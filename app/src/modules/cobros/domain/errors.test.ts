/**
 * Unit — cobros 600-series error catalog (R-C5).
 *
 * Proves every rejection path is catalog-coded: each exported code yields a
 * stable, non-empty Spanish user message, and `CobroDomainError` carries the
 * code + message + minimal context — never a stack trace (spec R-C5: "Every
 * rejection is catalog-coded ... never a stack trace"). Domain-only, no DB.
 */

import {
  COBRO_ERROR_CODES,
  CobroDomainError,
  PAGO_IDEMPOTENCIA_CONFLICTO,
  COBRO_EXCEDE_SALDO,
  REEMBOLSO_EXCEDE_SALDO,
  CLIENTE_EN_MORA,
  LIMITE_CREDITO_EXCEDIDO,
  CREDITO_NO_HABILITADO,
  FACTURA_COBRO_NO_VIGENTE,
  PAGO_NO_AUTORIZADO,
  PAGO_NO_ENCONTRADO,
  messageFor,
  type CobroErrorCode,
} from "./errors";

describe("cobros error catalog (600-series, R-C5)", () => {
  it("owns exactly the nine spec-listed codes", () => {
    // toStrictEqual (not toEqual): an unknowingly-missing export imports as
    // `undefined`, and toEqual IGNORES undefined array entries — which would let
    // this exact-list assertion pass vacuously before the code exists (TDD red).
    expect([...COBRO_ERROR_CODES].sort()).toStrictEqual(
      [
        PAGO_IDEMPOTENCIA_CONFLICTO,
        COBRO_EXCEDE_SALDO,
        REEMBOLSO_EXCEDE_SALDO,
        CLIENTE_EN_MORA,
        LIMITE_CREDITO_EXCEDIDO,
        CREDITO_NO_HABILITADO,
        FACTURA_COBRO_NO_VIGENTE,
        PAGO_NO_AUTORIZADO,
        PAGO_NO_ENCONTRADO,
      ].sort(),
    );
  });

  it.each(COBRO_ERROR_CODES.map((code) => [code]) as [CobroErrorCode][])(
    "%s yields a stable non-empty user message",
    (code) => {
      const message = messageFor(code);
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
      // Stable: identical across repeated lookups (single source of truth).
      expect(messageFor(code)).toBe(message);
    },
  );

  it("CobroDomainError carries the code, the catalog message and minimal context only", () => {
    const err = new CobroDomainError(COBRO_EXCEDE_SALDO, {
      facturaId: 42,
      saldoPendiente: "6000.00",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CobroDomainError");
    expect(err.code).toBe(COBRO_EXCEDE_SALDO);
    expect(err.message).toBe(messageFor(COBRO_EXCEDE_SALDO));
    expect(err.details).toEqual({ facturaId: 42, saldoPendiente: "6000.00" });
    // The user-facing message never embeds a stack trace or internal detail.
    expect(err.message).not.toMatch(/at .*\.ts|Prisma|Error:/);
  });

  it("details are optional for codes that need no locator", () => {
    const err = new CobroDomainError(CREDITO_NO_HABILITADO);
    expect(err.code).toBe(CREDITO_NO_HABILITADO);
    expect(err.details).toBeUndefined();
  });
});
