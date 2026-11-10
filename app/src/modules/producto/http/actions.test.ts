import { Decimal } from "decimal.js";
import {
  crearProductoAction,
  listarProductosAction,
  actualizarProductoAction,
  desactivarProductoAction,
  consultarProductosAction,
  obtenerProductoPorIdAction,
  obtenerPermisosProductoAction,
} from "./actions";
import {
  crearProducto,
  type CrearProductoResult,
} from "../application/crear-producto";
import { listarProductos } from "../application/listar-productos";
import { consultarProductos } from "../application/consultar-productos";
import { obtenerProductoDetalle } from "../application/obtener-producto";
import { ROLES_GESTION_PRODUCTOS, ROLES_VER_PRODUCTOS } from "./shared";
import { actualizarProducto } from "../application/actualizar-producto";
import { desactivarProducto } from "../application/desactivar-producto";
import { tieneRolPermitidoEnTx } from "../infrastructure/producto-repository";
import {
  CODIGO_PRODUCTO_DUPLICADO,
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  CONCURRENCIA_CONFLICTO,
  PRODUCTO_NO_ENCONTRADO,
  PRODUCTO_YA_INACTIVO,
  PRODUCTO_TIENE_MOVIMIENTOS,
  messageFor,
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

jest.mock("../application/consultar-productos", () => ({
  consultarProductos: jest.fn(),
}));

jest.mock("../application/obtener-producto", () => ({
  obtenerProductoDetalle: jest.fn(),
}));

jest.mock("../application/actualizar-producto", () => ({
  actualizarProducto: jest.fn(),
}));

jest.mock("../application/desactivar-producto", () => ({
  desactivarProducto: jest.fn(),
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
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";

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
      unidadMedida: "",
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
    // All Prisma/audit work must run inside the tenant wrapper.
    expect(withTenantTransaction).toHaveBeenCalled();
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
      // Catalog message, not the raw zod text.
      expect(result.error.message).toBe(messageFor(VALIDATION_ERROR));
    }
    // Validation blocks before any use-case delegation.
    expect(crearProducto).not.toHaveBeenCalled();
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
  it("authorizes against the view group (Administrador, Operador, Despachador)", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (listarProductos as jest.Mock).mockResolvedValue({
      ok: true,
      data: { items: [], total: 0, page: 1 },
    });

    await listarProductosAction({ page: 1, limit: 25 });

    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ROLES_VER_PRODUCTOS,
    );
  });

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
      expect(result.data.items[0].tasaItbis).toBe("18");
    }
    // All Prisma/audit work must run inside the tenant wrapper.
    expect(withTenantTransaction).toHaveBeenCalled();
  });

  it("PROD-008-B: invalid query params returns VALIDATION_ERROR", async () => {
    const result = await listarProductosAction({ limit: 500 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(VALIDATION_ERROR);
      // Catalog message, not the raw zod text.
      expect(result.error.message).toBe(messageFor(VALIDATION_ERROR));
    }
    // Validation blocks before any use-case delegation.
    expect(listarProductos).not.toHaveBeenCalled();
  });

  it("PROD-008-B2: ctx build fails returns SESION_INVALIDA", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await listarProductosAction({ page: 1, limit: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(SESION_INVALIDA);
    }
    expect(listarProductos).not.toHaveBeenCalled();
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

function makeProductoDomain() {
  return {
    id: 10,
    empresaId: 1,
    categoriaId: 1,
    codigo: "LAP001",
    nombre: "Laptop Dell",
    descripcion: null,
    unidadMedida: "",
    precioVenta: new Decimal("55000.00"),
    itbis: {
      tasa: "18" as const,
      vigenteDesde: new Date("2026-01-01"),
      vigenteHasta: null,
      aplicaRetencionITBIS: false,
    },
    exento: false,
    activo: true,
  };
}

describe("actualizarProductoAction", () => {
  const editInput = { id: 10, version: 2, precioVenta: "55000.00" };

  it("PROD-011-A: happy path returns id and bumped version", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (actualizarProducto as jest.Mock).mockResolvedValue({
      ok: true,
      producto: makeProductoDomain(),
      version: 3,
    });

    const result = await actualizarProductoAction(editInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ id: 10, version: 3 });
    }
    // String money is converted to Decimal before reaching the use case.
    const passed = (actualizarProducto as jest.Mock).mock.calls[0][2];
    expect(passed.precioVenta.toString()).toBe("55000");
    expect(withTenantTransaction).toHaveBeenCalled();
    // Edit uses the manage group (Administrador only; owner 2026-11-08).
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ROLES_GESTION_PRODUCTOS,
    );
  });

  it("PROD-011-B: stale version maps CONCURRENCIA_CONFLICTO", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (actualizarProducto as jest.Mock).mockResolvedValue({
      ok: false,
      code: CONCURRENCIA_CONFLICTO,
      message: messageFor(CONCURRENCIA_CONFLICTO),
    });

    const result = await actualizarProductoAction(editInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(CONCURRENCIA_CONFLICTO);
  });

  it("PROD-011-C: duplicate changed code maps CODIGO_PRODUCTO_DUPLICADO", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (actualizarProducto as jest.Mock).mockResolvedValue({
      ok: false,
      code: CODIGO_PRODUCTO_DUPLICADO,
      message: messageFor(CODIGO_PRODUCTO_DUPLICADO),
    });

    const result = await actualizarProductoAction({
      ...editInput,
      codigo: "OTRO",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(CODIGO_PRODUCTO_DUPLICADO);
  });

  it("PROD-013-B: foreign-tenant id maps PRODUCTO_NO_ENCONTRADO", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (actualizarProducto as jest.Mock).mockResolvedValue({
      ok: false,
      code: PRODUCTO_NO_ENCONTRADO,
      message: messageFor(PRODUCTO_NO_ENCONTRADO),
    });

    const result = await actualizarProductoAction(editInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(PRODUCTO_NO_ENCONTRADO);
  });

  it("PROD-015-A: patch with no editable fields fails before any DB access", async () => {
    const result = await actualizarProductoAction({ id: 10, version: 2 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VALIDATION_ERROR);
    expect(actualizarProducto).not.toHaveBeenCalled();
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });

  it("PROD-013-A: unauthorized role returns NO_AUTORIZADO without delegating", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await actualizarProductoAction(editInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(NO_AUTORIZADO);
    expect(actualizarProducto).not.toHaveBeenCalled();
  });
});

describe("desactivarProductoAction", () => {
  it("PROD-012-A: happy path returns the deactivated id", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (desactivarProducto as jest.Mock).mockResolvedValue({
      ok: true,
      productoId: 10,
      codigo: "LAP001",
    });

    const result = await desactivarProductoAction({ id: 10 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ id: 10 });
    // Deactivation is Admin-only (REQ-PROD-013).
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ["Administrador"],
    );
    expect(withTenantTransaction).toHaveBeenCalled();
  });

  it("PROD-012-B: active references map PRODUCTO_TIENE_MOVIMIENTOS", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (desactivarProducto as jest.Mock).mockResolvedValue({
      ok: false,
      code: PRODUCTO_TIENE_MOVIMIENTOS,
      message: messageFor(PRODUCTO_TIENE_MOVIMIENTOS),
    });

    const result = await desactivarProductoAction({ id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(PRODUCTO_TIENE_MOVIMIENTOS);
  });

  it("repeated deactivation maps PRODUCTO_YA_INACTIVO", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (desactivarProducto as jest.Mock).mockResolvedValue({
      ok: false,
      code: PRODUCTO_YA_INACTIVO,
      message: messageFor(PRODUCTO_YA_INACTIVO),
    });

    const result = await desactivarProductoAction({ id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(PRODUCTO_YA_INACTIVO);
  });

  it("PROD-013-A: Operador (not Admin) is forbidden from deactivating", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await desactivarProductoAction({ id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(NO_AUTORIZADO);
    expect(desactivarProducto).not.toHaveBeenCalled();
  });

  it("PROD-015-A: invalid id fails before any DB access", async () => {
    const result = await desactivarProductoAction({ id: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VALIDATION_ERROR);
    expect(desactivarProducto).not.toHaveBeenCalled();
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });
});

const CONSULTA_VACIA = {
  items: [],
  total: 0,
  page: 1,
  limit: 25,
  categorias: [],
};

describe("consultarProductosAction", () => {
  it("S3: authorizes against the view group and returns the projection", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (consultarProductos as jest.Mock).mockResolvedValue({
      ok: true,
      data: {
        ...CONSULTA_VACIA,
        items: [
          {
            id: 7,
            codigo: "P-007",
            nombre: "Arroz",
            descripcion: null,
            categoriaId: 3,
            categoria: "Granos",
            unidadMedida: "Libra",
            precioVenta: "125.50",
            tasaItbis: "18",
            itbisVigenteDesde: "2026-01-01T00:00:00.000Z",
            itbisVigenteHasta: null,
            itbisAplicaRetencionITBIS: false,
            activo: true,
            version: 4,
          },
        ],
        total: 1,
        categorias: [{ id: 3, nombre: "Granos" }],
      },
    });

    const result = await consultarProductosAction({ page: 1, limit: 25 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items[0].categoria).toBe("Granos");
      expect(result.data.items[0].unidadMedida).toBe("Libra");
      expect(result.data.items[0].version).toBe(4);
      expect(result.data.categorias).toEqual([{ id: 3, nombre: "Granos" }]);
    }
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ROLES_VER_PRODUCTOS,
    );
    expect(withTenantTransaction).toHaveBeenCalled();
  });

  it("S1: an invalid query returns VALIDATION_ERROR without delegating", async () => {
    const result = await consultarProductosAction({ page: 1, limit: 101 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VALIDATION_ERROR);
    expect(consultarProductos).not.toHaveBeenCalled();
  });

  it("S3: an unauthorized role is refused without delegating", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await consultarProductosAction({ page: 1, limit: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(NO_AUTORIZADO);
    expect(consultarProductos).not.toHaveBeenCalled();
  });
});

describe("obtenerProductoPorIdAction", () => {
  const detalle = {
    id: 10,
    codigo: "LAP-001",
    nombre: "Laptop",
    descripcion: null,
    categoriaId: 2,
    categoria: "Equipos",
    unidadMedida: "Unidad",
    precioVenta: "55000.00",
    tasaItbis: "18",
    itbisVigenteDesde: "2026-01-01T00:00:00.000Z",
    itbisVigenteHasta: null,
    itbisAplicaRetencionITBIS: false,
    activo: true,
    version: 7,
  };

  it("S1: returns the full detail including the version, for the edit prefill", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (obtenerProductoDetalle as jest.Mock).mockResolvedValue({ ok: true, producto: detalle });

    const result = await obtenerProductoPorIdAction({ id: 10 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(detalle);
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ROLES_VER_PRODUCTOS,
    );
    expect(obtenerProductoDetalle).toHaveBeenCalledWith(expect.anything(), mockCtx, { id: 10 });
  });

  it("S4: a missing product maps PRODUCTO_NO_ENCONTRADO", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (obtenerProductoDetalle as jest.Mock).mockResolvedValue({
      ok: false,
      code: PRODUCTO_NO_ENCONTRADO,
      message: messageFor(PRODUCTO_NO_ENCONTRADO),
    });

    const result = await obtenerProductoPorIdAction({ id: 99 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(PRODUCTO_NO_ENCONTRADO);
  });

  it("S1: an invalid id fails before any database access", async () => {
    const result = await obtenerProductoPorIdAction({ id: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VALIDATION_ERROR);
    expect(obtenerProductoDetalle).not.toHaveBeenCalled();
  });
});

describe("obtenerPermisosProductoAction", () => {
  it("S3: answers from the manage role group (Administrador may manage)", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);

    const result = await obtenerPermisosProductoAction();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ puedeGestionar: true });
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ROLES_GESTION_PRODUCTOS,
    );
  });

  it("S3: Operador and Despachador get no manage capability", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await obtenerPermisosProductoAction();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ puedeGestionar: false });
  });
});

describe("unidad in the write actions (S1)", () => {
  it("crearProductoAction forwards unidadMedida to the use case", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (crearProducto as jest.Mock).mockResolvedValue(mockProductoResult());

    const result = await crearProductoAction({ ...validInput, unidadMedida: "Libra" });

    expect(result.ok).toBe(true);
    const passed = (crearProducto as jest.Mock).mock.calls[0][2];
    expect(passed.unidadMedida).toBe("Libra");
  });

  it("crearProductoAction defaults itbisVigenteDesde to now when the dialog omits it", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (crearProducto as jest.Mock).mockResolvedValue(mockProductoResult());
    const sinVigencia = {
      categoriaId: validInput.categoriaId,
      codigo: validInput.codigo,
      nombre: validInput.nombre,
      precioVenta: validInput.precioVenta,
      itbisTasa: validInput.itbisTasa,
      itbisVigenteHasta: validInput.itbisVigenteHasta,
      itbisAplicaRetencionITBIS: validInput.itbisAplicaRetencionITBIS,
    };

    const result = await crearProductoAction(sinVigencia);

    expect(result.ok).toBe(true);
    const passed = (crearProducto as jest.Mock).mock.calls[0][2];
    expect(passed.itbisVigenteDesde).toBeInstanceOf(Date);
  });

  it("actualizarProductoAction forwards unidadMedida in the patch", async () => {
    mockSupabase();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (actualizarProducto as jest.Mock).mockResolvedValue({
      ok: true,
      producto: makeProductoDomain(),
      version: 3,
    });

    const result = await actualizarProductoAction({ id: 10, version: 2, unidadMedida: "Caja" });

    expect(result.ok).toBe(true);
    const passed = (actualizarProducto as jest.Mock).mock.calls[0][2];
    expect(passed.unidadMedida).toBe("Caja");
  });
});
