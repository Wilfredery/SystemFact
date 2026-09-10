/**
 * Venta client resolver (spec R-V10) — application layer.
 *
 * Maps the sale's client input to a concrete, tenant-scoped `clienteId`:
 *   - `null` input → the empresa's single Consumidor Final row via the race-safe
 *     5a seam `getOrCreateConsumidorFinalEnTx` (fetch → insert → catch P2002 →
 *     refetch; the DB partial unique `cliente_consumidor_final_uk` is the
 *     backstop). This is consumed AS DOCUMENTED — never modified here.
 *   - a given id → loaded empresa-scoped by the repository; unknown or
 *     cross-tenant → `CLIENTE_NO_ENCONTRADO` (indistinguishable from a
 *     never-existing id — no existence/PII leakage); inactive → `CLIENTE_INACTIVO`.
 *
 * The fiscal ID is NOT re-validated at sale time (validated at client create);
 * credit-bearing clients are allowed at draft (B01/B02 eligibility + credit/mora
 * blocking are deferred to 5c/Fase 6). Runs inside the caller's `tx` (no nested
 * transaction), returning a typed `VentaResult` so the save use case can short
 * circuit on failure.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { getOrCreateConsumidorFinalEnTx } from "@/modules/cliente/application/consumidor-final";
import {
  CLIENTE_INACTIVO,
  CLIENTE_NO_ENCONTRADO,
  messageFor,
  type VentaResult,
} from "../domain/errors";
import { leerClienteParaVentaEnTx } from "../infrastructure/venta-repository";

export type ResolverClienteResultado = VentaResult<{ readonly clienteId: number }>;

/**
 * Resolve the sale client within an open tenant transaction. Never writes to
 * `VENTA` — it only guarantees a valid, active, tenant-owned `clienteId` (or
 * provisions/returns the empresa's Consumidor Final for a contado sale).
 */
export async function resolverClienteParaVentaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  clienteId: number | null,
): Promise<ResolverClienteResultado> {
  // Contado sale → the per-empresa Consumidor Final (5a reserved seam).
  if (clienteId === null) {
    const cf = await getOrCreateConsumidorFinalEnTx(tx, ctx.empresaId);
    return { ok: true, data: { clienteId: cf.id } };
  }

  // Named client → empresa-scoped load. A foreign id is indistinguishable from
  // a missing one because the repository filters by `empresaId`.
  const cliente = await leerClienteParaVentaEnTx(tx, ctx.empresaId, clienteId);
  if (cliente === null) {
    return {
      ok: false,
      code: CLIENTE_NO_ENCONTRADO,
      message: messageFor(CLIENTE_NO_ENCONTRADO),
    };
  }
  if (!cliente.activo) {
    return {
      ok: false,
      code: CLIENTE_INACTIVO,
      message: messageFor(CLIENTE_INACTIVO),
    };
  }
  return { ok: true, data: { clienteId: cliente.id } };
}
