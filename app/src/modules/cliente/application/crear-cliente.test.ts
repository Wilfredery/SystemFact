import { Decimal } from "decimal.js";
import { crearCliente } from "./crear-cliente";
import {
  existeIdentificacionFiscalEnEmpresa,
  crearClienteEnTx,
  registrarAuditClienteEnTx,
} from "../infrastructure/cliente-repository";
import {
  CLIENTE_IDENTIFICACION_DUPLICADA,
  IDENTIFICACION_FISCAL_INVALIDA,
  CREDITO_REQUIERE_FISCAL_IDENTIDAD,
  VALIDATION_ERROR,
  ClienteDomainError,
} from "../domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/cliente-repository", () => ({
  existeIdentificacionFiscalEnEmpresa: jest.fn(),
  crearClienteEnTx: jest.fn(),
  registrarAuditClienteEnTx: jest.fn(),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: true,
};

function makeTx(): PrismaTx {
  return {} as unknown as PrismaTx;
}

function makeCliente(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
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
    version: 1,
    ...overrides,
  };
}

const inputValido = {
  nombre: "Acme SRL",
  telefono: "809-555-0000",
  direccion: "Av. Principal 1",
  identificacionFiscal: "131-04567-7",
  tipoCliente: "MAYORISTA" as const,
};

describe("crearCliente", () => {
  beforeEach(() => jest.resetAllMocks());

  it("CLI-CREATE-A: creates active at version 1 with one CREAR audit", async () => {
    (existeIdentificacionFiscalEnEmpresa as jest.Mock).mockResolvedValue(false);
    (crearClienteEnTx as jest.Mock).mockResolvedValue(makeCliente());

    const result = await crearCliente(makeTx(), ctx, inputValido);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ id: 1, nombre: "Acme SRL", version: 1 });
    }
    expect(registrarAuditClienteEnTx).toHaveBeenCalledTimes(1);
    expect(registrarAuditClienteEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      "CREAR",
      1,
      null,
      expect.objectContaining({ id: 1, nombre: "Acme SRL" }),
    );
  });

  it("CLI-CREATE-B: applies R3 defaults when credit fields are omitted", async () => {
    (existeIdentificacionFiscalEnEmpresa as jest.Mock).mockResolvedValue(false);
    (crearClienteEnTx as jest.Mock).mockResolvedValue(makeCliente());

    await crearCliente(makeTx(), ctx, inputValido);

    // limite 0.00, plazo 30, credit off, never a CF row on operator create.
    expect(crearClienteEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({
        limiteCredito: "0.00",
        plazoCreditoDias: 30,
        creditoHabilitado: false,
        esConsumidorFinal: false,
      }),
    );
  });

  it("CLI-CREATE-C: stores the separator-stripped fiscal ID and probes it", async () => {
    (existeIdentificacionFiscalEnEmpresa as jest.Mock).mockResolvedValue(false);
    (crearClienteEnTx as jest.Mock).mockResolvedValue(makeCliente());

    await crearCliente(makeTx(), ctx, inputValido);

    expect(existeIdentificacionFiscalEnEmpresa).toHaveBeenCalledWith(
      expect.anything(),
      1,
      "131045677",
    );
    expect(crearClienteEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({ identificacionFiscal: "131045677" }),
    );
  });

  it("CLI-GET-NULL: a null/blank fiscal ID skips the duplicate probe", async () => {
    (crearClienteEnTx as jest.Mock).mockResolvedValue(
      makeCliente({ identificacionFiscal: null, tipoCliente: "MINORISTA" }),
    );

    const result = await crearCliente(makeTx(), ctx, {
      ...inputValido,
      identificacionFiscal: null,
      tipoCliente: "MINORISTA",
    });

    expect(result.ok).toBe(true);
    expect(existeIdentificacionFiscalEnEmpresa).not.toHaveBeenCalled();
  });

  it("CLI-CREATE-D: blank nombre → VALIDATION_ERROR with zero writes", async () => {
    const result = await crearCliente(makeTx(), ctx, {
      ...inputValido,
      nombre: "   ",
    });
    expect(result.ok === false && result.code).toBe(VALIDATION_ERROR);
    expect(crearClienteEnTx).not.toHaveBeenCalled();
    expect(registrarAuditClienteEnTx).not.toHaveBeenCalled();
  });

  it("CLIENTE-R-FISCAL: invalid check digit → IDENTIFICACION_FISCAL_INVALIDA, no write", async () => {
    const result = await crearCliente(makeTx(), ctx, {
      ...inputValido,
      identificacionFiscal: "131045671", // bad mod-11
    });
    expect(result.ok === false && result.code).toBe(IDENTIFICACION_FISCAL_INVALIDA);
    expect(crearClienteEnTx).not.toHaveBeenCalled();
  });

  it("CLIENTE-R5: credit without a valid fiscal ID → CREDITO_REQUIERE_FISCAL_IDENTIDAD, no write", async () => {
    const result = await crearCliente(makeTx(), ctx, {
      ...inputValido,
      identificacionFiscal: null,
      tipoCliente: "MINORISTA",
      creditoHabilitado: true,
    });
    expect(result.ok === false && result.code).toBe(CREDITO_REQUIERE_FISCAL_IDENTIDAD);
    expect(crearClienteEnTx).not.toHaveBeenCalled();
  });

  it("CLIENTE-R5: tipoCliente CREDITO (credit-bearing) forces a valid fiscal ID", async () => {
    const result = await crearCliente(makeTx(), ctx, {
      ...inputValido,
      identificacionFiscal: null,
      tipoCliente: "CREDITO",
    });
    expect(result.ok === false && result.code).toBe(CREDITO_REQUIERE_FISCAL_IDENTIDAD);
  });

  it("CLIENTE-R3: negative credit limit → VALIDATION_ERROR", async () => {
    const result = await crearCliente(makeTx(), ctx, {
      ...inputValido,
      identificacionFiscal: "131045677",
      limiteCredito: "-5",
    });
    expect(result.ok === false && result.code).toBe(VALIDATION_ERROR);
    expect(crearClienteEnTx).not.toHaveBeenCalled();
  });

  it("CLI-DUP: duplicate active fiscal ID rejected before insert", async () => {
    (existeIdentificacionFiscalEnEmpresa as jest.Mock).mockResolvedValue(true);
    const result = await crearCliente(makeTx(), ctx, inputValido);
    expect(result.ok === false && result.code).toBe(CLIENTE_IDENTIFICACION_DUPLICADA);
    expect(crearClienteEnTx).not.toHaveBeenCalled();
  });

  it("CLI-DUP-RACE: concurrent P2002 maps to the same code, no audit", async () => {
    (existeIdentificacionFiscalEnEmpresa as jest.Mock).mockResolvedValue(false);
    (crearClienteEnTx as jest.Mock).mockRejectedValue(
      new ClienteDomainError(CLIENTE_IDENTIFICACION_DUPLICADA),
    );
    const result = await crearCliente(makeTx(), ctx, inputValido);
    expect(result.ok === false && result.code).toBe(CLIENTE_IDENTIFICACION_DUPLICADA);
    expect(registrarAuditClienteEnTx).not.toHaveBeenCalled();
  });
});
