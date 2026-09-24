/**
 * Unit — cobros refund bound guard (v2r-02, pure domain: no DB).
 *
 * `reembolsoExcedeMontoCobrado` is the arithmetic tripwire the refund path was
 * missing: a refund must never exceed what the client actually paid on the
 * invoice, `cobrado = total − saldoPendiente` derived from the SAME row-locked
 * facts the canonical recompute produces (mirroring the sibling
 * `COBRO_EXCEDE_SALDO` guard on the collection path). Domain-only, so every
 * case here runs with no database (AGENTS.md testing priority 1).
 */

import { Decimal } from "decimal.js";
import { reembolsoExcedeMontoCobrado } from "./pago";

describe("reembolsoExcedeMontoCobrado (v2r-02 refund bound)", () => {
  it("permits a refund below the amount actually paid", () => {
    // total 100.00, saldoPendiente 35.00 → cobrado 65.00; refund 50.00 is fine.
    expect(
      reembolsoExcedeMontoCobrado(
        new Decimal("50.00"),
        "100.00",
        "35.00",
      ),
    ).toBe(false);
  });

  it("permits a refund exactly equal to the amount actually paid (<= bound)", () => {
    // At the exact boundary the refund fully refunds what was paid — allowed.
    expect(
      reembolsoExcedeMontoCobrado(
        new Decimal("65.00"),
        "100.00",
        "35.00",
      ),
    ).toBe(false);
    // Fully collected invoice (saldoPendiente 0) → cobrado 100.00.
    expect(
      reembolsoExcedeMontoCobrado(
        new Decimal("100.00"),
        "100.00",
        "0.00",
      ),
    ).toBe(false);
  });

  it("rejects a refund that exceeds the amount actually paid", () => {
    expect(
      reembolsoExcedeMontoCobrado(
        new Decimal("65.01"),
        "100.00",
        "35.00",
      ),
    ).toBe(true);
    expect(
      reembolsoExcedeMontoCobrado(
        new Decimal("150.00"),
        "100.00",
        "0.00",
      ),
    ).toBe(true);
  });

  it("rejects ANY refund against a zero-payment invoice (the audit dummy)", () => {
    // Audit dummy F-2001: total 100.00 with ZERO payments → saldoPendiente
    // equals total → cobrado 0.00 → every positive amount over-refunds.
    expect(
      reembolsoExcedeMontoCobrado(
        new Decimal("500.00"),
        "100.00",
        "100.00",
      ),
    ).toBe(true);
    expect(
      reembolsoExcedeMontoCobrado(
        new Decimal("0.01"),
        "100.00",
        "100.00",
      ),
    ).toBe(true);
  });

  it("uses decimal arithmetic (no float drift) at scale", () => {
    // 9,999,999,999.99 total, one cent collected → cobrado 0.01; a refund of
    // 0.02 exceeds it by exactly one cent, never a rounding artifact.
    expect(
      reembolsoExcedeMontoCobrado(
        new Decimal("0.02"),
        "9999999999.99",
        "9999999999.98",
      ),
    ).toBe(true);
    expect(
      reembolsoExcedeMontoCobrado(
        new Decimal("0.01"),
        "9999999999.99",
        "9999999999.98",
      ),
    ).toBe(false);
  });
});