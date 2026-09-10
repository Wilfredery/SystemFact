import { Decimal } from "decimal.js";
import { obtenerCliente } from "./obtener-cliente";
import { clienteByIdEnEmpresa } from "../infrastructure/cliente-repository";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/cliente-repository", () => ({
  clienteByIdEnEmpresa: jest.fn(),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: true,
};
const tx = {} as unknown as PrismaTx;

describe("obtenerCliente", () => {
  beforeEach(() => jest.resetAllMocks());

  it("CLI-GET-A: returns the tenant client when found", async () => {
    (clienteByIdEnEmpresa as jest.Mock).mockResolvedValue({
      id: 7,
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
    });

    const result = await obtenerCliente(tx, ctx, { id: 7 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe(7);
    // Tenant-scoped read: empresaId is always forwarded (R1).
    expect(clienteByIdEnEmpresa).toHaveBeenCalledWith(tx, 1, 7);
  });

  it("CLIENTE-R1-ISO: a foreign/unknown id (repo returns null) is CLIENTE_NO_ENCONTRADO", async () => {
    (clienteByIdEnEmpresa as jest.Mock).mockResolvedValue(null);
    const result = await obtenerCliente(tx, ctx, { id: 999 });
    expect(result.ok === false && result.code).toBe("CLIENTE_NO_ENCONTRADO");
  });

  it("CLI-CF: the Consumidor Final is hidden from operator detail (NO_ENCONTRADO)", async () => {
    (clienteByIdEnEmpresa as jest.Mock).mockResolvedValue({
      id: 20,
      empresaId: 1,
      nombre: "Consumidor Final",
      telefono: "N/A",
      direccion: "N/A",
      identificacionFiscal: null,
      tipoCliente: "MINORISTA",
      esConsumidorFinal: true,
      creditoHabilitado: false,
      limiteCredito: new Decimal("0.00"),
      plazoCreditoDias: 30,
      activo: true,
      version: 1,
    });
    const result = await obtenerCliente(tx, ctx, { id: 20 });
    expect(result.ok === false && result.code).toBe("CLIENTE_NO_ENCONTRADO");
  });
});
