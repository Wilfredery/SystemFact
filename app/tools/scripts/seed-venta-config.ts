/**
 * Production seed for tenant sale configuration (`venta-config` R-C2).
 *
 * `leerConfigVentaEnTx` hard-fails a discounted draft with `DESC_MAX_FALTANTE`
 * when no active `DESC_MAX` row covers the sale date — a state that (like the
 * retention keys before their seed) only integration fixtures avoid today. This
 * script provisions `DESC_MAX` for every empresa as ONE active row in a wide
 * validity window, using the business-confirmed default `4.00` (adjustable, and
 * the running rule reads the stored value so changing it needs no deploy — R-C3).
 * It is SAFE TO RE-RUN (idempotent), mirroring `seed-retencion-config.ts`.
 *
 * Idempotency strategy (no migration, frozen `@@unique([empresaId, clave,
 * vigenciaInicio])`):
 *   1. Demote to `activa=false` any OTHER active `DESC_MAX` row for the same
 *      empresa that is not the canonical window — enforcing "one active row per
 *      (empresaId, clave)".
 *   2. Upsert the canonical window by its compound unique key, so a re-run UPDATES
 *      the same row instead of inserting a duplicate.
 *
 * It introduces NO hardcoded fallback in domain/application code (the value lives
 * only in the config row) and does NOT change existing integration fixtures.
 *
 * Connection: a privileged/operator role (the app role is RLS-bound to one tenant
 * and branch; a company-wide maintenance pass has no single-tenant context). It
 * reuses DIRECT_URL when present (superuser), else DATABASE_URL — the same
 * convention as the retention and Consumidor-Final seeds.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/** Business-confirmed default discount cap (percent-form, adjustable in DB). */
export const DESC_MAX_SEED_VALOR = "4.00";

/** The `ConfiguracionEmpresa` key this seed provisions. */
export const DESC_MAX_CLAVE = "DESC_MAX";

/** Canonical validity window (the same long-dated span the fixtures use). */
export const DESC_MAX_SEED_VIGENCIA = {
  inicio: new Date("2000-01-01T00:00:00.000Z"),
  fin: new Date("2099-12-31T23:59:59.000Z"),
} as const;

/**
 * R-V17 (CodeRabbit F5, fase-5c task 4.3): pure, deterministic overlap probe.
 * Returns the FIRST pair of validity windows that intersect (boundaries
 * inclusive), or `null` when the set is overlap-free. Windows are half-open
 * intervals on the instant axis; `[a0,a1] ∩ [b0,b1] ≠ ∅ ⟺ a0 ≤ b1 ∧ b0 ≤ a1`.
 */
export function detectarVentanasSuperpuestas<
  T extends { vigenciaInicio: Date; vigenciaFin: Date },
>(ventanas: readonly T[]): { a: T; b: T } | null {
  for (let i = 0; i < ventanas.length; i++) {
    for (let j = i + 1; j < ventanas.length; j++) {
      const a = ventanas[i];
      const b = ventanas[j];
      if (
        a.vigenciaInicio <= b.vigenciaFin &&
        b.vigenciaInicio <= a.vigenciaFin
      ) {
        return { a, b };
      }
    }
  }
  return null;
}

/**
 * Seed the `DESC_MAX` key for ONE empresa: one active row in the canonical
 * window, other active duplicates demoted. Idempotent.
 *
 * R-V17 fail-fast guard: BEFORE repairing, the seed inspects the currently
 * active non-canonical rows. Two or more of them OVERLAPPING each other is an
 * indeterminate corruption the demote step cannot resolve without silently
 * choosing a winner — the seed throws instead of repairing. A single stray
 * (even one overlapping the canonical window) remains self-healable by the
 * demote + canonical upsert below, preserving the R-C2 idempotency contract.
 */
export async function seedVentaConfigParaEmpresa(
  db: PrismaClient,
  empresaId: number,
): Promise<void> {
  const extraActivas = await db.configuracionEmpresa.findMany({
    where: {
      empresaId,
      clave: DESC_MAX_CLAVE,
      activa: true,
      NOT: { vigenciaInicio: DESC_MAX_SEED_VIGENCIA.inicio },
    },
    select: { vigenciaInicio: true, vigenciaFin: true },
  });
  const conflicto = detectarVentanasSuperpuestas(extraActivas);
  if (conflicto !== null) {
    throw new Error(
      `seed-venta-config: ventanas DESC_MAX activas superpuestas para empresa ${String(
        empresaId,
      )} (${conflicto.a.vigenciaInicio.toISOString()}–${conflicto.a.vigenciaFin.toISOString()} ∩ ${conflicto.b.vigenciaInicio.toISOString()}–${conflicto.b.vigenciaFin.toISOString()}); corríjalas antes de re-sembrar (R-V17 fail-fast)`,
    );
  }

  await db.$transaction([
    db.configuracionEmpresa.updateMany({
      where: {
        empresaId,
        clave: DESC_MAX_CLAVE,
        activa: true,
        NOT: { vigenciaInicio: DESC_MAX_SEED_VIGENCIA.inicio },
      },
      data: { activa: false },
    }),
    db.configuracionEmpresa.upsert({
      where: {
        empresaId_clave_vigenciaInicio: {
          empresaId,
          clave: DESC_MAX_CLAVE,
          vigenciaInicio: DESC_MAX_SEED_VIGENCIA.inicio,
        },
      },
      update: {
        valor: DESC_MAX_SEED_VALOR,
        vigenciaFin: DESC_MAX_SEED_VIGENCIA.fin,
        activa: true,
      },
      create: {
        empresaId,
        clave: DESC_MAX_CLAVE,
        valor: DESC_MAX_SEED_VALOR,
        vigenciaInicio: DESC_MAX_SEED_VIGENCIA.inicio,
        vigenciaFin: DESC_MAX_SEED_VIGENCIA.fin,
        activa: true,
      },
    }),
  ]);
}

/**
 * Seed every empresa. Returns counts for logging. Re-running never duplicates:
 * the compound unique key targets the canonical window row.
 */
export async function seedVentaConfig(
  db: PrismaClient,
): Promise<{ empresas: number }> {
  const empresas = await db.empresa.findMany({ select: { id: true } });
  for (const empresa of empresas) {
    await seedVentaConfigParaEmpresa(db, empresa.id);
  }
  return { empresas: empresas.length };
}

/**
 * CLI entry point (run via `pnpm seed:venta`). Only executes when this file is
 * the script, so importing the functions for tests never opens a connection.
 */
async function main(): Promise<void> {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "seed-venta-config: set DIRECT_URL (preferred) or DATABASE_URL in .env",
    );
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const res = await seedVentaConfig(db);
    console.log(
      `OK: seeded ${DESC_MAX_CLAVE}=${DESC_MAX_SEED_VALOR} for ${res.empresas} empresa(s) (idempotent).`,
    );
  } finally {
    await db.$disconnect();
  }
}

if (
  process.argv[1] !== undefined &&
  process.argv[1].includes("seed-venta-config")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
