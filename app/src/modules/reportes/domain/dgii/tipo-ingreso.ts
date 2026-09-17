/**
 * Reportes domain — the DGII 607 "Tipo de Ingreso" (D5) code resolution (FIS-3, U3; slice E, task 5.2).
 *
 * ADR-013: PURE TypeScript. Research §5/§9 (U3) is explicit that the authoritative 607 D5 code
 * LIST (1–6) could NOT be read from the annex and is UNVERIFIED; it MUST be confirmed against the
 * DGII pre-validation tool / Anexo B. Because the code table is (a) tenant-configurable per the
 * binding decision ("Tipo-Ingreso mapping → ConfiguracionEmpresa-backed, never a constant") and
 * (b) itself tool-unverified, this domain function NEVER hardcodes a table: it takes the mapping
 * RESOLVED FROM THE DB (an `infrastructure/` reader over `ConfiguracionEmpresa`) and a documented
 * safe default, and applies it purely. A tool-verified code-table change is then a DATA edit
 * (config rows) with zero logic change — the exact config seam U3 demands.
 *
 * The map keys are SystemFact's own document classifications (the sales NCF type); the values are
 * the DGII income-code strings. The default stands in only when the tenant has configured nothing
 * for a document's class — it is a documented, single-constant fallback, not a silent guess per
 * document. {@link RESOLVER_TIPO_INGRESO} is pure and fully unit-testable with a fixed map.
 */

/** A tenant's Tipo-Ingreso code table: document class → DGII income code (string, unpadded). */
export type MapaTipoIngreso = Readonly<Record<string, string>>;

/**
 * The documented safe DEFAULT income code when a document's class has no configured mapping.
 * Kept as the SINGLE seam (research §9 U3: not authoritatively pinned). Value `"1"` mirrors the
 * most general "operaciones gravadas" class; a tool-verified change edits this one constant (or,
 * better, the tenant's config rows) with no logic touch. Never a per-document guess.
 */
export const TIPO_INGRESO_POR_DEFECTO = "1";

/** The length of the 607 D5 "Tipo de Ingreso" field (a single numeric code — research §3 D5). */
export const LARGO_TIPO_INGRESO = 1;

/**
 * Resolve the DGII 607 income code for one document's class from the DB-backed `mapa`, falling
 * back to {@link TIPO_INGRESO_POR_DEFECTO} only when that class is genuinely unconfigured. The
 * returned code is the raw string; the writer zero/left-pads it to {@link LARGO_TIPO_INGRESO}.
 */
export function resolverTipoIngreso(
  claseDocumento: string,
  mapa: MapaTipoIngreso,
): string {
  const codigo = mapa[claseDocumento];
  if (codigo !== undefined && codigo !== "") return codigo;
  return TIPO_INGRESO_POR_DEFECTO;
}
