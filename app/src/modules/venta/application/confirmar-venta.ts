/**
 * Sale confirmation (spec R-V15, R-F1..R-F4) — application orchestration.
 *
 * `confirmarVenta` runs INSIDE the caller's `withTenantTransaction` (it never
 * opens one) and executes the frozen observable ORDER from design "Interfaces":
 *   read + branch guard → pure `transicionarConfirmar` → emission gate
 *   (`facturaAutomatica`) → NCF-type eligibility → HARD stock preview (reject
 *   BEFORE any burn) → NCF lock+consume → guarded `UPDATE ... WHERE estado=
 *   'BORRADOR'` flip → recomputed `FACTURA(VIGENTE)` → (PR-3 `registrarSalidasVenta`)
 *   → warnings.
 *
 * Two invariants make this safe:
 *   1. Nothing that CONSUMES runs before the emission gate or the HARD preview, so
 *      a `FACTURA_AUTOMATICA_FALTA` / `STOCK_INSUFICIENTE_BLOQUEO` / missing-range
 *      failure returns a typed error having burned no NCF and mutated no state.
 *   2. EVERY failure after a successful consume THROWS (never returns) — so the
 *      flip, the invoice and the advanced sequence all roll back together. The
 *      guarded flip losing a concurrent race is the canonical case: throwing there
 *      un-burns the loser's number and keeps exactly one invoice (R-V15 idempotency).
 */

import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  consumirNcfEnTx,
  NcfConsumoError,
  type NcfConsumoErrorCode,
} from "@/modules/ncf/application/consumir-ncf";
import { NCF_UMBRAL_90, type NcfWarning, type TipoNcfEmitido } from "@/modules/ncf/domain/ncf-rules";
import { ESTADO_VENTA, transicionarConfirmar } from "../domain/venta";
import {
  messageFor,
  VentaDomainError,
  VENTA_INMUTABLE,
  VENTA_NO_ENCONTRADO,
  CONCURRENCIA_CONFLICTO,
  FACTURA_AUTOMATICA_FALTA,
  STOCK_INSUFICIENTE_BLOQUEO,
  type VentaErrorCode,
} from "../domain/errors";
import { seleccionarTipoNcf } from "./elegibilidad-ncf";
import {
  crearFacturaEnTx,
  confirmarVentaFlipEnTx,
  leerClienteParaElegibilidadEnTx,
  leerFacturaAutomaticaDeEmpresaEnTx,
  leerFacturaDeVentaEnTx,
  leerStockSucursalEnTx,
  leerVentaParaConfirmarEnTx,
  asignarCorrelativoFacturaEnTx,
  type FacturaPersistencia,
} from "../infrastructure/venta-repository";

/** A non-blocking confirmation warning — currently only the 90% NCF threshold. */
export interface ConfirmarVentaWarning {
  readonly code: typeof NCF_UMBRAL_90;
}

export interface ConfirmarVentaInput {
  readonly id: number;
}

/** The confirmed sale plus its emitted invoice, all money as Decimal strings. */
export interface ConfirmarVentaOutput {
  readonly id: number;
  readonly estado: typeof ESTADO_VENTA.CONFIRMADA;
  readonly facturaId: number;
  readonly ncf: string;
  readonly tipoNcf: TipoNcfEmitido;
  readonly correlativoInterno: string;
  readonly subtotalGravado: string;
  readonly subtotalExento: string;
  readonly itbis: string;
  readonly descuento: string;
  readonly total: string;
}

export type ConfirmarVentaResult =
  | { readonly ok: true; readonly data: ConfirmarVentaOutput; readonly warnings?: readonly ConfirmarVentaWarning[] }
  | { readonly ok: false; readonly code: VentaErrorCode; readonly message: string };

/** Build a typed confirmation failure from a domain code. */
function confirmarError(code: VentaErrorCode): ConfirmarVentaResult {
  return { ok: false, code, message: messageFor(code) };
}

/** The ncf-engine consume codes are the SAME stable strings venta now pins (R-V13). */
function mapearCodigoNcf(code: NcfConsumoErrorCode): VentaErrorCode {
  return code as VentaErrorCode;
}

/** Aggregate the requested quantity per product across the persisted lines. */
function demandaPorProducto(
  lineas: readonly { readonly productoId: number; readonly cantidad: string }[],
): Map<number, Decimal> {
  const mapa = new Map<number, Decimal>();
  for (const l of lineas) {
    mapa.set(l.productoId, (mapa.get(l.productoId) ?? new Decimal(0)).plus(l.cantidad));
  }
  return mapa;
}

/**
 * Recompute the invoice breakdown from the PERSISTED lines (R-F3): `subtotalGravado`
 * = Σ final bases at a rate > 0 (16% counts as gravado), `subtotalExento` = Σ bases
 * at rate 0, `itbis` = Σ per-line ITBIS. The header identity
 * `total = subtotal − descuento + itbis` is reconstructed from the server-frozen
 * header `subtotal`/`descuento` (never a client payload) and holds exactly; by the
 * draft calculator `gravado + exento = subtotal − descuento`, so the two views agree.
 */
function recomponerTotalesFactura(venta: {
  readonly subtotal: string;
  readonly descuento: string;
  readonly lineas: readonly {
    readonly tasaItbis: string;
    readonly subtotalLinea: string;
    readonly itbisLinea: string;
  }[];
}): {
  subtotalGravado: string;
  subtotalExento: string;
  itbis: string;
  total: string;
} {
  let gravado = new Decimal(0);
  let exento = new Decimal(0);
  let itbis = new Decimal(0);
  for (const l of venta.lineas) {
    const base = new Decimal(l.subtotalLinea);
    if (new Decimal(l.tasaItbis).greaterThan(0)) gravado = gravado.plus(base);
    else exento = exento.plus(base);
    itbis = itbis.plus(new Decimal(l.itbisLinea));
  }
  const total = new Decimal(venta.subtotal)
    .minus(new Decimal(venta.descuento))
    .plus(itbis);
  return {
    subtotalGravado: gravado.toFixed(2),
    subtotalExento: exento.toFixed(2),
    itbis: itbis.toFixed(2),
    total: total.toFixed(2),
  };
}

/**
 * CONFIRM a `BORRADOR` sale: flip it and emit its `VIGENTE` invoice atomically.
 * Returns a typed error for every PRE-consume rejection; throws (rolling the whole
 * transaction back) for every failure after a successful consume.
 */
export async function confirmarVenta(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ConfirmarVentaInput,
): Promise<ConfirmarVentaResult> {
  // 1. Branch-guarded read (foreign branch / missing → not-found, zero disclosure).
  const venta = await leerVentaParaConfirmarEnTx(tx, ctx, input.id);
  if (venta === null) return confirmarError(VENTA_NO_ENCONTRADO);

  // 2. Pure confirmation gate. A retry on an already-`CONFIRMADA` sale (or a
  //    `CANCELADA` one) is refused here — BEFORE any consume — as `VENTA_INMUTABLE`
  //    with its existing invoice left intact (no second NCF, no second FACTURA).
  const transicion = transicionarConfirmar(venta.estado);
  if (!transicion.permitido) return confirmarError(VENTA_INMUTABLE);

  // 3. Emission gate (R-F1): `facturaAutomatica=false` blocks BEFORE any NCF work.
  const facturaAutomatica = await leerFacturaAutomaticaDeEmpresaEnTx(tx, ctx.empresaId);
  if (!facturaAutomatica) return confirmarError(FACTURA_AUTOMATICA_FALTA);

  // 4. NCF-type eligibility (R-F2): B01 for a taxpayer, else B02 (fail-closed).
  const cliente = await leerClienteParaElegibilidadEnTx(tx, ctx.empresaId, venta.clienteId);
  if (cliente === null) return confirmarError(VENTA_NO_ENCONTRADO);
  const elegibilidad = seleccionarTipoNcf(cliente);

  // 5. HARD stock preview (pre-NCF boundary, R-V15). Phase 3 owns the authoritative
  //    post-consume block; here the same shortage is rejected BEFORE any burn so a
  //    draft that cannot be sold never consumes a sequence number.
  const demanda = demandaPorProducto(venta.lineas);
  const stocks = await leerStockSucursalEnTx(tx, ctx.sucursalId, [...demanda.keys()]);
  const disponible = new Map(stocks.map((s) => [s.productoId, new Decimal(s.disponible)]));
  for (const [productoId, pedida] of demanda) {
    if (pedida.greaterThan(disponible.get(productoId) ?? new Decimal(0))) {
      return confirmarError(STOCK_INSUFICIENTE_BLOQUEO);
    }
  }

  // 6. NCF lock + consume. Missing / exhausted / expired all THROW before advancing
  //    (nothing burned), so mapping them back to venta's stable codes is safe.
  let ncf: string;
  let secuencial: number;
  let warning: NcfWarning | undefined;
  try {
    const consumido = await consumirNcfEnTx(tx, ctx, elegibilidad.tipo);
    ncf = consumido.ncf;
    secuencial = consumido.secuencial;
    warning = consumido.warning;
  } catch (err) {
    if (err instanceof NcfConsumoError) {
      return confirmarError(mapearCodigoNcf(err.code));
    }
    throw err;
  }

  // ---- POST-CONSUME: every failure below MUST throw so the sequence rolls back. ----

  // 7. Guarded flip. Zero rows = a concurrent confirm won → throw (never return) so
  //    this transaction's consume is un-burnt and only one invoice survives.
  const { flipUpdated } = await confirmarVentaFlipEnTx(tx, ctx, venta.id);
  if (!flipUpdated) throw new VentaDomainError(CONCURRENCIA_CONFLICTO);

  // 8. Emit the FACTURA: recomputed breakdown + atomic correlativo (branch GUC
  //    restored inside the allocator's finally) + branch-scoped insert.
  const totales = recomponerTotalesFactura(venta);
  const correlativoInterno = await asignarCorrelativoFacturaEnTx(tx, ctx.empresaId, ctx.sucursalId);
  const factura: FacturaPersistencia = {
    ventaId: venta.id,
    clienteId: venta.clienteId,
    usuarioId: ctx.usuarioId,
    sucursalId: ctx.sucursalId,
    tipoNcf: elegibilidad.tipo,
    ncf,
    correlativoInterno,
    subtotalGravado: totales.subtotalGravado,
    subtotalExento: totales.subtotalExento,
    itbis: totales.itbis,
    descuento: venta.descuento,
    total: totales.total,
    fechaEmision: new Date(),
  };
  const { id: facturaId } = await crearFacturaEnTx(tx, ctx, factura);

  // 9. (PR-3) registrarSalidasVenta — the authoritative stock debit + movements.
  void secuencial; // reserved for later audit/nota flows; the invoice carries the NCF.

  const warnings: ConfirmarVentaWarning[] =
    warning === NCF_UMBRAL_90 ? [{ code: NCF_UMBRAL_90 }] : [];
  const resultado: ConfirmarVentaResult = {
    ok: true,
    data: {
      id: venta.id,
      estado: ESTADO_VENTA.CONFIRMADA,
      facturaId,
      ncf,
      tipoNcf: elegibilidad.tipo,
      correlativoInterno,
      ...totales,
      descuento: venta.descuento,
    },
  };
  return warnings.length > 0 ? { ...resultado, warnings } : resultado;
}

/**
 * Read a confirmed sale's existing invoice for the HTTP/UI projection. Not part of
 * the confirm transaction; a convenience for callers that must show the invoice.
 */
export async function leerFacturaDeVentaConfirmadaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventaId: number,
): Promise<
  | { readonly id: number; readonly ncf: string; readonly tipoNcf: string; readonly correlativoInterno: string; readonly total: string }
  | null
> {
  return leerFacturaDeVentaEnTx(tx, ctx, ventaId);
}
