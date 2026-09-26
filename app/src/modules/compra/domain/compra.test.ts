/**
 * Domain unit tests — purchase state contract and guarded transitions, no DB.
 */

import {
  ESTADO_COMPRA,
  TIPO_COMPRA,
  TIPO_NCF_COMPRA,
  NCF_COMPRA_REGEX,
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
import { componerNcf } from "@/modules/ncf/domain/ncf-rules";

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

describe("NCF_COMPRA_REGEX (11-position purchase NCF grammar)", () => {
  it("accepts a well-formed B01 (formal) and B11 (informal) NCF", () => {
    expect(NCF_COMPRA_REGEX.test("B0100000001")).toBe(true);
    expect(NCF_COMPRA_REGEX.test("B1100000001")).toBe(true);
    // Boundaries of the 8-digit consecutive: leading and trailing zeros are valid digits.
    expect(NCF_COMPRA_REGEX.test("B0100000000")).toBe(true);
    expect(NCF_COMPRA_REGEX.test("B1199999999")).toBe(true);
  });

  it("accepts EXACTLY the values the NCF engine composes (R-N2 `B` + 2-digit tipo + %08d)", () => {
    // The grammar must not reject a single NCF the system itself is able to emit.
    expect(NCF_COMPRA_REGEX.test(componerNcf("B01", 7))).toBe(true); // "B0100000007"
    expect(NCF_COMPRA_REGEX.test(componerNcf("B11", 1))).toBe(true); // "B1100000001"
  });

  it("rejects a non-canonical case (the NCF is uppercase by definition)", () => {
    expect(NCF_COMPRA_REGEX.test("b0100000001")).toBe(false);
    expect(NCF_COMPRA_REGEX.test("B01abcde001")).toBe(false);
  });

  it("rejects a kind outside the purchase vocabulary (B02 formal-invoice series, B13, B00)", () => {
    // B02 IS a real DGII series (consumidor final), but it is NOT a purchase NCF — B01/B11
    // are. The grammar pins the vocabulary, it does not merely check "starts with B".
    expect(NCF_COMPRA_REGEX.test("B0200000001")).toBe(false);
    expect(NCF_COMPRA_REGEX.test("B1300000001")).toBe(false);
    expect(NCF_COMPRA_REGEX.test("B0000000001")).toBe(false);
  });

  it("rejects letters or symbols inside the 8-digit consecutive", () => {
    expect(NCF_COMPRA_REGEX.test("B01000000A1")).toBe(false);
    expect(NCF_COMPRA_REGEX.test("B0100000 01")).toBe(false);
    expect(NCF_COMPRA_REGEX.test("B01000000-1")).toBe(false);
  });

  it("rejects any length other than exactly 11 positions", () => {
    expect(NCF_COMPRA_REGEX.test("B010000001")).toBe(false); // 10
    expect(NCF_COMPRA_REGEX.test("B01000000012")).toBe(false); // 12 (a 9-digit consecutive)
    expect(NCF_COMPRA_REGEX.test("B01")).toBe(false);
  });

  it("rejects an ASCII control character INSIDE the 11 positions (606 record-layout vector)", () => {
    // Exactly 11 chars each, so ONLY the control character can be the reason for rejection.
    expect(NCF_COMPRA_REGEX.test("B01\r\n123456")).toBe(false); // interior CRLF (the repro)
    expect(NCF_COMPRA_REGEX.test("B0\r12345678")).toBe(false); // interior CR
    expect(NCF_COMPRA_REGEX.test("B0\n12345678")).toBe(false); // interior LF
    expect(NCF_COMPRA_REGEX.test("B0\t12345678")).toBe(false); // interior TAB
    expect(NCF_COMPRA_REGEX.test("B0\u000012345678")).toBe(false); // interior NUL
    expect(NCF_COMPRA_REGEX.test("B0\u007F12345678")).toBe(false); // interior DEL
  });

  it("is stateless across calls (no `g` flag, so `test` never carries a lastIndex)", () => {
    expect(NCF_COMPRA_REGEX.test("B0100000001")).toBe(true);
    expect(NCF_COMPRA_REGEX.test("B0100000001")).toBe(true);
    expect(NCF_COMPRA_REGEX.test("B01\r\n123456")).toBe(false);
    expect(NCF_COMPRA_REGEX.test("B0100000001")).toBe(true);
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
