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

// A minimal fake transaction client. The seam drives its race guard through
// `tenant/infrastructure/savepoint` (which issues `$executeRawUnsafe`), so these
// tests assert the seam against the same raw command contract without a DB.
const executeRawUnsafe = jest.fn().mockResolvedValue(1);
const tx = { $executeRawUnsafe: executeRawUnsafe } as unknown as PrismaTx;

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
    // The refetch only works because the aborted-insert state was cleared via
    // the savepoint: guard the recovery ORDER (SAVEPOINT before the insert,
    // ROLLBACK TO before the refetch).
    const commands = executeRawUnsafe.mock.calls.map((c) => c[0]);
    expect(commands).toEqual([
      "SAVEPOINT sf_cf_race_guard",
      "ROLLBACK TO SAVEPOINT sf_cf_race_guard",
    ]);
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

  it("deactivates the savepoint guard on a top-level client (seed path: 25P01)", async () => {
    // The maintenance seed passes a plain PrismaClient (no open transaction):
    // SAVEPOINT fails with `25P01` ("can only be used in transaction blocks").
    // The guard must deactivate and the refetch run WITHOUT any ROLLBACK TO,
    // because a failed INSERT on a non-transactional client poisons nothing.
    const fueraDeTx = Object.assign(
      new Error(
        "Invalid `prisma.$executeRawUnsafe()` invocation: Raw query failed. " +
          "Code: `25P01`. Message: `SAVEPOINT can only be used in transaction blocks`",
      ),
      { name: "PrismaClientKnownRequestError", code: "P2010" },
    );
    const execute = jest
      .fn()
      .mockRejectedValueOnce(fueraDeTx) // SAVEPOINT probe fails
      .mockResolvedValue(1);
    const seedTx = { $executeRawUnsafe: execute } as unknown as PrismaTx;

    (consumidorFinalEnEmpresa as jest.Mock)
      .mockResolvedValueOnce(null) // first fetch: miss
      .mockResolvedValueOnce(makeCF(13)); // refetch: winner
    (crearConsumidorFinalEnTx as jest.Mock).mockRejectedValue(
      new ClienteDomainError(CLIENTE_IDENTIFICACION_DUPLICADA),
    );

    const result = await getOrCreateConsumidorFinalEnTx(seedTx, 1);
    expect(result.id).toBe(13);
    // Only the probe ran — no RELEASE/ROLLBACK on a client without a block.
    const commands = execute.mock.calls.map((c) => c[0]);
    expect(commands).toEqual(["SAVEPOINT sf_cf_race_guard"]);
  });
});
