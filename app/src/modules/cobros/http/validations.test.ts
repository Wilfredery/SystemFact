/**
 * Unit — cobros transport grammar (Zod).
 *
 * Zod owns the SHAPE only: a positive `Decimal(12,2)` amount, an OPTIONAL SD
 * calendar date (`YYYY-MM-DD`, really a calendar day) and an OPTIONAL payment
 * reference bounded to the `PAGO.referencia` column width (80). Business rules —
 * the date BAND, the invoice state, the over-payment guard — stay in the
 * application/domain and never leak here.
 */

import { zRegistrarCobroInput } from "./validations";

const base = { facturaId: 12, monto: "1500.00" } as const;

describe("zRegistrarCobroInput — amount grammar (unchanged)", () => {
  it("accepts a positive Decimal(12,2) amount", () => {
    expect(zRegistrarCobroInput.safeParse(base).success).toBe(true);
    expect(zRegistrarCobroInput.safeParse({ ...base, monto: "0.01" }).success).toBe(true);
  });

  it("rejects zero, floats beyond 2 decimals and a non-positive id", () => {
    expect(zRegistrarCobroInput.safeParse({ ...base, monto: "0" }).success).toBe(false);
    expect(zRegistrarCobroInput.safeParse({ ...base, monto: "10.001" }).success).toBe(false);
    expect(zRegistrarCobroInput.safeParse({ ...base, facturaId: 0 }).success).toBe(false);
  });
});

describe("zRegistrarCobroInput — optional Fecha del pago (S14)", () => {
  it("accepts an absent date (the server defaults it)", () => {
    expect(zRegistrarCobroInput.safeParse(base).success).toBe(true);
  });

  it("accepts a real SD calendar date", () => {
    const parsed = zRegistrarCobroInput.safeParse({ ...base, fechaCobro: "2026-08-10" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.fechaCobro).toBe("2026-08-10");
  });

  it("rejects a non-ISO shape and a date that does not exist", () => {
    for (const fechaCobro of ["10/08/2026", "2026-8-10", "2026-02-31", "2026-13-01", ""]) {
      expect(zRegistrarCobroInput.safeParse({ ...base, fechaCobro }).success).toBe(false);
    }
  });
});

describe("zRegistrarCobroInput — optional Referencia (S14)", () => {
  it("accepts a reference at the 80-character column bound and trims it", () => {
    const parsed = zRegistrarCobroInput.safeParse({
      ...base,
      referencia: `  ${"R".repeat(80)}  `,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.referencia).toBe("R".repeat(80));
  });

  it("rejects a reference longer than the column", () => {
    expect(
      zRegistrarCobroInput.safeParse({ ...base, referencia: "R".repeat(81) }).success,
    ).toBe(false);
  });

  it("accepts an absent reference", () => {
    expect(zRegistrarCobroInput.safeParse(base).success).toBe(true);
  });
});
