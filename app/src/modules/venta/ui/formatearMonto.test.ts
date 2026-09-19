import { formatearMonto } from "./carro";

/**
 * Presentation-only contract for `formatearMonto` (venta/ui/carro.ts).
 *
 * This file is the behavioural LOCK for the S8786 swap that replaces the
 * hand-rolled thousands-grouping regex
 * (`/\B(?=(\d{3})+(?!\d))/g`) with `Intl.NumberFormat`. Every assertion below
 * encodes the OUTPUT of the original implementation so the refactor is provably
 * a no-op at the string boundary. The helper is display-only: it never touches
 * fiscal math, prices, or any domain value — it only reformats an already
 * computed fixed-point string.
 *
 * Contract being pinned:
 *  - Fixed-point strings (`^(\d+)(\.(\d{1,2}))?$` after trim) are grouped and
 *    rendered with exactly two decimals: "1234.5" -> "1,234.50".
 *  - A bare integer gets ".00" appended ("1234" -> "1,234.00").
 *  - Anything the guard rejects is returned VERBATIM, including surrounding
 *    whitespace ("  1.234  " -> "  1.234  ").
 */
describe("formatearMonto (presentation-only grouped money string)", () => {
  it("groups the integer part and pads a 1-decimal value to two decimals", () => {
    expect(formatearMonto("1234.5")).toBe("1,234.50");
  });

  it("keeps an explicit zero decimal", () => {
    expect(formatearMonto("0.00")).toBe("0.00");
    expect(formatearMonto("0")).toBe("0.00");
  });

  it("groups multi-thousand values with two decimals", () => {
    expect(formatearMonto("9999999.99")).toBe("9,999,999.99");
    expect(formatearMonto("1000000000.50")).toBe("1,000,000,000.50");
  });

  it("appends .00 to a bare integer", () => {
    expect(formatearMonto("1234")).toBe("1,234.00");
    expect(formatearMonto("1000")).toBe("1,000.00");
    expect(formatearMonto("999")).toBe("999.00");
  });

  it("preserves trailing-zero and mid decimals that already carry a dot", () => {
    expect(formatearMonto("1234.50")).toBe("1,234.50");
    expect(formatearMonto("1234.05")).toBe("1,234.05");
    expect(formatearMonto("1234.00")).toBe("1,234.00");
  });

  it("trims before matching but formats the trimmed value", () => {
    expect(formatearMonto(" 1234.5 ")).toBe("1,234.50");
  });

  it("returns out-of-domain values verbatim (guard rejects them)", () => {
    expect(formatearMonto("1.234")).toBe("1.234"); // three decimals -> no match
    expect(formatearMonto("12.345")).toBe("12.345");
    expect(formatearMonto("abc")).toBe("abc");
    expect(formatearMonto("-5")).toBe("-5");
    expect(formatearMonto("1e5")).toBe("1e5");
    expect(formatearMonto("")).toBe("");
  });

  it("returns a rejected value untrimmed, exactly as received", () => {
    expect(formatearMonto("  1.234  ")).toBe("  1.234  ");
  });
});
