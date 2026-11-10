/**
 * Tenant domain — read-only Administración screen rules (screens plan Step 7, S2c).
 *
 * PURE TypeScript: no Next.js, React, Prisma or Supabase (ADR-013). The single
 * rule here is the NCF range fill percentage the Configuración tab shows. It is
 * a domain rule and not a UI formatter because the stored pointer is a fiscal
 * fact (`secuenciaActual` = LAST USED value, ncf D7): "how much of the
 * authorized range is consumed" must be computed once, identically, for the
 * screen, tests and any future report.
 */

/**
 * Percentage of an NCF range consumed, computed with exact integer math (no
 * float division, so the 90% warning boundary the DGII rules use can never
 * disagree with this display) and rounded to the nearest whole percent.
 *
 * `secuenciaActual` is the LAST USED number: a range whose pointer is still at
 * or below `rangoInicio` is at 0%, and the range's own start counts as the
 * first used number, so the final number is exactly 100%.
 *
 * NOT clamped at 100: a stored pointer past `rangoFin` is an exhausted (or
 * mis-seeded) range, which is precisely what this read-only view exists to
 * surface — silently showing "100%" would hide it. A degenerate/inverted range
 * (no issuable number) reports 0 instead of throwing.
 */
export function calcularPorcentajeUsado(input: {
  readonly rangoInicio: bigint;
  readonly rangoFin: bigint;
  readonly secuenciaActual: bigint;
}): number {
  const total = input.rangoFin - input.rangoInicio + 1n;
  if (total <= 0n) return 0;
  const usados = input.secuenciaActual - input.rangoInicio + 1n;
  if (usados <= 0n) return 0;

  const escalado = usados * 100n;
  const cociente = escalado / total;
  const resto = escalado % total;
  // Round half up without leaving BigInt.
  const redondeado = resto * 2n >= total ? cociente + 1n : cociente;
  return Number(redondeado);
}
