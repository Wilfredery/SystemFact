/**
 * Unit — Caja domain error catalog (S5). No database.
 *
 * The catalog is deliberately minimal (YAGNI): ONLY the SD day-resolution failure is thrown by
 * this module today. The test pins that every declared code carries a stable Spanish message and
 * that the error object exposes the stable code so adapters never inline a string.
 */

import { CAJA_ERROR_CODES, CAJA_VALIDACION, CajaDomainError, messageFor } from "./errors";

describe("caja error catalog", () => {
  it("declares only the code the domain can actually throw", () => {
    expect(CAJA_ERROR_CODES).toEqual([CAJA_VALIDACION]);
  });

  it("gives every code a stable, non-empty user message", () => {
    for (const code of CAJA_ERROR_CODES) {
      const mensaje = messageFor(code);
      expect(typeof mensaje).toBe("string");
      expect(mensaje.length).toBeGreaterThan(0);
      // Stable: the same code always yields the same wording.
      expect(messageFor(code)).toBe(mensaje);
    }
  });

  it("carries the stable code and minimal details on the thrown error", () => {
    const error = new CajaDomainError(CAJA_VALIDACION, { campo: "fechaSD" });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CajaDomainError");
    expect(error.code).toBe(CAJA_VALIDACION);
    expect(error.message).toBe(messageFor(CAJA_VALIDACION));
    expect(error.details).toEqual({ campo: "fechaSD" });
  });
});
