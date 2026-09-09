/**
 * Shared, pure fiscal-identifier validation (mod-11 check digit) for the
 * Dominican Republic RNC (taxpayer registry) and cédula (national ID).
 *
 * Dependency-free by contract (ADR-013): imports NOTHING from Prisma, Next.js,
 * React or Supabase, so it lives in `shared/domain` and is importable by the
 * `cliente` module now and by compra/venta later with identical results
 * (client-validators R1/R2/R3/R4). Domain tests run with no database.
 *
 * Algorithms are frozen to `docs/13-glosarioFact.md` §39–40 (DGII mod-11):
 *   - RNC    : weights [7,9,8,6,5,4,3,2] applied to the first 8 digits.
 *   - cédula : weights [1,2,4,8,5,10,9,7,3,6] applied to the first 10 digits.
 *   - DV     : 11 − (Σ mod 11); a raw result of 11 normalizes to DV 0; a raw
 *              result of 10 is invalid (no single check digit can satisfy it).
 * Weights are compile-time constants, NEVER configurable (spec requirement).
 *
 * OPEN ITEM (client-validators R3, design Open Questions):
 *   The modern 11-digit CORPORATE RNC (branch-suffix form, e.g. `…-00001`)
 *   shares its length with the cédula. Its check-digit variant is NOT pinned by
 *   docs/13, so it is deliberately NOT handled here: until an accountant pins it
 *   in Fase 5b/5c, an 11-digit input is validated ONLY under the cédula rule.
 *   A caller needing to accept an 11-digit corporate RNC must resolve that open
 *   item first — do not special-case it around this validator.
 */

/** Normalized success carries the separator-stripped digit string for storage. */
export type ValidacionFiscalResultado =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false };

/** Frozen mod-11 weights — RNC uses the first 8 digits of a 9-digit value. */
const PESOS_RNC: readonly number[] = [7, 9, 8, 6, 5, 4, 3, 2];
/** Frozen mod-11 weights — cédula uses the first 10 digits of an 11-digit value. */
const PESOS_CEDULA: readonly number[] = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6];

/**
 * Strip separators (`-` and whitespace) so `131-04567-7` and `13104567 7`
 * collapse to the same digit run before validation (client-validators R2).
 */
function normalizar(valor: string): string {
  return valor.replace(/[\s-]/g, "");
}

/**
 * Compute the mod-11 check digit over `digitos` using the pinned `pesos`,
 * returning the expected trailing check digit or `null` when the raw result is
 * 10 (an impossible check digit). The final digit of `digitos` is the one being
 * verified; the weighted sum covers only the leading `pesos.length` digits.
 */
function digitoVerificadorValido(
  digitos: readonly number[],
  pesos: readonly number[],
): boolean {
  let suma = 0;
  for (let i = 0; i < pesos.length; i++) {
    suma += digitos[i] * pesos[i];
  }
  const resto = suma % 11;
  const dv = 11 - resto;
  if (dv === 10) return false; // impossible check digit → always invalid
  const dvFinal = dv === 11 ? 0 : dv; // 11 normalizes to 0
  return digitos[digitos.length - 1] === dvFinal;
}

/** `true` only for an all-digit string of the exact expected length. */
function esRanuraNumerica(valor: string, longitud: number): boolean {
  return valor.length === longitud && /^\d+$/.test(valor);
}

/**
 * Validate a 9-digit RNC (persona jurídica / business). Normalizes separators,
 * enforces the 9-digit shape, then applies the pinned RNC weights.
 */
export function validarRnc(valor: string): ValidacionFiscalResultado {
  const digits = normalizar(valor);
  if (!esRanuraNumerica(digits, 9)) return { ok: false };
  const digitos = digits.split("").map(Number);
  return digitoVerificadorValido(digitos, PESOS_RNC)
    ? { ok: true, value: digits }
    : { ok: false };
}

/**
 * Validate an 11-digit cédula (persona física / national ID). Normalizes
 * separators, enforces the 11-digit shape, then applies the pinned cédula
 * weights. NOTE: this also — and only — governs 11-digit input, because the
 * corporate 11-digit RNC variant is an open item (see the file header).
 */
export function validarCedula(valor: string): ValidacionFiscalResultado {
  const digits = normalizar(valor);
  if (!esRanuraNumerica(digits, 11)) return { ok: false };
  const digitos = digits.split("").map(Number);
  return digitoVerificadorValido(digitos, PESOS_CEDULA)
    ? { ok: true, value: digits }
    : { ok: false };
}

/**
 * Combined entry point: length discriminates the variant. Exactly 9 digits →
 * RNC rule; exactly 11 digits → cédula rule; any other length or any non-digit
 * character fails without attempting a checksum (client-validators R2).
 *
 * @throws never — returns a typed `{ ok: false }` on every invalid shape.
 */
export function validarIdentificacionFiscal(
  valor: string,
): ValidacionFiscalResultado {
  const digits = normalizar(valor);
  if (digits.length === 9) return validarRnc(digits);
  if (digits.length === 11) return validarCedula(digits);
  return { ok: false };
}
