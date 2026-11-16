/**
 * Application unit tests — the shared draft-line preparation pipeline.
 *
 * These exercise `prepararLineasVenta` directly against mocked repositories so
 * the behaviour-preserving decomposition (pure `validarPrecondicionesLineas`,
 * async `validarDescuentosAutorizadosYTopes`, pure `construirLineasPersistibles`
 * and `colectarWarningsStock`) is locked in ISOLATION from `crearVenta`. The
 * discount branches (role hard-check, config hard-fail, cap) and the per-line vs
 * header authorizer split are the primary focus (task 1b.2).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  leerProductosParaLineasVentaEnTx,
  leerStockSucursalEnTx,
  tieneRolPermitidoEnTx,
} from "../infrastructure/venta-repository";
import {
  leerConfigVentaEnTx,
  VentaConfigError,
  DESC_MAX_FALTANTE,
} from "../infrastructure/config-repository";
import { DESCUENTO_TIPO, type Descuento } from "../domain/venta";
import {
  LINEA_INVALIDA,
  LINEAS_VACIAS,
  PRODUCTO_NO_ENCONTRADO,
  PRODUCTO_INACTIVO,
  DESCUENTO_NO_AUTORIZADO,
  DESCUENTO_EXCEDE_MAXIMO,
} from "../domain/errors";
import { prepararLineasVenta } from "./preparar-lineas-venta";
import { leerTasasItbisEnTx } from "@/shared/infrastructure/tasas-itbis-config";

// --- mocks -----------------------------------------------------------------

jest.mock("../infrastructure/venta-repository", () => ({
  leerProductosParaLineasVentaEnTx: jest.fn(),
  leerStockSucursalEnTx: jest.fn(),
  tieneRolPermitidoEnTx: jest.fn(),
}));

// Keep the REAL VentaConfigError / DESC_MAX_FALTANTE (so `instanceof` inside the
// discount helper holds); stub only the async config reader.
// The sale now validates line rates against the per-empresa TASA_ITBIS list
// (feature itbis-tasas-config, slice 3d); stub the shared reader, keep the REAL
// TasasItbisConfigError class so instanceof in the prepare pipeline holds.
jest.mock("@/shared/infrastructure/tasas-itbis-config", () => {
  const actual = jest.requireActual(
    "@/shared/infrastructure/tasas-itbis-config",
  ) as Record<string, unknown>;
  return { ...actual, leerTasasItbisEnTx: jest.fn() };
});

jest.mock("../infrastructure/config-repository", () => {
  const actual = jest.requireActual(
    "../infrastructure/config-repository",
  ) as Record<string, unknown>;
  return { ...actual, leerConfigVentaEnTx: jest.fn() };
});

// --- fixtures --------------------------------------------------------------

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 2,
  usuarioId: 3,
  esAdmin: true,
};
const tx = {} as unknown as PrismaTx;
const FECHA = new Date("2026-01-10T00:00:00.000Z");

const CERO: Descuento = {
  descuentoTipo: DESCUENTO_TIPO.PORCENTAJE,
  descuentoValor: "0.00",
};

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

function linea(
  productoId = 10,
  descuento: Descuento = CERO,
  cantidad = "1",
) {
  return { productoId, cantidad, precioUnitario: "100.00", descuento };
}

beforeEach(() => {
  jest.clearAllMocks();
  (leerProductosParaLineasVentaEnTx as jest.Mock).mockResolvedValue([
    producto(10),
  ]);
  (leerStockSucursalEnTx as jest.Mock).mockResolvedValue([
    { productoId: 10, disponible: "50.000" },
  ]);
  (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
  (leerConfigVentaEnTx as jest.Mock).mockResolvedValue("25.00");
  (leerTasasItbisEnTx as jest.Mock).mockResolvedValue(["18", "16", "0"]);
});

describe("prepararLineasVenta — preconditions (validarPrecondicionesLineas)", () => {
  it("rejects an empty line set with LINEAS_VACIAS before reading products", async () => {
    const r = await prepararLineasVenta(tx, ctx, {
      lineas: [],
      descuentoCabecera: CERO,
      fecha: FECHA,
    });
    expect(!r.ok && r.code).toBe(LINEAS_VACIAS);
    expect(leerProductosParaLineasVentaEnTx).not.toHaveBeenCalled();
  });

  it("maps a missing/foreign product to PRODUCTO_NO_ENCONTRADO", async () => {
    (leerProductosParaLineasVentaEnTx as jest.Mock).mockResolvedValue([]);
    const r = await prepararLineasVenta(tx, ctx, {
      lineas: [linea()],
      descuentoCabecera: CERO,
      fecha: FECHA,
    });
    expect(!r.ok && r.code).toBe(PRODUCTO_NO_ENCONTRADO);
  });

  it("maps an inactive product to PRODUCTO_INACTIVO", async () => {
    (leerProductosParaLineasVentaEnTx as jest.Mock).mockResolvedValue([
      { ...producto(10), activo: false },
    ]);
    const r = await prepararLineasVenta(tx, ctx, {
      lineas: [linea()],
      descuentoCabecera: CERO,
      fecha: FECHA,
    });
    expect(!r.ok && r.code).toBe(PRODUCTO_INACTIVO);
  });

  // --- v2r-04: a sale may never carry the same product twice (per-product
  // quantities must be a single cell, mirroring the HTTP zod refine). Guarded
  // BEFORE the batch product read, so the mirror fails fast like LINEAS_VACIAS.

  it("rejects a duplicated productoId with LINEA_INVALIDA before reading products", async () => {
    const r = await prepararLineasVenta(tx, ctx, {
      lineas: [linea(10, CERO, "1"), linea(10, CERO, "2")],
      descuentoCabecera: CERO,
      fecha: FECHA,
    });
    expect(!r.ok && r.code).toBe(LINEA_INVALIDA);
    expect(leerProductosParaLineasVentaEnTx).not.toHaveBeenCalled();
  });
});

describe("prepararLineasVenta — discount pipeline (validarDescuentosAutorizadosYTopes)", () => {
  it("skips the role and config reads entirely for a zero-discount draft", async () => {
    const r = await prepararLineasVenta(tx, ctx, {
      lineas: [linea()],
      descuentoCabecera: CERO,
      fecha: FECHA,
    });
    expect(r.ok).toBe(true);
    expect(tieneRolPermitidoEnTx).not.toHaveBeenCalled();
    expect(leerConfigVentaEnTx).not.toHaveBeenCalled();
  });

  it("returns typed DESCUENTO_NO_AUTORIZADO when a positive discount lacks admin", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);
    const r = await prepararLineasVenta(tx, ctx, {
      lineas: [linea()],
      descuentoCabecera: {
        descuentoTipo: DESCUENTO_TIPO.PORCENTAJE,
        descuentoValor: "10",
      },
      fecha: FECHA,
    });
    expect(!r.ok && r.code).toBe(DESCUENTO_NO_AUTORIZADO);
    // Role is the first gate: config is never read once unauthorized.
    expect(leerConfigVentaEnTx).not.toHaveBeenCalled();
  });

  it("maps the config hard-fail to the composed DESC_MAX_FALTANTE code", async () => {
    (leerConfigVentaEnTx as jest.Mock).mockRejectedValue(
      new VentaConfigError(DESC_MAX_FALTANTE, { empresaId: 1 }),
    );
    const r = await prepararLineasVenta(tx, ctx, {
      lineas: [linea()],
      descuentoCabecera: {
        descuentoTipo: DESCUENTO_TIPO.PORCENTAJE,
        descuentoValor: "10",
      },
      fecha: FECHA,
    });
    expect(!r.ok && r.code).toBe(DESC_MAX_FALTANTE);
  });

  it("rejects a header percentage above DESC_MAX with DESCUENTO_EXCEDE_MAXIMO", async () => {
    const r = await prepararLineasVenta(tx, ctx, {
      lineas: [linea()],
      descuentoCabecera: {
        descuentoTipo: DESCUENTO_TIPO.PORCENTAJE,
        descuentoValor: "90",
      },
      fecha: FECHA,
    });
    expect(!r.ok && r.code).toBe(DESCUENTO_EXCEDE_MAXIMO);
  });
});

describe("prepararLineasVenta — persistence shape (construirLineasPersistibles)", () => {
  it("records the acting admin per-line ONLY on the discounted line", async () => {
    const r = await prepararLineasVenta(tx, ctx, {
      lineas: [
        linea(
          10,
          { descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "5" },
        ),
      ],
      descuentoCabecera: CERO,
      fecha: FECHA,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Line-level discount → authorizer is the acting admin.
      expect(r.data.lineas[0].descuentoAutorizadoPor).toBe(ctx.usuarioId);
      // Header had no discount → header authorizer stays null.
      expect(r.data.totales.descuentoAutorizadoPor).toBeNull();
    }
  });
});

describe("prepararLineasVenta — stock warnings (colectarWarningsStock)", () => {
  it("emits a non-blocking STOCK_INSUFICIENTE warning while still succeeding", async () => {
    (leerStockSucursalEnTx as jest.Mock).mockResolvedValue([
      { productoId: 10, disponible: "2.000" },
    ]);
    const r = await prepararLineasVenta(tx, ctx, {
      lineas: [linea(10, CERO, "5")],
      descuentoCabecera: CERO,
      fecha: FECHA,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.warnings).toHaveLength(1);
      expect(r.data.warnings[0]).toEqual({
        code: "STOCK_INSUFICIENTE",
        productoId: 10,
        available: "2.000",
        requested: "5",
      });
    }
  });

  it("defaults a missing stock row to 0.000 and warns on any positive quantity", async () => {
    (leerStockSucursalEnTx as jest.Mock).mockResolvedValue([]);
    const r = await prepararLineasVenta(tx, ctx, {
      lineas: [linea(10, CERO, "1")],
      descuentoCabecera: CERO,
      fecha: FECHA,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.warnings[0]).toMatchObject({
        code: "STOCK_INSUFICIENTE",
        available: "0.000",
      });
    }
  });
});

// --- slice 3d: per-empresa ITBIS rate list ---------------------------------

import { TasasItbisConfigError } from "@/shared/domain/tasas-itbis";

describe("prepararLineasVenta — per-empresa TASA_ITBIS list (slice 3d)", () => {
  it("refuses a well-formed rate outside the list ('7') with LINEA_INVALIDA", async () => {
    (leerProductosParaLineasVentaEnTx as jest.Mock).mockResolvedValue([
      producto(10, "7"),
    ]);
    const r = await prepararLineasVenta(tx, ctx, {
      lineas: [linea()],
      descuentoCabecera: CERO,
      fecha: FECHA,
    });
    expect(!r.ok && r.code).toBe("LINEA_INVALIDA");
  });

  it("fails loud with TASA_ITBIS_CONFIG_FALTANTE when the key is missing (S15)", async () => {
    (leerTasasItbisEnTx as jest.Mock).mockRejectedValue(
      new TasasItbisConfigError("ausente"),
    );
    const r = await prepararLineasVenta(tx, ctx, {
      lineas: [linea()],
      descuentoCabecera: CERO,
      fecha: FECHA,
    });
    expect(!r.ok && r.code).toBe("TASA_ITBIS_CONFIG_FALTANTE");
    expect(!r.ok && r.message).toContain("TASA_ITBIS");
  });

  it("reads the rate list AFTER the product batch (ordering)", async () => {
    const calls: string[] = [];
    (leerProductosParaLineasVentaEnTx as jest.Mock).mockImplementation(async () => {
      calls.push("productos");
      return [producto(10)];
    });
    (leerTasasItbisEnTx as jest.Mock).mockImplementation(async () => {
      calls.push("tasas");
      return ["18", "16", "0"];
    });
    await prepararLineasVenta(tx, ctx, {
      lineas: [linea()],
      descuentoCabecera: CERO,
      fecha: FECHA,
    });
    expect(calls).toEqual(["productos", "tasas"]);
  });
});
