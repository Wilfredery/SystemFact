/**
 * Unit tests for the savepoint lifecycle primitives (`tenant/infrastructure`).
 * Pure: the fake transaction client records the raw commands, so no database is
 * touched. The 25P01 "no transaction block" self-probe is the load-bearing
 * branch (it lets the maintenance-seed path deactivate the guard cleanly).
 */

import {
  abrirSavepoint,
  esSinBloqueDeTransaccion,
  liberarSavepoint,
  revertarSavepoint,
} from "./savepoint";
import type { PrismaTx } from "./withTenantTransaction";

function fakeTx(fn: jest.Mock): PrismaTx {
  return { $executeRawUnsafe: fn } as unknown as PrismaTx;
}

const P2010_25P01 = Object.assign(
  new Error(
    "Invalid `prisma.$executeRawUnsafe()` invocation: Raw query failed. " +
      "Code: `25P01`. Message: `SAVEPOINT can only be used in transaction blocks`",
  ),
  { code: "P2010" },
);

describe("savepoint primitives", () => {
  it("abrirSavepoint returns true and issues SAVEPOINT when in a transaction", async () => {
    const fn = jest.fn().mockResolvedValue(1);
    await expect(abrirSavepoint(fakeTx(fn), "g")).resolves.toBe(true);
    expect(fn).toHaveBeenCalledWith("SAVEPOINT g");
  });

  it("abrirSavepoint returns false (guard off) on the 25P01 no-block error", async () => {
    const fn = jest.fn().mockRejectedValue(P2010_25P01);
    await expect(abrirSavepoint(fakeTx(fn), "g")).resolves.toBe(false);
  });

  it("abrirSavepoint re-throws any OTHER error (never hides a real failure)", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("connection reset"));
    await expect(abrirSavepoint(fakeTx(fn), "g")).rejects.toThrow("connection reset");
  });

  it("liberarSavepoint / revertarSavepoint issue the matching commands", async () => {
    const fn = jest.fn().mockResolvedValue(1);
    await liberarSavepoint(fakeTx(fn), "g");
    await revertarSavepoint(fakeTx(fn), "g");
    expect(fn.mock.calls.map((c) => c[0])).toEqual([
      "RELEASE SAVEPOINT g",
      "ROLLBACK TO SAVEPOINT g",
    ]);
  });

  it("rejects a non-identifier savepoint name (no raw-DDL injection surface)", async () => {
    const fn = jest.fn().mockResolvedValue(1);
    await expect(abrirSavepoint(fakeTx(fn), "a; DROP TABLE x--")).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it("esSinBloqueDeTransaccion: recognizes the SQLSTATE and the P2010 wording", () => {
    expect(esSinBloqueDeTransaccion(P2010_25P01)).toBe(true);
    expect(
      esSinBloqueDeTransaccion({ code: "P2010", meta: { message: "25P01" } }),
    ).toBe(true);
    expect(esSinBloqueDeTransaccion(new Error("unrelated"))).toBe(false);
  });
});
