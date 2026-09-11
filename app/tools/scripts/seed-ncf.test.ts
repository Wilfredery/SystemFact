/**
 * Unit — NCF range seed shape (spec R-N6, fase-5c tasks 4.1/4.2).
 *
 * No DB: the seed is pinned on a structural fake so the FROZEN CONTRACT is
 * deterministic — independent B01/B02 dev ranges that fit the `%08d`
 * composition (R-N2: every value ≤ 99_999_999, so the composed NCF is always
 * exactly 11 chars — NEVER a 9-digit range), `secuenciaActual = rangoInicio - 1`
 * ("nothing used yet" under the D7 last-used semantics), compound-upsert
 * idempotency that NEVER rewrites a live counter, and the fail-fast overlap
 * assertion that protects a real DGII-issued range from being clobbered.
 * The real-DB provisioning/idempotency/consume runs are proven in
 * `src/integration/seed-ncf.integration.test.ts`.
 */

import {
  seedNcfParaEmpresa,
  seedNcf,
  NCF_RANGOS_SEED,
  NCF_MAX_CONSECUTIVO,
  NCF_SEED_VIGENCIA,
} from "./seed-ncf";

jest.mock("@/generated/prisma/client", () => ({ PrismaClient: class {} }));
jest.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));

interface SecFila {
  rangoInicio: number;
  rangoFin: number;
  secuenciaActual: number;
  activa: boolean;
}

/** Fake client: `preexistentes` maps tipoNcf → the row the DB already holds. */
function makeFakeDb(preexistentes: Partial<Record<string, SecFila>> = {}) {
  const upserts: {
    where: { empresaId_tipoNcf: { empresaId: number; tipoNcf: string } };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }[] = [];
  const db = {
    ncfSecuencia: {
      findUnique: async ({
        where: { empresaId_tipoNcf: { tipoNcf } },
      }: {
        where: { empresaId_tipoNcf: { tipoNcf: string } };
      }) => {
        const fila = preexistentes[tipoNcf];
        return fila === undefined ? null : { id: 1, ...fila };
      },
      upsert: async (args: (typeof upserts)[number]) => {
        upserts.push(args);
        return { id: 1 };
      },
    },
    empresa: { findMany: async () => [{ id: 1 }, { id: 2 }] },
  };
  return { db: db as never, upserts };
}

describe("NCF seed plan (R-N6 + R-N2 consistency)", () => {
  it("provisions exactly B01 and B02 with independent, non-overlapping ranges", () => {
    const tipos = NCF_RANGOS_SEED.map((r) => r.tipoNcf);
    expect(tipos.sort()).toEqual(["B01", "B02"]);
    for (let i = 0; i < NCF_RANGOS_SEED.length; i++) {
      for (let j = i + 1; j < NCF_RANGOS_SEED.length; j++) {
        const a = NCF_RANGOS_SEED[i];
        const b = NCF_RANGOS_SEED[j];
        expect(a.rangoInicio > b.rangoFin || b.rangoInicio > a.rangoFin).toBe(
          true,
        );
      }
    }
  });

  it("every seeded value fits the frozen %08d composition — NO 9-digit ranges", () => {
    for (const r of NCF_RANGOS_SEED) {
      expect(r.rangoInicio).toBeGreaterThanOrEqual(1);
      expect(r.rangoFin).toBeLessThanOrEqual(NCF_MAX_CONSECUTIVO);
      expect(NCF_MAX_CONSECUTIVO).toBe(99_999_999);
    }
    // The dev ranges must stay inside the documented %08d-consistent style.
    expect(NCF_RANGOS_SEED.some((r) => r.rangoFin >= 100_000_000)).toBe(false);
  });

  it("validity covers the running year through its end (SD semantics)", () => {
    const anio = new Date().getUTCFullYear();
    expect(NCF_SEED_VIGENCIA.inicio.getUTCFullYear()).toBe(anio);
    expect(NCF_SEED_VIGENCIA.fin.getUTCFullYear()).toBe(anio);
    expect(NCF_SEED_VIGENCIA.fin.getUTCMonth()).toBe(11);
    expect(NCF_SEED_VIGENCIA.fin.getUTCDate()).toBe(31);
  });
});

describe("seedNcfParaEmpresa", () => {
  it("upserts one active row per tipo with secuenciaActual = rangoInicio - 1 (D7)", async () => {
    const { db, upserts } = makeFakeDb();
    await seedNcfParaEmpresa(db, 7);

    expect(upserts).toHaveLength(2);
    for (const up of upserts) {
      expect(up.where.empresaId_tipoNcf.empresaId).toBe(7);
      expect(["B01", "B02"]).toContain(up.where.empresaId_tipoNcf.tipoNcf);
      expect(up.create.activa).toBe(true);
      expect(up.create.secuenciaActual).toBe(
        (up.create.rangoInicio as number) - 1,
      );
    }
  });

  it("re-run on the canonical rows is idempotent and NEVER rewrites the live counter", async () => {
    const { db, upserts } = makeFakeDb({
      B01: { rangoInicio: 1, rangoFin: 100, secuenciaActual: 42, activa: true },
      B02: { rangoInicio: 101, rangoFin: 200, secuenciaActual: 101, activa: true },
    });
    await seedNcfParaEmpresa(db, 7);

    expect(upserts).toHaveLength(2);
    for (const up of upserts) {
      expect(up.update.secuenciaActual).toBeUndefined();
      expect(up.update.rangoInicio).toBeUndefined();
      expect(up.update.rangoFin).toBeUndefined();
      expect(up.update.activa).toBe(true);
    }
  });

  it("FAILS FAST when a same-key row holds a different (real DGII) range", async () => {
    const { db, upserts } = makeFakeDb({
      B01: {
        rangoInicio: 500000,
        rangoFin: 599999,
        secuenciaActual: 500001,
        activa: true,
      },
    });
    await expect(seedNcfParaEmpresa(db, 7)).rejects.toThrow(/overlap|superposi/i);
    // B02 never gets written — the whole seed aborts fail-fast.
    expect(upserts).toHaveLength(0);
  });
});

describe("seedNcf company-wide pass", () => {
  it("runs two upserts per empresa for every empresa by default", async () => {
    const { db, upserts } = makeFakeDb();
    const res = await seedNcf(db);
    expect(res.empresas).toBe(2);
    expect(upserts).toHaveLength(4);
  });

  it("targets a single empresa when one is given (CLI --empresa)", async () => {
    const { db, upserts } = makeFakeDb();
    const res = await seedNcf(db, 2);
    expect(res.empresas).toBe(1);
    expect(upserts).toHaveLength(2);
    expect(upserts.every((u) => u.where.empresaId_tipoNcf.empresaId === 2)).toBe(
      true,
    );
  });
});
