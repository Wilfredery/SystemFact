import { formatearMonto } from "./money";

/**
 * Behavioural LOCK for the shared `formatearMonto` (src/shared/ui/format/money.ts).
 *
 * Consolidates BOTH prior suites after the F0.3 move: venta's grouping lock
 * (originally `venta/ui/formatearMonto.test.ts`) and cobros' currency locks
 * (originally `cobros/ui/format.test.ts` — its `/1,234\.50/` and `/RD\$/`
 * regex asserts are folded here as exact-string asserts against the composed
 * `RD$ `-prefixed form).
 *
 * Contract pinned:
 *  - In-domain fixed-point strings render `RD$ ` + comma-grouped + 2 decimals
 *    ("1234.5" -> "RD$ 1,234.50").
 *  - Anything the guard rejects is returned VERBATIM, never throws (display
 *    boundary never blanks a cell).
 */
describe("formatearMonto (RD$ display, shared F0.3 formatter)", () => {
  it("groups the integer part and pads a 1-decimal value to two decimals", () => {
    expect(formatearMonto("1234.5")).toBe("RD$ 1,234.50");
  });

  it("keeps an explicit zero decimal", () => {
    expect(formatearMonto("0.00")).toBe("RD$ 0.00");
    expect(formatearMonto("0")).toBe("RD$ 0.00");
  });

  it("groups multi-thousand values with two decimals", () => {
    expect(formatearMonto("9999999.99")).toBe("RD$ 9,999,999.99");
    expect(formatearMonto("1000000000.50")).toBe("RD$ 1,000,000,000.50");
  });

  it("appends .00 to a bare integer", () => {
    expect(formatearMonto("1234")).toBe("RD$ 1,234.00");
    expect(formatearMonto("1000")).toBe("RD$ 1,000.00");
    expect(formatearMonto("999")).toBe("RD$ 999.00");
  });

  it("preserves trailing-zero and mid decimals that already carry a dot", () => {
    expect(formatearMonto("1234.50")).toBe("RD$ 1,234.50");
    expect(formatearMonto("1234.05")).toBe("RD$ 1,234.05");
    expect(formatearMonto("1234.00")).toBe("RD$ 1,234.00");
  });

  it("trims before matching but formats the trimmed value", () => {
    expect(formatearMonto(" 1234.5 ")).toBe("RD$ 1,234.50");
  });

  // Spec scenario "Out-of-domain input verbatim" (as `"-5"`, `"1.234"`, `""`).
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

  // Folded cobros assertions (exactly-once RD$ + resolved grouping).
  it("renders exactly one RD$ prefix with the grouped amount (cobros fold)", () => {
    expect(formatearMonto("100.00")).toBe("RD$ 100.00");
    expect((formatearMonto("100.00").match(/RD\$/g) ?? []).length).toBe(1);
  });
});
