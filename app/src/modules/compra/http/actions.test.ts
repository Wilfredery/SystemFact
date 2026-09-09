/**
 * HTTP action unit tests (all collaborators mocked).
 *
 * Proves the thin adapter contract without a DB: input validation, session
 * resolution, SERVER-SIDE Administrador enforcement (the non-admin rejection
 * the spec requires), and the faithful pass-through of use-case typed results
 * into the {ok:false,error} ActionResult envelope. Mocking the application and
 * repository modules keeps the generated Prisma client out of this suite.
 */

import {
  crearCompraAction,
  confirmarCompraAction,
  cancelarCompraAction,
} from "./actions";
import { crearCompra } from "../application/crear-compra";
import { confirmarCompra } from "../application/confirmar-compra";
import { cancelarCompra } from "../application/cancelar-compra";
import { tieneRolPermitidoEnTx } from "../infrastructure/compra-repository";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";

jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));
jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
}));
jest.mock("@/modules/tenant/infrastructure/withTenantTransaction", () => ({
  withTenantTransaction: jest.fn((_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn({})),
}));
jest.mock("../application/crear-compra", () => ({ crearCompra: jest.fn() }));
jest.mock("../application/confirmar-compra", () => ({ confirmarCompra: jest.fn() }));
jest.mock("../application/cancelar-compra", () => ({ cancelarCompra: jest.fn() }));
jest.mock("../infrastructure/compra-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));

const ctx = { empresaId: 1, sucursalId: 1, usuarioId: 1, esAdmin: false };

const validaCrear = {
  proveedorId: 5,
  tipoCompra: "MERCANCIA",
  fecha: "2026-01-10T00:00:00.000Z",
  lineas: [{ productoId: 10, cantidad: "1.000", costoUnitario: "100.00" }],
};

beforeEach(() => {
  jest.clearAllMocks();
  (createClient as jest.Mock).mockResolvedValue({});
  (getCurrentTenantContext as jest.Mock).mockResolvedValue(ctx);
});

describe("crearCompraAction", () => {
  it("rejects invalid input before touching the session", async () => {
    const result = await crearCompraAction({ proveedorId: 0 });
    expect(result).toEqual({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.any(String) },
    });
    expect(getCurrentTenantContext).not.toHaveBeenCalled();
  });

  it("rejects when the session is missing", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);
    const result = await crearCompraAction(validaCrear);
    expect(result.ok === false && result.error.code).toBe("SESION_INVALIDA");
  });

  it("rejects a NON-admin server-side with NO use-case call", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);
    const result = await crearCompraAction(validaCrear);
    expect(result.ok === false && result.error.code).toBe("NO_AUTORIZADO");
    expect(crearCompra).not.toHaveBeenCalled();
  });

  it("delegates for an admin and returns the use-case data", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (crearCompra as jest.Mock).mockResolvedValue({
      ok: true,
      data: { id: 7, estado: "BORRADOR", correlativoInterno: "", total: "118.00" },
    });
    const result = await crearCompraAction(validaCrear);
    expect(result).toEqual({
      ok: true,
      data: { id: 7, estado: "BORRADOR", correlativoInterno: "", total: "118.00" },
    });
  });

  it("passes through a typed business error from the use case", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (crearCompra as jest.Mock).mockResolvedValue({
      ok: false,
      code: "NFC_DUPLICADO",
      message: "dup",
    });
    const result = await crearCompraAction(validaCrear);
    expect(result.ok === false && result.error.code).toBe("NFC_DUPLICADO");
  });
});

describe("confirmarCompraAction", () => {
  it("enforces admin and forwards CONFIG_RETENCION_FALTANTE", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (confirmarCompra as jest.Mock).mockResolvedValue({
      ok: false,
      code: "CONFIG_RETENCION_FALTANTE",
      message: "falta config",
    });
    const result = await confirmarCompraAction({ id: 7 });
    expect(result.ok === false && result.error.code).toBe("CONFIG_RETENCION_FALTANTE");
  });
});

describe("cancelarCompraAction", () => {
  it("rejects a missing motivo at the transport boundary", async () => {
    const result = await cancelarCompraAction({ id: 7 });
    expect(result.ok === false && result.error.code).toBe("VALIDATION_ERROR");
    expect(cancelarCompra).not.toHaveBeenCalled();
  });

  it("delegates a valid cancel for an admin", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (cancelarCompra as jest.Mock).mockResolvedValue({
      ok: true,
      data: { id: 7, estado: "CANCELADA" },
    });
    const result = await cancelarCompraAction({ id: 7, motivo: "error" });
    expect(result).toEqual({ ok: true, data: { id: 7, estado: "CANCELADA" } });
  });
});
