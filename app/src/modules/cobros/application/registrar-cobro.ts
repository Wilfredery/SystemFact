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
 *   • the optional `fechaCobro` is bounded to the tenant's SD date band (S14)
 *     before the lock, so a future/out-of-horizon date writes nothing;
 *   • the invoice row is locked (`FOR UPDATE`) and the pending balance is
 *     recomputed INSIDE the transaction, so a concurrent collection is judged
 *     against the balance at its own snapshot;
 *   • a `monto` greater than the recomputed balance is rejected with
 *     `COBRO_EXCEDE_SALDO` (over-payment never drives the balance negative);
 *   • the receipt number is allocated company-wide under the `EMPRESA` lock
 *     (R-C4), then the `COBRO`/`APLICADO` row is inserted `EFECTIVO`-only with
 *     `Decimal` money end-to-end;
 *   • exactly one `PAGAR` audit row is appended in the same transaction after the
 *     Pago commits (R-C8) — a rejected/replayed cobro writes none.
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
  CobroDomainError,
  messageFor,
  type CobroErrorCode,
} from "../domain/errors";
import {
  instanteDeFechaCobroSD,
  validarFechaCobro,
} from "../domain/fecha-cobro";
import { leerRetroactivoFechaVentaEnTx } from "@/modules/venta/infrastructure/config-repository";
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
import { registrarEventoAuditoriaEnTx } from "@/modules/auditoria/application/auditoria-write-port";

/** A collection request — one payment against one invoice. */
export interface RegistrarCobroInput {
  readonly facturaId: number;
  /** Positive `Decimal(12,2)` amount as a string (Zod guarantees the shape). */
  readonly monto: string;
  /**
   * S14 optional `Fecha del pago` as an SD calendar date (`YYYY-MM-DD`). Absent
   * means "the server instant"; present means the user picked a past day, which is
   * bounded by {@link resolverFechaCobroEnTx} against the SERVER's SD clock.
   */
  readonly fechaCobro?: string;
  /** S14 optional free-text reference stored on the `PAGO` row (≤ 80). */
  readonly referencia?: string;
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
 * S14 — resolve the payment instant and bound it to the tenant's SD date band.
 *
 * Both bounds come from the SERVER clock: the horizon is the tenant parameter
 * (`leerRetroactivoFechaVentaEnTx`, the SAME seam the sale date uses) and the wire
 * date is compared against that same instant, so a stale or hostile client clock
 * cannot widen the band. A `CobroDomainError` (one of the two frozen catalog
 * codes) becomes a typed result; ANY other throw is a config/defect and
 * propagates (a tenant without the horizon has no legal band — fail loud).
 */
async function resolverFechaCobroEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: RegistrarCobroInput,
): Promise<{ ok: true; fecha: Date } | { ok: false; code: CobroErrorCode; message: string }> {
  const ahora = new Date();
  if (input.fechaCobro === undefined) {
    // JD-A remediation: the retroactive-horizon config is only needed when the
    // caller actually sends a date — a tenant without the key keeps collecting
    // with the server clock (the historical default).
    return { ok: true, fecha: ahora };
  }
  const fecha = instanteDeFechaCobroSD(input.fechaCobro);
  const horizonteDias = await leerRetroactivoFechaVentaEnTx(
    tx,
    ctx.empresaId,
    ahora,
  );
  try {
    validarFechaCobro(fecha, horizonteDias, ahora);
    return { ok: true, fecha };
  } catch (err) {
    if (err instanceof CobroDomainError) {
      // The catalog code is the ONLY rejection surface — never a raw Prisma or
      // stack trace. A malformed date is Zod's job and is rejected at the
      // transport boundary before this use case runs.
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }
}

/** A trimmed reference or `null` (an absent/blank value is never stored as ""). */
function normalizarReferencia(referencia: string | undefined): string | null {
  const limpio = referencia?.trim() ?? "";
  return limpio === "" ? null : limpio;
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

  // S14: bound the editable payment date BEFORE the invoice lock, the receipt
  // allocation or any write — a rejected date burns nothing.
  const fechaOk = await resolverFechaCobroEnTx(tx, ctx, input);
  if (!fechaOk.ok) return fechaOk;

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
    fecha: fechaOk.fecha,
    correlativoRecibo,
    idempotencyKey: null,
    autorizadoPor: null,
    referencia: normalizarReferencia(input.referencia),
  });

  // R-C8: append exactly one `PAGAR` audit row, INSIDE this same transaction and
  // strictly after the `Pago` committed. The over-payment / non-VIGENTE guards
  // returned above, so a rejected cobro never reaches this call. The audit insert
  // is not wrapped in try/catch on purpose: a failure aborts the transaction so the
  // Pago and its audit row roll back together (AU-3, design.md) — never a payment
  // without its audit trail.
  await registrarEventoAuditoriaEnTx(tx, ctx, {
    accion: "PAGAR",
    entidad: "Pago",
    idEntidad: String(pagoId),
    valorNuevo: JSON.stringify({
      correlativoRecibo,
      monto: monto.toFixed(2),
    }),
    motivo: "Cobro aplicado",
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
