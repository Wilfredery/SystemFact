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
  leerRetroactivoFechaVentaEnTx,
  VentaConfigError,
  DESC_MAX_FALTANTE,
  RETROACTIVO_FECHA_VENTA_FALTANTE,
} from "../infrastructure/config-repository";
import { getOrCreateConsumidorFinalEnTx } from "@/modules/cliente/application/consumidor-final";
import { registrarReposicionCancelacion } from "@/modules/inventario/application/registrar-salidas-venta";
import { revertirPagosAplicadosDeVentaEnTx } from "@/modules/cobros/infrastructure/pago-repository";
import { registrarEventoAuditoriaEnTx } from "@/modules/auditoria/application/auditoria-write-port";
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

// The v2r-09 payment reversal + its append-only audit (driven by the confirmed
// cancel chain); real behavior is covered in the integration suite.
jest.mock("@/modules/cobros/infrastructure/pago-repository", () => ({
  revertirPagosAplicadosDeVentaEnTx: jest.fn(),
}));

jest.mock("@/modules/auditoria/application/auditoria-write-port", () => ({
  registrarEventoAuditoriaEnTx: jest.fn(),
}));

// Keep the REAL VentaConfigError / code (so `instanceof` in preparar works);
// stub only the async reader.
jest.mock("../infrastructure/config-repository", () => {
  const actual = jest.requireActual(
    "../infrastructure/config-repository",
  ) as Record<string, unknown>;
  return {
    ...actual,
    leerConfigVentaEnTx: jest.fn(),
    leerRetroactivoFechaVentaEnTx: jest.fn(),
  };
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
  // F5: the sale-date band. `FECHA` (2026-01-10) is far in the past, so the
  // default mock opens the band wide enough for the historical fixtures here;
  // the two bounds themselves are pinned in `domain/__tests__/fecha-venta.spec.ts`
  // and the band is exercised at the real horizon in the integration suite.
  (leerRetroactivoFechaVentaEnTx as jest.Mock).mockResolvedValue(999);
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
  // v2r-09: no live payments by default (the CONFIRMADA-cancel fixtures are a
  // never-collected CREDIT sale); the reversal then is a zero-row no-op.
  (revertirPagosAplicadosDeVentaEnTx as jest.Mock).mockResolvedValue([]);
  (registrarEventoAuditoriaEnTx as jest.Mock).mockResolvedValue(undefined);
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

// --- F5: sale-date band (audit v2r-11) --------------------------------------

/** One millisecond-day — the SD-calendar shift used by the domain gate. */
const UN_DIA_MS = 86_400_000;
/** `n` calendar days before NOW (the server instant the gate reads). */
function diasAtras(n: number): Date {
  return new Date(Date.now() - n * UN_DIA_MS);
}
/** `n` calendar days after NOW. */
function diasAdelante(n: number): Date {
  return new Date(Date.now() + n * UN_DIA_MS);
}

describe("crearVenta — sale-date band gate (F5, audit v2r-11)", () => {
  it("rejects a future-dated `fecha` with FECHA_VENTA_FUTURA, nothing persisted", async () => {
    (leerRetroactivoFechaVentaEnTx as jest.Mock).mockResolvedValue(7);
    const r = await crearVenta(tx, ctx, baseCreate({ fecha: diasAdelante(1) }));

    expect(!r.ok && r.code).toBe("FECHA_VENTA_FUTURA");
    expect(crearVentaConLineasEnTx).not.toHaveBeenCalled();
    expect(reemplazarLineasVentaEnTx).not.toHaveBeenCalled();
    expect(registrarAuditVentaEnTx).not.toHaveBeenCalled();
  });

  it("rejects a backdate past the horizon with FECHA_VENTA_RETROACTIVA_EXCEDIDA", async () => {
    (leerRetroactivoFechaVentaEnTx as jest.Mock).mockResolvedValue(7);
    // 8 calendar days back with a 7-day horizon — one day past the edge.
    const r = await crearVenta(tx, ctx, baseCreate({ fecha: diasAtras(8) }));

    expect(!r.ok && r.code).toBe("FECHA_VENTA_RETROACTIVA_EXCEDIDA");
    expect(crearVentaConLineasEnTx).not.toHaveBeenCalled();
    expect(registrarAuditVentaEnTx).not.toHaveBeenCalled();
  });

  it("accepts a backdate INSIDE the horizon (yesterday at the default 7 days)", async () => {
    (leerRetroactivoFechaVentaEnTx as jest.Mock).mockResolvedValue(7);
    const ayer = diasAtras(1);
    const r = await crearVenta(tx, ctx, baseCreate({ fecha: ayer }));

    expect(r.ok).toBe(true);
    expect(crearVentaConLineasEnTx).toHaveBeenCalledTimes(1);
    // The (legal) backdated date is what gets persisted — the gate bounds it, it
    // does not rewrite it.
    expect((crearVentaConLineasEnTx as jest.Mock).mock.calls[0]?.[2].fecha).toBe(ayer);
  });

  it("runs BEFORE the client resolver — the earliest possible point, zero work", async () => {
    (leerRetroactivoFechaVentaEnTx as jest.Mock).mockResolvedValue(7);
    await crearVenta(tx, ctx, baseCreate({ fecha: diasAdelante(1) }));

    expect(leerRetroactivoFechaVentaEnTx).toHaveBeenCalledWith(tx, 1, expect.any(Date));
    expect(leerClienteParaVentaEnTx).not.toHaveBeenCalled();
    expect(getOrCreateConsumidorFinalEnTx).not.toHaveBeenCalled();
    expect(leerProductosParaLineasVentaEnTx).not.toHaveBeenCalled();
  });

  it("reads the horizon against the SERVER clock, never the wire `fecha`", async () => {
    (leerRetroactivoFechaVentaEnTx as jest.Mock).mockResolvedValue(7);
    const antes = new Date();
    await crearVenta(tx, ctx, baseCreate({ fecha: diasAdelante(1) }));
    const argFecha = (leerRetroactivoFechaVentaEnTx as jest.Mock).mock.calls[0]?.[2] as Date;

    // The config window is resolved at "now", so a client cannot widen the band
    // by asking for a date in the past.
    expect(argFecha.getTime()).toBeGreaterThanOrEqual(antes.getTime() - 1000);
    expect(argFecha.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("fails LOUD (throws) when the tenant has no RETROACTIVO_FECHA_VENTA_DIAS row", async () => {
    // Deliberately NOT a typed save result: without the parameter there is no
    // legal band, and defaulting it in code is forbidden (never a hardcoded
    // constant). A missing tenant config is a deployment defect.
    (leerRetroactivoFechaVentaEnTx as jest.Mock).mockRejectedValue(
      new VentaConfigError(RETROACTIVO_FECHA_VENTA_FALTANTE, { empresaId: 1 }),
    );
    await expect(crearVenta(tx, ctx, baseCreate())).rejects.toMatchObject({
      code: RETROACTIVO_FECHA_VENTA_FALTANTE,
    });
    expect(crearVentaConLineasEnTx).not.toHaveBeenCalled();
  });
});

describe("actualizarVenta — sale-date band gate (F5, audit v2r-11)", () => {
  it("rejects a future-dated `fecha` before parameter selection and any write", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue({ id: 7, estado: "BORRADOR", sucursalId: 2, clienteId: 99, updatedAt: new Date() });
    (leerRetroactivoFechaVentaEnTx as jest.Mock).mockResolvedValue(7);
    const r = await actualizarVenta(tx, ctx, {
      id: 7,
      lineas: [{ productoId: 10, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      fecha: diasAdelante(1),
    });

    expect(!r.ok && r.code).toBe("FECHA_VENTA_FUTURA");
    // The wire `fecha` selects the ITBIS-rate / DESC_MAX windows inside
    // `prepararLineasVenta`, so nothing may run before the gate.
    expect(leerProductosParaLineasVentaEnTx).not.toHaveBeenCalled();
    expect(actualizarVentaBorradorEnTx).not.toHaveBeenCalled();
    expect(reemplazarLineasVentaEnTx).not.toHaveBeenCalled();
    expect(registrarAuditVentaEnTx).not.toHaveBeenCalled();
  });

  it("rejects a backdate past the horizon on update too", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue({ id: 7, estado: "BORRADOR", sucursalId: 2, clienteId: 99, updatedAt: new Date() });
    (leerRetroactivoFechaVentaEnTx as jest.Mock).mockResolvedValue(7);
    const r = await actualizarVenta(tx, ctx, {
      id: 7,
      lineas: [{ productoId: 10, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      fecha: diasAtras(30),
    });

    expect(!r.ok && r.code).toBe("FECHA_VENTA_RETROACTIVA_EXCEDIDA");
    expect(actualizarVentaBorradorEnTx).not.toHaveBeenCalled();
  });

  it("a missing sale still reports VENTA_NO_ENCONTRADO ahead of the band gate", async () => {
    // The gate runs AFTER the existence/state read on update, so a foreign id
    // stays indistinguishable from a missing one.
    (leerVentaEnTx as jest.Mock).mockResolvedValue(null);
    const r = await actualizarVenta(tx, ctx, {
      id: 7,
      lineas: [{ productoId: 10, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      fecha: diasAdelante(1),
    });
    expect(!r.ok && r.code).toBe("VENTA_NO_ENCONTRADO");
    expect(leerRetroactivoFechaVentaEnTx).not.toHaveBeenCalled();
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
    // v2r-09: the payment reversal runs (zero-row no-op here, a CREDIT sale never
    // collected) BEFORE the annul — ordering inside the same transaction chain.
    expect(revertirPagosAplicadosDeVentaEnTx).toHaveBeenCalledWith(tx, ctx, 7);
    expect((anularFacturaDeVentaEnTx as jest.Mock).mock.invocationCallOrder[0]).toBeGreaterThan(
      (revertirPagosAplicadosDeVentaEnTx as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(registrarEventoAuditoriaEnTx).not.toHaveBeenCalled();
    // Both reversals are audited (Venta CANCELAR + Factura ANULAR).
    expect(registrarAuditVentaEnTx).toHaveBeenCalledTimes(1);
    expect(registrarAuditFacturaEnTx).toHaveBeenCalledTimes(1);
  });

  it("CONFIRMADA with live APLICADO payments: reverts them and audits ONE 'Pago' ANULAR per row, before the annul (v2r-09)", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue({ id: 7, estado: "CONFIRMADA", sucursalId: 2, clienteId: 99, updatedAt: new Date() });
    (revertirPagosAplicadosDeVentaEnTx as jest.Mock).mockResolvedValue([
      { id: 41, tipo: "COBRO", monto: "500.00" },
      { id: 42, tipo: "COBRO", monto: "100.00" },
    ]);
    const r = await cancelarVenta(tx, ctx, { id: 7, motivo: "Devolución cliente" });
    expect(r.ok).toBe(true);
    // The reversal precedes the annul inside the same transaction chain.
    expect((anularFacturaDeVentaEnTx as jest.Mock).mock.invocationCallOrder[0]).toBeGreaterThan(
      (revertirPagosAplicadosDeVentaEnTx as jest.Mock).mock.invocationCallOrder[0],
    );
    // One append-only audit per flipped row with the frozen money (accion ANULAR).
    expect(registrarEventoAuditoriaEnTx).toHaveBeenCalledTimes(2);
    expect(registrarEventoAuditoriaEnTx).toHaveBeenNthCalledWith(1, tx, ctx, {
      accion: "ANULAR",
      entidad: "Pago",
      idEntidad: "41",
      valorAnterior: JSON.stringify({ estado: "APLICADO", tipo: "COBRO", monto: "500.00" }),
      valorNuevo: JSON.stringify({ estado: "REVERTIDO" }),
      motivo: "Devolución cliente",
    });
    expect(registrarEventoAuditoriaEnTx).toHaveBeenNthCalledWith(2, tx, ctx, {
      accion: "ANULAR",
      entidad: "Pago",
      idEntidad: "42",
      valorAnterior: JSON.stringify({ estado: "APLICADO", tipo: "COBRO", monto: "100.00" }),
      valorNuevo: JSON.stringify({ estado: "REVERTIDO" }),
      motivo: "Devolución cliente",
    });
  });

  it("CONFIRMADA flip race loses → CONCURRENCIA_CONFLICTO, no annul/reposition/audit", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue({ id: 7, estado: "CONFIRMADA", sucursalId: 2, clienteId: 99, updatedAt: new Date() });
    (cancelarVentaConfirmadaEnTx as jest.Mock).mockResolvedValue({ cancelled: false });
    const r = await cancelarVenta(tx, ctx, { id: 7 });
    expect(!r.ok && r.code).toBe("CONCURRENCIA_CONFLICTO");
    // Nothing after the lost flip runs — including the v2r-09 reversal.
    expect(revertirPagosAplicadosDeVentaEnTx).not.toHaveBeenCalled();
    expect(anularFacturaDeVentaEnTx).not.toHaveBeenCalled();
    expect(registrarReposicionCancelacion).not.toHaveBeenCalled();
    expect(registrarAuditFacturaEnTx).not.toHaveBeenCalled();
  });

  it("CONFIRMADA but no VIGENTE invoice throws post-flip (rolls the cancel back)", async () => {
    (leerVentaEnTx as jest.Mock).mockResolvedValue({ id: 7, estado: "CONFIRMADA", sucursalId: 2, clienteId: 99, updatedAt: new Date() });
    (leerFacturaVigenteDeVentaEnTx as jest.Mock).mockResolvedValue(null);
    await expect(cancelarVenta(tx, ctx, { id: 7 })).rejects.toMatchObject({ code: "CONCURRENCIA_CONFLICTO" });
    expect(revertirPagosAplicadosDeVentaEnTx).not.toHaveBeenCalled();
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
