/**
 * Savepoint lifecycle primitives (ADR-013: Prisma raw calls belong in
 * infrastructure, never in `application/`).
 *
 * These back the transactional race guards used by get-or-create seams: open a
 * savepoint, and on the expected "loser" signal roll back to it so the
 * enclosing transaction returns to a usable state (a statement error otherwise
 * aborts the whole Postgres transaction — SQLSTATE 25P02 — and any later
 * command fails with "current transaction is aborted").
 *
 * Names are static code constants, never user input; `abrirSavepoint` still
 * asserts the identifier shape so a raw-identifier call can never carry an
 * injection surface.
 */

import type { PrismaTx } from "./withTenantTransaction";

const IDENTIFICADOR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validarNombre(nombre: string): string {
  if (!IDENTIFICADOR_RE.test(nombre)) {
    throw new TypeError(`Nombre de savepoint inválido: ${nombre}`);
  }
  return nombre;
}

/**
 * True for the Prisma raw-query error reporting SQLSTATE `25P01` — "SAVEPOINT
 * can only be used in transaction blocks", i.e. the caller handed a top-level
 * client with no active transaction (the idempotent maintenance seeds do this).
 * There each statement auto-commits and a failed INSERT poisons nothing, so a
 * guard is unnecessary and callers should fall back to a plain refetch.
 */
export function esSinBloqueDeTransaccion(err: unknown): boolean {
  const e = err as { code?: string; message?: string; meta?: { message?: string } };
  const texto = `${e.meta?.message ?? ""} ${e.message ?? ""}`;
  // Prisma surfaces raw SQL failures as P2010, but the SQLSTATE text is the
  // ground truth — match it directly so a driver/version code change cannot
  // misclassify a real transaction-context failure as "no block".
  return /25P01|SAVEPOINT can only be used in transaction blocks/i.test(texto)
    ? true
    : e.code === "P2010" && /transaction block/i.test(texto);
}

/**
 * Issue `SAVEPOINT <nombre>`. Returns `true` when the guard is live, or
 * `false` when the client is not inside a transaction block (25P01). Any other
 * failure propagates.
 */
export async function abrirSavepoint(tx: PrismaTx, nombre: string): Promise<boolean> {
  try {
    await tx.$executeRawUnsafe(`SAVEPOINT ${validarNombre(nombre)}`);
    return true;
  } catch (err) {
    if (esSinBloqueDeTransaccion(err)) return false;
    throw err;
  }
}

/** `RELEASE SAVEPOINT <nombre>` — keep the guarded work. */
export async function liberarSavepoint(tx: PrismaTx, nombre: string): Promise<void> {
  await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${validarNombre(nombre)}`);
}

/** `ROLLBACK TO SAVEPOINT <nombre>` — undo the guarded work, keep the transaction live. */
export async function revertarSavepoint(tx: PrismaTx, nombre: string): Promise<void> {
  await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${validarNombre(nombre)}`);
}
