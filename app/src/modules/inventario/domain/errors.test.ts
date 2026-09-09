/**
 * DB-free unit tests for the inventario error catalog (tasks 5.2).
 */

import {
  INVENTARIO_ERROR_CODES,
  InventarioDomainError,
  messageFor,
  CANTIDAD_INVALIDA,
  MOTIVO_VACIO,
  STOCK_INSUFICIENTE,
  INVENTARIO_NO_ENCONTRADO,
  NO_AUTORIZADO,
  LIMITE_PAGINACION_INVALIDO,
  PAGINA_INVALIDA,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  type InventarioErrorCode,
} from "./errors";

describe("inventario error catalog", () => {
  it("every catalogued code produces a non-empty, stable message", () => {
    const expectedCodes: readonly InventarioErrorCode[] = [
      CANTIDAD_INVALIDA,
      MOTIVO_VACIO,
      STOCK_INSUFICIENTE,
      INVENTARIO_NO_ENCONTRADO,
      NO_AUTORIZADO,
      LIMITE_PAGINACION_INVALIDO,
      PAGINA_INVALIDA,
      SESION_INVALIDA,
      VALIDATION_ERROR,
    ];
    expect(INVENTARIO_ERROR_CODES).toEqual(expectedCodes);

    for (const code of INVENTARIO_ERROR_CODES) {
      const message = messageFor(code);
      expect(typeof message).toBe("string");
      expect(message.trim().length).toBeGreaterThan(0);
      // Deterministic: the same code always yields the same message.
      expect(messageFor(code)).toBe(message);
    }
  });

  it("pins the key business messages (stable contract for the UI)", () => {
    expect(messageFor(CANTIDAD_INVALIDA)).toContain("cantidad");
    expect(messageFor(MOTIVO_VACIO)).toContain("motivo");
    expect(messageFor(STOCK_INSUFICIENTE)).toContain("negativo");
    expect(messageFor(INVENTARIO_NO_ENCONTRADO)).toContain("inventario");
    expect(messageFor(NO_AUTORIZADO)).toContain("permisos");
  });

  it("InventarioDomainError carries the stable code and the catalog message", () => {
    const err = new InventarioDomainError(STOCK_INSUFICIENTE);
    expect(err).toBeInstanceOf(InventarioDomainError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(STOCK_INSUFICIENTE);
    expect(err.message).toBe(messageFor(STOCK_INSUFICIENTE));
    expect(err.name).toBe("InventarioDomainError");
  });

  it("InventarioDomainError can carry minimal context without altering the message", () => {
    const err = new InventarioDomainError(INVENTARIO_NO_ENCONTRADO, {
      productoId: 42,
    });
    expect(err.code).toBe(INVENTARIO_NO_ENCONTRADO);
    expect(err.details).toEqual({ productoId: 42 });
    expect(err.message).toBe(messageFor(INVENTARIO_NO_ENCONTRADO));
  });
});
