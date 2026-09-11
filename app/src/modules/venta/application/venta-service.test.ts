/**
 * Application unit tests — venta-service orchestration (mocked repositories).
 *
 * Proves the DRAFT save/read/cancel wiring WITHOUT a real DB: the CF resolver is
 * consumed, lines/rates/discounts flow through the (also unit-tested) domain
 * pipeline, the config hard-fail maps to the composed `DESC_MAX_FALTANTE` code,
 * stock shortages ride along as non-blocking `warnings`, the guarded update/cancel
 * races map to `CONCURRENCIA_CONFLICTO`, and each success appends exactly ONE
 * audit row. The integration suites cover the real Prisma/RLS behavior.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  crearVentaConLineasEnTx,
  actualizarVentaBorradorEnTx,
  reemplazarLineasVentaEnTx,
  cancelarVentaEnTx,
  cancelarVentaConfirmadaEnTx,
  anularFacturaDeVentaEnTx,
  leerFacturaVigenteDeVentaEnTx,
  registrarAuditFacturaEnTx,
  leerVentaParaConfirmarEnTx,
  leerVentaEnTx,
  listarVentasEnTx,
  contarVentasEnTx,
  obtenerVentaDetalleEnTx,
  registrarAuditVentaEnTx,
  leerProductosParaLineasVentaEnTx,
  leerStockSucursalEnTx,
  leerClienteParaVentaEnTx,
  tieneRolPermitidoEnTx,
} from "../infrastructure/venta-repository";
import {
  leerConfigVentaEnTx,
  VentaConfigError,
  DESC_MAX_FALTANTE,
} from "../infrastructure/config-repository";
import { getOrCreateConsumidorFinalEnTx } from "@/modules/cliente/application/consumidor-final";
import { registrarReposicionCancelacion } from "@/modules/inventario/application/registrar-salidas-venta";
import { DESCUENTO_TIPO, type Descuento } from "../domain/venta";
import {
  crearVenta,
  actualizarVenta,
  cancelarVenta,
  listarVentas,
  obtenerVenta,
  type CrearVentaInput,
} from "./venta-service";

// --- mocks -----------------------------------------------------------------

jest.mock("../infrastructure/venta-repository", () => ({
  crearVentaConLineasEnTx: jest.fn(),
  actualizarVentaBorradorEnTx: jest.fn(),
  reemplazarLineasVentaEnTx: jest.fn(),
  cancelarVentaEnTx: jest.fn(),
  cancelarVentaConfirmadaEnTx: jest.fn(),
  anularFacturaDeVentaEnTx: jest.fn(),
  leerFacturaVigenteDeVentaEnTx: jest.fn(),
  registrarAuditFacturaEnTx: jest.fn(),
  leerVentaParaConfirmarEnTx: jest.fn(),
  leerVentaEnTx: jest.fn(),
  listarVentasEnTx: jest.fn(),
  contarVentasEnTx: jest.fn(),
  obtenerVentaDetalleEnTx: jest.fn(),
  registrarAuditVentaEnTx: jest.fn(),
  leerProductosParaLineasVentaEnTx: jest.fn(),
  leerStockSucursalEnTx: jest.fn(),
  leerClienteParaVentaEnTx: jest.fn(),
  tieneRolPermitidoEnTx: jest.fn(),
}));

// Stub the inventario exit/reposition port so this unit test never pulls in the
// repository (and the `import.meta`-bearing generated Prisma client) it mocks
// away elsewhere. Confirmed-cancel reposition is exercised against the real DB in
// `src/integration/cancelar-confirmada.integration.test.ts`.
jest.mock("@/modules/inventario/application/registrar-salidas-venta", () => ({
  registrarReposicionCancelacion: jest.fn(),
  registrarSalidasVenta: jest.fn(),
}));

// Keep the REAL VentaConfigError / code (so `instanceof` in preparar works);
// stub only the async reader.
jest.mock("../infrastructure/config-repository", () => {
  const actual = jest.requireActual(
    "../infrastructure/config-repository",
  ) as Record<string, unknown>;
  return { ...actual, leerConfigVentaEnTx: jest.fn() };
});

jest.mock("@/modules/cliente/application/consumidor-final", () => ({
  getOrCreateConsumidorFinalEnTx: jest.fn(),
}));

// --- fixtures --------------------------------------------------------------

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 2,
  usuarioId: 3,
  esAdmin: true,
};
const tx = {} as unknown as PrismaTx;
const FECHA = new Date("2026-01-10T00:00:00.000Z");

function producto(id: number, tasa = "18") {
  return {
    id,
    activo: true,
    nombre: `P${id}`,
    tasaItbis: tasa,
    itbisVigenteDesde: new Date("2000-01-01T00:00:00.000Z"),
    itbisVigenteHasta: null,
  };
}

function baseCreate(over: Partial<CrearVentaInput> = {}): CrearVentaInput {
  return {
    clienteId: null,
    fecha: FECHA,
    lineas: [{ productoId: 10, cantidad: "1", precioUnitario: "100.00", descuento: { descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "0.00" } }],
    ...over,
  };
}

const CERO: Descuento = { descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "0.00" };

beforeEach(() => {
  jest.clearAllMocks();
  (getOrCreateConsumidorFinalEnTx as jest.Mock).mockResolvedValue({ id: 99 });
  (leerClienteParaVentaEnTx as jest.Mock).mockResolvedValue({ id: 5, activo: true, esConsumidorFinal: false });
  (leerProductosParaLineasVentaEnTx as jest.Mock).mockResolvedValue([producto(10)]);
  (leerStockSucursalEnTx as jest.Mock).mockResolvedValue([{ productoId: 10, disponible: "50.000" }]);
  (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
  (leerConfigVentaEnTx as jest.Mock).mockResolvedValue("25.00");
  (crearVentaConLineasEnTx as jest.Mock).mockResolvedValue({ id: 500 });
  (actualizarVentaBorradorEnTx as jest.Mock).mockResolvedValue({ updated: true });
  (cancelarVentaEnTx as jest.Mock).mockResolvedValue({ cancelled: true });
  // Confirmed-cancel path defaults (only exercised by the CONFIRMADA tests).
  (cancelarVentaConfirmadaEnTx as jest.Mock).mockResolvedValue({ cancelled: true });
  (leerFacturaVigenteDeVentaEnTx as jest.Mock).mockResolvedValue({ id: 80 });
  (anularFacturaDeVentaEnTx as jest.Mock).mockResolvedValue({ annulled: true });
  (leerVentaParaConfirmarEnTx as jest.Mock).mockResolvedValue({
    lineas: [{ productoId: 10, cantidad: "5.000" }],
  });
  (registrarReposicionCancelacion as jest.Mock).mockResolvedValue([]);
});

describe("crearVenta", () => {
  it("resolves contado → CF, saves a BORRADOR and appends one CREAR audit", async () => {
    const r = await crearVenta(tx, ctx, baseCreate());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.estado).toBe("BORRADOR");
      expect(r.data.id).toBe(500);
      expect(r.warnings ?? []).toHaveLength(0);
    }
    expect(getOrCreateConsumidorFinalEnTx).toHaveBeenCalledWith(tx, 1);
    const arg = (crearVentaConLineasEnTx as jest.Mock).mock.calls[0]?.[2];
    expect(arg.clienteId).toBe(99);
    expect(arg.totales.descuentoTipo).toBe("PORCENTAJE");
    expect(arg.totales.descuentoAutorizadoPor).toBeNull();
    expect(registrarAuditVentaEnTx).toHaveBeenCalledTimes(1);
  });

  it("persists the calculator's stored totals (single 100 @18% = 118.00)", async () => {
    await crearVenta(tx, ctx, baseCreate());
    const arg = (crearVentaConLineasEnTx as jest.Mock).mock.calls[0]?.[2];
    expect(arg.totales.subtotal).toBe("100.00");
    expect(arg.totales.itbis).toBe("18.00");
    expect(arg.totales.total).toBe("118.00");
    // Per-line subtotalLinea is the FINAL net base (no discounts here).
    expect(arg.lineas[0].subtotalLinea).toBe("100.00");
    expect(arg.lineas[0].tasaItbis).toBe("18");
  });

  it("rejects an empty line set with LINEAS_VACIAS, no write", async () => {
    const r = await crearVenta(tx, ctx, baseCreate({ lineas: [] }));
    expect(!r.ok && r.code).toBe("LINEAS_VACIAS");
    expect(crearVentaConLineasEnTx).not.toHaveBeenCalled();
  });

  it("records descuentoAutorizadoPor as the acting admin and caps against DESC_MAX", async () => {
    const r = await crearVenta(tx, ctx, baseCreate({ descuentoCabecera: { descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "10" } }));
    expect(r.ok).toBe(true);
    const arg = (crearVentaConLineasEnTx as jest.Mock).mock.calls[0]?.[2];
    expect(arg.totales.descuentoAutorizadoPor).toBe(3); // ctx.usuarioId (admin)
    expect(arg.totales.descuento).toBe("10.00");
    expect(leerConfigVentaEnTx).toHaveBeenCalled();
  });

  it("rejects a discount when the actor is NOT admin, before any write", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);
    const r = await crearVenta(tx, ctx, baseCreate({ descuentoCabecera: { descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "10" } }));
    expect(!r.ok && r.code).toBe("DESCUENTO_NO_AUTORIZADO");
    expect(crearVentaConLineasEnTx).not.toHaveBeenCalled();
  });

  it("maps the config hard-fail to the composed DESC_MAX_FALTANTE code", async () => {
    (leerConfigVentaEnTx as jest.Mock).mockRejectedValue(
      new VentaConfigError(DESC_MAX_FALTANTE, { empresaId: 1 }),
    );
    const r = await crearVenta(tx, ctx, baseCreate({ descuentoCabecera: { descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "5" } }));
    expect(!r.ok && r.code).toBe("DESC_MAX_FALTANTE");
    expect(crearVentaConLineasEnTx).not.toHaveBeenCalled();
  });

  it("does NOT read config for a zero-discount draft", async () => {
    await crearVenta(tx, ctx, baseCreate({ descuentoCabecera: CERO }));
    expect(leerConfigVentaEnTx).not.toHaveBeenCalled();
  });

  it("returns a stock shortage as a warning while the draft still saves", async () => {
    (leerStockSucursalEnTx as jest.Mock).mockResolvedValue([{ productoId: 10, disponible: "2.000" }]);
    const r = await crearVenta(tx, ctx, baseCreate({ lineas: [{ productoId: 10, cantidad: "5", precioUnitario: "10.00", descuento: CERO }] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings?.[0]).toEqual({ code: "STOCK_INSUFICIENTE", productoId: 10, available: "2.000", requested: "5" });
    }
    expect(crearVentaConLineasEnTx).toHaveBeenCalledTimes(1);
  });

  it("rejects a foreign/unknown product without writing", async () => {
    (leerProductosParaLineasVentaEnTx as jest.Mock).mockResolvedValue([]);
    const r = await crearVenta(tx, ctx, baseCreate());
    expect(!r.ok && r.code).toBe("PRODUCTO_NO_ENCONTRADO");
    expect(crearVentaConLineasEnTx).not.toHaveBeenCalled();
  });
});

describe("actualizarVenta", () => {
  it("rejects a non-draft target with VENTA_INMUTABLE", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue({ id: 7, estado: "CANCELADA", sucursalId: 2, clienteId: 99, updatedAt: new Date() });
    const r = await actualizarVenta(tx, ctx, { id: 7, lineas: [{ productoId: 10, cantidad: "1", precioUnitario: "100.00", descuento: CERO }], fecha: FECHA });
    expect(!r.ok && r.code).toBe("VENTA_INMUTABLE");
    expect(actualizarVentaBorradorEnTx).not.toHaveBeenCalled();
  });

  it("CONCURRENCIA_CONFLICTO when the guarded update loses; no line replace, no audit", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue({ id: 7, estado: "BORRADOR", sucursalId: 2, clienteId: 99, updatedAt: new Date() });
    (actualizarVentaBorradorEnTx as jest.Mock).mockResolvedValue({ updated: false });
    const r = await actualizarVenta(tx, ctx, { id: 7, lineas: [{ productoId: 10, cantidad: "1", precioUnitario: "100.00", descuento: CERO }], fecha: FECHA });
    expect(!r.ok && r.code).toBe("CONCURRENCIA_CONFLICTO");
    expect(reemplazarLineasVentaEnTx).not.toHaveBeenCalled();
    expect(registrarAuditVentaEnTx).not.toHaveBeenCalled();
  });

  it("swaps the client and replaces lines on a draft success", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue({ id: 7, estado: "BORRADOR", sucursalId: 2, clienteId: 99, updatedAt: new Date() });
    const r = await actualizarVenta(tx, ctx, { id: 7, clienteId: 5, lineas: [{ productoId: 10, cantidad: "1", precioUnitario: "100.00", descuento: CERO }], fecha: FECHA });
    expect(r.ok).toBe(true);
    const patch = (actualizarVentaBorradorEnTx as jest.Mock).mock.calls[0]?.[4];
    expect(patch.clienteId).toBe(5);
    expect(reemplazarLineasVentaEnTx).toHaveBeenCalledTimes(1);
    expect(registrarAuditVentaEnTx).toHaveBeenCalledTimes(1);
  });
});

describe("cancelarVenta", () => {
  it("transitions BORRADOR → CANCELADA with one audit row", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue({ id: 7, estado: "BORRADOR", sucursalId: 2, clienteId: 99, updatedAt: new Date() });
    const r = await cancelarVenta(tx, ctx, { id: 7 });
    expect(r.ok === true && r.data.estado).toBe("CANCELADA");
    expect(cancelarVentaEnTx).toHaveBeenCalledTimes(1);
    expect(registrarAuditVentaEnTx).toHaveBeenCalledTimes(1);
  });

  it("VENTA_INMUTABLE when the row is already cancelled (state read after commit)", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue({ id: 7, estado: "CANCELADA", sucursalId: 2, clienteId: 99, updatedAt: new Date() });
    const r = await cancelarVenta(tx, ctx, { id: 7 });
    expect(!r.ok && r.code).toBe("VENTA_INMUTABLE");
    expect(cancelarVentaEnTx).not.toHaveBeenCalled();
    expect(registrarAuditVentaEnTx).not.toHaveBeenCalled();
  });

  it("CONCURRENCIA_CONFLICTO when the guard matches zero rows; no second audit", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue({ id: 7, estado: "BORRADOR", sucursalId: 2, clienteId: 99, updatedAt: new Date() });
    (cancelarVentaEnTx as jest.Mock).mockResolvedValue({ cancelled: false });
    const r = await cancelarVenta(tx, ctx, { id: 7 });
    expect(!r.ok && r.code).toBe("CONCURRENCIA_CONFLICTO");
    expect(registrarAuditVentaEnTx).not.toHaveBeenCalled();
  });

  it("VENTA_NO_ENCONTRADO for a foreign/branch id (repo returns null)", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue(null);
    const r = await cancelarVenta(tx, ctx, { id: 7 });
    expect(!r.ok && r.code).toBe("VENTA_NO_ENCONTRADO");
  });

  it("CONFIRMADA: guarded flip + invoice annul + reposition + both audits (R-V16)", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue({ id: 7, estado: "CONFIRMADA", sucursalId: 2, clienteId: 99, updatedAt: new Date() });
    const r = await cancelarVenta(tx, ctx, { id: 7, motivo: "Devolución cliente" });
    expect(r.ok === true && r.data.estado).toBe("CANCELADA");
    // Confirmed flip, not the draft predicate; the VIGENTE invoice is annulled once.
    expect(cancelarVentaEnTx).not.toHaveBeenCalled();
    expect(cancelarVentaConfirmadaEnTx).toHaveBeenCalledTimes(1);
    expect(anularFacturaDeVentaEnTx).toHaveBeenCalledTimes(1);
    expect(registrarReposicionCancelacion).toHaveBeenCalledTimes(1);
    // Both reversals are audited (Venta CANCELAR + Factura ANULAR).
    expect(registrarAuditVentaEnTx).toHaveBeenCalledTimes(1);
    expect(registrarAuditFacturaEnTx).toHaveBeenCalledTimes(1);
  });

  it("CONFIRMADA flip race loses → CONCURRENCIA_CONFLICTO, no annul/reposition/audit", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue({ id: 7, estado: "CONFIRMADA", sucursalId: 2, clienteId: 99, updatedAt: new Date() });
    (cancelarVentaConfirmadaEnTx as jest.Mock).mockResolvedValue({ cancelled: false });
    const r = await cancelarVenta(tx, ctx, { id: 7 });
    expect(!r.ok && r.code).toBe("CONCURRENCIA_CONFLICTO");
    expect(anularFacturaDeVentaEnTx).not.toHaveBeenCalled();
    expect(registrarReposicionCancelacion).not.toHaveBeenCalled();
    expect(registrarAuditFacturaEnTx).not.toHaveBeenCalled();
  });

  it("CONFIRMADA but no VIGENTE invoice throws post-flip (rolls the cancel back)", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue({ id: 7, estado: "CONFIRMADA", sucursalId: 2, clienteId: 99, updatedAt: new Date() });
    (leerFacturaVigenteDeVentaEnTx as jest.Mock).mockResolvedValue(null);
    await expect(cancelarVenta(tx, ctx, { id: 7 })).rejects.toMatchObject({ code: "CONCURRENCIA_CONFLICTO" });
    expect(registrarReposicionCancelacion).not.toHaveBeenCalled();
  });
});

describe("listarVentas / obtenerVenta", () => {
  it("clamps an over-large limit to 100 (defence in depth, R-V12)", async () => {
    (listarVentasEnTx as jest.Mock).mockResolvedValue([]);
    (contarVentasEnTx as jest.Mock).mockResolvedValue(0);
    const r = await listarVentas(tx, ctx, { page: 1, limit: 500 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.limit).toBe(100);
    const filtro = (listarVentasEnTx as jest.Mock).mock.calls[0]?.[2];
    expect(filtro.limit).toBe(100);
  });

  it("returns VENTA_NO_ENCONTRADO when the detail read is null", async () => {
    (obtenerVentaDetalleEnTx as jest.Mock).mockResolvedValue(null);
    const r = await obtenerVenta(tx, ctx, { id: 7 });
    expect(!r.ok && r.code).toBe("VENTA_NO_ENCONTRADO");
  });
});
