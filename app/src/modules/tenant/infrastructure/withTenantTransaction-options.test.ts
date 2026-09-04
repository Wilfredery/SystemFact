/**
 * Unit tests — opciones (timeout) y manejo de fallo de set_config en
 * withTenantTransaction.
 *
 * Cubre los escenarios de spec que el archivo de integración
 * `withTenantTransaction.test.ts` (tsx/Postgres real) no ejercita:
 *   - WTT-001-B: override de timeout a 5 s.
 *   - WTT-001-C: override de timeout a 30 s.
 *   - WTT-002-B: rechazo de set_config (fail-fast, `fn` no corre).
 *   - WTT-004-B: el error SQL de set_config se propaga intacto al caller.
 *
 * Usa mocks de `@/lib/prisma` y de `tenant-runtime` para no requerir Postgres
 * (determinista y rápido). El test de integración real vive en el archivo
 * `withTenantTransaction.test.ts` (corre vía `npx tsx`).
 */

import {
  withTenantTransaction,
  type PrismaTx,
} from "./withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { setTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
  },
}));

jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  setTenantContext: jest.fn().mockResolvedValue(undefined),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: false,
};

const tx = {} as unknown as PrismaTx;

function mockTransactionRuns() {
  // Replica el contrato de prisma.$transaction: se invoca con (callback, options)
  // y el callback recibe el tx. El wrapper llama setTenantContext(tx, ctx) y luego fn(tx).
  (prisma.$transaction as jest.Mock).mockImplementation(
    async (callback: (t: PrismaTx) => Promise<unknown>) => {
      await setTenantContext(tx as Parameters<typeof setTenantContext>[0], ctx);
      return callback(tx);
    },
  );
}
describe("withTenantTransaction — timeout override (WTT-001)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("WTT-001-B: propaga override de timeout a 5 s", async () => {
    mockTransactionRuns();
    const fn = jest.fn().mockResolvedValue("ok");

    await withTenantTransaction(ctx, fn, { timeoutMs: 5_000 });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ timeout: 5_000 }),
    );
    expect(fn).toHaveBeenCalledWith(tx);
    expect(await fn.mock.results[0].value).toBe("ok");
  });

  it("WTT-001-C: propaga override de timeout a 30 s", async () => {
    mockTransactionRuns();
    const fn = jest.fn().mockResolvedValue("ok");

    await withTenantTransaction(ctx, fn, { timeoutMs: 30_000 });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ timeout: 30_000 }),
    );
  });
});

describe("withTenantTransaction — set_config failure (WTT-002/004)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("WTT-002-B: setTenantContext falla y fn NUNCA se ejecuta (fail-fast)", async () => {
    mockTransactionRuns();
    (setTenantContext as jest.Mock).mockRejectedValueOnce(
      new Error('set_config: función "set_config(text, text, boolean)" no existe'),
    );
    const fn = jest.fn().mockResolvedValue("should not run");

    await expect(withTenantTransaction(ctx, fn)).rejects.toThrow(
      "set_config",
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it("WTT-004-B: el error SQL de set_config se propaga intacto al caller", async () => {
    mockTransactionRuns();
    const sqlError = new Error(
      'set_config: no existe el parámetro "app.current_empresa_id"',
    ) as Error & { code?: string };
    sqlError.code = "42704"; // undefined_object
    (setTenantContext as jest.Mock).mockRejectedValueOnce(sqlError);

    const caught = await withTenantTransaction(ctx, jest.fn()).catch(
      (e: unknown) => e,
    );

    expect(caught).toBe(sqlError);
    expect((caught as { code?: string }).code).toBe("42704");
  });
});
