/**
 * Cobros infrastructure — `PAGO` row persistence (ADR-013).
 *
 * All Prisma access for the payment lifecycle lives here; the application layer
 * only orchestrates. Money is written with `Prisma.Decimal` from a Decimal-string
 * (AGENTS.md "Money = Decimal"), NEVER a JS number/float. The tenant anchors
 * (`empresaId`, `sucursalId`, `usuarioId`) come from the acting `TenantCtx` so
 * the RLS `WITH CHECK` passes and the row is bound to the correct branch.
 */

import { Prisma } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { METODO_PAGO, type EstadoPago, type TipoPago } from "../domain/pago";

/** A validated payment write payload — all money is a `Decimal(12,2)` string. */
export interface CrearPagoInput {
  readonly facturaId: number;
  readonly tipo: TipoPago;
  readonly estado: EstadoPago;
  readonly monto: string;
  readonly fecha: Date;
  readonly correlativoRecibo: number;
  /** `empresaId`-scoped idempotency key — always `null` for a COBRO (R-C3). */
  readonly idempotencyKey: string | null;
  /** Authorizer for a REEMBOLSO; `null` for a COBRO (§10). */
  readonly autorizadoPor: number | null;
}

/** Persists a `PAGO` inside the caller's tenant transaction; returns its id. */
export async function crearPagoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CrearPagoInput,
): Promise<{ readonly id: number }> {
  const created = await tx.pago.create({
    data: {
      facturaId: input.facturaId,
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
      // V1 exposes only EFECTIVO (schema `MetodoPago`), frozen to the domain.
      metodoPago: METODO_PAGO.EFECTIVO,
      monto: new Prisma.Decimal(input.monto),
      fecha: input.fecha,
      estado: input.estado,
      tipo: input.tipo,
      autorizadoPor: input.autorizadoPor,
      correlativoRecibo: input.correlativoRecibo,
      idempotencyKey: input.idempotencyKey,
    },
    select: { id: true },
  });
  return { id: created.id };
}
