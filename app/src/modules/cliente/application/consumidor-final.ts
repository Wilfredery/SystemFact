import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  abrirSavepoint,
  liberarSavepoint,
  revertarSavepoint,
} from "@/modules/tenant/infrastructure/savepoint";
import type { Cliente } from "../domain/cliente";
import {
  CLIENTE_IDENTIFICACION_DUPLICADA,
  ClienteDomainError,
} from "../domain/errors";
import {
  consumidorFinalEnEmpresa,
  crearConsumidorFinalEnTx,
} from "../infrastructure/cliente-repository";

/** Name of the self-probing race guard. Static — never derived from user input. */
const CF_RACE_SAVEPOINT = "sf_cf_race_guard";

/**
 * RESERVED FASE-5b SEAM — get-or-create the per-empresa Consumidor Final.
 *
 * fetch → (miss) SAVEPOINT-guarded insert → catch P2002 (via the repository's
 * duplicate code) → ROLLBACK TO SAVEPOINT → refetch. This makes concurrent
 * provisioning or, later, sale-path calls leave EXACTLY ONE CF row per empresa:
 * the DB partial unique `cliente_consumidor_final_uk` (empresaId WHERE
 * esConsumidorFinal) is the definitive backstop, and the losing racer re-reads
 * the winner's row instead of failing. Idempotent and safe under parallelism
 * with no explicit lock.
 *
 * Why the savepoint (fase-5b flake remediation): a P2002 leaves the Postgres
 * transaction ABORTED (SQLSTATE 25P02) — the previous bare refetch on the same
 * `tx` errored with "current transaction is aborted" instead of returning the
 * winner, which is what made the parallel race test flaky. Rolling back to a
 * savepoint taken BEFORE the insert clears the aborted state while keeping the
 * enclosing transaction and its `set_config(..., true)` tenant GUCs alive (they
 * predate the savepoint), so the refetch runs in the same transaction as a
 * fresh READ COMMITTED statement and sees the winner's committed row. A
 * separate top-level transaction is NOT available from here: the seam receives
 * a transaction client (Prisma forbids nesting `$transaction`) and could not
 * rebuild the tenant GUCs from `empresaId` alone — the savepoint is the
 * equivalent robust pattern that keeps this seam signature stable. The raw
 * savepoint calls live in `tenant/infrastructure/savepoint.ts` (ADR-013: no
 * `prisma.*` from `application/`).
 *
 * The guard is SELF-PROBING: the same seam is called by the idempotent seed
 * with a top-level maintenance client, where `SAVEPOINT` is illegal (25P01) and
 * `abrirSavepoint` returns `false`. There, each statement auto-commits, a
 * failed INSERT poisons nothing, and the plain catch → refetch is already
 * correct — so the guard simply deactivates.
 *
 * This is the SAME path the idempotent seed drives. It is exported and
 * unit-tested now but performs NO venta/sale wiring — nothing here imports the
 * `venta` module. Phase 5b calls it lazily from the sale save pipeline
 * (`resolver-cliente-venta`); 5a provisions via the seed.
 */
export async function getOrCreateConsumidorFinalEnTx(
  tx: PrismaTx,
  empresaId: number,
): Promise<Cliente> {
  const existente = await consumidorFinalEnEmpresa(tx, empresaId);
  if (existente !== null) return existente;

  // A SAVEPOINT is legal ONLY inside a transaction block; when the caller
  // passed a top-level client (e.g. the maintenance seed), `abrirSavepoint`
  // returns false (25P01) rather than throwing, which is safe because a failed
  // INSERT on a non-transactional client auto-rolls-back and never poisons a
  // later read.
  const guardaActiva = await abrirSavepoint(tx, CF_RACE_SAVEPOINT);

  try {
    const creado = await crearConsumidorFinalEnTx(tx, empresaId);
    if (guardaActiva) await liberarSavepoint(tx, CF_RACE_SAVEPOINT);
    return creado;
  } catch (err) {
    // Only the CF-unique duplicate (P2002) is the concurrent-winner signal.
    if (
      err instanceof ClienteDomainError &&
      err.code === CLIENTE_IDENTIFICACION_DUPLICADA
    ) {
      // Undo the aborted insert so the refetch runs on a live transaction. When
      // there was no block to guard (top-level client), nothing is aborted and
      // the refetch is immediate.
      if (guardaActiva) await revertarSavepoint(tx, CF_RACE_SAVEPOINT);
      const refetched = await consumidorFinalEnEmpresa(tx, empresaId);
      if (refetched !== null) return refetched;
    }
    throw err;
  }
}
