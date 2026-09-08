import {
  crearProveedorAction,
  listarProveedoresAction,
  actualizarProveedorAction,
  desactivarProveedorAction,
} from "./actions";
import { crearProveedor } from "../application/crear-proveedor";
import { listarProveedores } from "../application/listar-proveedores";
import { actualizarProveedor } from "../application/actualizar-proveedor";
import { desactivarProveedor } from "../application/desactivar-proveedor";
import { tieneRolPermitidoEnTx } from "../infrastructure/proveedor-repository";
import {
  RNC_PROVEEDOR_DUPLICADO,
  RNC_FORMATO_INVALIDO,
  PROVEEDOR_NO_ENCONTRADO,
  PROVEEDOR_TIENE_COMPRAS,
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  CONCURRENCIA_CONFLICTO,
  messageFor,
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

jest.mock("../application/crear-proveedor", () => ({
  crearProveedor: jest.fn(),
}));

jest.mock("../application/listar-proveedores", () => ({
  listarProveedores: jest.fn(),
}));

jest.mock("../application/actualizar-proveedor", () => ({
  actualizarProveedor: jest.fn(),
}));

jest.mock("../application/desactivar-proveedor", () => ({
  desactivarProveedor: jest.fn(),
}));

jest.mock("../infrastructure/proveedor-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";

const mockCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: false,
};

// resetAllMocks strips implementations, not just call history: the tenant
// wrapper and the Supabase client stub are re-armed before every test so the
// session-before-transaction convention stays observable end to end.
beforeEach(() => {
  jest.resetAllMocks();
  (createClient as jest.Mock).mockResolvedValue({});
  (withTenantTransaction as jest.Mock).mockImplementation(
    (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn({}),
  );
});

function mockSession() {
  (getCurrentTenantContext as jest.Mock).mockResolvedValue(mockCtx);
}

function makeProveedor(overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    empresaId: 1,
    nombre: "Distribuidora Norte",
    contacto: "Juan Pérez",
    telefono: "809-555-1212",
    rnc: "138000001",
    tipoProveedor: "FORMAL",
    tipoPersona: "JURIDICA",
    activo: true,
    version: 1,
    ...overrides,
  };
}

const crearInput = {
  nombre: "Distribuidora Norte",
  contacto: "Juan Pérez",
  telefono: "809-555-1212",
  rnc: "1-3800000-1",
  tipoProveedor: "FORMAL",
  tipoPersona: "JURIDICA",
};

describe("crearProveedorAction", () => {
  it("PRV-A-1: happy path returns the mapped supplier and wraps in tenant tx", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (crearProveedor as jest.Mock).mockResolvedValue({
      ok: true,
      data: makeProveedor(),
    });

    const result = await crearProveedorAction(crearInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ id: 4, nombre: "Distribuidora Norte", version: 1 });
    }
    expect(withTenantTransaction).toHaveBeenCalled();
    // CRUD is Administrador + Operador (role matrix).
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ["Administrador", "Operador"],
    );
  });

  it("PRV-A-2: invalid payload returns VALIDATION_ERROR without delegation", async () => {
    const result = await crearProveedorAction({ ...crearInput, nombre: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(VALIDATION_ERROR);
      // Catalog message, not the raw zod text.
      expect(result.error.message).toBe(messageFor(VALIDATION_ERROR));
    }
    expect(crearProveedor).not.toHaveBeenCalled();
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });

  it("PRV-A-2: unknown fiscal classification fails Zod", async () => {
    const result = await crearProveedorAction({
      ...crearInput,
      tipoProveedor: "SEMI-FORMAL",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VALIDATION_ERROR);
  });

  it("PRV-A-3: invalid session returns SESION_INVALIDA", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await crearProveedorAction(crearInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(SESION_INVALIDA);
    expect(crearProveedor).not.toHaveBeenCalled();
  });

  it("PRV-A-4: forbidden role returns NO_AUTORIZADO without delegating", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await crearProveedorAction(crearInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(NO_AUTORIZADO);
    expect(crearProveedor).not.toHaveBeenCalled();
  });

  it("PRV-A-5: use-case error is forwarded with its stable code", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (crearProveedor as jest.Mock).mockResolvedValue({
      ok: false,
      code: RNC_PROVEEDOR_DUPLICADO,
      message: messageFor(RNC_PROVEEDOR_DUPLICADO),
    });

    const result = await crearProveedorAction(crearInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(RNC_PROVEEDOR_DUPLICADO);
  });
});

describe("listarProveedoresAction", () => {
  it("PRV-A-1: happy path returns items/total/page with mapped rows", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (listarProveedores as jest.Mock).mockResolvedValue({
      ok: true,
      data: { items: [makeProveedor()], total: 1, page: 1 },
    });

    const result = await listarProveedoresAction({ page: 1, limit: 25 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.total).toBe(1);
      expect(result.data.items[0]).toEqual({
        id: 4,
        nombre: "Distribuidora Norte",
        contacto: "Juan Pérez",
        telefono: "809-555-1212",
        rnc: "138000001",
        tipoProveedor: "FORMAL",
        tipoPersona: "JURIDICA",
        activo: true,
      });
    }
    expect(withTenantTransaction).toHaveBeenCalled();
  });

  it("PRV-A-2: limit > 100 fails Zod before the use case", async () => {
    const result = await listarProveedoresAction({ page: 1, limit: 500 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VALIDATION_ERROR);
    expect(listarProveedores).not.toHaveBeenCalled();
  });

  it("PRV-A-4: listing needs Admin or Operador too", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await listarProveedoresAction({ page: 1, limit: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(NO_AUTORIZADO);
    expect(listarProveedores).not.toHaveBeenCalled();
  });
});

describe("actualizarProveedorAction", () => {
  const editInput = { id: 10, version: 2, nombre: "Distribuidora Sur" };

  it("PRV-A-1: happy path returns id and bumped version; client version forwarded", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (actualizarProveedor as jest.Mock).mockResolvedValue({
      ok: true,
      data: makeProveedor({ id: 10, nombre: "Distribuidora Sur", version: 3 }),
    });

    const result = await actualizarProveedorAction(editInput);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ id: 10, version: 3 });
    const passed = (actualizarProveedor as jest.Mock).mock.calls[0][2];
    expect(passed.version).toBe(2);
    expect(withTenantTransaction).toHaveBeenCalled();
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ["Administrador", "Operador"],
    );
  });

  it("PRV-A-5: stale version maps CONCURRENCIA_CONFLICTO", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (actualizarProveedor as jest.Mock).mockResolvedValue({
      ok: false,
      code: CONCURRENCIA_CONFLICTO,
      message: messageFor(CONCURRENCIA_CONFLICTO),
    });

    const result = await actualizarProveedorAction(editInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(CONCURRENCIA_CONFLICTO);
  });

  it("PRV-A-5: foreign-tenant id maps PROVEEDOR_NO_ENCONTRADO", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (actualizarProveedor as jest.Mock).mockResolvedValue({
      ok: false,
      code: PROVEEDOR_NO_ENCONTRADO,
      message: messageFor(PROVEEDOR_NO_ENCONTRADO),
    });

    const result = await actualizarProveedorAction(editInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(PROVEEDOR_NO_ENCONTRADO);
  });

  it("PRV-A-2: patch without editable fields fails Zod before any DB access", async () => {
    const result = await actualizarProveedorAction({ id: 10, version: 2 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VALIDATION_ERROR);
    expect(actualizarProveedor).not.toHaveBeenCalled();
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });
});

describe("desactivarProveedorAction", () => {
  it("PRV-A-1: happy path returns the deactivated id, Admin-only", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (desactivarProveedor as jest.Mock).mockResolvedValue({
      ok: true,
      data: { id: 10, nombre: "Distribuidora Norte" },
    });

    const result = await desactivarProveedorAction({ id: 10 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ id: 10 });
    // Deactivation is Administrador-only (role matrix).
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      1,
      ["Administrador"],
    );
    expect(withTenantTransaction).toHaveBeenCalled();
  });

  it("PRV-A-5: live purchase reference maps PROVEEDOR_TIENE_COMPRAS", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (desactivarProveedor as jest.Mock).mockResolvedValue({
      ok: false,
      code: PROVEEDOR_TIENE_COMPRAS,
      message: messageFor(PROVEEDOR_TIENE_COMPRAS),
    });

    const result = await desactivarProveedorAction({ id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(PROVEEDOR_TIENE_COMPRAS);
  });

  it("PRV-A-5: invalid RNC use-case error is forwarded unchanged", async () => {
    mockSession();
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (actualizarProveedor as jest.Mock).mockResolvedValue({
      ok: false,
      code: RNC_FORMATO_INVALIDO,
      message: messageFor(RNC_FORMATO_INVALIDO),
    });

    const result = await actualizarProveedorAction({ id: 1, version: 1, rnc: "12" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(RNC_FORMATO_INVALIDO);
  });

  it("PRV-A-2: invalid id fails before any DB access", async () => {
    const result = await desactivarProveedorAction({ id: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VALIDATION_ERROR);
    expect(desactivarProveedor).not.toHaveBeenCalled();
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });
});
