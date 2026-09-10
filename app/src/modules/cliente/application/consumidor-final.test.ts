import { Decimal } from "decimal.js";
import { getOrCreateConsumidorFinalEnTx } from "./consumidor-final";
import {
  consumidorFinalEnEmpresa,
  crearConsumidorFinalEnTx,
} from "../infrastructure/cliente-repository";
import {
  CLIENTE_IDENTIFICACION_DUPLICADA,
  ClienteDomainError,
} from "../domain/errors";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/cliente-repository", () => ({
  consumidorFinalEnEmpresa: jest.fn(),
  crearConsumidorFinalEnTx: jest.fn(),
}));

const tx = {} as unknown as PrismaTx;

function makeCF(id: number) {
  return {
    id,
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
  };
}

describe("getOrCreateConsumidorFinalEnTx (reserved 5b seam)", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns the existing CF row WITHOUT inserting when found", async () => {
    (consumidorFinalEnEmpresa as jest.Mock).mockResolvedValue(makeCF(10));
    const result = await getOrCreateConsumidorFinalEnTx(tx, 1);
    expect(result.id).toBe(10);
    expect(crearConsumidorFinalEnTx).not.toHaveBeenCalled();
  });

  it("inserts when absent and returns the newly created row", async () => {
    (consumidorFinalEnEmpresa as jest.Mock).mockResolvedValueOnce(null);
    (crearConsumidorFinalEnTx as jest.Mock).mockResolvedValue(makeCF(11));
    const result = await getOrCreateConsumidorFinalEnTx(tx, 1);
    expect(result.id).toBe(11);
    expect(crearConsumidorFinalEnTx).toHaveBeenCalledWith(tx, 1);
  });

  it("CLIENTE-R2-RACE: concurrent insert (P2002/duplicate) refetches the winner", async () => {
    (consumidorFinalEnEmpresa as jest.Mock)
      .mockResolvedValueOnce(null) // first fetch: miss
      .mockResolvedValueOnce(makeCF(12)); // refetch: the racer's row
    (crearConsumidorFinalEnTx as jest.Mock).mockRejectedValue(
      new ClienteDomainError(CLIENTE_IDENTIFICACION_DUPLICADA),
    );

    const result = await getOrCreateConsumidorFinalEnTx(tx, 1);
    expect(result.id).toBe(12);
    expect(crearConsumidorFinalEnTx).toHaveBeenCalledTimes(1);
  });

  it("re-throws a non-duplicate domain error rather than swallowing it", async () => {
    (consumidorFinalEnEmpresa as jest.Mock).mockResolvedValueOnce(null);
    (crearConsumidorFinalEnTx as jest.Mock).mockRejectedValue(
      new ClienteDomainError("IDENTIFICACION_FISCAL_INVALIDA"),
    );
    await expect(getOrCreateConsumidorFinalEnTx(tx, 1)).rejects.toBeInstanceOf(
      ClienteDomainError,
    );
  });
});
