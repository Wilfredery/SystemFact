/**
 * Cobros application — the credit-evaluation PORT (fase-6 PR-3, R-K1/R-K2).
 *
 * This is the SINGLE window `venta` has into cobros credit decisions. Per R-K1
 * the dependency direction is strictly venta → this application port: `venta`
 * imports NO `@/generated/prisma` model, NO cobros infrastructure and NO Prisma
 * from here — it consumes the narrow `EvaluarCreditoPort` contract (a
 * `TenantCtx` + Decimal-string over the CALLER's already-open tenant
 * transaction) and a typed allow/reject result. Every balance, limit and mora
 * rule lives in cobros; venta never duplicates one (ADR-017 single source).
 *
 * The implementation reuses the canonical derived-CxC aggregate
 * (`consultarSaldoCxcEnTx`) filtered to the client for the pending projection
 * and the worst days-overdue, plus one tenant-pinned client-profile read — no
 * second balance source. It runs inside `confirmarVenta`'s transaction, so the
 * RLS GUCs are already in force.
 */

import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  evaluarReglaCredito,
  type CreditoRechazo,
  type ReglaCreditoResultado,
} from "../domain/credito";
import { diasVencidoEnSD } from "../domain/en-mora";
import {
  consultarSaldoCxcEnTx,
  leerPerfilCreditoEnTx,
} from "../infrastructure/saldo-cxc.repository";

/**
 * Re-exported so `venta` (application + http adapter) can widen its own result
 * codes to the credit rejection set by importing ONLY this application port —
 * never the cobros domain error catalog or infrastructure (R-K1, no catalog
 * coupling: the SAME stable strings the cobros catalog owns are relayed here).
 */
export type { CreditoRechazo };

/** The input the caller supplies: which client, the new sale's Decimal total, and the clock. */
export interface EvaluarCreditoInput {
  readonly clienteId: number;
  /** New sale total as a `Decimal(12,2)` string (never a float). */
  readonly totalVenta: string;
  /** "Now" the mora window is resolved against (SD). */
  readonly fecha: Date;
}

/**
 * The typed allow/reject result of the credit gate. `CONTADO` means the sale is
 * not a credit sale at all (a Consumidor Final / cash client), so venta proceeds
 * AND closes the receivable with a full-total COBRO; a `CREDITO`/`permitido:false`
 * carries a stable code venta surfaces unchanged.
 */
export type CreditResult =
  | { readonly forma: "CONTADO" }
  | { readonly forma: "CREDITO"; readonly permitido: true }
  | {
      readonly forma: "CREDITO";
      readonly permitido: false;
      readonly code: CreditoRechazo;
      readonly message: string;
    };

/** The narrow cross-module contract `venta` programs against (never the impl). */
export interface EvaluarCreditoPort {
  evaluarCreditoCliente(
    tx: PrismaTx,
    ctx: TenantCtx,
    input: EvaluarCreditoInput,
  ): Promise<CreditResult>;
}

/**
 * Cobros' implementation of {@link EvaluarCreditoPort}. Called by `confirmarVenta`
 * INSIDE its own transaction, after the hard stock preview and BEFORE the NCF
 * lock/consume so a blocked client burns no sequence number.
 */
export async function evaluarCreditoCliente(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: EvaluarCreditoInput,
): Promise<CreditResult> {
  const perfil = await leerPerfilCreditoEnTx(tx, ctx, input.clienteId);
  if (perfil === null) {
    // Unreachable in the ordered flow: confirmarVenta already resolved the client
    // in-tx before calling. A missing/foreign profile is a defect, not a business
    // state; failing loud (pre-consume) aborts the transaction with zero effects.
    throw new Error(
      `evaluarCreditoCliente: perfil de crédito inexistente para el cliente ${String(input.clienteId)}`,
    );
  }

  // Only a non-CF `CREDITO` client is gated; anything else is a contado sale.
  if (!perfil.esVentaCredito) {
    return { forma: "CONTADO" };
  }

  // Reuse the CANONICAL aggregate (R-K1: no second balance source) filtered to
  // this client: its Σ pending projection and its worst SD-days-overdue unpaid
  // receivable. REVERTIDO cobros are already excluded by the aggregate itself.
  const filas = (await consultarSaldoCxcEnTx(tx, ctx)).filter(
    (f) => f.clienteId === input.clienteId,
  );

  let pendienteTotal = new Decimal(0);
  let diasEnMoraMaximo = 0;
  for (const f of filas) {
    const pendiente = new Decimal(f.saldoPendiente);
    pendienteTotal = pendienteTotal.plus(pendiente);
    if (pendiente.greaterThan(0)) {
      const dias = diasVencidoEnSD({
        fechaEmision: f.fechaEmision,
        plazoCreditoDias: perfil.plazoCreditoDias,
        now: input.fecha,
      });
      if (dias > diasEnMoraMaximo) diasEnMoraMaximo = dias;
    }
  }

  const regla: ReglaCreditoResultado = evaluarReglaCredito({
    creditoHabilitado: perfil.creditoHabilitado,
    pendienteTotal: pendienteTotal.toFixed(2),
    limiteCredito: perfil.limiteCredito,
    totalVenta: input.totalVenta,
    diasEnMoraMaximo,
  });

  if (!regla.permitido) {
    return { forma: "CREDITO", permitido: false, code: regla.code, message: regla.message };
  }
  return { forma: "CREDITO", permitido: true };
}

/**
 * The port as a value. `venta` injects/consumes this typed object, never the
 * function identity, so the coupling is provably to `EvaluarCreditoPort` alone.
 */
export const evaluarCreditoPort: EvaluarCreditoPort = { evaluarCreditoCliente };
