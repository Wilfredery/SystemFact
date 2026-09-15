/**
 * Cobros application — canonical CxC view (R-B1; sole entry for board/aging/
 * mora/credit).
 *
 * A thin read-model orchestration over the single aggregate
 * (`consultarSaldoCxcEnTx`) plus the pure classifiers (`clasificarEstadoPago`,
 * `enMora`/`fechaVencimiento`). This is the ONLY application surface for a
 * receivable: the CxC board (PR-4), the estado de cuenta (PR-4) and the credit
 * gate (PR-3) all consume this and NOTHING else, so the balance, derived state
 * and mora decision can never diverge between screens (ADR-017 — nothing is
 * cached or materialized; a re-run always reflects the latest committed payment).
 *
 * Runs inside the caller's `withTenantTransaction`, so the aggregate is already
 * RLS-scoped; the explicit `empresaId` in the aggregate + the term read are the
 * second defense. Every monetary value crosses here as a `Decimal(12,2)` string.
 */

import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { clasificarEstadoPago } from "../domain/clasificar-estado-pago";
import { enMora, fechaVencimiento } from "../domain/en-mora";
import type { CobroResult, EstadoPagoDerivado } from "../domain/pago";
import {
  consultarSaldoCxcEnTx,
  leerTerminosCreditoEnTx,
} from "../infrastructure/saldo-cxc.repository";

/**
 * One receivable as the board/aging/mora/credit consumers need it: the summed
 * facts from the canonical aggregate plus the DERIVED payment state and the
 * Santo-Domingo mora/aging facts resolved from the client's credit terms.
 */
export interface SaldoCxCVista {
  readonly facturaId: number;
  readonly clienteId: number;
  readonly total: string;
  readonly cobrosAplicados: string;
  readonly saldoPendiente: string;
  readonly estadoPago: EstadoPagoDerivado;
  readonly enMora: boolean;
  /** SD calendar due date (`YYYY-MM-DD`), for aging buckets. */
  readonly vencimiento: string;
  readonly creditoHabilitado: boolean;
  readonly limiteCredito: string;
}

/** Options for the read; `now` is injected for deterministic mora tests. */
export interface ConsultarSaldoCxcInput {
  readonly now?: Date;
}

/**
 * Returns every VIGENTE receivable of the (branch-scoped) tenant with its derived
 * state and mora, newest first. This is the single canonical CxC query.
 */
export async function consultarSaldoCxC(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ConsultarSaldoCxcInput = {},
): Promise<CobroResult<SaldoCxCVista[]>> {
  const filas = await consultarSaldoCxcEnTx(tx, ctx);

  // One batched read of the distinct clients' terms — never a per-invoice query.
  const clienteIds = [...new Set(filas.map((f) => f.clienteId))];
  const terminos = await leerTerminosCreditoEnTx(tx, ctx, clienteIds);

  const now = input.now ?? new Date();
  const vista: SaldoCxCVista[] = filas.map((f) => {
    const t = terminos.get(f.clienteId);
    const plazo = t?.plazoCreditoDias ?? 0;
    return {
      facturaId: f.facturaId,
      clienteId: f.clienteId,
      total: f.total,
      cobrosAplicados: f.cobrosAplicados,
      saldoPendiente: f.saldoPendiente,
      estadoPago: clasificarEstadoPago(
        new Decimal(f.cobrosAplicados),
        new Decimal(f.total),
      ),
      enMora: enMora({
        fechaEmision: f.fechaEmision,
        plazoCreditoDias: plazo,
        now,
      }),
      vencimiento: fechaVencimiento(f.fechaEmision, plazo),
      creditoHabilitado: t?.creditoHabilitado ?? false,
      limiteCredito: t?.limiteCredito ?? "0.00",
    };
  });

  return { ok: true, data: vista };
}
