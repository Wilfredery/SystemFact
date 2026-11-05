const mockCreate = jest.fn();
const mockFindMany = jest.fn();
const mockDeleteMany = jest.fn();

// The Prisma accessor is replaced wholesale: this asserts the QUERY SHAPE the throttle
// depends on, and importing the real module would drag `@/lib/env` into the test.
jest.mock("@/lib/prisma", () => ({
  prisma: {
    loginIntento: {
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    },
  },
}));

import { almacenIntentosPrisma } from "./login-attempt-repository";

/**
 * The two properties these tests pin were both review findings against this slice, and
 * neither is visible from the domain policy — they live in the query.
 */
describe("login attempt repository — query shape", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("reads the NEWEST rows first, so truncation can never hide the latest attempt", async () => {
    // R3-listar-truncation-order: without an explicit order, `take: 500` may drop the newest
    // rows, `Math.max` then understates the last attempt and the delay collapses to zero —
    // exactly under the high-volume attack the throttle exists to stop.
    mockFindMany.mockResolvedValue([{ creadoEn: new Date(1_000) }]);
    const desde = new Date(0);

    await almacenIntentosPrisma.listar("203.0.113.7", "ana", desde);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ip: "203.0.113.7", nombreUsuarioNormalizado: "ana", creadoEn: { gte: desde } },
        orderBy: { creadoEn: "desc" },
      }),
    );
  });

  it("maps the rows to epoch milliseconds", async () => {
    mockFindMany.mockResolvedValue([{ creadoEn: new Date(1_000) }, { creadoEn: new Date(2_000) }]);

    await expect(almacenIntentosPrisma.listar("ip", "ana", new Date(0))).resolves.toEqual([
      1_000, 2_000,
    ]);
  });

  it("sweeps on the column that has its own index, never a compound prefix", async () => {
    // R1-002: the (ip, username, creadoEn) index cannot serve a predicate on creadoEn
    // alone, so this delete used to scan the whole table once per attempt.
    mockDeleteMany.mockResolvedValue({ count: 3 });
    const corte = new Date(500);

    await expect(almacenIntentosPrisma.barrer(corte)).resolves.toBe(3);

    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { creadoEn: { lt: corte } } });
  });

  it("returns the new row id so the caller can undo exactly that attempt", async () => {
    mockCreate.mockResolvedValue({ id: 42 });

    await expect(
      almacenIntentosPrisma.registrar("203.0.113.7", "ana", new Date(1)),
    ).resolves.toBe(42);
  });

  it("removes one attempt by id and the whole pair on success", async () => {
    mockDeleteMany.mockResolvedValue({ count: 1 });

    await almacenIntentosPrisma.descartar(42);
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { id: 42 } });

    await almacenIntentosPrisma.limpiar("203.0.113.7", "ana");
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { ip: "203.0.113.7", nombreUsuarioNormalizado: "ana" },
    });
  });
});
