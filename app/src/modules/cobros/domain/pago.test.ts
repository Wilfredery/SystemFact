/**
 * Unit — cobros refund bound guard (audit run-3, pure domain: no DB).
 *
 * `reembolsoExcedeMontoCobrado` is the arithmetic tripwire the refund path was
 * missing. Audit run-3: the bound is the NET CASH actually collected on the
 * invoice minus the refunds already committed (`cobradoNeto` = Σ COBRO/APLICADO
 * − Σ committed REEMBOLSO, computed on the same row-locked recompute), NOT the
 * old `total − saldoPendiente` derivation, which (a) excluded committed refunds
 * (the ADR-017 balance is refund-blind) and (b) was inflated by VIGENTE credit
 * notes — letting sequential fresh-key refunds drain cash unboundedly. Domain
 * only, so every case runs with no database (AGENTS.md testing priority 1).
 */

import { Decimal } from "decimal.js";
import { reembolsoExcedeMontoCobrado } from "./pago";

describe("reembolsoExcedeMontoCobrado (audit run-3 net-cash refund bound)", () => {
  it("rejects any positive refund against zero net cash", () => {
    // Zero cobros committed, zero refunds: nothing to return.
    expect(reembolsoExcedeMontoCobrado(new Decimal("500.00"), "0.00")).toBe(true);
    expect(reembolsoExcedeMontoCobrado(new Decimal("0.01"), "0.00")).toBe(true);
  });

  it("accepts a refund exactly equal to net cash (bound is <=)", () => {
    expect(reembolsoExcedeMontoCobrado(new Decimal("10000.00"), "10000.00")).toBe(false);
    expect(reembolsoExcedeMontoCobrado(new Decimal("0.01"), "0.01")).toBe(false);
  });

  it("accepts a refund below net cash", () => {
    expect(reembolsoExcedeMontoCobrado(new Decimal("500.00"), "10000.00")).toBe(false);
  });

  it("rejects a refund exceeding net cash", () => {
    expect(reembolsoExcedeMontoCobrado(new Decimal("10000.01"), "10000.00")).toBe(true);
    expect(reembolsoExcedeMontoCobrado(new Decimal("150.00"), "100.00")).toBe(true);
  });

  it("the bound SHRINKS as committed refunds grow (the sequential-refund regression)", () => {
    // Full COBRO of 10000.00, refund #1 of 500.00 committed → net cash 9500.00.
    // A fresh-key refund of 500.00 still fits; anything past the remaining net
    // is rejected — the old bound ignored committed refunds entirely.
    expect(reembolsoExcedeMontoCobrado(new Decimal("500.00"), "9500.00")).toBe(false);
    expect(reembolsoExcedeMontoCobrado(new Decimal("9500.01"), "9500.00")).toBe(true);
    // Net cash itself negative (more refunded than collected — defense in
    // depth) must reject EVERY positive amount.
    expect(reembolsoExcedeMontoCobrado(new Decimal("0.01"), "-1.00")).toBe(true);
  });

  it("decimal arithmetic at scale (no float drift)", () => {
    // 9,999,999,999.99 collected net → refund of 9,999,999,999.98 is fine, one
    // cent above is rejected by exactly one cent, never a rounding artifact.
    expect(reembolsoExcedeMontoCobrado(new Decimal("9999999999.98"), "9999999999.99")).toBe(false);
    // A refund exactly EQUAL to the net bound is <=, so accepted.
    expect(reembolsoExcedeMontoCobrado(new Decimal("9999999999.99"), "9999999999.99")).toBe(false);
    // One whole unit above the collectible net is rejected.
    expect(reembolsoExcedeMontoCobrado(new Decimal("10000000000.00"), "9999999999.99")).toBe(true);
  });
});
