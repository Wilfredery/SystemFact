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
  ajustarInventarioAction,
} from "./actions";
import { listarInventario } from "../application/listar-inventario";
import { ajustarInventario } from "../application/ajustar-inventario";
import { tieneRolPermitidoEnTx } from "../infrastructure/inventario-repository";
import {
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  STOCK_INSUFICIENTE,
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

jest.mock("../application/ajustar-inventario", () => ({
  ajustarInventario: jest.fn(),
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
  const validInput = { productoId: 5, cantidad: "5", motivo: "Inventario físico" };

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
    // Adjusting stock is Admin + Operador (spec authorized roles).
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ["Administrador", "Operador"],
    );
  });

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
