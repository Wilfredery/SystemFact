/**
 * NCF infrastructure — the ONLY place in the module that touches Prisma.
 *
 * Owns the row-lock atomic consumption of an `NCF_SECUENCIA` range (design:
 * lock the sequence row with `SELECT ... FOR UPDATE`, never the EMPRESA row, so
 * only the requested `empresaId + tipoNcf` sequence is serialized).
 *
 * Tenant isolation (frozen schema, RLS `ncfsecuencia_isolation` enabled +
 * forced): the surrounding `withTenantTransaction` sets `app.current_empresa_id`,
 * so the row is visible/lockable only inside the acting company. Per AGENTS.md
 * we ALSO pin `empresaId` explicitly in the WHERE — never relying on RLS alone.
 *
 * `secuenciaActual` is the LAST USED value (D7). Integers are cast `::int` so
 * Prisma returns JS numbers (the tsconfig target below ES2020 cannot emit BigInt
 * literals), mirroring `compra-repository.asignarCorrelativoSiguienteEnTx`.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TipoNcf } from "../domain/ncf-rules";

/** A locked active sequence row, integer-cast for safe JS arithmetic. */
export interface SecuenciaBloqueada {
  readonly id: number;
  readonly rangoInicio: number;
  readonly rangoFin: number;
  readonly secuenciaActual: number;
  readonly vigenciaFin: Date;
}

/**
 * Locks (FOR UPDATE) the single active `empresaId + tipoNcf` sequence row and
 * returns it, or `null` when no ACTIVE row exists (missing/inactive). Because
 * `@@unique([empresaId, tipoNcf])` guarantees at most one row per pair, the
 * `ORDER BY "id" LIMIT 1` is purely defensive/deterministic.
 */
export async function bloquearSecuenciaActivaEnTx(
  tx: PrismaTx,
  empresaId: number,
  tipo: TipoNcf,
): Promise<SecuenciaBloqueada | null> {
  const filas = await tx.$queryRaw<
    {
      id: number;
      rangoInicio: number;
      rangoFin: number;
      secuenciaActual: number;
      vigenciaFin: Date;
    }[]
  >`
    SELECT "id"::int AS "id",
           "rangoInicio"::int AS "rangoInicio",
           "rangoFin"::int AS "rangoFin",
           "secuenciaActual"::int AS "secuenciaActual",
           "vigenciaFin" AS "vigenciaFin"
    FROM "NCF_SECUENCIA"
    WHERE "empresaId" = ${empresaId}
      AND "tipoNcf" = ${tipo}::"TipoNcfSecuencia"
      AND "activa" = true
    ORDER BY "id"
    LIMIT 1
    FOR UPDATE`;

  const fila = filas[0];
  if (fila === undefined) return null;
  return {
    id: fila.id,
    rangoInicio: fila.rangoInicio,
    rangoFin: fila.rangoFin,
    secuenciaActual: fila.secuenciaActual,
    vigenciaFin: fila.vigenciaFin,
  };
}

/**
 * Advances the locked row's last-used pointer to `nuevoValor` and returns the
 * affected-row count. Runs under the held row lock (same transaction). The
 * `empresaId` predicate is redundant with the `FOR UPDATE` lock + RLS but is
 * pinned explicitly for defense in depth (AGENTS.md: never rely on RLS alone).
 */
export async function avanzarSecuenciaEnTx(
  tx: PrismaTx,
  empresaId: number,
  id: number,
  nuevoValor: number,
): Promise<number> {
  const afectados = await tx.$executeRaw`
    UPDATE "NCF_SECUENCIA"
    SET "secuenciaActual" = ${nuevoValor}::int
    WHERE "id" = ${id}::int
      AND "empresaId" = ${empresaId}::int`;
  return afectados;
}
