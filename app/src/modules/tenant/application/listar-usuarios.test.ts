/**
 * Application unit tests — `listarUsuarios` (collaborators mocked).
 *
 * Proves the use case owns its pagination contract through the SHARED helpers
 * (`shared/domain/pagination`): page ≥ 1, pageSize clamped to [1, 100], offset
 * derived from them, and a blank search never becomes a filter. The tenant
 * scope itself is asserted at the repository (empresaId pinned, branch via RLS).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  contarUsuariosEnTx,
  listarUsuariosEnTx,
  type UsuarioListRow,
} from "../infrastructure/usuario-repository";
import { listarUsuarios } from "./listar-usuarios";

jest.mock("../infrastructure/usuario-repository", () => ({
  listarUsuariosEnTx: jest.fn(),
  contarUsuariosEnTx: jest.fn(),
}));

const ctx: TenantCtx = { empresaId: 1, sucursalId: 2, usuarioId: 3, esAdmin: true };
const tx = {} as unknown as PrismaTx;

function makeRow(overrides: Partial<UsuarioListRow> = {}): UsuarioListRow {
  return {
    id: 7,
    nombreUsuario: "maria",
    nombre: "María Pérez",
    activo: true,
    sucursalNombre: "Matriz",
    roles: ["Administrador"],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (listarUsuariosEnTx as jest.Mock).mockResolvedValue([]);
  (contarUsuariosEnTx as jest.Mock).mockResolvedValue(0);
});

describe("listarUsuarios", () => {
  it("defaults to page 1 / pageSize 25 / offset 0 with no filters", async () => {
    const result = await listarUsuarios(tx, ctx, {});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
    }
    expect(listarUsuariosEnTx).toHaveBeenCalledWith(tx, ctx, {
      offset: 0,
      limit: 25,
    });
    expect(contarUsuariosEnTx).toHaveBeenCalledWith(tx, ctx, {});
  });

  it("clamps a page below 1 and a pageSize above 100 through the shared helpers", async () => {
    await listarUsuarios(tx, ctx, { page: 0, pageSize: 250 });

    expect(listarUsuariosEnTx).toHaveBeenCalledWith(tx, ctx, {
      offset: 0,
      limit: 100,
    });
  });

  it("derives the offset from page and pageSize", async () => {
    await listarUsuarios(tx, ctx, { page: 3, pageSize: 10 });

    expect(listarUsuariosEnTx).toHaveBeenCalledWith(tx, ctx, {
      offset: 20,
      limit: 10,
    });
  });

  it("forwards the trimmed search term and the activo filter", async () => {
    await listarUsuarios(tx, ctx, { buscar: "  maria ", activo: false });

    expect(listarUsuariosEnTx).toHaveBeenCalledWith(tx, ctx, {
      offset: 0,
      limit: 25,
      buscar: "maria",
      activo: false,
    });
    expect(contarUsuariosEnTx).toHaveBeenCalledWith(tx, ctx, {
      buscar: "maria",
      activo: false,
    });
  });

  it("drops a blank search term instead of forwarding it", async () => {
    await listarUsuarios(tx, ctx, { buscar: "   " });

    expect(listarUsuariosEnTx).toHaveBeenCalledWith(tx, ctx, {
      offset: 0,
      limit: 25,
    });
  });

  it("returns the rows and the total from the repository", async () => {
    (listarUsuariosEnTx as jest.Mock).mockResolvedValue([makeRow()]);
    (contarUsuariosEnTx as jest.Mock).mockResolvedValue(42);

    const result = await listarUsuarios(tx, ctx, { page: 2, pageSize: 25 });

    expect(result).toEqual({
      ok: true,
      data: { items: [makeRow()], total: 42, page: 2, pageSize: 25 },
    });
  });
});
