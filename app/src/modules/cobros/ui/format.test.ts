import { formatearMontoDO, formatearFechaDO } from "./format";

describe("formatearMontoDO (es-DO currency, Decimal-safe)", () => {
  it("groups a Decimal-string as Dominican currency without any float math", () => {
    // es-DO uses "RD$" for DOP; grouping/decimal separators are locale-owned.
    expect(formatearMontoDO("1234.50")).toMatch(/1,234\.50/);
    expect(formatearMontoDO("10000")).toMatch(/10,000\.00/);
    expect(formatearMontoDO("0.00")).toMatch(/0\.00/);
  });

  it("renders the RD$ currency marker", () => {
    expect(formatearMontoDO("100.00")).toMatch(/RD\$/);
  });

  it("shows an out-of-domain value verbatim rather than throwing", () => {
    expect(formatearMontoDO("garbage")).toBe("garbage");
  });
});

describe("formatearFechaDO (SD calendar date display)", () => {
  it("formats a bare SD date string day/month/year", () => {
    expect(formatearFechaDO("2026-01-31")).toBe("31/01/2026");
  });

  it("falls back to an em dash for an empty/unparseable value", () => {
    expect(formatearFechaDO("")).toBe("—");
    expect(formatearFechaDO("not-a-date")).toBe("—");
  });
});
