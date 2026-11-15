/**
 * Unit test — venta-config seed (task 2.13 "seed script unit"; extended by the
 * F5 audit v2r-11 remediation with the third key).
 *
 * Asserts the seed's SHAPE without a DB (the real idempotency-on-re-run is proven
 * in the integration suite): the business defaults `DESC_MAX = 4.00`,
 * `PLAZO_DEVOLUCION = 15` and `RETROACTIVO_FECHA_VENTA_DIAS = 7` in the wide
 * canonical window, the demote-others + upsert-canonical idempotency strategy,
 * and that the per-empresa pass targets ALL THREE keys. This mirrors how the
 * retention seed's constants are the single source the fixtures align to.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  seedVentaConfigParaEmpresa,
  seedVentaConfig,
  detectarVentanasSuperpuestas,
  DESC_MAX_SEED_VALOR,
  DESC_MAX_CLAVE,
  PLAZO_DEVOLUCION_SEED_VALOR,
  PLAZO_DEVOLUCION_CLAVE,
  RETROACTIVO_FECHA_VENTA_SEED_VALOR,
  RETROACTIVO_FECHA_VENTA_CLAVE,
  TASA_ITBIS_SEED_VALOR,
  TASA_ITBIS_CLAVE,
  CLAVE_SEED_VIGENCIA,
} from "./seed-venta-config";
import { TASAS_ITBIS_PERMITIDAS } from "@/shared/domain/tasas-itbis";

// The seed module imports the generated Prisma client + pg adapter at the top for
// its `main()` CLI path. In the CommonJS unit runner the generated client's
// `import.meta` cannot load, so stub both — `main()` never runs here (the
// process.argv guard excludes the Jest runner), and the exported seed functions
// operate purely on the caller-provided `db`.
jest.mock("@/generated/prisma/client", () => ({ PrismaClient: class {} }));
jest.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));

/** Structural fake of the PrismaClient methods the seed calls. */
function makeFakeDb(
  empresas: number[],
  activeRows: { vigenciaInicio: Date; vigenciaFin: Date }[] = [],
) {
  const calls: Record<string, unknown[]> = { updateMany: [], upsert: [] };
  const db = {
    $transaction: async (ops: unknown[]) => ops,
    empresa: { findMany: async () => empresas.map((id) => ({ id })) },
    configuracionEmpresa: {
      findMany: async () => activeRows,
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

it("seeds the business defaults for the DESC_MAX, PLAZO_DEVOLUCION and RETROACTIVO_FECHA_VENTA_DIAS keys in a wide window", async () => {
  expect(DESC_MAX_CLAVE).toBe("DESC_MAX");
  expect(DESC_MAX_SEED_VALOR).toBe("4.00");
  expect(PLAZO_DEVOLUCION_CLAVE).toBe("PLAZO_DEVOLUCION");
  expect(PLAZO_DEVOLUCION_SEED_VALOR).toBe("15");
  // F5 (audit v2r-11): the sale-date band ships as 7 calendar days.
  expect(RETROACTIVO_FECHA_VENTA_CLAVE).toBe("RETROACTIVO_FECHA_VENTA_DIAS");
  expect(RETROACTIVO_FECHA_VENTA_SEED_VALOR).toBe("7");
  // ITBIS rate list (odd/tasks/itbis-tasas-config.md S2, S5): exactly 18, 16 and 0,
  // default rate first, the same SET the shared domain constant allows today.
  expect(TASA_ITBIS_CLAVE).toBe("TASA_ITBIS");
  expect(TASA_ITBIS_SEED_VALOR).toBe("18,16,0");
  expect([...TASA_ITBIS_SEED_VALOR.split(",")].sort()).toEqual([...TASAS_ITBIS_PERMITIDAS].sort());
  expect(CLAVE_SEED_VIGENCIA.inicio.getUTCFullYear()).toBe(2000);
  expect(CLAVE_SEED_VIGENCIA.fin.getUTCFullYear()).toBe(2099);

  const { db, calls } = makeFakeDb([]);
  await seedVentaConfigParaEmpresa(db, 42);

  // One demote + one upsert PER KEY (idempotency strategy).
  expect(calls.updateMany).toHaveLength(4);
  expect(calls.upsert).toHaveLength(4);

  const upserts = calls.upsert as {
    where: { empresaId_clave_vigenciaInicio: { empresaId: number; clave: string } };
    create: { valor: string; clave: string; activa: boolean };
  }[];
  const claves = upserts.map((u) => u.where.empresaId_clave_vigenciaInicio.clave);
  expect(claves).toEqual([
    "DESC_MAX",
    "PLAZO_DEVOLUCION",
    "RETROACTIVO_FECHA_VENTA_DIAS",
    "TASA_ITBIS",
  ]);

  const descMax = upserts.find(
    (u) => u.where.empresaId_clave_vigenciaInicio.clave === "DESC_MAX",
  )!;
  expect(descMax.where.empresaId_clave_vigenciaInicio.empresaId).toBe(42);
  expect(descMax.create.valor).toBe("4.00");
  expect(descMax.create.activa).toBe(true);

  const plazo = upserts.find(
    (u) => u.where.empresaId_clave_vigenciaInicio.clave === "PLAZO_DEVOLUCION",
  )!;
  expect(plazo.where.empresaId_clave_vigenciaInicio.empresaId).toBe(42);
  expect(plazo.create.valor).toBe("15");
  expect(plazo.create.activa).toBe(true);

  const retroactivo = upserts.find(
    (u) => u.where.empresaId_clave_vigenciaInicio.clave === "RETROACTIVO_FECHA_VENTA_DIAS",
  )!;
  expect(retroactivo.where.empresaId_clave_vigenciaInicio.empresaId).toBe(42);
  expect(retroactivo.create.valor).toBe("7");
  expect(retroactivo.create.activa).toBe(true);

  const tasas = upserts.find(
    (u) => u.where.empresaId_clave_vigenciaInicio.clave === "TASA_ITBIS",
  )!;
  expect(tasas.where.empresaId_clave_vigenciaInicio.empresaId).toBe(42);
  expect(tasas.create.valor).toBe("18,16,0");
  expect(tasas.create.activa).toBe(true);
});

it("runs once per empresa on the company-wide pass", async () => {
  const { db } = makeFakeDb([1, 2, 3]);
  const res = await seedVentaConfig(db);
  expect(res.empresas).toBe(3);
});

// --- R-V17 (task 4.3): seed-time overlap assertion -------------------------

const W = (inicio: string, fin: string) => ({
  vigenciaInicio: new Date(inicio),
  vigenciaFin: new Date(fin),
});

describe("detectarVentanasSuperpuestas (R-V17 pure overlap probe)", () => {
  it("returns null for an empty or single-window set", () => {
    expect(detectarVentanasSuperpuestas([])).toBeNull();
    expect(detectarVentanasSuperpuestas([W("2000-01-01", "2005-12-31")])).toBeNull();
  });

  it("returns null for disjoint windows", () => {
    expect(
      detectarVentanasSuperpuestas([
        W("2000-01-01", "2005-12-31"),
        W("2006-01-01", "2010-12-31"),
      ]),
    ).toBeNull();
  });

  it("reports the first overlapping pair (inclusive boundaries)", () => {
    const filas = [
      W("2000-01-01", "2005-12-31"),
      W("2005-12-31", "2010-12-31"), // shares the boundary instant
    ];
    const conflicto = detectarVentanasSuperpuestas(filas);
    expect(conflicto).not.toBeNull();
    expect(conflicto!.a).toBe(filas[0]);
    expect(conflicto!.b).toBe(filas[1]);
  });
});

it("R-V17: seed FAILS FAST when two active non-canonical windows overlap (indeterminate state)", async () => {
  // Two stale-but-active overlapping windows are corrupted config the demote
  // step cannot repair unambiguously: the seed must throw, not silently pick.
  const { db } = makeFakeDb([], [
    W("2000-01-01", "2010-12-31"),
    W("2005-01-01", "2020-12-31"),
  ]);
  await expect(seedVentaConfigParaEmpresa(db, 42)).rejects.toThrow(/DESC_MAX/);
});

it("R-V17: a single overlapping stray still self-heals via demote + canonical upsert (R-C2 parity)", async () => {
  // Exactly one active non-canonical row (even overlapping the canonical
  // window): demote-others resolves it — no fail-fast, one demote + one upsert
  // per key.
  const { db, calls } = makeFakeDb([], [W("2001-01-01", "2099-01-01")]);
  await seedVentaConfigParaEmpresa(db, 42);
  expect(calls.updateMany).toHaveLength(4);
  expect(calls.upsert).toHaveLength(4);
});

// --- ITBIS rate list: the data migration and the seed must say the same thing ----

it("the TASA_ITBIS seed migration stores the same key and value as the seed and is idempotent", () => {
  const sql = readFileSync(
    join(process.cwd(), "prisma", "migrations", "20261115140000_seed_tasa_itbis", "migration.sql"),
    "utf8",
  );
  const codigo = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  expect(codigo).toContain(`'${TASA_ITBIS_CLAVE}', '${TASA_ITBIS_SEED_VALOR}'`);
  expect(codigo).toContain('ON CONFLICT ("empresaId", "clave", "vigenciaInicio") DO NOTHING');
  expect(codigo).toContain('FROM "EMPRESA"');
  // Never rewrites existing rows: no UPDATE or DELETE in the data migration.
  expect(codigo).not.toMatch(/\b(UPDATE|DELETE)\b/i);
});
