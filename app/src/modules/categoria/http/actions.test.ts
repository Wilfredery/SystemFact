import {
  crearCategoriaAction,
  listarCategoriasAction,
  actualizarCategoriaAction,
  desactivarCategoriaAction,
} from "./actions";
import { crearCategoria, type CrearCategoriaResult } from "../application/crear-categoria";
import { listarCategorias } from "../application/listar-categorias";
import { actualizarCategoria } from "../application/actualizar-categoria";
import { desactivarCategoria } from "../application/desactivar-categoria";
import { tieneRolPermitidoEnTx } from "../infrastructure/categoria-repository";
import {
  NOMBRE_CATEGORIA_DUPLICADO,
  CATEGORIA_NO_ENCONTRADA,
  CATEGORIA_YA_INACTIVA,
  CATEGORIA_TIENE_PRODUCTOS,
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  CONCURRENCIA_CONFLICTO,
  messageFor,
  type CategoriaErrorCode,
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

jest.mock("../application/crear-categoria", () => ({
  crearCategoria: jest.fn(),
}));

jest.mock("../application/listar-categorias", () => ({
  listarCategorias: jest.fn(),
}));

jest.mock("../application/actualizar-categoria", () => ({
  actualizarCategoria: jest.fn(),
}));

jest.mock("../application/desactivar-categoria", () => ({
  desactivarCategoria: jest.fn(),
}));

jest.mock("../infrastructure/categoria-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));

import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";

const mockCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: false,
};

function mockSession() {
  (getCurrentTenantContext as jest.Mock).mockResolvedValue(mockCtx);
}

function mockCategoria(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    empresaId: 1,
    nombre: "Zapatos",
    activa: true,
    version: 1,
    ...overrides,
  };
}

function mockCrearResult(error?: {
  code?: CategoriaErrorCode;
  message?: string;
}): CrearCategoriaResult {
  if (error) {
    return {
      ok: false,
      code: error.code ?? NOMBRE_CATEGORIA_DUPLICADO,
      message: error.message ?? "",
    };
  }
  return { ok: true, data: mockCategoria() };
}

describe("crearCategoriaAction", () => {
  it("CAT-006: happy path returns the mapped category and wraps in tenant tx", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (crearCategoria as jest.Mock).mockResolvedValue(mockCrearResult());

    const result = await crearCategoriaAction({ nombre: "Zapatos" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ id: 1, nombre: "Zapatos", version: 1 });
    }
    expect(withTenantTransaction).toHaveBeenCalled();
    // CRUD is Administrador + Operador (design D1).
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ["Administrador", "Operador"],
    );
  });

  it("CAT-007-A: invalid payload returns VALIDATION_ERROR without delegation", async () => {
    const result = await crearCategoriaAction({ nombre: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(VALIDATION_ERROR);
      // Catalog message, not the raw zod text.
      expect(result.error.message).toBe(messageFor(VALIDATION_ERROR));
    }
    expect(crearCategoria).not.toHaveBeenCalled();
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });

  it("CAT-006: invalid session returns SESION_INVALIDA", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await crearCategoriaAction({ nombre: "Zapatos" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(SESION_INVALIDA);
    expect(crearCategoria).not.toHaveBeenCalled();
  });

  it("CAT-006-A: forbidden role returns NO_AUTORIZADO without delegating", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await crearCategoriaAction({ nombre: "Zapatos" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(NO_AUTORIZADO);
    expect(crearCategoria).not.toHaveBeenCalled();
  });

  it("use-case error is forwarded with its stable code", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (crearCategoria as jest.Mock).mockResolvedValue(
      mockCrearResult({ code: NOMBRE_CATEGORIA_DUPLICADO }),
    );

    const result = await crearCategoriaAction({ nombre: "Zapatos" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(NOMBRE_CATEGORIA_DUPLICADO);
  });
});

describe("listarCategoriasAction", () => {
  it("CAT-003: happy path returns items/total/page", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (listarCategorias as jest.Mock).mockResolvedValue({
      ok: true,
      data: { items: [mockCategoria()], total: 1, page: 1 },
    });

    const result = await listarCategoriasAction({ page: 1, limit: 25 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.total).toBe(1);
      expect(result.data.items[0]).toEqual({
        id: 1,
        nombre: "Zapatos",
        activa: true,
      });
    }
    expect(withTenantTransaction).toHaveBeenCalled();
  });

  it("CAT-003-B/CAT-007-A: limit > 100 fails Zod before the use case", async () => {
    const result = await listarCategoriasAction({ page: 1, limit: 500 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VALIDATION_ERROR);
    expect(listarCategorias).not.toHaveBeenCalled();
  });

  it("CAT-006-A: listing needs Admin or Operador too", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await listarCategoriasAction({ page: 1, limit: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(NO_AUTORIZADO);
    expect(listarCategorias).not.toHaveBeenCalled();
  });
});

describe("actualizarCategoriaAction", () => {
  const editInput = { id: 10, version: 2, nombre: "Calzado" };

  it("CAT-004-A: happy path returns id and bumped version", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (actualizarCategoria as jest.Mock).mockResolvedValue({
      ok: true,
      data: mockCategoria({ id: 10, nombre: "Calzado", version: 3 }),
    });

    const result = await actualizarCategoriaAction(editInput);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ id: 10, version: 3 });
    // The client-submitted version is forwarded untouched to the use case.
    const passed = (actualizarCategoria as jest.Mock).mock.calls[0][2];
    expect(passed.version).toBe(2);
    expect(withTenantTransaction).toHaveBeenCalled();
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ["Administrador", "Operador"],
    );
  });

  it("CAT-004-B: stale version maps CONCURRENCIA_CONFLICTO", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (actualizarCategoria as jest.Mock).mockResolvedValue({
      ok: false,
      code: CONCURRENCIA_CONFLICTO,
      message: messageFor(CONCURRENCIA_CONFLICTO),
    });

    const result = await actualizarCategoriaAction(editInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(CONCURRENCIA_CONFLICTO);
  });

  it("CAT-006-B: foreign-tenant id maps CATEGORIA_NO_ENCONTRADA", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (actualizarCategoria as jest.Mock).mockResolvedValue({
      ok: false,
      code: CATEGORIA_NO_ENCONTRADA,
      message: messageFor(CATEGORIA_NO_ENCONTRADA),
    });

    const result = await actualizarCategoriaAction(editInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(CATEGORIA_NO_ENCONTRADA);
  });

  it("CAT-004: patch without nombre fails Zod before any DB access", async () => {
    const result = await actualizarCategoriaAction({ id: 10, version: 2 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VALIDATION_ERROR);
    expect(actualizarCategoria).not.toHaveBeenCalled();
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });
});

describe("desactivarCategoriaAction", () => {
  it("CAT-005: happy path returns the deactivated id, Admin-only", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (desactivarCategoria as jest.Mock).mockResolvedValue({
      ok: true,
      data: { id: 10, nombre: "Zapatos" },
    });

    const result = await desactivarCategoriaAction({ id: 10 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ id: 10 });
    // Deactivation is Administrador-only (design D1).
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ["Administrador"],
    );
    expect(withTenantTransaction).toHaveBeenCalled();
  });

  it("CAT-005-A: active products map CATEGORIA_TIENE_PRODUCTOS", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (desactivarCategoria as jest.Mock).mockResolvedValue({
      ok: false,
      code: CATEGORIA_TIENE_PRODUCTOS,
      message: messageFor(CATEGORIA_TIENE_PRODUCTOS),
    });

    const result = await desactivarCategoriaAction({ id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(CATEGORIA_TIENE_PRODUCTOS);
  });

  it("repeated deactivation maps CATEGORIA_YA_INACTIVA", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (desactivarCategoria as jest.Mock).mockResolvedValue({
      ok: false,
      code: CATEGORIA_YA_INACTIVA,
      message: messageFor(CATEGORIA_YA_INACTIVA),
    });

    const result = await desactivarCategoriaAction({ id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(CATEGORIA_YA_INACTIVA);
  });

  it("CAT-007-A: invalid id fails before any DB access", async () => {
    const result = await desactivarCategoriaAction({ id: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VALIDATION_ERROR);
    expect(desactivarCategoria).not.toHaveBeenCalled();
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });
});
