/**
 * Reportes domain — the DGII 607 "Tipo de Ingreso" (D5) code resolution (FIS-3, U3; slice E, task 5.2).
 *
 * ADR-013: PURE TypeScript. D5 is a ONE-CHARACTER field, so its code is a SINGLE DIGIT: the 607
 * instructivo's classes are 1–6, and a zero-padded `"01"` is not a valid D5 value — it is two
 * characters in a one-character field, which shifts every following column of the detail row and
 * is rejected by DGII. The grammar is therefore pinned here as {@link ES_CODIGO_TIPO_INGRESO}
 * and the `infrastructure/` reader DROPS any configured value outside it before the map ever
 * reaches the resolver, so a bad config row degrades to the documented default instead of shipping
 * a file DGII would reject.
 *
 * The map keys are SystemFact's own document classifications (the sales NCF type); the values are
 * the DGII income-code strings. Because the code table stays (a) tenant-configurable per the
 * binding decision ("Tipo-Ingreso mapping → ConfiguracionEmpresa-backed, never a constant") and
 * (b) verifiable against the DGII pre-validation tool, this domain function NEVER hardcodes a
 * per-class table: it takes the mapping RESOLVED FROM THE DB (an `infrastructure/` reader over
 * `ConfiguracionEmpresa`) and a documented safe default, and applies it purely. A code-table change
 * is then a DATA edit (config rows) with zero logic change — the exact config seam U3 demands.
 *
 * The default stands in only when the tenant has configured nothing for a document's class — a
 * documented, single-constant fallback, not a silent guess per document.
 * {@link resolverTipoIngreso} is pure and fully unit-testable with a fixed map.
 */

/** A tenant's Tipo-Ingreso code table: document class → DGII income code (string, unpadded). */
export type MapaTipoIngreso = Readonly<Record<string, string>>;

/**
 * The documented safe DEFAULT income code when a document's class has no configured mapping.
 * Kept as the SINGLE seam (research §9 U3: not authoritatively pinned). Value `"1"` is the most
 * general "operaciones gravadas" class and is itself a valid one-digit D5; a tool-verified change
 * edits this one constant (or, better, the tenant's config rows) with no logic touch.
 */
export const TIPO_INGRESO_POR_DEFECTO = "1";

/** The length of the 607 D5 "Tipo de Ingreso" field (a single numeric code — research §3 D5). */
export const LARGO_TIPO_INGRESO = 1;

/**
 * The D5 code grammar: the single digits `1`–`6`, the set verified against the official DGII 607
 * instructivo (its "Tipo de Ingreso" field is a one-character code over exactly those six
 * classes). Anchored, so `"01"`, `"7"`, `"1.0"`, a padded value or any non-digit is rejected. The
 * `infrastructure/` reader applies it to the parsed config map; the same rule is the transport
 * guard the tests pin. If DGII ever widens the class list, this regex is the single edit.
 */
export const ES_CODIGO_TIPO_INGRESO = /^[1-6]$/;

/**
 * True when `codigo` is a well-formed DGII D5 income code (one of the single digits 1–6). Used to
 * discard a tenant-configured value that DGII would reject, so the resolver falls back to
 * {@link TIPO_INGRESO_POR_DEFECTO} rather than shipping a malformed field.
 */
export function esCodigoTipoIngresoValido(codigo: string): boolean {
  return ES_CODIGO_TIPO_INGRESO.test(codigo);
}

/**
 * Resolve the DGII 607 income code for one document's class from the DB-backed `mapa`, falling
 * back to {@link TIPO_INGRESO_POR_DEFECTO} only when that class is genuinely unconfigured. The
 * returned code is the raw single digit; the writer left/zero-pads it to
 * {@link LARGO_TIPO_INGRESO}, which for one digit is the digit itself.
 *
 * A non-empty but MALFORMED configured value is treated as unconfigured rather than returned, so
 * this function is safe to call with a map that has not been grammar-filtered upstream.
 */
export function resolverTipoIngreso(
  claseDocumento: string,
  mapa: MapaTipoIngreso,
): string {
  const codigo = mapa[claseDocumento];
  if (codigo !== undefined && esCodigoTipoIngresoValido(codigo)) return codigo;
  return TIPO_INGRESO_POR_DEFECTO;
}
