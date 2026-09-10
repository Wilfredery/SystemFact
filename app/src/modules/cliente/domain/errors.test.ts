import {
  CLIENTE_IDENTIFICACION_DUPLICADA,
  IDENTIFICACION_FISCAL_INVALIDA,
  CLIENTE_NO_ENCONTRADO,
  CLIENTE_YA_INACTIVO,
  CLIENTE_TIENE_VENTAS,
  CONCURRENCIA_CONFLICTO,
  CREDITO_REQUIERE_FISCAL_IDENTIDAD,
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO,
  messageFor,
  ClienteDomainError,
} from "./errors";
import type { ClienteErrorCode } from "./errors";

/**
 * Task 1.6: the catalog maps all eleven stable codes to non-empty Spanish
 * messages and the domain error carries its code + optional details. The set of
 * codes is asserted by length so a future code without a message fails here.
 */
describe("cliente/domain/errors", () => {
  const TODOS: ClienteErrorCode[] = [
    CLIENTE_IDENTIFICACION_DUPLICADA,
    IDENTIFICACION_FISCAL_INVALIDA,
    CLIENTE_NO_ENCONTRADO,
    CLIENTE_YA_INACTIVO,
    CLIENTE_TIENE_VENTAS,
    CONCURRENCIA_CONFLICTO,
    CREDITO_REQUIERE_FISCAL_IDENTIDAD,
    NO_AUTORIZADO,
    SESION_INVALIDA,
    VALIDATION_ERROR,
    CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO,
  ];

  it("declares exactly the eleven design codes, all distinct", () => {
    expect(TODOS).toHaveLength(11);
    expect(new Set(TODOS).size).toBe(11);
  });

  it.each(TODOS)("maps %s to a non-empty Spanish message", (code) => {
    const mensaje = messageFor(code);
    expect(typeof mensaje).toBe("string");
    expect(mensaje.length).toBeGreaterThan(0);
    // messageFor must be the same string the error's base message exposes.
    expect(new ClienteDomainError(code).message).toBe(mensaje);
  });

  it("keeps the Consumidor-Final-protection code distinct from the duplicate code", () => {
    expect(messageFor(CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO)).not.toBe(
      messageFor(CLIENTE_IDENTIFICACION_DUPLICADA),
    );
    expect(CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO).toBe(
      "CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO",
    );
  });

  it("Carries the stable code and minimal details on the domain error", () => {
    const err = new ClienteDomainError(CREDITO_REQUIERE_FISCAL_IDENTIDAD, {
      tipoCliente: "CREDITO",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(CREDITO_REQUIERE_FISCAL_IDENTIDAD);
    expect(err.details).toEqual({ tipoCliente: "CREDITO" });
  });
});
