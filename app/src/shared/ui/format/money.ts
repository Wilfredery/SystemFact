/**
 * Shared display money formatter (F0.3) — the ONE `formatearMonto`.
 *
 * Presentation-only: it turns the `Decimal(12,2)` fixed-point STRINGS the
 * canonical views carry into the Dominican display form with an explicit
 * `RD$ ` prefix, en-US thousands grouping and exactly two decimals
 * (`"1234.50"` → `"RD$ 1,234.50"`).
 *
 * Out-of-domain input (three decimals, negatives, blank/garbage) is returned
 * VERBATIM — never throws, never blanks a board cell (format spec: "display
 * boundary never blank"). The integer part is a plain digit run (Div 12 digits
 * max) so `Number()` is exact for every in-domain input; the decimal part is
 * appended verbatim so no locale decimal dialect can leak in.
 */

const MONTO_RE = /^(\d+)(\.(\d{1,2}))?$/;

// Grouping is pinned to en-US so the thousands separator stays a comma
// regardless of the server/browser default locale.
const MONTO_AGRUPADOR = new Intl.NumberFormat("en-US", { useGrouping: true });

/** `Decimal(12,2)` fixed-point string → `RD$ 1,234.50` display (or verbatim). */
export function formatearMonto(valor: string): string {
  const m = MONTO_RE.exec(valor.trim());
  if (m === null) return valor;
  const entero = MONTO_AGRUPADOR.format(Number(m[1]));
  const dec = (m[3] ?? "").padEnd(2, "0");
  return `RD$ ${entero}.${dec}`;
}
