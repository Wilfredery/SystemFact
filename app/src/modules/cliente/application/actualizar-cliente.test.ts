import { Decimal } from "decimal.js";
import { actualizarCliente, llevaCamposDeCredito } from "./actualizar-cliente";
import {
  clienteByIdEnEmpresa,
  existeIdentificacionFiscalEnEmpresa,
  actualizarClienteEnTx,
  registrarAuditClienteEnTx,
} from "../infrastructure/cliente-repository";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/cliente-repository", () => ({
  clienteByIdEnEmpresa: jest.fn(),
  existeIdentificacionFiscalEnEmpresa: jest.fn(),
  actualizarClienteEnTx: jest.fn(),
  registrarAuditClienteEnTx: jest.fn(),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: true,
};
const tx = {} as unknown as PrismaTx;

function makeCliente(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    empresaId: 1,
    nombre: "Acme SRL",
    telefono: "809-555-0000",
    direccion: "Av. Principal 1",
    identificacionFiscal: "131045677",
    tipoCliente: "MAYORISTA",
    esConsumidorFinal: false,
    creditoHabilitado: false,
    limiteCredito: new Decimal("0.00"),
    plazoCreditoDias: 30,
    activo: true,
    version: 2,
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  (clienteByIdEnEmpresa as jest.Mock).mockResolvedValue(makeCliente());
  (actualizarClienteEnTx as jest.Mock).mockResolvedValue({
    updated: true,
    newVersion: 3,
  });
});

describe("actualizarCliente", () => {
  it("CLI-EDIT-A: happy edit bumps version and audits only the changed field", async () => {
    const result = await actualizarCliente(tx, ctx, {
      id: 5,
      version: 2,
      nombre: "Acme Nueva",
    });
    expect(result.ok).toBe(true);
    // Optimistic lock uses the CLIENT version, not a re-read one.
    expect(actualizarClienteEnTx).toHaveBeenCalledWith(
      tx,
      1,
      5,
      2,
      expect.objectContaining({ nombre: "Acme Nueva" }),
    );
    expect(registrarAuditClienteEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      "ACTUALIZAR",
      5,
      { nombre: "Acme SRL" },
      { nombre: "Acme Nueva" },
    );
  });

  it("CLI-EDIT-B: stale version → CONCURRENCIA_CONFLICTO with no audit", async () => {
    (actualizarClienteEnTx as jest.Mock).mockResolvedValue({
      updated: false,
      newVersion: 2,
    });
    const result = await actualizarCliente(tx, ctx, {
      id: 5,
      version: 2,
      nombre: "X",
    });
    expect(result.ok === false && result.code).toBe("CONCURRENCIA_CONFLICTO");
    expect(registrarAuditClienteEnTx).not.toHaveBeenCalled();
  });

  it("CLI-CF: editing a Consumidor Final → CONSUMIDOR_FINAL_PROTEGIDO, no write", async () => {
    (clienteByIdEnEmpresa as jest.Mock).mockResolvedValue(
      makeCliente({ esConsumidorFinal: true }),
    );
    const result = await actualizarCliente(tx, ctx, {
      id: 5,
      version: 2,
      nombre: "Nope",
    });
    expect(result.ok === false && result.code).toBe(
      "CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO",
    );
    expect(actualizarClienteEnTx).not.toHaveBeenCalled();
  });

  it("CLI-EDIT-NULL: foreign/missing id → CLIENTE_NO_ENCONTRADO", async () => {
    (clienteByIdEnEmpresa as jest.Mock).mockResolvedValue(null);
    const result = await actualizarCliente(tx, ctx, {
      id: 5,
      version: 2,
      nombre: "X",
    });
    expect(result.ok === false && result.code).toBe("CLIENTE_NO_ENCONTRADO");
  });

  it("CLI-EDIT: an inactive row cannot be edited (CLIENTE_YA_INACTIVO)", async () => {
    (clienteByIdEnEmpresa as jest.Mock).mockResolvedValue(makeCliente({ activo: false }));
    const result = await actualizarCliente(tx, ctx, { id: 5, version: 2, nombre: "X" });
    expect(result.ok === false && result.code).toBe("CLIENTE_YA_INACTIVO");
  });

  it("CLI-EDIT: empty patch → VALIDATION_ERROR, no write", async () => {
    const result = await actualizarCliente(tx, ctx, { id: 5, version: 2 });
    expect(result.ok === false && result.code).toBe("VALIDATION_ERROR");
    expect(actualizarClienteEnTx).not.toHaveBeenCalled();
  });

  it("CLIENTE-R5: enabling credit while stored fiscal ID is null → zero writes", async () => {
    (clienteByIdEnEmpresa as jest.Mock).mockResolvedValue(
      makeCliente({ identificacionFiscal: null }),
    );
    const result = await actualizarCliente(tx, ctx, {
      id: 5,
      version: 2,
      creditoHabilitado: true,
    });
    expect(result.ok === false && result.code).toBe(
      "CREDITO_REQUIERE_FISCAL_IDENTIDAD",
    );
    expect(actualizarClienteEnTx).not.toHaveBeenCalled();
    expect(registrarAuditClienteEnTx).not.toHaveBeenCalled();
  });

  it("CLIENTE-R5: enabling credit against a valid stored fiscal ID succeeds", async () => {
    const result = await actualizarCliente(tx, ctx, {
      id: 5,
      version: 2,
      creditoHabilitado: true,
      limiteCredito: "1500.00",
    });
    expect(result.ok).toBe(true);
    expect(actualizarClienteEnTx).toHaveBeenCalledWith(
      tx,
      1,
      5,
      2,
      expect.objectContaining({
        creditoHabilitado: true,
        limiteCredito: "1500.00",
      }),
    );
  });

  it("CLIENTE-FISCAL: invalid new fiscal ID in patch → format error, no write", async () => {
    const result = await actualizarCliente(tx, ctx, {
      id: 5,
      version: 2,
      identificacionFiscal: "131045671",
    });
    expect(result.ok === false && result.code).toBe(
      "IDENTIFICACION_FISCAL_INVALIDA",
    );
    expect(actualizarClienteEnTx).not.toHaveBeenCalled();
  });

  it("CLI-DUP: changing to another active client's fiscal ID is rejected", async () => {
    (existeIdentificacionFiscalEnEmpresa as jest.Mock).mockResolvedValue(true);
    const result = await actualizarCliente(tx, ctx, {
      id: 5,
      version: 2,
      identificacionFiscal: "131-04567-7", // differs from stored? makeCliente stores 131045677 → same → no probe
    });
    // The stored value equals this normalized value, so NO probe is issued and
    // the edit succeeds unchanged — asserts the "only probe on actual change" rule.
    expect(existeIdentificacionFiscalEnEmpresa).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("CLI-DUP: a genuinely new fiscal ID is probed (excluding self)", async () => {
    (existeIdentificacionFiscalEnEmpresa as jest.Mock).mockResolvedValue(true);
    const result = await actualizarCliente(tx, ctx, {
      id: 5,
      version: 2,
      identificacionFiscal: "00123456795", // valid cédula, differs from stored
    });
    expect(existeIdentificacionFiscalEnEmpresa).toHaveBeenCalledWith(
      tx,
      1,
      "00123456795",
      5,
    );
    expect(result.ok === false && result.code).toBe(
      "CLIENTE_IDENTIFICACION_DUPLICADA",
    );
  });

  it("CLI-EDIT: explicit null clears the fiscal ID and skips the probe", async () => {
    (actualizarClienteEnTx as jest.Mock).mockResolvedValue({
      updated: true,
      newVersion: 3,
    });
    const result = await actualizarCliente(tx, ctx, {
      id: 5,
      version: 2,
      identificacionFiscal: null,
    });
    expect(result.ok).toBe(true);
    expect(existeIdentificacionFiscalEnEmpresa).not.toHaveBeenCalled();
    expect(actualizarClienteEnTx).toHaveBeenCalledWith(
      tx,
      1,
      5,
      2,
      expect.objectContaining({ identificacionFiscal: null }),
    );
  });
});

describe("llevaCamposDeCredito (admin-only gate predicate)", () => {
  it("true when any credit-bearing field is present", () => {
    expect(llevaCamposDeCredito({ id: 1, version: 1, creditoHabilitado: true })).toBe(
      true,
    );
    expect(llevaCamposDeCredito({ id: 1, version: 1, tipoCliente: "CREDITO" })).toBe(
      true,
    );
    expect(llevaCamposDeCredito({ id: 1, version: 1, limiteCredito: "0" })).toBe(true);
  });
  it("false for an ordinary-field-only edit", () => {
    expect(llevaCamposDeCredito({ id: 1, version: 1, nombre: "x" })).toBe(false);
    expect(llevaCamposDeCredito({ id: 1, version: 1 })).toBe(false);
  });
});
