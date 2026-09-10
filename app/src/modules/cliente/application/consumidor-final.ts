import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { Cliente } from "../domain/cliente";
import {
  CLIENTE_IDENTIFICACION_DUPLICADA,
  ClienteDomainError,
} from "../domain/errors";
import {
  consumidorFinalEnEmpresa,
  crearConsumidorFinalEnTx,
} from "../infrastructure/cliente-repository";

/**
 * RESERVED FASE-5b SEAM — get-or-create the per-empresa Consumidor Final.
 *
 * fetch → (miss) insert → catch P2002 (via the repository's duplicate code) →
 * refetch. This makes concurrent provisioning or, later, sale-path calls leave
 * EXACTLY ONE CF row per empresa: the DB partial unique
 * `cliente_consumidor_final_uk` (empresaId WHERE esConsumidorFinal) is the
 * definitive backstop, and the losing racer re-reads the winner's row instead of
 * failing. Idempotent and safe under parallelism with no explicit lock.
 *
 * This is the SAME path the idempotent seed drives (the seed passes its
 * maintenance client as `tx`). It is exported and unit-tested now but performs
 * NO venta/sale wiring — nothing here imports the `venta` module. Phase 5b will
 * call it lazily from the sale confirm flow; 5a only provisions via the seed.
 */
export async function getOrCreateConsumidorFinalEnTx(
  tx: PrismaTx,
  empresaId: number,
): Promise<Cliente> {
  const existente = await consumidorFinalEnEmpresa(tx, empresaId);
  if (existente !== null) return existente;

  try {
    return await crearConsumidorFinalEnTx(tx, empresaId);
  } catch (err) {
    // Only the CF-unique duplicate (P2002) is the concurrent-winner signal:
    // refetch that row. Any other error is a genuine failure and propagates.
    if (
      err instanceof ClienteDomainError &&
      err.code === CLIENTE_IDENTIFICACION_DUPLICADA
    ) {
      const refetched = await consumidorFinalEnEmpresa(tx, empresaId);
      if (refetched !== null) return refetched;
    }
    throw err;
  }
}
