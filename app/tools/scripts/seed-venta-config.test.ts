/**
 * Unit test — venta-config seed (task 2.13 "seed script unit").
 *
 * Asserts the seed's SHAPE without a DB (the real idempotency-on-re-run is proven
 * in the integration suite): the business default `DESC_MAX = 4.00` in the wide
 * canonical window, the demote-others + upsert-canonical idempotency strategy, and
 * that the per-empresa pass targets exactly the `DESC_MAX` key. This mirrors how
 * the retention seed's constants are the single source the fixtures align to.
 */

import {
  seedVentaConfigParaEmpresa,
  seedVentaConfig,
  DESC_MAX_SEED_VALOR,
  DESC_MAX_CLAVE,
  DESC_MAX_SEED_VIGENCIA,
} from "./seed-venta-config";

// The seed module imports the generated Prisma client + pg adapter at the top for
// its `main()` CLI path. In the CommonJS unit runner the generated client's
// `import.meta` cannot load, so stub both — `main()` never runs here (the
// process.argv guard excludes the Jest runner), and the exported seed functions
// operate purely on the caller-provided `db`.
jest.mock("@/generated/prisma/client", () => ({ PrismaClient: class {} }));
jest.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));

/** Minimal structural fake of the PrismaClient methods the seed calls. */
function makeFakeDb(empresas: number[]) {
  const calls: Record<string, unknown[]> = { updateMany: [], upsert: [] };
  const db = {
    $transaction: async (ops: unknown[]) => ops,
    empresa: { findMany: async () => empresas.map((id) => ({ id })) },
    configuracionEmpresa: {
      updateMany: async (args: unknown) => {
        calls.updateMany.push(args);
        return { count: 0 };
      },
      upsert: async (args: unknown) => {
        calls.upsert.push(args);
        return { id: 1 };
      },
    },
  };
  // Structural cast: the seed accepts a PrismaClient, the fake satisfies the used
  // surface only (no generated-client import needed in a pure unit).
  return { db: db as never, calls };
}

it("seeds the business default 4.00 for the DESC_MAX key in a wide window", async () => {
  expect(DESC_MAX_CLAVE).toBe("DESC_MAX");
  expect(DESC_MAX_SEED_VALOR).toBe("4.00");
  expect(DESC_MAX_SEED_VIGENCIA.inicio.getUTCFullYear()).toBe(2000);
  expect(DESC_MAX_SEED_VIGENCIA.fin.getUTCFullYear()).toBe(2099);

  const { db, calls } = makeFakeDb([]);
  await seedVentaConfigParaEmpresa(db, 42);

  // One demote + one upsert for the single key (idempotency strategy).
  expect(calls.updateMany).toHaveLength(1);
  expect(calls.upsert).toHaveLength(1);

  const upsert = calls.upsert[0] as {
    where: { empresaId_clave_vigenciaInicio: { empresaId: number; clave: string } };
    create: { valor: string; clave: string; activa: boolean };
  };
  expect(upsert.where.empresaId_clave_vigenciaInicio.empresaId).toBe(42);
  expect(upsert.where.empresaId_clave_vigenciaInicio.clave).toBe("DESC_MAX");
  expect(upsert.create.valor).toBe("4.00");
  expect(upsert.create.activa).toBe(true);
});

it("runs once per empresa on the company-wide pass", async () => {
  const { db } = makeFakeDb([1, 2, 3]);
  const res = await seedVentaConfig(db);
  expect(res.empresas).toBe(3);
});
