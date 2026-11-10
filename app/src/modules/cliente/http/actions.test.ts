import { Decimal } from "decimal.js";
import {
  crearClienteAction,
  obtenerClienteAction,
  listarClientesAction,
  actualizarClienteAction,
  desactivarClienteAction,
  obtenerPermisosClienteAction,
} from "./actions";
import { crearCliente } from "../application/crear-cliente";
import { obtenerCliente } from "../application/obtener-cliente";
import { listarClientes } from "../application/listar-clientes";
import { actualizarCliente } from "../application/actualizar-cliente";
import { desactivarCliente } from "../application/desactivar-cliente";
import { tieneRolPermitidoEnTx } from "../infrastructure/cliente-repository";
import { messageFor, NO_AUTORIZADO, SESION_INVALIDA, VALIDATION_ERROR } from "../domain/errors";

jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));
jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
}));
jest.mock("@/modules/tenant/infrastructure/withTenantTransaction", () => ({
  withTenantTransaction: jest.fn(),
}));
jest.mock("../application/crear-cliente", () => {
  const actual = jest.requireActual("../application/crear-cliente");
  return {
    crearCliente: jest.fn(),
    llevaCreditoEnCreacion: actual.llevaCreditoEnCreacion,
  };
});
jest.mock("../application/obtener-cliente", () => ({ obtenerCliente: jest.fn() }));
jest.mock("../application/listar-clientes", () => ({ listarClientes: jest.fn() }));
jest.mock("../application/actualizar-cliente", () => {
  const actual = jest.requireActual("../application/actualizar-cliente");
  return {
    actualizarCliente: jest.fn(),
    llevaCamposDeCredito: actual.llevaCamposDeCredito,
  };
});
jest.mock("../application/desactivar-cliente", () => ({
  desactivarCliente: jest.fn(),
}));
jest.mock("../infrastructure/cliente-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";

const mockCtx = { empresaId: 1, sucursalId: 1, usuarioId: 1, esAdmin: false };

beforeEach(() => {
  jest.resetAllMocks();
  (createClient as jest.Mock).mockResolvedValue({});
  (withTenantTransaction as jest.Mock).mockImplementation(
    (_c: unknown, fn: (t: unknown) => Promise<unknown>) => fn({}),
  );
});

function mockSession() {
  (getCurrentTenantContext as jest.Mock).mockResolvedValue(mockCtx);
}

function makeCliente(overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    empresaId: 1,
    nombre: "Acme SRL",
    telefono: "809-555-0000",
    direccion: "Av. 1",
    identificacionFiscal: "131045677",
    tipoCliente: "MAYORISTA",
    esConsumidorFinal: false,
    creditoHabilitado: false,
    limiteCredito: new Decimal("0.00"),
    plazoCreditoDias: 30,
    activo: true,
    version: 1,
    ...overrides,
  };
}

const crearInput = {
  nombre: "Acme SRL",
  telefono: "809-555-0000",
  direccion: "Av. 1",
  identificacionFiscal: "131-04567-7",
  tipoCliente: "MAYORISTA",
};

describe("crearClienteAction", () => {
  it("happy path returns a Decimal-as-string DTO and requires the manage group", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (crearCliente as jest.Mock).mockResolvedValue({ ok: true, data: makeCliente() });

    const result = await crearClienteAction(crearInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Money crosses as a fixed-point string, never a float (AGENTS.md).
      expect(result.data.limiteCredito).toBe("0.00");
      expect(result.data.id).toBe(4);
    }
    // Clientes screen S3 (owner L9): Operador and Despachador are view-only,
    // so creating a client is Administrador-only. One-line group edit in
    // http/shared.ts when that changes.
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(), 1, 1, ["Administrador"],
    );
  });

  it("invalid payload → VALIDATION_ERROR before any DB access", async () => {
    const result = await crearClienteAction({ ...crearInput, nombre: "" });
    expect(result.ok === false && result.error.code).toBe(VALIDATION_ERROR);
    expect(crearCliente).not.toHaveBeenCalled();
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });

  it("null session → SESION_INVALIDA", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);
    const result = await crearClienteAction(crearInput);
    expect(result.ok === false && result.error.code).toBe(SESION_INVALIDA);
  });

  it("forbidden role → NO_AUTORIZADO without delegating", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);
    const result = await crearClienteAction(crearInput);
    expect(result.ok === false && result.error.code).toBe(NO_AUTORIZADO);
    expect(crearCliente).not.toHaveBeenCalled();
  });

  it("use-case error forwarded with stable code", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (crearCliente as jest.Mock).mockResolvedValue({
      ok: false, code: "CLIENTE_IDENTIFICACION_DUPLICADA",
      message: messageFor("CLIENTE_IDENTIFICACION_DUPLICADA"),
    });
    const result = await crearClienteAction(crearInput);
    expect(result.ok === false && result.error.code).toBe(
      "CLIENTE_IDENTIFICACION_DUPLICADA",
    );
  });
});

describe("actualizarClienteAction", () => {
  it("ordinary-field edit passes the CRUD gate and delegates to the use case", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (actualizarCliente as jest.Mock).mockResolvedValue({
      ok: true, data: makeCliente({ id: 5, version: 3 }),
    });
    const result = await actualizarClienteAction({ id: 5, version: 2, nombre: "Nuevo" });
    expect(result.ok).toBe(true);
    // Only ONE role check (CRUD): no credit fields carried.
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledTimes(1);
  });

  it("credit-field edit by a non-admin → NO_AUTORIZADO, use case NOT called", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock)
      .mockResolvedValueOnce(true) // CRUD gate passes (Operador)
      .mockResolvedValueOnce(false); // Admin-only credit gate fails
    const result = await actualizarClienteAction({
      id: 5, version: 2, creditoHabilitado: true,
    });
    expect(result.ok === false && result.error.code).toBe(NO_AUTORIZADO);
    expect(actualizarCliente).not.toHaveBeenCalled();
    // The admin-only gate is checked with ["Administrador"].
    expect(tieneRolPermitidoEnTx).toHaveBeenLastCalledWith(
      expect.anything(), 1, 1, ["Administrador"],
    );
  });

  it("credit-field edit by an admin → second gate passes and delegates", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (actualizarCliente as jest.Mock).mockResolvedValue({
      ok: true, data: makeCliente({ version: 3, creditoHabilitado: true }),
    });
    const result = await actualizarClienteAction({
      id: 5, version: 2, creditoHabilitado: true, limiteCredito: "500.00",
    });
    expect(result.ok).toBe(true);
    expect(actualizarCliente).toHaveBeenCalled();
  });

  it("empty patch fails Zod before the DB", async () => {
    const result = await actualizarClienteAction({ id: 5, version: 2 });
    expect(result.ok === false && result.error.code).toBe(VALIDATION_ERROR);
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });
});

describe("obtenerClienteAction", () => {
  it("returns the DTO on success", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (obtenerCliente as jest.Mock).mockResolvedValue({ ok: true, data: makeCliente() });
    const result = await obtenerClienteAction({ id: 4 });
    expect(result.ok === true && result.data.id).toBe(4);
  });
});

describe("listarClientesAction", () => {
  it("limit above 100 fails Zod before the use case", async () => {
    const result = await listarClientesAction({ page: 1, limit: 500 });
    expect(result.ok === false && result.error.code).toBe(VALIDATION_ERROR);
    expect(listarClientes).not.toHaveBeenCalled();
  });
  it("maps items to DTOs", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (listarClientes as jest.Mock).mockResolvedValue({
      ok: true, data: { items: [makeCliente()], total: 1, page: 1 },
    });
    const result = await listarClientesAction({ page: 1, limit: 25 });
    expect(result.ok === true && result.data.items[0].limiteCredito).toBe("0.00");
  });

  // F2 slice B task 2.3 (R-V27, DTO contract test ONLY — zero production change;
  // ClienteDto/toDto already ship the three credit fields per shared.ts:29-59).
  it("DTO row carries the credit profile with Decimal-string money and NO email/auth field (ADR-014)", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (listarClientes as jest.Mock).mockResolvedValue({
      ok: true,
      data: {
        items: [makeCliente({ creditoHabilitado: true, limiteCredito: new Decimal("20000.00"), plazoCreditoDias: 15 })],
        total: 1,
        page: 1,
      },
    });
    const result = await listarClientesAction({ page: 1, limit: 25 });
    if (!result.ok) throw new Error("expected ok");
    const row = result.data.items[0];
    expect(row.creditoHabilitado).toBe(true);
    expect(typeof row.limiteCredito).toBe("string"); // Decimal-string money, never a float
    expect(row.limiteCredito).toBe("20000.00");
    expect(row.plazoCreditoDias).toBe(15);
    // ADR-014: the access identifier is nombreUsuario/unique code — email is
    // NEVER a credential, so no email/auth-related field maps across the row.
    const keys = Object.keys(row);
    expect(keys).not.toContain("email");
    expect(keys.filter((k) => /mail|auth|password|usuario.*@|supabase/i.test(k))).toEqual([]);
  });
});

describe("desactivarClienteAction", () => {
  it("requires Administrador and returns the id", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (desactivarCliente as jest.Mock).mockResolvedValue({
      ok: true, data: { id: 9, nombre: "Acme" },
    });
    const result = await desactivarClienteAction({ id: 9 });
    expect(result.ok === true && result.data).toEqual({ id: 9 });
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(), 1, 1, ["Administrador"],
    );
  });
  it("non-admin → NO_AUTORIZADO", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);
    const result = await desactivarClienteAction({ id: 9 });
    expect(result.ok === false && result.error.code).toBe(NO_AUTORIZADO);
    expect(desactivarCliente).not.toHaveBeenCalled();
  });
});

describe("Cliente role seam (Clientes screen S3)", () => {
  it("the list is open to the view group, never to a literal role name", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (listarClientes as jest.Mock).mockResolvedValue({
      ok: true, data: { items: [makeCliente()], total: 1, page: 1, limit: 25 },
    });

    const result = await listarClientesAction({ page: 1, limit: 25 });

    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(), 1, 1, ["Administrador", "Operador", "Despachador"],
    );
    expect(result.ok).toBe(true);
  });

  it("reading one client uses the view group, not the manage group", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (obtenerCliente as jest.Mock).mockResolvedValue({ ok: true, data: makeCliente() });

    await obtenerClienteAction({ id: 4 });

    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(), 1, 1, ["Administrador", "Operador", "Despachador"],
    );
  });

  it("a credit-bearing creation by a non-admin → NO_AUTORIZADO with zero writes", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock)
      .mockResolvedValueOnce(true) // manage gate (a future wider group)
      .mockResolvedValueOnce(false); // credit gate

    const result = await crearClienteAction({ ...crearInput, creditoHabilitado: true });

    expect(result.ok === false && result.error.code).toBe(NO_AUTORIZADO);
    expect(crearCliente).not.toHaveBeenCalled();
    expect(tieneRolPermitidoEnTx).toHaveBeenLastCalledWith(
      expect.anything(), 1, 1, ["Administrador"],
    );
  });

  it("a plain creation by an admin needs no extra credit gate", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (crearCliente as jest.Mock).mockResolvedValue({ ok: true, data: makeCliente() });

    await crearClienteAction(crearInput);

    expect(tieneRolPermitidoEnTx).toHaveBeenCalledTimes(1);
  });
});

describe("obtenerPermisosClienteAction", () => {
  it("answers manage and credit visibility from the named role groups", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);

    const result = await obtenerPermisosClienteAction();

    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toEqual({ puedeGestionar: true, puedeVerCredito: true });
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(), 1, 1, ["Administrador"],
    );
  });

  it("view-only callers get neither manage nor credit visibility", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await obtenerPermisosClienteAction();

    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toEqual({ puedeGestionar: false, puedeVerCredito: false });
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledTimes(2);
  });

  it("no session → SESION_INVALIDA and no role query", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await obtenerPermisosClienteAction();

    expect(result.ok === false && result.error.code).toBe(SESION_INVALIDA);
    expect(tieneRolPermitidoEnTx).not.toHaveBeenCalled();
  });
});
