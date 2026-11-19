/**
 * Unit — the CxC board search normalization (S12: search by client name or
 * invoice number, server-side LIKE over normalized input).
 *
 * Pure: no DB. The board query receives the NORMALIZED term and builds the
 * `%term%` pattern itself, so this suite pins the whole grammar: blank input
 * means "no filter" (`null`, never `%%`), the term is case-folded and
 * whitespace-collapsed before it reaches SQL, LIKE metacharacters are escaped
 * so a user typing `%` matches a literal percent, and the length is bounded.
 */

import {
  LARGO_MAXIMO_BUSQUEDA_CXC,
  normalizarBusquedaCxc,
} from "./busqueda-cxc";

describe("normalizarBusquedaCxc (S12)", () => {
  it("treats blank input as NO filter (null — never a wildcard-only pattern)", () => {
    expect(normalizarBusquedaCxc(undefined)).toBeNull();
    expect(normalizarBusquedaCxc(null)).toBeNull();
    expect(normalizarBusquedaCxc("")).toBeNull();
    expect(normalizarBusquedaCxc("   ")).toBeNull();
    expect(normalizarBusquedaCxc("\t \n")).toBeNull();
  });

  it("trims, collapses inner whitespace and case-folds the term", () => {
    expect(normalizarBusquedaCxc("  Ferretería   del\tValle ")).toBe(
      "ferretería del valle",
    );
    expect(normalizarBusquedaCxc("ABC123")).toBe("abc123");
  });

  it("keeps an invoice number search intact", () => {
    expect(normalizarBusquedaCxc(" 1042 ")).toBe("1042");
  });

  it("escapes LIKE metacharacters so they match literally", () => {
    expect(normalizarBusquedaCxc("100%")).toBe("100\\%");
    expect(normalizarBusquedaCxc("a_b")).toBe("a\\_b");
    expect(normalizarBusquedaCxc("c\\d")).toBe("c\\\\d");
  });

  it("bounds the term length", () => {
    const larga = "a".repeat(LARGO_MAXIMO_BUSQUEDA_CXC + 40);
    expect(normalizarBusquedaCxc(larga)).toHaveLength(LARGO_MAXIMO_BUSQUEDA_CXC);
  });
});
