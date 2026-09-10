/**
 * Venta application use cases (PR-2).
 *
 * Thin orchestrators over the pure domain calculators and the venta repository:
 * they resolve the client (R-V10), prepare/validate the lines through the shared
 * {@link prepararLineasVenta} pipeline (rates, validity, admin+cap discounts,
 * config hard-fail, stock warnings), then perform ONE guarded write + ONE audit
 * row inside the caller's `withTenantTransaction`. No business logic lives here;
 * no `prisma.*` call is made directly (ADR-013: data access only via infra).
 *
 * 5b lifecycle is DRAFT-FIRST: `crearVenta` produces a `BORRADOR`, `actualizarVenta`
 * replaces all lines while still `BORRADOR` (guarded), and `cancelarVenta` moves
 * `BORRADOR → CANCELADA` (guarded). Nothing here confirms or touches NCF/stock.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { registrarReposicionCancelacion } from "@/modules/inventario/application/registrar-salidas-venta";
import {
  ESTADO_VENTA,
  DESCUENTO_CERO,
  transicionarCancelarConfirmada,
  type Descuento,
  type EstadoVentaDraft,
  type VentaLineaInput,
} from "../domain/venta";
import {
  VENTA_INMUTABLE,
  VENTA_NO_ENCONTRADO,
  CONCURRENCIA_CONFLICTO,
  messageFor,
  VentaDomainError,
  type StockWarning,
  type VentaErrorCode,
  type VentaResult,
} from "../domain/errors";
import {
  crearVentaConLineasEnTx,
  actualizarVentaBorradorEnTx,
  reemplazarLineasVentaEnTx,
  cancelarVentaEnTx,
  cancelarVentaConfirmadaEnTx,
  anularFacturaDeVentaEnTx,
  leerFacturaVigenteDeVentaEnTx,
  registrarAuditFacturaEnTx,
  leerVentaParaConfirmarEnTx,
  leerVentaEnTx,
  listarVentasEnTx,
  contarVentasEnTx,
  obtenerVentaDetalleEnTx,
  registrarAuditVentaEnTx,
  type ListarVentasFiltro,
  type VentaDetalle,
  type VentaListRow,
} from "../infrastructure/venta-repository";
import { resolverClienteParaVentaEnTx } from "./resolver-cliente-venta";
import { prepararLineasVenta } from "./preparar-lineas-venta";
import {
  type VentaGuardadoSaveResult,
  ventaGuardadoError,
} from "./venta-guardado";

// --- Create ----------------------------------------------------------------

export interface CrearVentaInput {
  /** `null` (contado) resolves to the empresa's Consumidor Final. */
  readonly clienteId: number | null;
  readonly fecha: Date;
  readonly lineas: readonly VentaLineaInput[];
  readonly descuentoCabecera?: Descuento;
}

export interface CrearVentaOutput {
  readonly id: number;
  readonly estado: EstadoVentaDraft;
  readonly total: string;
  readonly subtotalGravado: string;
  readonly subtotalExento: string;
}

export type CrearVentaResult = VentaGuardadoSaveResult<CrearVentaOutput>;

/**
 * VENT-CREATE: persist a `BORRADOR` at the session empresa+branch. The client is
 * resolved first (contado → CF); lines are validated, rates frozen with a
 * validity window, discounts capped against `DESC_MAX` (admin-only) and branch
 * stock shortages surfaced as warnings — all in {@link prepararLineasVenta} and
 * all BEFORE any write. On success: one header + lines insert and one CREAR
 * audit row, in the same transaction.
 */
export async function crearVenta(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CrearVentaInput,
): Promise<CrearVentaResult> {
  const resuelto = await resolverClienteParaVentaEnTx(tx, ctx, input.clienteId);
  if (!resuelto.ok) return resuelto;

  const preparado = await prepararLineasVenta(tx, ctx, {
    lineas: input.lineas,
    descuentoCabecera: input.descuentoCabecera ?? DESCUENTO_CERO,
    fecha: input.fecha,
  });
  if (!preparado.ok) return preparado;
  const { data } = preparado;

  const { id } = await crearVentaConLineasEnTx(tx, ctx, {
    sucursalId: ctx.sucursalId,
    clienteId: resuelto.data.clienteId,
    usuarioId: ctx.usuarioId,
    fecha: input.fecha,
    lineas: data.lineas,
    totales: data.totales,
  });

  await registrarAuditVentaEnTx(tx, ctx, "CREAR", id, null, {
    id,
    estado: ESTADO_VENTA.BORRADOR,
    clienteId: resuelto.data.clienteId,
    total: data.total,
  });

  return {
    ok: true,
    data: {
      id,
      estado: ESTADO_VENTA.BORRADOR,
      total: data.total,
      subtotalGravado: data.subtotalGravado,
      subtotalExento: data.subtotalExento,
    },
    warnings: data.warnings,
  };
}

// --- Update ----------------------------------------------------------------

export interface ActualizarVentaInput {
  readonly id: number;
  /** Full replacement line set (delete-and-reinsert). */
  readonly lineas: readonly VentaLineaInput[];
  /** `undefined` keeps the current client; `null` switches to contado/CF. */
  readonly clienteId?: number | null;
  readonly fecha: Date;
  readonly descuentoCabecera?: Descuento;
}

export type ActualizarVentaResult = VentaGuardadoSaveResult<{
  readonly id: number;
  readonly total: string;
}>;

/**
 * VENT-EDIT: replace all lines (and optionally re-select the client) of a draft,
 * allowed ONLY while it is `BORRADOR`. A non-draft target is `VENTA_INMUTABLE`;
 * the guarded `UPDATE ... WHERE id AND empresaId AND sucursalId AND
 * estado='BORRADOR'` losing a concurrent race returns `CONCURRENCIA_CONFLICTO`
 * with NO line replacement and NO audit (no mixed line-set can persist). Totals
 * recompute from the new lines/rates.
 */
export async function actualizarVenta(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ActualizarVentaInput,
): Promise<ActualizarVentaResult> {
  const actual = await leerVentaEnTx(tx, ctx, input.id);
  if (actual === null) return ventaGuardadoError(VENTA_NO_ENCONTRADO);
  if (actual.estado !== ESTADO_VENTA.BORRADOR) {
    return ventaGuardadoError(VENTA_INMUTABLE);
  }

  // Client re-selection: undefined keeps the stored client; otherwise resolve
  // (null → contado CF, id → named/active) through the sale resolver.
  const clienteIdAResolver =
    input.clienteId === undefined ? actual.clienteId : input.clienteId;
  const resuelto = await resolverClienteParaVentaEnTx(tx, ctx, clienteIdAResolver);
  if (!resuelto.ok) return resuelto;

  const preparado = await prepararLineasVenta(tx, ctx, {
    lineas: input.lineas,
    descuentoCabecera: input.descuentoCabecera ?? DESCUENTO_CERO,
    fecha: input.fecha,
  });
  if (!preparado.ok) return preparado;
  const { data } = preparado;

  const { updated } = await actualizarVentaBorradorEnTx(
    tx,
    ctx,
    input.id,
    actual.updatedAt,
    { clienteId: resuelto.data.clienteId, totales: data.totales },
  );
  if (!updated) {
    // Lost the guarded race since the read: no lines replaced, no audit.
    return ventaGuardadoError(CONCURRENCIA_CONFLICTO);
  }

  await reemplazarLineasVentaEnTx(tx, input.id, data.lineas);

  await registrarAuditVentaEnTx(tx, ctx, "ACTUALIZAR", input.id, {
    estado: ESTADO_VENTA.BORRADOR,
    clienteId: actual.clienteId,
  }, {
    estado: ESTADO_VENTA.BORRADOR,
    clienteId: resuelto.data.clienteId,
    total: data.total,
  });

  return {
    ok: true,
    data: { id: input.id, total: data.total },
    warnings: data.warnings,
  };
}

// --- Cancel ----------------------------------------------------------------

export interface CancelarVentaInput {
  readonly id: number;
  /** Optional motivo — the draft never had fiscal effect. */
  readonly motivo?: string;
}

export type CancelarVentaResult = VentaResult<{
  readonly id: number;
  readonly estado: EstadoVentaDraft;
}>;

/** Lifecycle cancellation errors are all domain codes; build a typed error. */
function cancelError(
  code:
    | typeof VENTA_NO_ENCONTRADO
    | typeof VENTA_INMUTABLE
    | typeof CONCURRENCIA_CONFLICTO,
): { ok: false; code: VentaErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/** The default non-empty reposition reason when the operator supplies none. */
const REPOSICION_MOTIVO_DEFECTO = "Cancelación de venta confirmada";

/**
 * VENT-CANCEL: cancel a sale. Two distinct, mutually-exclusive lifecycles
 * (spec R-V16):
 *
 *   - DRAFT (`BORRADOR → CANCELADA`, R-V4, UNCHANGED): one guarded `updateMany`
 *     (`WHERE estado='BORRADOR'`) + affected-rows check. No invoice, no movement,
 *     no NCF — a draft never had fiscal or inventory effect.
 *   - CONFIRMADA (`CONFIRMADA → CANCELADA`, R-V16 / 608): guarded flip, then the
 *     linked `FACTURA` flips `VIGENTE → ANULADA` (never deleted), then the
 *     stock is restored via `registrarReposicionCancelacion`, with audit rows for
 *     BOTH reversals. The consumed NCF is NEVER rewound.
 *
 * A repeat cancel of an already-`CANCELADA` sale is the stable `VENTA_INMUTABLE`
 * error (terminal state, zero effects); a lost flip race is `CONCURRENCIA_CONFLICTO`.
 * Once the sale flip succeeds, every later failure (invoice not `VIGENTE`, or a
 * reposition rejection) THROWS so the whole cancellation rolls back — a confirmed
 * sale is never left half-reversed.
 */
export async function cancelarVenta(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CancelarVentaInput,
): Promise<CancelarVentaResult> {
  const venta = await leerVentaEnTx(tx, ctx, input.id);
  if (venta === null) return cancelError(VENTA_NO_ENCONTRADO);
  if (venta.estado === ESTADO_VENTA.CANCELADA) {
    // Terminal: a repeated cancel is a stable no-op, never a double reversal.
    return cancelError(VENTA_INMUTABLE);
  }

  // --- DRAFT path (R-V4 / R-V16 "Draft-cancel path untouched"). ---
  if (venta.estado === ESTADO_VENTA.BORRADOR) {
    const { cancelled } = await cancelarVentaEnTx(tx, ctx, input.id);
    if (!cancelled) {
      // Raced with a concurrent cancel/confirm between the read and the guard.
      return cancelError(CONCURRENCIA_CONFLICTO);
    }
    await registrarAuditVentaEnTx(
      tx,
      ctx,
      "CANCELAR",
      input.id,
      { estado: ESTADO_VENTA.BORRADOR },
      { estado: ESTADO_VENTA.CANCELADA },
      input.motivo?.trim() ? input.motivo.trim() : null,
    );
    return { ok: true, data: { id: input.id, estado: ESTADO_VENTA.CANCELADA } };
  }

  // --- CONFIRMADA path (R-V16). ---
  return cancelarVentaConfirmada(tx, ctx, input.id, input.motivo);
}

/**
 * The confirmed-cancellation reversal (R-V16). Precondition: the caller read the
 * sale as `CONFIRMADA`. Runs INSIDE the same tenant transaction and rolls back
 * atomically on any throw. Returns a typed error ONLY for the pre-flip race; every
 * post-flip failure throws so a half-reversed sale can never persist.
 */
async function cancelarVentaConfirmada(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventaId: number,
  motivo: string | undefined,
): Promise<CancelarVentaResult> {
  const gate = transicionarCancelarConfirmada(ESTADO_VENTA.CONFIRMADA);
  // `gate.estado` is `CANCELADA` by construction; the total switch documents that
  // ONLY a CONFIRMADA sale can enter this path (draft/terminal are routed away).
  void gate;

  // 1. Guarded CONFIRMADA → CANCELADA. Zero rows = a concurrent cancel/confirm won
  //    → typed conflict, and NOTHING else has run so there is nothing to roll back.
  const { cancelled } = await cancelarVentaConfirmadaEnTx(tx, ctx, ventaId);
  if (!cancelled) {
    return cancelError(CONCURRENCIA_CONFLICTO);
  }

  // 2. The sale is now CANCELADA under this transaction's lock. Every step below
  //    THROWS on failure (never returns) so the flip, the annul, the reposition and
  //    the audits all roll back together — a confirmed sale is never half-reversed.
  const factura = await leerFacturaVigenteDeVentaEnTx(tx, ctx, ventaId);
  if (factura === null) {
    // A CONFIRMADA sale must own a VIGENTE invoice; its absence is an integrity
    // conflict (e.g. already annulled) — never a silent double-annul.
    throw new VentaDomainError(CONCURRENCIA_CONFLICTO, { ventaId });
  }
  const { annulled } = await anularFacturaDeVentaEnTx(tx, ctx, ventaId);
  if (!annulled) {
    // Lost the VIGENTE predicate after the read: abort so the flip rolls back.
    throw new VentaDomainError(CONCURRENCIA_CONFLICTO, { facturaId: factura.id });
  }

  // 3. Restore branch stock: one REPOSICION_CANCELACION movement per persisted
  //    line, positive deltas, under the SAME ascending-product-id locks as the
  //    exit. Throws on a foreign product (post-flip → whole cancel rolls back).
  const lineas = await leerVentaParaConfirmarEnTx(tx, ctx, ventaId);
  const trimmed = motivo?.trim();
  await registrarReposicionCancelacion(tx, ctx, {
    ventaId,
    motivo: trimmed && trimmed.length > 0 ? trimmed : REPOSICION_MOTIVO_DEFECTO,
    lineas: (lineas?.lineas ?? []).map((l) => ({
      productoId: l.productoId,
      cantidad: l.cantidad,
    })),
  });

  // 4. Audit BOTH reversals (sale flip + invoice annul), append-only, same tx.
  await registrarAuditVentaEnTx(
    tx,
    ctx,
    "CANCELAR",
    ventaId,
    { estado: ESTADO_VENTA.CONFIRMADA },
    { estado: ESTADO_VENTA.CANCELADA },
    trimmed && trimmed.length > 0 ? trimmed : REPOSICION_MOTIVO_DEFECTO,
  );
  await registrarAuditFacturaEnTx(
    tx,
    ctx,
    factura.id,
    { estado: "VIGENTE" },
    { estado: "ANULADA" },
    trimmed && trimmed.length > 0 ? trimmed : REPOSICION_MOTIVO_DEFECTO,
  );

  return { ok: true, data: { id: ventaId, estado: ESTADO_VENTA.CANCELADA } };
}

// --- List / Detail ---------------------------------------------------------

export interface ListarVentasQuery {
  readonly page: number;
  readonly limit: number;
  readonly estado?: EstadoVentaDraft;
  /** "Mis borradores": restrict to the acting user's drafts. */
  readonly soloMios?: boolean;
}

export interface ListarVentasOutput {
  readonly items: readonly VentaListRow[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export type ListarVentasResult = VentaResult<ListarVentasOutput>;

const LIMIT_MIN = 1;
const LIMIT_MAX = 100;

/**
 * VENT-LIST: tenant+branch-scoped, paginated, deterministic listing (R-V12). The
 * page size is defensively clamped to `[1,100]` so an unbounded query can never
 * run even if a caller bypasses the HTTP boundary; the HTTP layer already rejects
 * an out-of-range size with a stable validation error. Supports the `estado` and
 * `usuarioId` ("mis borradores") filters.
 */
export async function listarVentas(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarVentasQuery,
): Promise<ListarVentasResult> {
  const page = Math.max(1, Math.trunc(query.page));
  const limit = Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.trunc(query.limit)));
  const filtro: ListarVentasFiltro = {
    page,
    limit,
    estado: query.estado,
    soloMios: query.soloMios,
  };

  const [items, total] = await Promise.all([
    listarVentasEnTx(tx, ctx, filtro),
    contarVentasEnTx(tx, ctx, filtro),
  ]);

  return { ok: true, data: { items, total, page, limit } };
}

export interface ObtenerVentaInput {
  readonly id: number;
}

export type ObtenerVentaResult = VentaResult<VentaDetalle>;

/**
 * VENT-GET: same-tenant/branch detail with lines (R-V12). A foreign id is
 * indistinguishable from a missing one (the repository filter pins both).
 */
export async function obtenerVenta(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ObtenerVentaInput,
): Promise<ObtenerVentaResult> {
  const detalle = await obtenerVentaDetalleEnTx(tx, ctx, input.id);
  if (detalle === null) {
    return {
      ok: false,
      code: VENTA_NO_ENCONTRADO,
      message: messageFor(VENTA_NO_ENCONTRADO),
    };
  }
  return { ok: true, data: detalle };
}

// Re-exported so callers/tests can reference the warnings shape from one place.
export type { StockWarning };
