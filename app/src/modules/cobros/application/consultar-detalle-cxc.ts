/**
 * Cobros application — per-invoice CxC detail (board-03 S13).
 *
 * The read behind `/cobros/factura/[facturaId]`: ONE invoice's canonical derived
 * balance (total / abonado / saldo — never a second formula, ADR-017) plus the
 * fiscal identity, the client facts and its full payment history. Every derived
 * date/mora fact comes from the SAME pure `en-mora` helpers the board uses, so
 * the detail page and the board row for that invoice can never disagree:
 *
 *   • `vencimiento` — `fechaEmision + CLIENTE.plazoCreditoDias` as an SD calendar
 *     date (`fechaVencimiento`);
 *   • `diasVencida` — the SIGNED SD day distance (`diasHastaVencimientoEnSD`):
 *     `> 0` overdue, `0` due today, `< 0` days remaining;
 *   • `enMora` — the R-B3 flag (`enMora`), i.e. exactly `diasVencida > 0`.
 *
 * Runs inside the caller's `withTenantTransaction`, so both reads are already
 * RLS-bound; the explicit `empresaId` pins are the second defense. Money crosses
 * here as `Decimal(12,2)` strings and is never summed or re-derived. A missing,
 * foreign or non-`VIGENTE` invoice collapses to the catalog's
 * `FACTURA_COBRO_NO_VIGENTE` — the whole surface stays inside the single
 * versioned error catalog (R-C5), with no internal error crossing HTTP.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { FACTURA_COBRO_NO_VIGENTE, messageFor } from "../domain/errors";
import {
  diasHastaVencimientoEnSD,
  enMora,
  fechaVencimiento,
} from "../domain/en-mora";
import type { CobroResult, EstadoPago, TipoPago } from "../domain/pago";
import {
  consultarDetalleCxcEnTx,
  type FilaDetalleCxc,
} from "../infrastructure/saldo-cxc.repository";
import {
  leerHistorialPagosFacturaEnTx,
  type FilaPagoHistorial,
} from "../infrastructure/pago-repository";

/** The detail read input; `now` is injected for deterministic mora tests. */
export interface ConsultarDetalleCxcInput {
  readonly facturaId: number;
  readonly now?: Date;
}

/** One payment of the invoice's history, as the screen renders it. */
export interface PagoHistorialVista {
  readonly correlativoRecibo: number;
  /** ISO/UTC instant; the UI resolves it to `America/Santo_Domingo`. */
  readonly fecha: string;
  readonly tipo: TipoPago;
  readonly estado: EstadoPago;
  readonly monto: string;
  readonly metodoPago: string;
  /**
   * Free-text payment reference. V1's `PAGO` has no such column, so this rides
   * `null` and the history renders it unchanged once S14/T10 adds the field.
   */
  readonly referencia: string | null;
  readonly usuarioNombre: string;
}

/** One invoice's detail projection for the per-invoice screen (S13). */
export interface DetalleCxcVista {
  readonly facturaId: number;
  readonly ncf: string;
  readonly correlativoInterno: string;
  /** ISO/UTC emission instant. */
  readonly fechaEmision: string;
  /** SD calendar due date (`YYYY-MM-DD`). */
  readonly vencimiento: string;
  readonly clienteId: number;
  readonly clienteNombre: string;
  readonly clienteRnc: string | null;
  /** Schema `TipoCliente` literal; the UI reads it as Crédito / Contado. */
  readonly tipoCliente: string;
  readonly total: string;
  readonly abonado: string;
  readonly saldo: string;
  /** SIGNED SD days past the due date (`< 0` = days remaining). */
  readonly diasVencida: number;
  readonly enMora: boolean;
  readonly historial: readonly PagoHistorialVista[];
}

/**
 * Reads one invoice's header + payment history, or `FACTURA_COBRO_NO_VIGENTE`
 * when the invoice is absent, foreign or no longer `VIGENTE`.
 */
export async function consultarDetalleCxc(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ConsultarDetalleCxcInput,
): Promise<CobroResult<DetalleCxcVista>> {
  const fila = await consultarDetalleCxcEnTx(tx, ctx, input.facturaId);
  if (fila === null) {
    return {
      ok: false,
      code: FACTURA_COBRO_NO_VIGENTE,
      message: messageFor(FACTURA_COBRO_NO_VIGENTE),
    };
  }
  // The history is only meaningful for an invoice that exists in the canonical
  // view, so it is read AFTER the header resolved (never a stray PAGO list).
  const historial = await leerHistorialPagosFacturaEnTx(tx, ctx, input.facturaId);
  return {
    ok: true,
    data: derivarDetalle(fila, historial, input.now ?? new Date()),
  };
}

/** The single pure mapping row + history → the screen's projection. */
function derivarDetalle(
  fila: FilaDetalleCxc,
  historial: readonly FilaPagoHistorial[],
  now: Date,
): DetalleCxcVista {
  const plazo = fila.plazoCreditoDias;
  return {
    facturaId: fila.facturaId,
    ncf: fila.ncf,
    correlativoInterno: fila.correlativoInterno,
    fechaEmision: fila.fechaEmision.toISOString(),
    vencimiento: fechaVencimiento(fila.fechaEmision, plazo),
    clienteId: fila.clienteId,
    clienteNombre: fila.clienteNombre,
    clienteRnc: fila.clienteIdentificacionFiscal,
    tipoCliente: fila.clienteTipoCliente,
    total: fila.total,
    abonado: fila.cobrosAplicados,
    saldo: fila.saldoPendiente,
    diasVencida: diasHastaVencimientoEnSD({
      fechaEmision: fila.fechaEmision,
      plazoCreditoDias: plazo,
      now,
    }),
    enMora: enMora({ fechaEmision: fila.fechaEmision, plazoCreditoDias: plazo, now }),
    historial: historial.map((p) => ({
      correlativoRecibo: p.correlativoRecibo,
      fecha: p.fecha.toISOString(),
      tipo: p.tipo,
      estado: p.estado,
      monto: p.monto,
      metodoPago: p.metodoPago,
      referencia: null,
      usuarioNombre: p.usuarioNombre,
    })),
  };
}
