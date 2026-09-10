/**
 * NCF range provisioning seed (spec R-N6, design D5 — fase-5c task 4.2).
 *
 * `pnpm seed:ncf` is the ONLY V1 provisioning path for `NCF_SECUENCIA`:
 * `consumirNcfEnTx` hard-fails `NCF_SEC_INEXISTENTE` without an active
 * `empresaId + tipoNcf` row, so no tenant can confirm a sale until this runs.
 * It provisions the two emitted invoice types (B01/B02) per empresa as
 * INDEPENDENT ranges (per AGENTS.md "independent sequences per type+company")
 * and is SAFE TO RE-RUN, mirroring `seed-venta-config.ts`.
 *
 * DEV-RANGE RECONCILIATION (fase-5c deviation 3): the earlier design/docs
 * example range `100000000–100000999` is 9 digits and contradicts the frozen
 * R-N2 composition `B<tipo 2d><%08d>` (11 chars total) — a secuencial above
 * `99_999_999` can never be composed. The authoritative rule is R-N2, so the
 * dev ranges below are `%08d`-consistent and DGII-plausible:
 *   B01 → 00000001–00000100, B02 → 00000101–00000200 (disjoint → independent).
 * Real DGII authorizations always live in `1..99_999_999` for the B-series;
 * this seed is a development/staging tool and MUST NOT be pointed at a tenant
 * holding a real authorized range (the fail-fast guard below refuses anyway).
 *
 * Fail-fast overlap assertion (R-N6 / task 4.1): `@@unique([empresaId,
 * tipoNcf])` means an existing row IS the same-key window. If it holds a
 * range DIFFERENT from the planned dev range, it is either a real DGII
 * authorization or corrupted config — both are indeterminate, so the seed
 * throws BEFORE writing anything instead of silently clobbering (never
 * rewinds or replaces `secuenciaActual` either: consumed NCFs stay consumed).
 *
 * Idempotency: compound upsert on `empresaId_tipoNcf`; the `update` branch
 * only refreshes vigencia/activa — the counter and the range are untouched.
 * `secuenciaActual = rangoInicio - 1` on create encodes "nothing used yet"
 * under the D7 LAST-USED semantics (first consume yields `rangoInicio`).
 *
 * Connection convention (parity with the other seeds): DIRECT_URL when
 * present (superuser — a company-wide maintenance pass has no single-tenant
 * RLS context), else DATABASE_URL. Optional `--empresa <id>` restricts the
 * pass to one company (dev onboarding); an unknown id fails loud.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/** Largest consecutive the frozen R-N2 `%08d` composition can encode. */
export const NCF_MAX_CONSECUTIVO = 99_999_999;

/** One planned dev range: which tipo and its inclusive numeric bounds. */
export interface RangoNcfSeed {
  readonly tipoNcf: "B01" | "B02";
  readonly rangoInicio: number;
  readonly rangoFin: number;
}

/**
 * The frozen provisioning plan. B01 is local-validation-only in V1 (design
 * D2/D6 — its eligibility requires a 9-digit RNC taxpayer client), but the
 * range is seeded so a taxpayer sale never dies on config. Ranges are
 * DISJOINT, hence independent counters with no numeric collision.
 */
export const NCF_RANGOS_SEED: readonly RangoNcfSeed[] = [
  { tipoNcf: "B01", rangoInicio: 1, rangoFin: 100 },
  { tipoNcf: "B02", rangoInicio: 101, rangoFin: 200 },
];

const anioEnCurso = new Date().getUTCFullYear();

/**
 * Validity through the end of the running year. The engine compares SD
 * CALENDAR days (R-N5, `esRangoVencidoSD`), so a `Dec 31 23:59:59Z` upper
 * bound resolves to Dec 31 in Santo Domingo and the range expires on the
 * first SD day of the next year — no manual hour arithmetic anywhere.
 */
export const NCF_SEED_VIGENCIA = {
  inicio: new Date(Date.UTC(anioEnCurso, 0, 1, 0, 0, 0)),
  fin: new Date(Date.UTC(anioEnCurso, 11, 31, 23, 59, 59)),
} as const;

/** Pure guard: every planned bound stays inside the %08d composition space. */
function assertPlausibleRango(r: RangoNcfSeed): void {
  if (
    !Number.isInteger(r.rangoInicio) ||
    !Number.isInteger(r.rangoFin) ||
    r.rangoInicio < 1 ||
    r.rangoFin > NCF_MAX_CONSECUTIVO ||
    r.rangoFin < r.rangoInicio
  ) {
    throw new Error(
      `seed-ncf: planned range ${String(r.rangoInicio)}–${String(r.rangoFin)} for ${r.tipoNcf} violates the %08d composition space (1..${String(NCF_MAX_CONSECUTIVO)})`,
    );
  }
}
for (const r of NCF_RANGOS_SEED) assertPlausibleRango(r);

/**
 * Seed one empresa: for each planned tipo, verify no same-key row holds a
 * DIFFERENT (real/overlapping-in-spirit) range, then compound-upsert. A
 * matching row re-runs refresh only vigencia/activa — never the counter.
 */
export async function seedNcfParaEmpresa(
  db: PrismaClient,
  empresaId: number,
): Promise<void> {
  for (const rango of NCF_RANGOS_SEED) {
    const existente = await db.ncfSecuencia.findUnique({
      where: {
        empresaId_tipoNcf: { empresaId, tipoNcf: rango.tipoNcf },
      },
      select: { rangoInicio: true, rangoFin: true },
    });
    if (
      existente !== null &&
      (existente.rangoInicio !== rango.rangoInicio ||
        existente.rangoFin !== rango.rangoFin)
    ) {
      // Same-key rows ALWAYS share (i.e. "overlap") the window; a different
      // range is indeterminate corruption or a live DGII authorization.
      throw new Error(
        `seed-ncf: overlap/conflict — empresa ${String(empresaId)} tipo ${rango.tipoNcf} ya tiene el rango ${String(existente.rangoInicio)}–${String(existente.rangoFin)}; el seed solo escribe el rango de desarrollo planificado (${String(rango.rangoInicio)}–${String(rango.rangoFin)}). Corrija la fila o use una empresa limpia (R-N6 fail-fast).`,
      );
    }
    await db.ncfSecuencia.upsert({
      where: {
        empresaId_tipoNcf: { empresaId, tipoNcf: rango.tipoNcf },
      },
      update: {
        // Idempotent refresh: never `rangoInicio`/`rangoFin` (would clobber a
        // verified-equal range pointlessly) and NEVER `secuenciaActual`.
        vigenciaInicio: NCF_SEED_VIGENCIA.inicio,
        vigenciaFin: NCF_SEED_VIGENCIA.fin,
        activa: true,
      },
      create: {
        empresaId,
        tipoNcf: rango.tipoNcf,
        rangoInicio: rango.rangoInicio,
        rangoFin: rango.rangoFin,
        // D7 last-used: zero consumed at provisioning.
        secuenciaActual: rango.rangoInicio - 1,
        vigenciaInicio: NCF_SEED_VIGENCIA.inicio,
        vigenciaFin: NCF_SEED_VIGENCIA.fin,
        activa: true,
      },
    });
  }
}

/**
 * Seed `empresaId` (single tenant) or every empresa. Returns the number of
 * empresas processed. Re-running never duplicates or rewinds counters.
 */
export async function seedNcf(
  db: PrismaClient,
  empresaId?: number,
): Promise<{ empresas: number }> {
  if (empresaId !== undefined) {
    await seedNcfParaEmpresa(db, empresaId);
    return { empresas: 1 };
  }
  const empresas = await db.empresa.findMany({ select: { id: true } });
  for (const empresa of empresas) {
    await seedNcfParaEmpresa(db, empresa.id);
  }
  return { empresas: empresas.length };
}

/** Parse the optional `--empresa <id>` CLI argument; unknown flags fail loud. */
export function parsearArgs(argv: readonly string[]): number | undefined {
  const idx = argv.indexOf("--empresa");
  if (idx === -1) return undefined;
  const valor = argv[idx + 1];
  const id = Number(valor);
  if (valor === undefined || !Number.isInteger(id) || id <= 0) {
    throw new Error(`seed-ncf: --empresa requiere un id entero positivo, got "${String(valor)}"`);
  }
  return id;
}

/**
 * CLI entry point (run via `pnpm seed:ncf`). Only executes when this file is
 * the script, so importing the functions for tests never opens a connection.
 */
async function main(): Promise<void> {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error("seed-ncf: set DIRECT_URL (preferred) or DATABASE_URL in .env");
  }
  const empresaId = parsearArgs(process.argv.slice(2));
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const res = await seedNcf(db, empresaId);
    const rangos = NCF_RANGOS_SEED.map(
      (r) => `${r.tipoNcf}:${String(r.rangoInicio)}–${String(r.rangoFin)}`,
    ).join(", ");
    console.log(
      `OK: seeded NCF ranges (${rangos}) for ${String(res.empresas)} empresa(s) (idempotent).`,
    );
  } finally {
    await db.$disconnect();
  }
}

if (
  process.argv[1] !== undefined &&
  process.argv[1].includes("seed-ncf")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
