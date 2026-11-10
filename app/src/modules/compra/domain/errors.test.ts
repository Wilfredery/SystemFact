/**
 * Error-catalog unit tests — compra (19-directivas §9 exhaustiveness). Pure.
 *
 * Mirrors the inventario/venta censuses: a `Record<CompraErrorCode, true>`
 * makes tsc reject any union member that is not listed here (machine-checked
 * catalog census), every code carries a non-empty Spanish message, and the L6
 * additive stock-ceiling delta (`STOCK_MAXIMO_EXCEDIDO`, mapped from
 * inventario's shared guard by `recibirCompra`) speaks compra's OWN copy —
 * inventario's codes and details never reach compra's public error contract.
 * No database.
 */

import {
  INVENTARIO_ENTRADA_RECHAZADA,
  STOCK_MAXIMO_EXCEDIDO,
  messageFor,
  type CompraErrorCode,
} from "./errors";

describe("compra error catalog", () => {
  // Exhaustiveness guard: adding a member to `CompraErrorCode` without a key
  // here is a COMPILE error, so this object is a machine-checked census.
  const CENSUS: Record<CompraErrorCode, true> = {
    VALIDATION_ERROR: true,
    COMPRA_NO_ENCONTRADA: true,
    PROVEEDOR_NO_ENCONTRADO: true,
    PRODUCTO_NO_ENCONTRADO: true,
    PROVEEDOR_INACTIVO: true,
    LINEA_INVALIDA: true,
    COMPRA_INMUTABLE: true,
    TRANSICION_INVALIDA: true,
    CONFIG_RETENCION_FALTANTE: true,
    CORRELATIVO_CONFLICTO: true,
    CONCURRENCIA_CONFLICTO: true,
    NFC_DUPLICADO: true,
    NFC_INVALIDO: true,
    TIPO_NCF_DESACUERDO: true,
    NO_AUTORIZADO: true,
    SESION_INVALIDA: true,
    COMPRA_SUCURSAL_INVALIDA: true,
    INVENTARIO_ENTRADA_RECHAZADA: true,
    // L6 additive stock-ceiling delta: the shared repository guard's stable
    // code, mapped to compra's own copy so a receipt over the ceiling is a
    // typed compra business error (thrown → the receipt transaction rolls back).
    STOCK_MAXIMO_EXCEDIDO: true,
  };

  it("carries exactly 19 stable codes (18 + the L6 stock-ceiling delta)", () => {
    expect(Object.keys(CENSUS)).toHaveLength(19);
  });

  it("gives every catalog code a non-empty Spanish message", () => {
    for (const code of Object.keys(CENSUS) as CompraErrorCode[]) {
      expect(messageFor(code)).toMatch(/\S/);
    }
  });

  it("exposes the stock-ceiling code with compra's own receipt copy (never inventario's)", () => {
    expect(STOCK_MAXIMO_EXCEDIDO).toBe("STOCK_MAXIMO_EXCEDIDO");
    expect(messageFor(STOCK_MAXIMO_EXCEDIDO)).toBe(
      "La recepción dejaría la existencia por encima del máximo permitido (999,999,999.999)",
    );
  });

  it("keeps the generic inventario bridge code distinct from the ceiling code", () => {
    // The bridge stays the fallback for every OTHER inventario rejection; the
    // ceiling maps to its own stable code instead of the generic bridge.
    expect(INVENTARIO_ENTRADA_RECHAZADA).toBe("INVENTARIO_ENTRADA_RECHAZADA");
    expect(messageFor(INVENTARIO_ENTRADA_RECHAZADA)).not.toBe(
      messageFor(STOCK_MAXIMO_EXCEDIDO),
    );
  });
});
