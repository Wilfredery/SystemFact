/**
 * Sale confirmation (spec R-V15, R-F1..R-F4) — application orchestration.
 *
 * `confirmarVenta` runs INSIDE the caller's `withTenantTransaction` (it never
 * opens one) and executes the frozen observable ORDER from design "Interfaces":
 *   read + branch guard → pure `transicionarConfirmar` → emission gate
 *   (`facturaAutomatica`) → NCF-type eligibility → HARD stock preview (reject
 *   BEFORE any burn) → CREDIT GATE for credit sales via `EvaluarCreditoPort`
 *   (reject BEFORE the NCF lock) → NCF lock+consume → guarded `UPDATE ... WHERE
 *   estado='BORRADOR'` flip → recomputed `FACTURA(VIGENTE)` → (PR-3
 *   `registrarSalidasVenta`) → CONTADO `COBRO/APLICADO` full total (close the
 *   loop) → warnings.
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
import { registrarSalidasVenta } from "@/modules/inventario/application/registrar-salidas-venta";
import {
  evaluarCreditoPort,
  type CreditoRechazo,
  type CreditResult,
} from "@/modules/cobros/application/credit-port";
import { registrarCobro } from "@/modules/cobros/application/registrar-cobro";
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
  type StockWarning,
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
  | {
      readonly ok: false;
      readonly code: VentaErrorCode | CreditoRechazo;
      readonly message: string;
    };

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
 * PURE pre-consume availability check (R-V15 hard preview, quality-polish 1e):
 * every demanded product whose requested quantity exceeds its branch stock (a
 * missing row counts as zero) yields one {@link StockWarning}. The orchestrator
 * turns a non-empty list into `STOCK_INSUFICIENTE_BLOQUEO` — the identical
 * predicate the inline loop applied, only relocated before the NCF consume.
 * Reads/calculation only: no DB, no state, no transaction semantics.
 */
export function verificarDisponibilidadPreNcf(
  demanda: ReadonlyMap<number, Decimal>,
  stocks: readonly { readonly productoId: number; readonly disponible: string }[],
): StockWarning[] {
  const disponible = new Map(stocks.map((s) => [s.productoId, new Decimal(s.disponible)]));
  const faltantes: StockWarning[] = [];
  for (const [productoId, pedida] of demanda) {
    const disponiblePara = disponible.get(productoId) ?? new Decimal(0);
    if (pedida.greaterThan(disponiblePara)) {
      faltantes.push({
        code: "STOCK_INSUFICIENTE",
        productoId,
        available: disponiblePara.toFixed(3),
        requested: pedida.toFixed(3),
      });
    }
  }
  return faltantes;
}

/**
 * PURE pre-consume credit rejection (R-V15, R-K2): a `CREDITO` sale the credit
 * gate refused (`forma === "CREDITO" && !permitido`) is turned into the typed
 * rejection result that relays the stable cobros code/message unchanged; every
 * other outcome (a `CONTADO` sale, or an allowed `CREDITO`) yields `null` so the
 * sale proceeds to the NCF consume. Reads only — no DB, no state. This is the
 * second-largest pre-consume branch cluster, split out of `confirmarVenta` so the
 * orchestrator stays inside the complexity ceiling while the gate still runs
 * AFTER the hard stock preview and BEFORE the NCF lock/consume (burn-free).
 */
export function resolverRechazoCredito(
  credito: CreditResult,
): ConfirmarVentaResult | null {
  if (credito.forma === "CREDITO" && !credito.permitido) {
    return { ok: false, code: credito.code, message: credito.message };
  }
  return null;
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
  //    draft that cannot be sold never consumes a sequence number. The pure
  //    predicate lives in `verificarDisponibilidadPreNcf` (quality-polish 1e).
  const demanda = demandaPorProducto(venta.lineas);
  const stocks = await leerStockSucursalEnTx(tx, ctx.sucursalId, [...demanda.keys()]);
  if (verificarDisponibilidadPreNcf(demanda, stocks).length > 0) {
    return confirmarError(STOCK_INSUFICIENTE_BLOQUEO);
  }

  // 5b. Recompute the invoice breakdown from the PERSISTED lines UP-FRONT (R-F3) so
  //     the credit gate (pre-consume) and the FACTURA (post-consume) share the exact
  //     same server-frozen total — one derivation, never two that could diverge.
  const totales = recomponerTotalesFactura(venta);

  // 5c. CREDIT GATE (R-V15, R-K2). Only credit sales are gated, and the gate runs
  //     AFTER the hard stock preview and BEFORE the NCF lock/consume, so a blocked
  //     client is refused WITHOUT burning a sequence number: the sale stays
  //     `BORRADOR` with no NCF, invoice, debit or COBRO (spec "credit-blocked
  //     client rejected before NCF consumption"). `venta` consumes ONLY the
  //     `EvaluarCreditoPort` application port — no ORM, no cobros infrastructure,
  //     no duplicated balance rule (R-K1). A `CONTADO` result carries no decision:
  //     the sale simply proceeds (and is closed with a COBRO after the invoice).
  const credito = await evaluarCreditoPort.evaluarCreditoCliente(tx, ctx, {
    clienteId: venta.clienteId,
    totalVenta: totales.total,
    fecha: new Date(),
  });
  const rechazoCredito = resolverRechazoCredito(credito);
  if (rechazoCredito !== null) return rechazoCredito;

  // 6. NCF lock + consume. Missing / exhausted / expired all THROW before advancing
  //    (nothing burned), so mapping them back to venta's stable codes is safe.
  //    The consumed `secuencial` is deliberately not surfaced: the invoice carries
  //    the NCF (quality-polish 1e closed the S3735 `void` here by dropping it).
  let ncf: string;
  let warning: NcfWarning | undefined;
  try {
    const consumido = await consumirNcfEnTx(tx, ctx, elegibilidad.tipo);
    ncf = consumido.ncf;
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

  // 8. Emit the FACTURA: recomputed breakdown (from the `totales` derived at 5b) +
  //    atomic correlativo (branch GUC restored inside the allocator's finally) +
  //    branch-scoped insert.
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

  // 9. AUTHORITATIVE stock exit (R-V15, PR-3). This is the real post-consume
  //    block: `registrarSalidasVenta` debits the branch rows, writes one
  //    `SALIDA_VENTA` movement per line, and THROWS `STOCK_INSUFICIENTE_BLOQUEO`
  //    on any shortage (or `INVENTARIO_NO_ENCONTRADO` on a foreign product). A
  //    throw here — AFTER the flip, invoice and consume — aborts the whole
  //    transaction, un-burning the NCF and discarding the invoice/debit, so the
  //    sale stays `BORRADOR` (spec "Post-consume stock rejection rolls everything
  //    back"). The step-5 hard preview is only an early fast-fail; THIS is the
  //    authoritative gate because it locks the rows and applies the batch atomically.
  await registrarSalidasVenta(tx, ctx, {
    ventaId: venta.id,
    lineas: venta.lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad })),
  });

  // 10. CONTADO CLOSE-THE-LOOP (R-V15). A cash sale is settled the instant it is
  //     confirmed: register EXACTLY ONE `COBRO/APLICADO` for the full invoice
  //     total (via the cobros collection use case — no ORM leak into `venta`), so
  //     the derived payment state resolves to `PAGADA` and a cash invoice never
  //     resurfaces as a phantom `PENDIENTE` on the CxC board. It runs POST-CONSUME,
  //     so any failure THROWS (never returns): a later abort leaves no COBRO row
  //     (spec "if the transaction later aborts, no COBRO persists"). A CREDIT sale
  //     is deliberately NOT closed here — it stays an open receivable the board
  //     collects through `registrarCobro`. A freshly-emitted VIGENTE invoice always
  //     has pending == total, so a rejection is an invariant defect, not a business
  //     state; throwing aborts the transaction and rolls every effect back.
  if (credito.forma === "CONTADO") {
    const cobro = await registrarCobro(tx, ctx, {
      facturaId,
      monto: totales.total,
    });
    if (!cobro.ok) {
      throw new Error(
        `confirmarVenta: cobro contado rechazado para la venta ${String(venta.id)} (${cobro.code})`,
      );
    }
  }

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
