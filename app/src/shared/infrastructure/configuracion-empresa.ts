/**
 * Shared ConfiguracionEmpresa reader seam — the ONE canonical active-window
 * read for tenant parameters (R-QC-08; design D8).
 *
 * `CONFIGURACION_EMPRESA` rows are tenant parameters with a validity window.
 * Every read the codebase performs asks the SAME question: "the row of
 * `empresaId.clave` that is `activa: true` and whose validity window covers
 * `fecha`'s instant" — the single predicate collected HERE once, so no module
 * re-encodes it (grep guard: `activa: true` in production code lives only in
 * this file; venta-config R-C4's R-V17 deterministic tie-break rides on the
 * single-key reader).
 *
 * Cutoff instant vs SD calendar (design D8, carried risk #8, behavior-preserving
 * reading of R-QC-08): the window bounds `VIGENCIA_INICIO` / `VIGENCIA_FIN` are
 * stored as absolute `timestamptz` instants, so "valid at fecha" is an EXACT
 * instant comparison — the SAME comparison every current consumer already
 * makes (compra's reader documents the rationale: long-dated windows, no tz
 * dependency, manual hour arithmetic forbidden). The "cutoff date resolved in
 * America/Santo_Domingo" of the spec is honored at the CALLERS: callers
 * resolve their own `fecha` via the ratified SD conversions
 * (`venta/domain/zona-horaria.ts` fechaEnSD/fechaSDaUTC, the `en-CA`-formatted
 * SD parts in `reportes/domain/reporte-filtro.ts`) BEFORE passing the instant.
 * The seam itself never re-derives a calendar day.
 *
 * Location (D8): `src/shared/infrastructure/` — not `shared/domain` (this is a
 * Prisma query adapter, not pure domain), and not any one module (its
 * consumers are venta + compra + reportes×2). It is the ONLY sanctioned
 * row-fetch for the active-window predicate inside the caller's tenant
 * transaction; per-key VALUE-GRAMMAR validation stays in each consumer module
 * (the seam stays free of business semantics — it does not know DESC_MAX from
 * RET_ISR_30).
 *
 * R-V17 overlap discipline: the single-key reader orders `vigenciaInicio
 * desc`, so overlapping windows resolve to the NEWEST `vigenciaInicio`
 * deterministically (each module's seed asserts zero overlap per key+empresa,
 * so the tie-break never hides corrupted config). The multi-key reader is a
 * findMany batch (`compra`'s serving shape): the caller maps rows by `clave` —
 * per R-V17 the per-key seed guarantee (zero overlap) makes the 1:1 outcome
 * mapping identical, so the batch variant needs no aggregate tie-break.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

/** One active config row as consumed by every module: the bare clave/valor pair. */
export interface FilaConfigEmpresa {
  readonly clave: string;
  readonly valor: string;
}

/**
 * THE single-key reader: the newest-`VIGENCIA_INICIO` active row of
 * `(empresaId, clave)` whose window covers `fecha`'s instant, or `null` when
 * the key is absent/expired (consumers translate `null` into their own
 * hard-fail, statutory-default, or optional-gap semantics — never the seam).
 */
export async function leerConfigActivaEnTx(
  tx: PrismaTx,
  empresaId: number,
  clave: string,
  fecha: Date,
): Promise<FilaConfigEmpresa | null> {
  const row = await tx.configuracionEmpresa.findFirst({
    where: {
      empresaId,
      clave,
      activa: true,
      vigenciaInicio: { lte: fecha },
      vigenciaFin: { gte: fecha },
    },
    orderBy: { vigenciaInicio: "desc" },
    select: { clave: true, valor: true },
  });
  return row;
}

/**
 * THE multi-key reader: ONE batched query for every requested `clave`, serving
 * `compra`'s retention reader shape. Missing keys are simply absent from the
 * result (the caller enforces its required-key discipline).
 */
export async function leerConfigsActivasEnTx(
  tx: PrismaTx,
  empresaId: number,
  claves: readonly string[],
  fecha: Date,
): Promise<ReadonlyArray<FilaConfigEmpresa>> {
  const rows = await tx.configuracionEmpresa.findMany({
    where: {
      empresaId,
      clave: { in: [...claves] },
      activa: true,
      vigenciaInicio: { lte: fecha },
      vigenciaFin: { gte: fecha },
    },
    select: { clave: true, valor: true },
  });
  return rows;
}
