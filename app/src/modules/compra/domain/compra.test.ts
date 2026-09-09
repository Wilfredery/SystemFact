/**
 * Domain unit tests — purchase state contract and guarded transitions, no DB.
 */

import {
  ESTADO_COMPRA,
  TIPO_COMPRA,
  TIPO_NCF_COMPRA,
  INVENTORY_SOURCE,
  puedeCancelar,
  puedeConfirmar,
  puedeEditar,
  transicionarCancelar,
  transicionarConfirmar,
} from "./compra";

describe("ESTADO_COMPRA", () => {
  it("exposes only the core-reachable states (no CONFIRMADA / RECIBIDA / PAGADA)", () => {
    expect(Object.keys(ESTADO_COMPRA).sort()).toEqual([
      "BORRADOR",
      "CANCELADA",
      "PENDIENTE",
    ]);
    expect(ESTADO_COMPRA).not.toHaveProperty("RECIBIDA");
    expect(ESTADO_COMPRA).not.toHaveProperty("PAGADA");
    expect(ESTADO_COMPRA).not.toHaveProperty("CONFIRMADA");
  });

  it("matches the frozen TipoCompra / TipoNcfCompra vocabularies", () => {
    expect(Object.keys(TIPO_COMPRA)).toEqual([
      "MERCANCIA",
      "SERVICIO_PROFESIONAL",
      "SERVICIO_TECNICO",
      "ALQUILER",
    ]);
    expect(Object.keys(TIPO_NCF_COMPRA)).toEqual(["B01", "B11"]);
  });
});

describe("state guards", () => {
  it("edit is allowed only for BORRADOR", () => {
    expect(puedeEditar(ESTADO_COMPRA.BORRADOR)).toBe(true);
    expect(puedeEditar(ESTADO_COMPRA.PENDIENTE)).toBe(false);
    expect(puedeEditar(ESTADO_COMPRA.CANCELADA)).toBe(false);
  });

  it("confirm is allowed only for BORRADOR", () => {
    expect(puedeConfirmar(ESTADO_COMPRA.BORRADOR)).toBe(true);
    expect(puedeConfirmar(ESTADO_COMPRA.PENDIENTE)).toBe(false);
  });

  it("cancel is reachable from BORRADOR and PENDIENTE, not CANCELADA", () => {
    expect(puedeCancelar(ESTADO_COMPRA.BORRADOR)).toBe(true);
    expect(puedeCancelar(ESTADO_COMPRA.PENDIENTE)).toBe(true);
    expect(puedeCancelar(ESTADO_COMPRA.CANCELADA)).toBe(false);
  });
});

describe("transicionarConfirmar", () => {
  it("BORRADOR → PENDIENTE", () => {
    expect(transicionarConfirmar(ESTADO_COMPRA.BORRADOR)).toEqual({
      ok: true,
      estado: ESTADO_COMPRA.PENDIENTE,
    });
  });

  it("PENDIENTE is immutable (COMPRA_INMUTABLE)", () => {
    expect(transicionarConfirmar(ESTADO_COMPRA.PENDIENTE)).toEqual({
      ok: false,
      code: "COMPRA_INMUTABLE",
    });
  });

  it("CANCELADA cannot be confirmed (TRANSICION_INVALIDA)", () => {
    expect(transicionarConfirmar(ESTADO_COMPRA.CANCELADA)).toEqual({
      ok: false,
      code: "TRANSICION_INVALIDA",
    });
  });
});

describe("transicionarCancelar", () => {
  it("BORRADOR and PENDIENTE → CANCELADA", () => {
    expect(transicionarCancelar(ESTADO_COMPRA.BORRADOR)).toEqual({
      ok: true,
      estado: ESTADO_COMPRA.CANCELADA,
    });
    expect(transicionarCancelar(ESTADO_COMPRA.PENDIENTE)).toEqual({
      ok: true,
      estado: ESTADO_COMPRA.CANCELADA,
    });
  });

  it("CANCELADA is terminal (TRANSICION_INVALIDA)", () => {
    expect(transicionarCancelar(ESTADO_COMPRA.CANCELADA)).toEqual({
      ok: false,
      code: "TRANSICION_INVALIDA",
    });
  });
});

describe("3.4b seams", () => {
  it("declares the reserved PURCHASE inventory source", () => {
    expect(INVENTORY_SOURCE.PURCHASE).toBe("purchase");
  });
});
