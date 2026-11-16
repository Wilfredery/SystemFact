/**
 * Per-empresa ITBIS rate list helpers (feature itbis-tasas-config).
 *
 * Pure TS, ADR-013: no Next.js, React, Prisma or Supabase. Rates are decimal
 * strings, never `number`. The allowed set is DATA in CONFIGURACION_EMPRESA
 * (key `TASA_ITBIS`): the old hardcoded 0/16/18 constant and its membership
 * predicate were deleted in slice 3g — every validation now goes through
 * `esTasaEnLista` against the empresa's own list (numeric equality).
 */
import { Decimal } from "decimal.js";

/**
 * Fallback copy for a rate outside the allowed set, kept for the error
 * catalog's static default (producto/domain/errors.ts). The LIVE messages are
 * built from the empresa's list via `mensajeTasaItbisInvalidaDe(list)`; this
 * literal only matches the former constant-derived output (0/16/18 today).
 */
export function mensajeTasaItbisInvalida(): string {
  return "La tasa de ITBIS debe ser 0%, 16% o 18%";
}

// ---------------------------------------------------------------------------
// Per-empresa rate list (config key TASA_ITBIS). Pure: the DB read lives in
// `shared/infrastructure/tasas-itbis-config.ts`.
// ---------------------------------------------------------------------------

/** `ConfiguracionEmpresa.clave` holding the comma list of allowed rates. */
export const CLAVE_TASA_ITBIS = "TASA_ITBIS";

/** Stable error code for a missing or malformed `TASA_ITBIS` key. */
export const CODIGO_TASA_ITBIS_CONFIG_FALTANTE = "TASA_ITBIS_CONFIG_FALTANTE";

export const MENSAJE_TASA_ITBIS_CONFIG_FALTANTE =
  "Falta la configuración TASA_ITBIS requerida; no se puede validar la tasa de ITBIS";

/** Raised by the config reader when the rate list cannot be trusted. */
export class TasasItbisConfigError extends Error {
  readonly code = CODIGO_TASA_ITBIS_CONFIG_FALTANTE;
  readonly motivo: "ausente" | "valor_invalido";
  readonly detalle?: string;

  constructor(motivo: "ausente" | "valor_invalido", detalle?: string) {
    super(MENSAJE_TASA_ITBIS_CONFIG_FALTANTE);
    this.name = "TasasItbisConfigError";
    this.motivo = motivo;
    this.detalle = detalle;
  }
}

const FORMATO_TASA = /^\d{1,3}(\.\d{1,2})?$/;

/** Shape only: plain non-negative decimal, max 2 decimals, 0 to 100. */
export function esTasaItbisFormatoValido(t: string): boolean {
  return FORMATO_TASA.test(t) && new Decimal(t).lte(100);
}

export type ResultadoParseoTasasItbis =
  | { readonly ok: true; readonly tasas: readonly string[] }
  | { readonly ok: false; readonly motivo: string };

/** Parse the stored comma list into canonical rate strings, in config order. */
export function parsearListaTasasItbis(valor: string): ResultadoParseoTasasItbis {
  if (valor.trim() === "") return { ok: false, motivo: "valor vacío" };
  const tasas: string[] = [];
  for (const crudo of valor.split(",")) {
    const token = crudo.trim();
    if (token === "") return { ok: false, motivo: "elemento vacío en la lista" };
    if (!FORMATO_TASA.test(token)) {
      return { ok: false, motivo: `tasa con formato inválido: "${token}"` };
    }
    const decimal = new Decimal(token);
    if (decimal.gt(100)) return { ok: false, motivo: `tasa mayor a 100: "${token}"` };
    const texto = decimal.toString();
    if (tasas.includes(texto)) return { ok: false, motivo: `tasa duplicada: "${texto}"` };
    tasas.push(texto);
  }
  return { ok: true, tasas };
}

/** True when `tasa` equals (numerically) one of `tasas`: "18.00" matches "18". Never throws. */
export function esTasaEnLista(tasa: string, tasas: readonly string[]): boolean {
  if (!esTasaItbisFormatoValido(tasa)) return false;
  const buscada = new Decimal(tasa);
  return tasas.some((t) => esTasaItbisFormatoValido(t) && new Decimal(t).equals(buscada));
}

/** UI label of a rate: "0% (exento)" for zero, `${t}%` otherwise. */
export function etiquetaTasaItbis(t: string): string {
  return t === "0" ? "0% (exento)" : `${t}%`;
}

/** Error sentence built from the given list (ascending inside the sentence). */
export function mensajeTasaItbisInvalidaDe(tasas: readonly string[]): string {
  const porcentajes = [...tasas]
    .sort((a, b) => new Decimal(a).comparedTo(new Decimal(b)))
    .map((t) => `${t}%`);
  if (porcentajes.length <= 1) {
    return `La tasa de ITBIS debe ser ${porcentajes.join("")}`;
  }
  const ultima = porcentajes[porcentajes.length - 1];
  return `La tasa de ITBIS debe ser ${porcentajes.slice(0, -1).join(", ")} o ${ultima}`;
}
