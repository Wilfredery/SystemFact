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

/**
 * Empresa-wide fast-path lookup of an existing `PAGO` by its `(empresaId,
 * idempotencyKey)` refund idempotency key (R-C3).
 *
 * The unique constraint is scoped to `empresaId` (NOT branch), so this read
 * clears the SUCURSAL GUC locally to see a matching row in ANY branch of the
 * empresa — otherwise a replay arriving at a different branch would slip past
 * the pre-check and only be caught by the insert's unique violation. The EMPRESA
 * GUC stays in force, so the scan never crosses tenants. The acting branch GUC
 * is restored before returning so the caller's subsequent writes land correctly.
 * Returns the existing id, or `null` when the key is fresh.
 */
export async function buscarPagoPorIdempotenciaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  idempotencyKey: string,
): Promise<{ readonly id: number } | null> {
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', '', true)`;
  const hit = await tx.pago.findFirst({
    where: { empresaId: ctx.empresaId, idempotencyKey },
    select: { id: true },
  });
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${String(
    ctx.sucursalId,
  )}, true)`;
  return hit === null ? null : { id: hit.id };
}

/**
 * A printable receipt projection (R-C4 reprint): the persisted payment facts plus
 * the fiscal-invoice and counterparty labels the reprint page renders. Money is a
 * `Decimal(12,2)` string; the receipt is a NON-fiscal document (a reprint of a
 * payment already reflected on its VIGENTE `FACTURA`, whose own NCF is shown for
 * cross-reference only — never a new tax document).
 */
export interface ReciboLeido {
  readonly correlativoRecibo: number;
  readonly tipo: TipoPago;
  readonly estado: EstadoPago;
  readonly monto: string;
  readonly metodoPago: string;
  readonly fecha: Date;
  readonly autorizadoPor: number | null;
  readonly facturaId: number;
  readonly facturaNcf: string;
  readonly clienteNombre: string;
  readonly usuarioNombre: string;
  readonly empresaNombre: string;
}

/**
 * Reads one empresa-wide receipt by its `correlativoRecibo` (the `(empresaId,
 * correlativoRecibo)` unique key) inside the caller's tenant transaction. The
 * `empresaId` pin plus the RLS EMPRESA GUC keep the read tenant-bound; a foreign or
 * missing number collapses to `null` so the application layer can map it to
 * `PAGO_NO_ENCONTRADO`. `monto` is a Decimal-string (never a float).
 */
export async function leerReciboEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  correlativoRecibo: number,
): Promise<ReciboLeido | null> {
  const row = await tx.pago.findFirst({
    where: { empresaId: ctx.empresaId, correlativoRecibo },
    select: {
      correlativoRecibo: true,
      tipo: true,
      estado: true,
      monto: true,
      metodoPago: true,
      fecha: true,
      autorizadoPor: true,
      facturaId: true,
      factura: { select: { ncf: true, cliente: { select: { nombre: true } } } },
      usuario: { select: { nombre: true } },
      empresa: { select: { nombreComercial: true } },
    },
  });
  if (row === null) return null;
  return {
    correlativoRecibo: row.correlativoRecibo,
    tipo: row.tipo,
    estado: row.estado,
    // Prisma returns a Decimal; normalize through toString so no float is seen.
    monto: row.monto.toFixed(2),
    metodoPago: row.metodoPago,
    fecha: row.fecha,
    autorizadoPor: row.autorizadoPor,
    facturaId: row.facturaId,
    facturaNcf: row.factura.ncf,
    clienteNombre: row.factura.cliente.nombre,
    usuarioNombre: row.usuario.nombre,
    empresaNombre: row.empresa.nombreComercial,
  };
}
