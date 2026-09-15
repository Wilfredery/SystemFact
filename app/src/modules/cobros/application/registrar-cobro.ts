/**
 * Cobros application — register a customer collection (COBRO) (R-C1, R-C2).
 *
 * Thin orchestration over the domain + infrastructure. Everything runs inside
 * the caller's `withTenantTransaction`, so the RLS GUCs are already in force and
 * the whole revalidation → allocation → insert is one atomic unit. No business
 * rule lives in the HTTP adapter (ADR-013).
 *
 * Guarantees:
 *   • the invoice must exist for this tenant and be `VIGENTE`, else
 *     `FACTURA_COBRO_NO_VIGENTE` and NOTHING is written;
 *   • the invoice row is locked (`FOR UPDATE`) and the pending balance is
 *     recomputed INSIDE the transaction, so a concurrent collection is judged
 *     against the balance at its own snapshot;
 *   • a `monto` greater than the recomputed balance is rejected with
 *     `COBRO_EXCEDE_SALDO` (over-payment never drives the balance negative);
 *   • the receipt number is allocated company-wide under the `EMPRESA` lock
 *     (R-C4), then the `COBRO`/`APLICADO` row is inserted `EFECTIVO`-only with
 *     `Decimal` money end-to-end.
 *
 * Idempotency of a collection is inherent: each `registrarCobro` is a distinct
 * payment the caller chose to make; only refunds carry a client idempotency key
 * (see `registrar-reembolso.ts`). Multiple partial payments (abonos) on one
 * invoice are simply multiple calls, each re-guarded against the balance left
 * after the previous commits.
 */

import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  COBRO_EXCEDE_SALDO,
  FACTURA_COBRO_NO_VIGENTE,
  messageFor,
  type CobroErrorCode,
} from "../domain/errors";
import {
  ESTADO_PAGO,
  TIPO_PAGO,
  aDecimalMonto,
  type CobroResult,
} from "../domain/pago";
import {
  bloquearYCalcularSaldoFacturaEnTx,
} from "../infrastructure/saldo-cxc.repository";
import { asignarCorrelativoReciboEnTx } from "../infrastructure/recibo.repository";
import { crearPagoEnTx } from "../infrastructure/pago-repository";

/** A collection request — one payment against one invoice. */
export interface RegistrarCobroInput {
  readonly facturaId: number;
  /** Positive `Decimal(12,2)` amount as a string (Zod guarantees the shape). */
  readonly monto: string;
  /** Payment instant; defaults to now (the acting server clock). */
  readonly fecha?: Date;
}

/** Committed collection: the persisted payment and the new pending balance. */
export interface RegistrarCobroOutput {
  readonly pagoId: number;
  readonly correlativoRecibo: number;
  readonly total: string;
  readonly saldoPendiente: string;
}

function buildError(code: CobroErrorCode): CobroResult<never> {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * Registers a `COBRO/APLICADO` against a VIGENTE invoice, rejecting over-payment
 * with `COBRO_EXCEDE_SALDO` after a row-locked in-transaction balance recompute.
 */
export async function registrarCobro(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: RegistrarCobroInput,
): Promise<CobroResult<RegistrarCobroOutput>> {
  const monto = aDecimalMonto(input.monto);
  if (monto.lessThanOrEqualTo(0)) {
    // Unreachable via HTTP (Zod requires a positive amount); a non-positive
    // amount is a programming-contract violation, not a business state, so it
    // fails loud and rolls the transaction back rather than inventing a code.
    throw new Error("registrarCobro: el monto debe ser mayor que cero");
  }

  // Lock the invoice and recompute its pending balance atomically (R-C2). A
  // missing / cross-tenant / non-VIGENTE invoice collapses to `null`.
  const saldo = await bloquearYCalcularSaldoFacturaEnTx(tx, ctx, input.facturaId);
  if (saldo === null) {
    return buildError(FACTURA_COBRO_NO_VIGENTE);
  }

  const pendiente = new Decimal(saldo.saldoPendiente);
  if (monto.greaterThan(pendiente)) {
    return buildError(COBRO_EXCEDE_SALDO);
  }

  const correlativoRecibo = await asignarCorrelativoReciboEnTx(
    tx,
    ctx.empresaId,
    ctx.sucursalId,
  );

  const { id: pagoId } = await crearPagoEnTx(tx, ctx, {
    facturaId: input.facturaId,
    tipo: TIPO_PAGO.COBRO,
    estado: ESTADO_PAGO.APLICADO,
    monto: monto.toFixed(2),
    fecha: input.fecha ?? new Date(),
    correlativoRecibo,
    idempotencyKey: null,
    autorizadoPor: null,
  });

  return {
    ok: true,
    data: {
      pagoId,
      correlativoRecibo,
      total: saldo.total,
      saldoPendiente: pendiente.minus(monto).toFixed(2),
    },
  };
}
