/**
 * Cobros application — register a cash refund (REEMBOLSO) with idempotency (R-C3).
 *
 * Runs inside the caller's `withTenantTransaction` (RLS GUCs already in force).
 * Refunds are the one money movement with a CLIENT-generated idempotency key:
 * the same request submitted twice must NEVER double-refund or double-burn a
 * receipt, and a lost race between two simultaneous first submits must still
 * leave exactly one committed row. The guarantees, in the order enforced:
 *
 *   1. The key is checked INSIDE the transaction, BEFORE any insert AND BEFORE
 *      the receipt number is allocated (a replay burns nothing — R-C3).
 *   2. The referenced invoice must be a VIGENTE tenant invoice, else
 *      `FACTURA_COBRO_NO_VIGENTE`.
 *   3. Only after the key is proven fresh is a receipt allocated (empresa lock)
 *      and the `REEMBOLSO/APLICADO` row inserted, recording `autorizadoPor`.
 *   4. A concurrent first-submit that races past the pre-check is caught at the
 *      insert: the `(empresaId, idempotencyKey)` unique violation is translated
 *      to the SAME stable `PAGO_IDEMPOTENCIA_CONFLICTO`; the loser's transaction
 *      rolls back so its receipt allocation leaves no trace. Any other Prisma
 *      error is a defect and propagates (the transaction aborts) — a raw Prisma
 *      error never becomes a business result.
 *   5. Exactly one `PAGAR` audit row is appended after the committed `Pago`
 *      (R-C8); the replay and race paths above write no audit row.
 *
 * Authorization (only an allowed actor may refund → `PAGO_NO_AUTORIZADO`) is a
 * coarse role gate enforced by the HTTP adapter BEFORE this use case runs — it
 * never reaches here for an unauthorized actor (R-C6). This use case assumes the
 * caller is authorized.
 */

import { Prisma } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  FACTURA_COBRO_NO_VIGENTE,
  PAGO_IDEMPOTENCIA_CONFLICTO,
  messageFor,
  type CobroErrorCode,
} from "../domain/errors";
import {
  ESTADO_PAGO,
  TIPO_PAGO,
  aDecimalMonto,
  type CobroResult,
} from "../domain/pago";
import { bloquearYCalcularSaldoFacturaEnTx } from "../infrastructure/saldo-cxc.repository";
import { asignarCorrelativoReciboEnTx } from "../infrastructure/recibo.repository";
import {
  buscarPagoPorIdempotenciaEnTx,
  crearPagoEnTx,
} from "../infrastructure/pago-repository";
import { registrarEventoAuditoriaEnTx } from "@/modules/auditoria/application/auditoria-write-port";

/** A refund request — the mandatory client key plus one payment amount. */
export interface RegistrarReembolsoInput {
  readonly facturaId: number;
  /** Positive `Decimal(12,2)` amount as a string (Zod guarantees the shape). */
  readonly monto: string;
  /** Client-generated, produced before the FIRST submit; mandatory (R-C3). */
  readonly idempotencyKey: string;
  /** Refund instant; defaults to now. */
  readonly fecha?: Date;
}

/** Committed refund: the persisted payment id and its receipt number. */
export interface RegistrarReembolsoOutput {
  readonly pagoId: number;
  readonly correlativoRecibo: number;
  readonly autorizadoPor: number;
}

function buildError(code: CobroErrorCode): CobroResult<never> {
  return { ok: false, code, message: messageFor(code) };
}

/** True when a Prisma error is the `(empresaId, idempotencyKey)` unique clash. */
function esConflictoIdempotencia(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    (Array.isArray(err.meta?.target)
      ? err.meta?.target.includes("idempotencyKey")
      : String(err.meta?.target ?? "").includes("idempotencyKey"))
  );
}

/**
 * Registers a `REEMBOLSO/APLICADO` guarded by the client idempotency key, which
 * is checked before any write and before the receipt allocation (R-C3).
 */
export async function registrarReembolso(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: RegistrarReembolsoInput,
): Promise<CobroResult<RegistrarReembolsoOutput>> {
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length === 0) {
    // The key is mandatory at the Zod boundary; an empty one here is a contract
    // violation, not a business state, so it fails loud and rolls back.
    throw new Error("registrarReembolso: idempotencyKey obligatorio");
  }
  const monto = aDecimalMonto(input.monto);
  if (monto.lessThanOrEqualTo(0)) {
    throw new Error("registrarReembolso: el monto debe ser mayor que cero");
  }

  // (1) R-C3 replay fast-path — read-only, BEFORE any insert and BEFORE the
  //     receipt allocation, so a duplicate consumes no receipt number.
  const existente = await buscarPagoPorIdempotenciaEnTx(tx, ctx, idempotencyKey);
  if (existente !== null) {
    return buildError(PAGO_IDEMPOTENCIA_CONFLICTO);
  }

  // (2) The refund must reference a VIGENTE invoice of this tenant. Locking the
  //     invoice serializes a refund against any concurrent collection on it.
  const factura = await bloquearYCalcularSaldoFacturaEnTx(tx, ctx, input.facturaId);
  if (factura === null) {
    return buildError(FACTURA_COBRO_NO_VIGENTE);
  }

  // (3) Receipt allocated only after the key is proven fresh.
  const correlativoRecibo = await asignarCorrelativoReciboEnTx(
    tx,
    ctx.empresaId,
    ctx.sucursalId,
  );

  const autorizadoPor = ctx.usuarioId;
  try {
    const { id: pagoId } = await crearPagoEnTx(tx, ctx, {
      facturaId: input.facturaId,
      tipo: TIPO_PAGO.REEMBOLSO,
      estado: ESTADO_PAGO.APLICADO,
      monto: monto.toFixed(2),
      fecha: input.fecha ?? new Date(),
      correlativoRecibo,
      idempotencyKey,
      autorizadoPor,
    });

    // R-C8: append exactly one `PAGAR` audit row strictly AFTER the `Pago`
    // committed, inside this same try — so the replay pre-check (returned above)
    // and the concurrent-first-submit P2002 race (caught below) both leave the
    // audit row count flat. An audit failure is not an idempotency conflict: the
    // catch re-throws and the whole transaction (Pago + audit) rolls back together
    // (AU-3).
    await registrarEventoAuditoriaEnTx(tx, ctx, {
      accion: "PAGAR",
      entidad: "Pago",
      idEntidad: String(pagoId),
      valorNuevo: JSON.stringify({
        correlativoRecibo,
        monto: monto.toFixed(2),
        idempotencyKey,
      }),
      motivo: "Reembolso aplicado",
    });

    return { ok: true, data: { pagoId, correlativoRecibo, autorizadoPor } };
  } catch (err) {
    // (4) First-submit race: a concurrent transaction committed the same key
    //     between our pre-check and this insert. Translate the unique violation
    //     to the SAME stable code; the transaction then rolls back so the loser
    //     persists no row and burns no receipt number.
    if (esConflictoIdempotencia(err)) {
      return buildError(PAGO_IDEMPOTENCIA_CONFLICTO);
    }
    throw err;
  }
}
