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
  puedeRecibir,
  transicionarCancelar,
  transicionarConfirmar,
  transicionarRecibir,
  estadoCompraDesdeDb,
  EstadoCompraNoRepresentableError,
  type InventoryEntryInput,
  type InventoryEntryPort,
} from "./compra";

describe("ESTADO_COMPRA", () => {
  it("reaches BORRADOR/PENDIENTE/RECIBIDA/CANCELADA — never PAGADA/CONFIRMADA", () => {
    expect(Object.keys(ESTADO_COMPRA).sort()).toEqual([
      "BORRADOR",
      "CANCELADA",
      "PENDIENTE",
      "RECIBIDA",
    ]);
    // RECIBIDA was opened in fase-3-4b; PAGADA/CONFIRMADA remain absent.
    expect(ESTADO_COMPRA).toHaveProperty("RECIBIDA");
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

  it("cancel is reachable from BORRADOR and PENDIENTE, not CANCELADA or RECIBIDA", () => {
    expect(puedeCancelar(ESTADO_COMPRA.BORRADOR)).toBe(true);
    expect(puedeCancelar(ESTADO_COMPRA.PENDIENTE)).toBe(true);
    expect(puedeCancelar(ESTADO_COMPRA.CANCELADA)).toBe(false);
    // Cancel-after-receipt stays frozen until the deferred reversal change.
    expect(puedeCancelar(ESTADO_COMPRA.RECIBIDA)).toBe(false);
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

  it("RECIBIDA cannot be cancelled (cancel-after-receipt frozen → TRANSICION_INVALIDA)", () => {
    expect(transicionarCancelar(ESTADO_COMPRA.RECIBIDA)).toEqual({
      ok: false,
      code: "TRANSICION_INVALIDA",
    });
  });
});

describe("recibir (PENDIENTE → RECIBIDA)", () => {
  it("only PENDIENTE is receivable", () => {
    expect(puedeRecibir(ESTADO_COMPRA.PENDIENTE)).toBe(true);
    expect(puedeRecibir(ESTADO_COMPRA.BORRADOR)).toBe(false);
    expect(puedeRecibir(ESTADO_COMPRA.CANCELADA)).toBe(false);
    expect(puedeRecibir(ESTADO_COMPRA.RECIBIDA)).toBe(false);
  });

  it("PENDIENTE → RECIBIDA", () => {
    expect(transicionarRecibir(ESTADO_COMPRA.PENDIENTE)).toEqual({
      ok: true,
      estado: ESTADO_COMPRA.RECIBIDA,
    });
  });

  it("BORRADOR / CANCELADA are wrong-state → TRANSICION_INVALIDA", () => {
    expect(transicionarRecibir(ESTADO_COMPRA.BORRADOR)).toEqual({
      ok: false,
      code: "TRANSICION_INVALIDA",
    });
    expect(transicionarRecibir(ESTADO_COMPRA.CANCELADA)).toEqual({
      ok: false,
      code: "TRANSICION_INVALIDA",
    });
  });

  it("already RECIBIDA is idempotent → COMPRA_INMUTABLE (use case maps to conflict)", () => {
    expect(transicionarRecibir(ESTADO_COMPRA.RECIBIDA)).toEqual({
      ok: false,
      code: "COMPRA_INMUTABLE",
    });
  });
});

describe("estadoCompraDesdeDb (total, exhaustive read mapper — task 2.1)", () => {
  it("maps the four reachable persisted states without coercion", () => {
    expect(estadoCompraDesdeDb("BORRADOR")).toBe(ESTADO_COMPRA.BORRADOR);
    expect(estadoCompraDesdeDb("PENDIENTE")).toBe(ESTADO_COMPRA.PENDIENTE);
    // RECIBIDA now reads back as the domain state (no `as` cast path).
    expect(estadoCompraDesdeDb("RECIBIDA")).toBe(ESTADO_COMPRA.RECIBIDA);
    expect(estadoCompraDesdeDb("CANCELADA")).toBe(ESTADO_COMPRA.CANCELADA);
  });

  it("PAGADA has no domain representation and fails LOUD", () => {
    expect(() => estadoCompraDesdeDb("PAGADA")).toThrow(
      EstadoCompraNoRepresentableError,
    );
  });

  it("an unknown value fails LOUD (never a silent coercion)", () => {
    expect(() => estadoCompraDesdeDb("ESTADO_FANTASMA")).toThrow(
      EstadoCompraNoRepresentableError,
    );
  });
});

describe("3.4b seams", () => {
  it("declares the reserved PURCHASE inventory source", () => {
    expect(INVENTORY_SOURCE.PURCHASE).toBe("purchase");
  });

  it("InventoryEntryInput carries the purchase id + ITBIS-exclusive unit cost (task 2.2)", async () => {
    // Compile-checked contract: a receipt line now carries purchaseId and the
    // net unit cost so the seam is complete for inventario's realization.
    const entrada: InventoryEntryInput = {
      branchId: 1,
      purchaseId: 42,
      productId: 7,
      quantity: "10.000",
      unitCostWithoutItbis: "100.00",
      reason: "Recepción compra",
      source: INVENTORY_SOURCE.PURCHASE,
    };
    const puerto: InventoryEntryPort = {
      applyEntry: async () => ({
        inventoryId: 3,
        previousQuantity: "0.000",
        newQuantity: "10.000",
      }),
    };
    await expect(puerto.applyEntry(entrada)).resolves.toEqual({
      inventoryId: 3,
      previousQuantity: "0.000",
      newQuantity: "10.000",
    });
    expect(entrada.purchaseId).toBe(42);
    expect(entrada.unitCostWithoutItbis).toBe("100.00");
  });
});
