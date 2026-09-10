import { Decimal } from "decimal.js";
import { desactivarCliente } from "./desactivar-cliente";
import {
  clienteByIdEnEmpresa,
  tieneVentasNoCanceladas,
  desactivarClienteEnTx,
  registrarAuditClienteEnTx,
} from "../infrastructure/cliente-repository";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/cliente-repository", () => ({
  clienteByIdEnEmpresa: jest.fn(),
  tieneVentasNoCanceladas: jest.fn(),
  desactivarClienteEnTx: jest.fn(),
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
    telefono: "x",
    direccion: "y",
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

beforeEach(() => {
  jest.resetAllMocks();
  (clienteByIdEnEmpresa as jest.Mock).mockResolvedValue(makeCliente());
  (tieneVentasNoCanceladas as jest.Mock).mockResolvedValue(false);
  (desactivarClienteEnTx as jest.Mock).mockResolvedValue({ deactivated: true });
});

describe("desactivarCliente", () => {
  it("CLI-DEACT-A: soft-deactivates and writes one CANCELAR audit (activo flip)", async () => {
    const result = await desactivarCliente(tx, ctx, { id: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ id: 5, nombre: "Acme SRL" });
    expect(desactivarClienteEnTx).toHaveBeenCalledWith(tx, 1, 5);
    expect(registrarAuditClienteEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      "CANCELAR",
      5,
      { activo: true },
      { activo: false },
      "cliente.desactivado",
    );
  });

  it("CLI-DEACT: missing id → CLIENTE_NO_ENCONTRADO", async () => {
    (clienteByIdEnEmpresa as jest.Mock).mockResolvedValue(null);
    const result = await desactivarCliente(tx, ctx, { id: 5 });
    expect(result.ok === false && result.code).toBe("CLIENTE_NO_ENCONTRADO");
  });

  it("CLI-CF: deactivating a Consumidor Final → CONSUMIDOR_FINAL_PROTEGIDO", async () => {
    (clienteByIdEnEmpresa as jest.Mock).mockResolvedValue(
      makeCliente({ esConsumidorFinal: true }),
    );
    const result = await desactivarCliente(tx, ctx, { id: 5 });
    expect(result.ok === false && result.code).toBe(
      "CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO",
    );
    expect(desactivarClienteEnTx).not.toHaveBeenCalled();
  });

  it("CLI-DEACT-IDEMPOTENT: already inactive → CLIENTE_YA_INACTIVO, no write", async () => {
    (clienteByIdEnEmpresa as jest.Mock).mockResolvedValue(makeCliente({ activo: false }));
    const result = await desactivarCliente(tx, ctx, { id: 5 });
    expect(result.ok === false && result.code).toBe("CLIENTE_YA_INACTIVO");
    expect(desactivarClienteEnTx).not.toHaveBeenCalled();
  });

  it("CLIENTE-R6: live (non-cancelled) sale reference blocks deactivation", async () => {
    (tieneVentasNoCanceladas as jest.Mock).mockResolvedValue(true);
    const result = await desactivarCliente(tx, ctx, { id: 5 });
    expect(result.ok === false && result.code).toBe("CLIENTE_TIENE_VENTAS");
    expect(desactivarClienteEnTx).not.toHaveBeenCalled();
    expect(registrarAuditClienteEnTx).not.toHaveBeenCalled();
  });

  it("CLI-DEACT-RACE: lost deactivate race collapses to CLIENTE_YA_INACTIVO", async () => {
    (desactivarClienteEnTx as jest.Mock).mockResolvedValue({ deactivated: false });
    const result = await desactivarCliente(tx, ctx, { id: 5 });
    expect(result.ok === false && result.code).toBe("CLIENTE_YA_INACTIVO");
    expect(registrarAuditClienteEnTx).not.toHaveBeenCalled();
  });
});
