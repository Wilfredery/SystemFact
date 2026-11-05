const mockFindMany = jest.fn();
const mockCreate = jest.fn();
const mockDeleteManyTx = jest.fn();
const mockExecuteRaw = jest.fn();
const mockDeleteMany = jest.fn();
const mockTransaction = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    loginIntento: {
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    },
  },
}));

import { almacenIntentosPrisma } from "./login-attempt-repository";
import { ESPERA_BASE_MS, UMBRAL_INTENTOS } from "../domain/login-throttle";

const AHORA = 1_800_000_000_000;

/** The transaction client the repository receives; every probe is captured here. */
const tx = {
  $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
  loginIntento: {
    findMany: (...args: unknown[]) => mockFindMany(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    deleteMany: (...args: unknown[]) => mockDeleteManyTx(...args),
  },
};

describe("login attempt repository — the count and the insert are ONE decision", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (fn: any) => fn(tx));
    mockCreate.mockResolvedValue({ id: 41 });
    mockDeleteManyTx.mockResolvedValue({ count: 0 });
    mockExecuteRaw.mockResolvedValue(0);
  });

  it("takes a per-pair advisory lock as the first statement of the transaction", async () => {
    // R4-002: without this, two concurrent requests both read "4 attempts" and both proceed.
    mockFindMany.mockResolvedValue([]);

    await almacenIntentosPrisma.intentar("203.0.113.7", "ana", AHORA);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    const [plantilla, ...valores] = mockExecuteRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(String(plantilla)).toContain("pg_advisory_xact_lock");
    expect(String(plantilla)).toContain("hashtext");
    // The lock key is the PAIR, so different users or addresses never queue behind each other.
    expect(valores[0]).toBe("203.0.113.7|ana");
  });

  it("records the attempt when the pair is under the threshold", async () => {
    mockFindMany.mockResolvedValue([]);

    const resultado = await almacenIntentosPrisma.intentar("203.0.113.7", "ana", AHORA);

    expect(resultado).toEqual({ permitido: true, id: 41 });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ip: "203.0.113.7",
          nombreUsuarioNormalizado: "ana",
          creadoEn: new Date(AHORA),
        }),
      }),
    );
    // Newest-first, bounded window: the policy reads the delay off the most recent attempt.
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { creadoEn: "desc" }, take: 500 }),
    );
  });

  it("refuses WITHOUT inserting once the threshold is reached", async () => {
    const recientes = Array.from(
      { length: UMBRAL_INTENTOS },
      (_, i) => ({ creadoEn: new Date(AHORA - i * 1_000) }),
    );
    mockFindMany.mockResolvedValue(recientes);

    const resultado = await almacenIntentosPrisma.intentar("203.0.113.7", "ana", AHORA);

    expect(resultado).toEqual({ permitido: false, esperarMs: ESPERA_BASE_MS });
    // The refusal must not become an attempt: counting refusals would keep the pair blocked.
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("sweeps expired rows inside the same transaction", async () => {
    mockFindMany.mockResolvedValue([]);

    await almacenIntentosPrisma.intentar("203.0.113.7", "ana", AHORA);

    expect(mockDeleteManyTx).toHaveBeenCalledTimes(1);
    const where = (mockDeleteManyTx.mock.calls[0][0] as { where: { creadoEn: { lt: Date } } }).where;
    expect(where.creadoEn.lt.getTime()).toBeLessThan(AHORA);
  });

  it("undoes one attempt by id, and clears the whole pair on success", async () => {
    mockDeleteMany.mockResolvedValue({ count: 1 });

    await almacenIntentosPrisma.descartar(41);
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { id: 41 } });

    await almacenIntentosPrisma.limpiar("203.0.113.7", "ana");
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { ip: "203.0.113.7", nombreUsuarioNormalizado: "ana" },
    });
  });
});
