/**
 * HTTP import validation (Zod) — transport contract for the venta boundary
 * (v2r-04).
 *
 * These lock the DUPLICATE-PRODUCT rejection: a sale may never carry the same
 * `productoId` twice on the wire, for BOTH create and update. The refine lives
 * on the array (not the line schema) because `zLineaInput` is shared with
 * other line shapes; `min(1)` and the duplicate check are array-level
 * properties.
 */

import {
  zCrearVentaInput,
  zActualizarVentaInput,
} from "./validations";

const linea = (productoId: number) => ({
  productoId,
  cantidad: "1",
  precioUnitario: "100.00",
});

const baseCrear = {
  clienteId: null,
  fecha: "2026-01-10T00:00:00.000Z",
};

const baseActualizar = {
  id: 1,
  ...baseCrear,
};

describe("venta HTTP boundary — duplicate productoId rejection (v2r-04)", () => {
  it("accepts distinct products on create", () => {
    const r = zCrearVentaInput.safeParse({
      ...baseCrear,
      lineas: [linea(1), linea(2)],
    });
    expect(r.success).toBe(true);
  });

  it("rejects the same productoId twice on create", () => {
    const r = zCrearVentaInput.safeParse({
      ...baseCrear,
      lineas: [linea(1), linea(1)],
    });
    expect(r.success).toBe(false);
  });

  it("rejects the same productoId three times on create", () => {
    const r = zCrearVentaInput.safeParse({
      ...baseCrear,
      lineas: [linea(1), linea(1), linea(1)],
    });
    expect(r.success).toBe(false);
  });

  it("accepts distinct products on update", () => {
    const r = zActualizarVentaInput.safeParse({
      ...baseActualizar,
      lineas: [linea(1), linea(2)],
    });
    expect(r.success).toBe(true);
  });

  it("rejects the same productoId twice on update", () => {
    const r = zActualizarVentaInput.safeParse({
      ...baseActualizar,
      lineas: [linea(1), linea(1)],
    });
    expect(r.success).toBe(false);
  });
});