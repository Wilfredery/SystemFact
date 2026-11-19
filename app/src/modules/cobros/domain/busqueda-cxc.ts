/**
 * Pure CxC board search normalization (board-03 S12: search by client name or
 * invoice number; the wireframe's Estado dropdown was rejected).
 *
 * No DB, no Prisma, no React. The board query narrows SERVER-SIDE with a LIKE
 * pattern (`"%term%"`) built from this normalized term, so this function is the
 * ONE grammar the transport and the SQL share:
 *
 *   • blank input (`""`, whitespace, absent) → `null`: NO filter. Returning `""`
 *     would build `%%`, a wildcard-only pattern that silently widens the board.
 *   • the term is trimmed, its inner whitespace collapsed to one space and
 *     case-folded, so "  Ferretería   del Valle " and "ferretería del valle"
 *     are the same search.
 *   • LIKE metacharacters (`%`, `_`) and the escape character itself are
 *     escaped, so a user typing `100%` matches a literal percent instead of
 *     every row (Postgres' default LIKE escape is the backslash).
 *   • the length is bounded ({@link LARGO_MAXIMO_BUSQUEDA_CXC}), keeping the
 *     pattern and the request payload small.
 *
 * Accent folding is NOT applied: it would need the `unaccent` extension on the
 * SQL side, which this project does not provision. Case folding only.
 */

/** Hard ceiling for a normalized search term (characters). */
export const LARGO_MAXIMO_BUSQUEDA_CXC = 80;

/** `%`, `_` and the escape character itself must reach LIKE literally. */
const METACARACTERES_LIKE = /[\\%_]/g;

/**
 * Normalize a raw board search input into the term the SQL pattern is built
 * from, or `null` when the user is not filtering at all.
 */
export function normalizarBusquedaCxc(entrada?: string | null): string | null {
  if (entrada === undefined || entrada === null) return null;
  const compacta = entrada.normalize("NFC").trim().replace(/\s+/g, " ");
  if (compacta === "") return null;
  return compacta
    .slice(0, LARGO_MAXIMO_BUSQUEDA_CXC)
    .toLowerCase()
    .replace(METACARACTERES_LIKE, (caracter) => `\\${caracter}`);
}
