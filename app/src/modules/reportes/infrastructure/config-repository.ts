/**
 * Reportes infrastructure — the DB-backed credit-term parameter reader (FIN-2, slice C).
 *
 * FIN-2: when a client carries no credit term, the DEFAULT MUST come from the
 * `ConfiguracionEmpresa` `PLAZO_CREDITO` parameter — NEVER a hardcoded constant (AGENTS.md
 * "Parameters from DB, never hardcoded constants"). This is the same parameterised-config
 * discipline `venta/infrastructure/config-repository.ts` applies to `DESC_MAX` /
 * `PLAZO_DEVOLUCION`: read the ACTIVE row whose validity window covers `now`, resolve
 * overlapping windows DETERMINISTICALLY to the newest `vigenciaInicio` (R-V17), and validate the
 * stored value's grammar. It runs inside the caller's `withTenantTransaction` (RLS in force) and
 * pins `empresaId` explicitly (defense in depth). `CONFIGURACION_EMPRESA` is empresa-anchored, so
 * it reads identically whether the caller's branch GUC is pinned or widened.
 *
 * Unlike the venta readers (which FAIL on a missing required key), a credit term is a genuine
 * OPTIONAL fallback: only clients with `plazoCreditoDias = 0` consult it. So a MISSING or
 * non-conforming row returns `null` and the caller falls back to the invoice's own term semantics
 * (a 0-day term = due on issuance), rather than throwing on data the report can still age.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

/** The `ConfiguracionEmpresa.clave` identifier for the default credit term (days). */
const CLAVE_PLAZO_CREDITO = "PLAZO_CREDITO";

/**
 * Load the tenant's default `PLAZO_CREDITO` (whole days) covering `now`, or `null` when no
 * active/conforming row exists. A whole-number positive integer grammar is enforced (parity with
 * the `PLAZO_DEVOLUCION` reader); anything else is treated as "not configured" (`null`), never a
 * silently-guessed number.
 */
export async function leerPlazoCreditoEnTx(
  tx: PrismaTx,
  empresaId: number,
  now: Date,
): Promise<number | null> {
  const row = await tx.configuracionEmpresa.findFirst({
    where: {
      empresaId,
      clave: CLAVE_PLAZO_CREDITO,
      activa: true,
      vigenciaInicio: { lte: now },
      vigenciaFin: { gte: now },
    },
    // Deterministic tie-break on overlapping windows: newest `vigenciaInicio` wins (R-V17).
    orderBy: { vigenciaInicio: "desc" },
    select: { valor: true },
  });
  if (row === null) return null;

  const trimmed = row.valor.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const dias = Number(trimmed);
  return Number.isInteger(dias) && dias > 0 ? dias : null;
}
