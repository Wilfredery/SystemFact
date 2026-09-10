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
import {
  ESTADO_VENTA,
  DESCUENTO_CERO,
  type Descuento,
  type EstadoVentaDraft,
  type VentaLineaInput,
} from "../domain/venta";
import {
  VENTA_INMUTABLE,
  VENTA_NO_ENCONTRADO,
  CONCURRENCIA_CONFLICTO,
  messageFor,
  type StockWarning,
  type VentaErrorCode,
  type VentaResult,
} from "../domain/errors";
import {
  crearVentaConLineasEnTx,
  actualizarVentaBorradorEnTx,
  reemplazarLineasVentaEnTx,
  cancelarVentaEnTx,
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

/**
 * VENT-CANCEL: transition `BORRADOR → CANCELADA` via ONE guarded `updateMany`
 * (`WHERE id AND empresaId AND sucursalId AND estado='BORRADOR'`) plus an
 * affected-rows check. A draft read as already non-`BORRADOR` is `VENTA_INMUTABLE`
 * (the state was observed after a committed cancel); a read that saw `BORRADOR`
 * but whose guard then matched zero rows is `CONCURRENCIA_CONFLICTO` (a parallel
 * cancel won). Either way NO second audit row is appended and stock/NCF/config
 * remain untouched. The motivo is optional.
 */
export async function cancelarVenta(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CancelarVentaInput,
): Promise<CancelarVentaResult> {
  const venta = await leerVentaEnTx(tx, ctx, input.id);
  if (venta === null) return cancelError(VENTA_NO_ENCONTRADO);
  if (venta.estado !== ESTADO_VENTA.BORRADOR) {
    return cancelError(VENTA_INMUTABLE);
  }

  const { cancelled } = await cancelarVentaEnTx(tx, ctx, input.id);
  if (!cancelled) {
    // Raced with a concurrent cancel between the read and the guard.
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
