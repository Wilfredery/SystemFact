/**
 * HTTP adapter authorization + wiring tests (tasks 5.5).
 *
 * Mirrors the producto adapter harness: the Supabase session, the tenant
 * context resolver, the transaction wrapper, the use cases and the role helper
 * are all mocked so the test asserts the gate/transaction wiring, not SQL. The
 * core guarantees checked here are: unauthorized role rejected, missing session
 * rejected, and every DB-backed use case invoked inside withTenantTransaction.
 */

import {
  listarInventarioAction,
  consultarInventarioAction,
  ajustarInventarioAction,
  obtenerPermisosInventarioAction,
  listarMovimientosInventarioAction,
} from "./actions";
import { listarMovimientosInventario } from "../application/listar-movimientos-inventario";
import { consultarInventario } from "../application/consultar-inventario";
import { listarInventario } from "../application/listar-inventario";
import { ajustarInventario } from "../application/ajustar-inventario";
import { tieneRolPermitidoEnTx } from "../infrastructure/inventario-repository";
import { ROLES_GESTION_INVENTARIO, ROLES_VER_INVENTARIO } from "./shared";
import {
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  STOCK_INSUFICIENTE,
  RANGO_FECHAS_EXCEDIDO,
  messageFor,
} from "../domain/errors";

jest.mock("@/lib/supabase/client", () => ({
  createClient: jest.fn(),
}));

jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
}));

jest.mock("@/modules/tenant/infrastructure/withTenantTransaction", () => ({
  withTenantTransaction: jest.fn(
    (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn({}),
  ),
}));

jest.mock("../application/listar-inventario", () => ({
  listarInventario: jest.fn(),
}));

jest.mock("../application/consultar-inventario", () => ({
  consultarInventario: jest.fn(),
}));

jest.mock("../application/ajustar-inventario", () => ({
  ajustarInventario: jest.fn(),
}));

jest.mock("../application/listar-movimientos-inventario", () => ({
  listarMovimientosInventario: jest.fn(),
}));

jest.mock("../infrastructure/inventario-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));

// Imported after the mocks so the test can drive them.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getCurrentTenantContext } = require("@/modules/tenant/infrastructure/tenant-runtime");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withTenantTransaction } = require("@/modules/tenant/infrastructure/withTenantTransaction");

const mockCtx = { empresaId: 1, sucursalId: 1, usuarioId: 1, esAdmin: false };

function mockSession() {
  (getCurrentTenantContext as jest.Mock).mockResolvedValue(mockCtx);
}

beforeEach(() => {
  jest.resetAllMocks();
  // Restore the pass-through transaction wrapper after resetAllMocks wiped it.
  (withTenantTransaction as jest.Mock).mockImplementation(
    (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn({}),
  );
});

describe("listarInventarioAction", () => {
  it("returns the listing inside the tenant transaction", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (listarInventario as jest.Mock).mockResolvedValue({
      ok: true,
      data: { items: [], total: 0, page: 1, limit: 25 },
    });

    const result = await listarInventarioAction({ page: 1, limit: 25 });

    expect(result.ok).toBe(true);
    expect(withTenantTransaction).toHaveBeenCalledTimes(1);
    // Listing uses the view group (Administrador, Operador, Despachador).
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ROLES_VER_INVENTARIO,
    );
  });

  it("rejects an unauthorized role with NO_AUTORIZADO without delegating", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await listarInventarioAction({ page: 1, limit: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(NO_AUTORIZADO);
    expect(listarInventario).not.toHaveBeenCalled();
  });

  it("rejects a missing session with SESION_INVALIDA before opening a tx", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await listarInventarioAction({ page: 1, limit: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(SESION_INVALIDA);
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });
});

describe("ajustarInventarioAction", () => {
  const validInput = {
    productoId: 5,
    cantidad: "5",
    motivo: "Inventario físico",
    requestId: "11111111-2222-4333-8444-555555555555",
  };

  it("applies an authorized adjustment inside the tenant transaction", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (ajustarInventario as jest.Mock).mockResolvedValue({
      ok: true,
      data: {
        inventarioId: 100,
        productoId: 5,
        cantidadAnterior: "3.000",
        cantidadNueva: "8.000",
      },
    });

    const result = await ajustarInventarioAction(validInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.cantidadNueva).toBe("8.000");
    }
    expect(withTenantTransaction).toHaveBeenCalledTimes(1);
    // Adjusting stock uses the manage group (Administrador only; owner 2026-11-08).
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ROLES_GESTION_INVENTARIO,
    );
  });

  it("forwards the requestId to the use case as the idempotency key", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (ajustarInventario as jest.Mock).mockResolvedValue({
      ok: true,
      data: { inventarioId: 1, productoId: 5, cantidadAnterior: "3.000", cantidadNueva: "8.000" },
    });

    await ajustarInventarioAction(validInput);

    expect(ajustarInventario).toHaveBeenCalledWith(expect.anything(), mockCtx, {
      productoId: 5,
      cantidad: "5",
      motivo: "Inventario físico",
      claveIdempotencia: "11111111-2222-4333-8444-555555555555",
    });
  });

  it.each([undefined, "", "short"])(
    "rejects a missing or too short requestId (%p) with VALIDATION_ERROR before any session read",
    async (requestId) => {
      const result = await ajustarInventarioAction({ ...validInput, requestId });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(VALIDATION_ERROR);
      expect(ajustarInventario).not.toHaveBeenCalled();
    },
  );

  it("rejects an unauthorized role without delegating to the use case", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await ajustarInventarioAction(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(NO_AUTORIZADO);
    expect(ajustarInventario).not.toHaveBeenCalled();
  });

  it("rejects a missing session with SESION_INVALIDA", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await ajustarInventarioAction(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(SESION_INVALIDA);
    expect(ajustarInventario).not.toHaveBeenCalled();
  });

  it("rejects a malformed DTO with VALIDATION_ERROR before any DB work", async () => {
    const result = await ajustarInventarioAction({
      productoId: 0,
      cantidad: "5",
      motivo: "x",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(VALIDATION_ERROR);
      expect(result.error.message).toBe(messageFor(VALIDATION_ERROR));
    }
    expect(ajustarInventario).not.toHaveBeenCalled();
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });

  it("maps a use-case business error to the ActionResult error", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (ajustarInventario as jest.Mock).mockResolvedValue({
      ok: false,
      code: STOCK_INSUFICIENTE,
      message: messageFor(STOCK_INSUFICIENTE),
    });

    const result = await ajustarInventarioAction({ ...validInput, cantidad: "-999" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(STOCK_INSUFICIENTE);
  });
});

describe("consultarInventarioAction", () => {
  it("authorizes against the view group and returns the use case data", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    const data = {
      items: [],
      total: 0,
      page: 1,
      limit: 25,
      resumen: { totalProductos: 0, bajoStock: 0, agotados: 0, valorInventario: "0.00" },
      categorias: [],
    };
    (consultarInventario as jest.Mock).mockResolvedValue({ ok: true, data });

    const result = await consultarInventarioAction({ page: 1, limit: 25 });

    expect(result).toEqual({ ok: true, data });
    expect(withTenantTransaction).toHaveBeenCalledTimes(1);
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ROLES_VER_INVENTARIO,
    );
  });

  it("treats cleared filter fields as no filter", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (consultarInventario as jest.Mock).mockResolvedValue({ ok: false, code: VALIDATION_ERROR, message: "x" });

    await consultarInventarioAction({ busqueda: "", categoriaId: "", estado: "" });

    expect(consultarInventario).toHaveBeenCalledWith(expect.anything(), mockCtx, {
      page: 1,
      limit: 25,
      busqueda: undefined,
      categoriaId: undefined,
      estado: undefined,
    });
  });

  it("rejects a category id beyond the database integer range with VALIDATION_ERROR", async () => {
    const result = await consultarInventarioAction({ categoriaId: 3000000000 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VALIDATION_ERROR);
    expect(consultarInventario).not.toHaveBeenCalled();
  });

  it("rejects an unknown status filter with VALIDATION_ERROR before any session read", async () => {
    const result = await consultarInventarioAction({ estado: "roto" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VALIDATION_ERROR);
    expect(consultarInventario).not.toHaveBeenCalled();
  });

  it("rejects a role outside the view group without delegating", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await consultarInventarioAction({ page: 1, limit: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(NO_AUTORIZADO);
    expect(consultarInventario).not.toHaveBeenCalled();
  });

  it("rejects a missing session with SESION_INVALIDA", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await consultarInventarioAction({ page: 1, limit: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(SESION_INVALIDA);
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });
});

describe("obtenerPermisosInventarioAction", () => {
  it("says puedeAjustar=true when the caller is in the manage group", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);

    const result = await obtenerPermisosInventarioAction();

    expect(result).toEqual({ ok: true, data: { puedeAjustar: true } });
    expect(withTenantTransaction).toHaveBeenCalledTimes(1);
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ROLES_GESTION_INVENTARIO,
    );
  });

  it("says puedeAjustar=false (not an error) when the caller is outside the manage group", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await obtenerPermisosInventarioAction();

    expect(result).toEqual({ ok: true, data: { puedeAjustar: false } });
  });

  it("rejects a missing session with SESION_INVALIDA before opening a tx", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await obtenerPermisosInventarioAction();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(SESION_INVALIDA);
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });
});

describe("listarMovimientosInventarioAction", () => {
  const DATA = {
    items: [],
    total: 0,
    page: 1,
    limit: 25,
    desde: "2026-10-16",
    hasta: "2026-11-14",
  };

  // The role check answers from the group the action passes, like the real repository does.
  function rolActual(nombre: string) {
    (tieneRolPermitidoEnTx as jest.Mock).mockImplementation(
      async (_tx: unknown, _u: number, _e: number, grupo: readonly string[]) => grupo.includes(nombre),
    );
  }

  it("lists for the manage group (Administrador) inside the tenant transaction", async () => {
    mockSession();
    rolActual("Administrador");
    (listarMovimientosInventario as jest.Mock).mockResolvedValue({ ok: true, data: DATA });

    const result = await listarMovimientosInventarioAction({ page: 1, limit: 25, tipo: "AJUSTE" });

    expect(result).toEqual({ ok: true, data: DATA });
    expect(withTenantTransaction).toHaveBeenCalledTimes(1);
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(expect.anything(), 1, 1, ROLES_GESTION_INVENTARIO);
    expect(listarMovimientosInventario).toHaveBeenCalledWith(expect.anything(), mockCtx, {
      page: 1,
      limit: 25,
      tipo: "AJUSTE",
    });
  });

  it.each(["Operador", "Despachador"])(
    "%s gets NO_AUTORIZADO and the use case / repository are never called",
    async (rol) => {
      mockSession();
      rolActual(rol);

      const result = await listarMovimientosInventarioAction({ page: 1, limit: 25 });

      expect(result).toEqual({
        ok: false,
        error: { code: NO_AUTORIZADO, message: expect.any(String) },
      });
      expect(listarMovimientosInventario).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid input with VALIDATION_ERROR before touching the session", async () => {
    const result = await listarMovimientosInventarioAction({ limit: 500 });

    expect(result).toEqual({
      ok: false,
      error: { code: VALIDATION_ERROR, message: messageFor(VALIDATION_ERROR) },
    });
    expect(getCurrentTenantContext).not.toHaveBeenCalled();
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });

  it("rejects a missing session with SESION_INVALIDA before opening a tx", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await listarMovimientosInventarioAction({});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(SESION_INVALIDA);
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });

  it("passes the typed range error through with its stable code", async () => {
    mockSession();
    rolActual("Administrador");
    (listarMovimientosInventario as jest.Mock).mockResolvedValue({
      ok: false,
      code: RANGO_FECHAS_EXCEDIDO,
      message: messageFor(RANGO_FECHAS_EXCEDIDO),
    });

    const result = await listarMovimientosInventarioAction({ desde: "2026-01-01", hasta: "2026-11-01" });

    expect(result).toEqual({
      ok: false,
      error: { code: RANGO_FECHAS_EXCEDIDO, message: messageFor(RANGO_FECHAS_EXCEDIDO) },
    });
  });
});
