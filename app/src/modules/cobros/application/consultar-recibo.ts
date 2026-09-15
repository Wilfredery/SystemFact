/**
 * Cobros application — read one receipt for rePRINTING (R-C4).
 *
 * A thin read orchestration over the pago repository: given an empresa-scoped
 * `correlativoRecibo`, it returns the persisted payment facts for the printable,
 * NON-fiscal receipt view (a reprint is a copy of a payment already reflected on its
 * VIGENTE invoice — it is NEVER a new tax document). A missing/foreign number maps
 * to the cobros catalog's `PAGO_NO_ENCONTRADO`, so the reprint surface stays inside
 * the single versioned error catalog (R-C5) with no internal error crossing HTTP.
 *
 * Runs inside the caller's `withTenantTransaction`, so the read is already RLS-bound
 * (the `empresaId` pin is the second defense). Money crosses as a Decimal-string.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { PAGO_NO_ENCONTRADO, messageFor } from "../domain/errors";
import type { CobroResult } from "../domain/pago";
import { leerReciboEnTx, type ReciboLeido } from "../infrastructure/pago-repository";

/** The reprint input: a company receipt number. */
export interface ConsultarReciboInput {
  readonly correlativoRecibo: number;
}

/** A printable, non-fiscal receipt projection for the UI. */
export interface ReciboVista {
  readonly correlativoRecibo: number;
  readonly tipo: string;
  readonly estado: string;
  readonly monto: string;
  readonly metodoPago: string;
  /** ISO/UTC payment instant; the UI resolves it to `America/Santo_Domingo`. */
  readonly fecha: string;
  readonly autorizadoPor: number | null;
  readonly facturaId: number;
  readonly facturaNcf: string;
  readonly clienteNombre: string;
  readonly usuarioNombre: string;
  readonly empresaNombre: string;
}

/** Reads a receipt for reprint, or `PAGO_NO_ENCONTRADO` when it is absent/foreign. */
export async function consultarRecibo(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ConsultarReciboInput,
): Promise<CobroResult<ReciboVista>> {
  const recibo = await leerReciboEnTx(tx, ctx, input.correlativoRecibo);
  if (recibo === null) {
    return {
      ok: false,
      code: PAGO_NO_ENCONTRADO,
      message: messageFor(PAGO_NO_ENCONTRADO),
    };
  }
  return { ok: true, data: toVista(recibo) };
}

/** Map the raw repository row to the stable UI DTO (Decimal-string money kept). */
function toVista(r: ReciboLeido): ReciboVista {
  return {
    correlativoRecibo: r.correlativoRecibo,
    tipo: r.tipo,
    estado: r.estado,
    monto: r.monto,
    metodoPago: r.metodoPago,
    fecha: r.fecha.toISOString(),
    autorizadoPor: r.autorizadoPor,
    facturaId: r.facturaId,
    facturaNcf: r.facturaNcf,
    clienteNombre: r.clienteNombre,
    usuarioNombre: r.usuarioNombre,
    empresaNombre: r.empresaNombre,
  };
}
