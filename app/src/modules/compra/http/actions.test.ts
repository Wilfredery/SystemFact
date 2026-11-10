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
  actualizarCompraAction,
  confirmarCompraAction,
  cancelarCompraAction,
  recibirCompraAction,
  listarComprasAction,
  obtenerCompraAction,
  obtenerPermisosCompraAction,
} from "./actions";
import {
  ROLES_GESTION_COMPRAS,
  ROLES_VER_COMPRAS,
} from "./shared";
import { crearCompra } from "../application/crear-compra";
import { confirmarCompra } from "../application/confirmar-compra";
import { cancelarCompra } from "../application/cancelar-compra";
import { recibirCompra } from "../application/recibir-compra";
import { actualizarCompra } from "../application/actualizar-compra";
import { listarCompras } from "../application/listar-compras";
import { obtenerCompra } from "../application/obtener-compra";
import { tieneRolPermitidoEnTx } from "../infrastructure/compra-repository";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { CompraDomainError } from "../domain/errors";

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
jest.mock("../application/recibir-compra", () => ({ recibirCompra: jest.fn() }));
jest.mock("../application/actualizar-compra", () => ({ actualizarCompra: jest.fn() }));
jest.mock("../application/listar-compras", () => ({ listarCompras: jest.fn() }));
jest.mock("../application/obtener-compra", () => ({ obtenerCompra: jest.fn() }));
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

describe("recibirCompraAction", () => {
  it("rejects a non-positive id at the transport boundary before the session", async () => {
    const result = await recibirCompraAction({ id: 0 });
    expect(result.ok === false && result.error.code).toBe("VALIDATION_ERROR");
    expect(getCurrentTenantContext).not.toHaveBeenCalled();
    expect(recibirCompra).not.toHaveBeenCalled();
  });

  it("rejects a NON-admin server-side with NO use-case call", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);
    const result = await recibirCompraAction({ id: 7 });
    expect(result.ok === false && result.error.code).toBe("NO_AUTORIZADO");
    expect(recibirCompra).not.toHaveBeenCalled();
  });

  it("delegates a valid receive for an admin and returns the use-case data", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (recibirCompra as jest.Mock).mockResolvedValue({
      ok: true,
      data: { id: 7, estado: "RECIBIDA", movimientosAplicados: 2 },
    });
    const result = await recibirCompraAction({ id: 7 });
    expect(result).toEqual({
      ok: true,
      data: { id: 7, estado: "RECIBIDA", movimientosAplicados: 2 },
    });
  });

  it("passes through a typed branch/state error from the use case", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (recibirCompra as jest.Mock).mockResolvedValue({
      ok: false,
      code: "COMPRA_SUCURSAL_INVALIDA",
      message: "otra sucursal",
    });
    const result = await recibirCompraAction({ id: 7 });
    expect(result.ok === false && result.error.code).toBe("COMPRA_SUCURSAL_INVALIDA");
  });

  it("maps a THROWN CompraDomainError (post-flip inventario rollback) to a typed result", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (recibirCompra as jest.Mock).mockRejectedValue(
      new CompraDomainError("INVENTARIO_ENTRADA_RECHAZADA", { compraId: 7 }),
    );
    // The transaction rolled back (throw), and the action surfaces a stable
    // business error rather than an unhandled rejection.
    const result = await recibirCompraAction({ id: 7 });
    expect(result.ok === false && result.error.code).toBe("INVENTARIO_ENTRADA_RECHAZADA");
  });
});

/**
 * S3 — one named group per capability. Reads gate on ROLES_VER_COMPRAS,
 * writes gate on ROLES_GESTION_COMPRAS; the screens never name a role.
 */
describe("role groups (S3)", () => {
  it("names the view and manage groups exactly as the spec does", () => {
    expect(ROLES_VER_COMPRAS).toEqual(["Administrador", "Operador", "Despachador"]);
    expect(ROLES_GESTION_COMPRAS).toEqual(["Administrador"]);
  });

  it("read actions check the VIEW group at the server", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (listarCompras as jest.Mock).mockResolvedValue({
      ok: true,
      data: { items: [], total: 0, page: 1 },
    });
    (obtenerCompra as jest.Mock).mockResolvedValue({
      ok: true,
      data: {
        id: 1,
        correlativoInterno: "CMP-000001",
        tipoCompra: "MERCANCIA",
        estado: "BORRADOR",
        ncf: null,
        tipoNcf: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        subtotal: "100.00",
        subtotalGravado: "100.00",
        subtotalExento: "0.00",
        itbis: "18.00",
        retencionIsr: "0.00",
        retencionItbis: "0.00",
        total: "118.00",
        proveedor: { id: 5, nombre: "Acme" },
        lineas: [],
      },
    });

    expect((await listarComprasAction({ page: 1 })).ok).toBe(true);
    expect((await obtenerCompraAction({ id: 1 })).ok).toBe(true);

    expect(tieneRolPermitidoEnTx).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      1,
      1,
      ["Administrador", "Operador", "Despachador"],
    );
    expect(tieneRolPermitidoEnTx).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      1,
      1,
      ["Administrador", "Operador", "Despachador"],
    );
  });

  it("write actions check the MANAGE group at the server", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (crearCompra as jest.Mock).mockResolvedValue({
      ok: true,
      data: { id: 7, estado: "BORRADOR", correlativoInterno: "", total: "118.00" },
    });
    (actualizarCompra as jest.Mock).mockResolvedValue({
      ok: true,
      data: { id: 7, total: "118.00" },
    });
    (confirmarCompra as jest.Mock).mockResolvedValue({
      ok: true,
      data: {
        id: 7,
        estado: "PENDIENTE",
        correlativoInterno: "CMP-000001",
        total: "118.00",
        retencionIsr: "0.00",
        retencionItbis: "0.00",
      },
    });
    (cancelarCompra as jest.Mock).mockResolvedValue({
      ok: true,
      data: { id: 7, estado: "CANCELADA" },
    });
    (recibirCompra as jest.Mock).mockResolvedValue({
      ok: true,
      data: { id: 7, estado: "RECIBIDA", movimientosAplicados: 1 },
    });

    await crearCompraAction(validaCrear);
    await actualizarCompraAction({
      id: 7,
      lineas: [{ productoId: 10, cantidad: "1.000", costoUnitario: "100.00" }],
    });
    await confirmarCompraAction({ id: 7 });
    await cancelarCompraAction({ id: 7, motivo: "error" });
    await recibirCompraAction({ id: 7 });

    expect(tieneRolPermitidoEnTx).toHaveBeenCalledTimes(5);
    for (const call of (tieneRolPermitidoEnTx as jest.Mock).mock.calls) {
      expect(call[3]).toEqual(["Administrador"]);
    }
  });
});

describe("obtenerPermisosCompraAction (S7)", () => {
  it("reports the manage capability from the named group", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);

    const result = await obtenerPermisosCompraAction();

    expect(result).toEqual({ ok: true, data: { puedeGestionar: true } });
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ["Administrador"],
    );
  });

  it("a view-only caller gets puedeGestionar=false (deny-by-default)", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await obtenerPermisosCompraAction();

    expect(result).toEqual({ ok: true, data: { puedeGestionar: false } });
  });

  it("no session returns SESION_INVALIDA", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await obtenerPermisosCompraAction();

    expect(result.ok === false && result.error.code).toBe("SESION_INVALIDA");
  });
});

describe("listarComprasAction filters (S7)", () => {
  it("forwards estado, tipoCompra and trimmed proveedorBusqueda to the use case", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (listarCompras as jest.Mock).mockResolvedValue({
      ok: true,
      data: { items: [], total: 0, page: 2 },
    });

    const result = await listarComprasAction({
      page: 2,
      limit: 10,
      estado: "PENDIENTE",
      tipoCompra: "MERCANCIA",
      proveedorBusqueda: "  Acme  ",
    });

    expect(result).toEqual({ ok: true, data: { items: [], total: 0, page: 2 } });
    expect(listarCompras).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        page: 2,
        limit: 10,
        estado: "PENDIENTE",
        tipoCompra: "MERCANCIA",
        proveedorBusqueda: "Acme",
      }),
    );
  });

  it("rejects an unknown estado before touching the session", async () => {
    const result = await listarComprasAction({ estado: "PAGADA" });

    expect(result.ok === false && result.error.code).toBe("VALIDATION_ERROR");
    expect(getCurrentTenantContext).not.toHaveBeenCalled();
    expect(listarCompras).not.toHaveBeenCalled();
  });
});
