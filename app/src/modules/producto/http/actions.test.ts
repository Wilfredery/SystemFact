import { Decimal } from "decimal.js";
import { crearProductoAction, listarProductosAction } from "./actions";
import {
  crearProducto,
  type CrearProductoResult,
} from "../application/crear-producto";
import { listarProductos } from "../application/listar-productos";
import { tieneRolPermitidoEnTx } from "../infrastructure/producto-repository";
import {
  CODIGO_PRODUCTO_DUPLICADO,
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  type ProductoErrorCode,
} from "../domain/errors";

jest.mock("@/lib/supabase/client", () => ({
  createClient: jest.fn(),
}));

jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
}));

jest.mock("@/modules/tenant/infrastructure/withTenantTransaction", () => ({
  withTenantTransaction: jest.fn((_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn({})),
}));

jest.mock("../application/crear-producto", () => ({
  crearProducto: jest.fn(),
}));

jest.mock("../application/listar-productos", () => ({
  listarProductos: jest.fn(),
}));

jest.mock("../infrastructure/producto-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));

// The generated Prisma client is ESM (uses import.meta.url) and cannot be
// loaded by ts-jest in CommonJS mode. actions.ts only needs Prisma.Decimal,
// which at runtime is a re-export of decimal.js — so the mock re-exports the
// same value instead of loading the generated client.
jest.mock("@/generated/prisma/client", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Decimal } = require("decimal.js");
  return { Prisma: { Decimal } };
});

import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";

const mockCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: false,
};

const validInput = {
  categoriaId: 1,
  codigo: "LAP001",
  nombre: "Laptop Dell",
  precioVenta: "50000.00",
  itbisTasa: "18" as const,
  itbisVigenteDesde: "2026-01-01",
  itbisVigenteHasta: null,
  itbisAplicaRetencionITBIS: false,
};

function mockSupabase() {
  (getCurrentTenantContext as jest.Mock).mockResolvedValue(mockCtx);
}

function mockProductoResult(
  error?: { code?: ProductoErrorCode; message?: string },
): CrearProductoResult {
  if (error) {
    return {
      ok: false,
      code: error.code ?? CODIGO_PRODUCTO_DUPLICADO,
      message: error.message ?? "",
    };
  }
  return {
    ok: true,
    producto: {
      id: 1,
      empresaId: 1,
      categoriaId: 1,
      codigo: "LAP001",
      nombre: "Laptop Dell",
      descripcion: null,
      precioVenta: new Decimal("50000.00"),
      itbis: {
        tasa: "18",
        vigenteDesde: new Date("2026-01-01"),
        vigenteHasta: null,
        aplicaRetencionITBIS: false,
      },
      exento: false,
      activo: true,
    },
  };
}

describe("crearProductoAction", () => {

  it("PROD-007-A: happy path returns id and codigo", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (crearProducto as jest.Mock).mockResolvedValue(mockProductoResult());

    const result = await crearProductoAction(validInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ id: 1, codigo: "LAP001" });
    }
  });

  it("PROD-007-B: zod validation fails on missing codigo", async () => {
    const result = await crearProductoAction({
      categoriaId: 1,
      nombre: "Laptop Dell",
      precioVenta: "50000.00",
      itbisTasa: "18",
      itbisVigenteDesde: "2026-01-01",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(VALIDATION_ERROR);
    }
  });

  it("PROD-007-C: ctx build fails returns UNAUTHORIZED", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await crearProductoAction(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(SESION_INVALIDA);
    }
  });

  it("PROD-007-D: use case error maps toActionResult error", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (crearProducto as jest.Mock).mockResolvedValue(
      mockProductoResult({
        code: CODIGO_PRODUCTO_DUPLICADO,
        message: "Ya existe un producto con ese código en la empresa",
      }),
    );

    const result = await crearProductoAction(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CODIGO_PRODUCTO_DUPLICADO);
    }
  });

  it("PROD-007-E: unauthorized role returns FORBIDDEN", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await crearProductoAction(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(NO_AUTORIZADO);
    }
    expect(crearProducto).not.toHaveBeenCalled();
  });
});

describe("listarProductosAction", () => {

  it("PROD-008-A: happy path returns items, total, page", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (listarProductos as jest.Mock).mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            id: 1,
            codigo: "LAP001",
            nombre: "Laptop Dell",
            precioVenta: new Decimal("50000.00"),
            itbis: { tasa: "18" },
          },
        ],
        total: 1,
        page: 1,
      },
    });

    const result = await listarProductosAction({ page: 1, limit: 25 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.total).toBe(1);
      expect(result.data.page).toBe(1);
      expect(result.data.items[0].precioVenta).toBe("50000.00");
    }
  });

  it("PROD-008-B: invalid query params returns VALIDATION_ERROR", async () => {
    const result = await listarProductosAction({ limit: 500 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(VALIDATION_ERROR);
    }
  });

  it("PROD-008-C: unauthorized role returns FORBIDDEN", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await listarProductosAction({ page: 1, limit: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(NO_AUTORIZADO);
    }
    expect(listarProductos).not.toHaveBeenCalled();
  });
});
