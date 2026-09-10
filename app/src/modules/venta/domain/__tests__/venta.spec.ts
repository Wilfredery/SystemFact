/**
 * Domain unit tests — venta state mapping, discount helpers and the pinned error
 * catalog. Pure, no database (ADR-013).
 */

import {
  ESTADO_VENTA,
  EstadoVentaNoRepresentableError,
  estadoVentaDesdeDb,
  puedeEditar,
  puedeCancelar,
  esDescuentoCero,
  DESCUENTO_CERO,
  DESCUENTO_TIPO,
} from "../venta";
import {
  messageFor,
  VENTA_NO_ENCONTRADO,
  DESCUENTO_NO_AUTORIZADO,
  CLIENTE_NO_ENCONTRADO,
  type VentaErrorCode,
} from "../errors";

describe("estadoVentaDesdeDb — exhaustive mapping (R-V13)", () => {
  it("maps each persisted enum value to its domain state", () => {
    expect(estadoVentaDesdeDb("BORRADOR")).toBe(ESTADO_VENTA.BORRADOR);
    expect(estadoVentaDesdeDb("CANCELADA")).toBe(ESTADO_VENTA.CANCELADA);
    expect(estadoVentaDesdeDb("CONFIRMADA")).toBe(ESTADO_VENTA.CONFIRMADA);
  });

  it("fails LOUD on an unknown state, never a silent coercion", () => {
    expect(() => estadoVentaDesdeDb("PAGADA")).toThrow(
      EstadoVentaNoRepresentableError,
    );
    expect(() => estadoVentaDesdeDb("")).toThrow(Error);
    expect(() => estadoVentaDesdeDb("weird")).toThrow(
      /no representable/,
    );
  });
});

describe("draft reachability (spec: no 5b path reaches CONFIRMADA)", () => {
  it("allows edit and cancel only from BORRADOR", () => {
    expect(puedeEditar("BORRADOR")).toBe(true);
    expect(puedeEditar("CANCELADA")).toBe(false);
    expect(puedeEditar("CONFIRMADA")).toBe(false);
    expect(puedeCancelar("BORRADOR")).toBe(true);
    expect(puedeCancelar("CANCELADA")).toBe(false);
  });
});

describe("discount zero convention (R-V7)", () => {
  it("PORCENTAJE 0.00 is the canonical zero", () => {
    expect(esDescuentoCero(DESCUENTO_CERO)).toBe(true);
    expect(esDescuentoCero({ descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "0" })).toBe(
      true,
    );
  });
  it("MONTO 0.00 and positive discounts are NOT zero-valid", () => {
    expect(
      esDescuentoCero({ descuentoTipo: DESCUENTO_TIPO.MONTO, descuentoValor: "0.00" }),
    ).toBe(false);
    expect(
      esDescuentoCero({ descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "5" }),
    ).toBe(false);
  });
});

describe("error catalog (R-V13)", () => {
  it("carries a Spanish message for every pinned code", () => {
    const codes: VentaErrorCode[] = [
      VENTA_NO_ENCONTRADO,
      "VENTA_INMUTABLE",
      "CONCURRENCIA_CONFLICTO",
      "LINEAS_VACIAS",
      "LINEA_INVALIDA",
      "PRODUCTO_NO_ENCONTRADO",
      "PRODUCTO_INACTIVO",
      "TASA_ITBIS_VIGENCIA_FALTA",
      "DESCUENTO_EXCEDE_MAXIMO",
      "DESCUENTO_EXCEDE_BASE",
      "DESCUENTO_INVALIDO",
      DESCUENTO_NO_AUTORIZADO,
      CLIENTE_NO_ENCONTRADO,
      "CLIENTE_INACTIVO",
      // Phase 5c confirm codes (R-V15)
      "NCF_AGOTADA",
      "NCF_VENCIDA",
      "NCF_SEC_INEXISTENTE",
      "FACTURA_AUTOMATICA_FALTA",
      "STOCK_INSUFICIENTE_BLOQUEO",
    ];
    for (const code of codes) {
      expect(messageFor(code)).toMatch(/\S/);
    }
    expect(codes).toHaveLength(19);
  });
});
