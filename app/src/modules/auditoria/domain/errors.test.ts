/**
 * Unit — auditoria error catalog (spec AC-1/AC-2/AC-3).
 *
 * Proves the two consultation rejection paths are catalog-coded: each exported code
 * yields a stable, non-empty Spanish user message, and `AuditoriaDomainError` carries
 * the code + message + minimal context — never a stack trace. Domain-only, no DB.
 * Mirrors the `cobros/domain/errors.test.ts` style.
 */

import {
  AUDITORIA_ERROR_CODES,
  AUDITORIA_NO_AUTORIZADO,
  AUDITORIA_VALIDACION,
  AuditoriaDomainError,
  messageFor,
  type AuditoriaErrorCode,
} from "./errors";

describe("auditoria error catalog", () => {
  it("owns exactly the two spec-listed consultation codes", () => {
    expect([...AUDITORIA_ERROR_CODES].sort()).toEqual(
      [AUDITORIA_NO_AUTORIZADO, AUDITORIA_VALIDACION].sort(),
    );
  });

  it.each(AUDITORIA_ERROR_CODES.map((code) => [code]) as [AuditoriaErrorCode][])(
    "%s yields a stable non-empty user message",
    (code) => {
      const message = messageFor(code);
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
      expect(messageFor(code)).toBe(message);
    },
  );

  it("AuditoriaDomainError carries the code, the catalog message and minimal context only", () => {
    const err = new AuditoriaDomainError(AUDITORIA_VALIDACION, { campo: "accion" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AuditoriaDomainError");
    expect(err.code).toBe(AUDITORIA_VALIDACION);
    expect(err.message).toBe(messageFor(AUDITORIA_VALIDACION));
    expect(err.details).toEqual({ campo: "accion" });
    // The user-facing message never embeds a stack trace or internal detail.
    expect(err.message).not.toMatch(/at .*\.ts|Prisma|Error:/);
  });

  it("details are optional when the code needs no locator", () => {
    const err = new AuditoriaDomainError(AUDITORIA_NO_AUTORIZADO);
    expect(err.code).toBe(AUDITORIA_NO_AUTORIZADO);
    expect(err.details).toBeUndefined();
  });
});
