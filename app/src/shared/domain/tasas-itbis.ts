/**
 * ITBIS rates allowed for new use (Ley 30-26): 0 / 16 / 18 percent.
 *
 * Single shared source for the allowed set (pure TS, ADR-013: no Next.js,
 * React, Prisma or Supabase). Rates are decimal strings, never `number`.
 */
export const TASAS_ITBIS_PERMITIDAS = ["0", "16", "18"] as const;

export type TasaItbis = (typeof TASAS_ITBIS_PERMITIDAS)[number];

/** True when `valor` is exactly one of the allowed rate strings. */
export function esTasaItbisPermitida(valor: string): valor is TasaItbis {
  return (TASAS_ITBIS_PERMITIDAS as readonly string[]).includes(valor);
}

/** Human list of the allowed rates, e.g. "0%, 16% o 18%". */
export function textoTasasItbisPermitidas(): string {
  const porcentajes = TASAS_ITBIS_PERMITIDAS.map((t) => `${t}%`);
  const ultima = porcentajes[porcentajes.length - 1];
  return `${porcentajes.slice(0, -1).join(", ")} o ${ultima}`;
}

/** Error sentence for a rate outside the allowed set. */
export function mensajeTasaItbisInvalida(): string {
  return `La tasa de ITBIS debe ser ${textoTasasItbisPermitidas()}`;
}
