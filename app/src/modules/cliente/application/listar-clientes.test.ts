import { Decimal } from "decimal.js";
import { listarClientes } from "./listar-clientes";
import {
  listarClientesEnEmpresa,
  contarClientesEnEmpresa,
} from "../infrastructure/cliente-repository";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/cliente-repository", () => ({
  listarClientesEnEmpresa: jest.fn(),
  contarClientesEnEmpresa: jest.fn(),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: true,
};
const tx = {} as unknown as PrismaTx;

function makeCliente(id: number) {
  return {
    id,
    empresaId: 1,
    nombre: `C${id}`,
    telefono: "x",
    direccion: "y",
    identificacionFiscal: null,
    tipoCliente: "MINORISTA",
    esConsumidorFinal: false,
    creditoHabilitado: false,
    limiteCredito: new Decimal("0.00"),
    plazoCreditoDias: 30,
    activo: true,
    version: 1,
  };
}

describe("listarClientes", () => {
  beforeEach(() => jest.resetAllMocks());

  it("CLI-LIST-A: returns items/total/page and queries are tenant-scoped", async () => {
    (listarClientesEnEmpresa as jest.Mock).mockResolvedValue([makeCliente(1)]);
    (contarClientesEnEmpresa as jest.Mock).mockResolvedValue(1);

    const result = await listarClientes(tx, ctx, { page: 1, limit: 25 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.total).toBe(1);
      expect(result.data.page).toBe(1);
      expect(result.data.items[0].id).toBe(1);
    }
    expect(listarClientesEnEmpresa).toHaveBeenCalledWith(tx, ctx, {
      page: 1,
      limit: 25,
    });
  });

  it("CLIENTE-R4: a page size above the 100 ceiling → VALIDATION_ERROR (no DB)", async () => {
    const result = await listarClientes(tx, ctx, { page: 1, limit: 500 });
    expect(result.ok === false && result.code).toBe("VALIDATION_ERROR");
    expect(listarClientesEnEmpresa).not.toHaveBeenCalled();
  });

  it("CLI-LIST-B: page < 1 → VALIDATION_ERROR", async () => {
    const result = await listarClientes(tx, ctx, { page: 0, limit: 25 });
    expect(result.ok === false && result.code).toBe("VALIDATION_ERROR");
  });

  it("CLI-LIST-C: CF is excluded by default (query has no incluirConsumidorFinal)", async () => {
    (listarClientesEnEmpresa as jest.Mock).mockResolvedValue([]);
    (contarClientesEnEmpresa as jest.Mock).mockResolvedValue(0);
    await listarClientes(tx, ctx, { page: 1, limit: 25, buscar: "acme" });
    const passed = (listarClientesEnEmpresa as jest.Mock).mock.calls[0][2];
    expect(passed.incluirConsumidorFinal).toBeUndefined();
    expect(passed.buscar).toBe("acme");
  });
});
