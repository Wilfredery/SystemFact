/**
 * Production seed for tenant retention configuration (fase-3-4b task 1.6).
 *
 * Guarantees real production empresas can CONFIRM and RECEIVE purchases. The
 * ISR/ITBIS retention calculators read four `ConfiguracionEmpresa` keys and
 * block confirmation with `CONFIG_RETENCION_FALTANTE` when an applicable key is
 * absent — a state that today only integration fixtures avoid. This script
 * provisions the four keys for every empresa as one ACTIVE row each, inside a
 * wide validity window, and is SAFE TO RE-RUN (idempotent).
 *
 * Idempotency strategy (no migration, frozen `@@unique([empresaId, clave,
 * vigenciaInicio])`):
 *   1. Demote to `activa=false` any OTHER active row for the same (empresa,
 *      clave) that is not the canonical window — enforcing "one active row per
 *      (empresaId, clave)".
 *   2. Upsert the canonical window by its compound unique key, so a re-run
 *      UPDATES the same row instead of inserting a duplicate.
 *
 * Rates stay config-driven: this seeds the persisted VALUES only; it introduces
 * NO hardcoded fallback in domain/application code, and leaves the integration
 * fixtures untouched (the fixture window is identical, so even a seed over a
 * fixture tenant updates rather than duplicates).
 *
 * Connection: a privileged/operator role (the app role is RLS-bound to a tenant
 * and branch, and a company-wide maintenance pass has no single-tenant context).
 * It reuses DIRECT_URL when present (superuser, mirrors the harness), else
 * DATABASE_URL (which a seed operator would run under a role able to read all
 * empresas and write their config).
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { RetencionClave } from "@/modules/compra/domain/calculators";

/** Percent-form values, matching the retention reader's accepted grammar. */
export const RETENCION_SEED_VALORES: Readonly<Record<RetencionClave, string>> = {
  RET_ISR_15: "15",
  RET_ISR_2: "2",
  RET_ITBIS_100: "100",
  RET_ITBIS_30: "30",
};

/** Canonical validity window (the same long-dated span the fixtures use). */
export const RETENCION_SEED_VIGENCIA = {
  inicio: new Date("2000-01-01T00:00:00.000Z"),
  fin: new Date("2099-12-31T23:59:59.000Z"),
} as const;

/** Minimal structural client type so tests can pass a harness/prisma client. */
type ConfigClient = PrismaClient;

/**
 * Seed the four retention keys for ONE empresa: one active row per key, other
 * active duplicates for the same key demoted. Idempotent.
 */
export async function seedRetencionConfigParaEmpresa(
  db: ConfigClient,
  empresaId: number,
): Promise<void> {
  for (const clave of Object.keys(RETENCION_SEED_VALORES) as RetencionClave[]) {
    const valor = RETENCION_SEED_VALORES[clave];
    await db.$transaction([
      db.configuracionEmpresa.updateMany({
        where: {
          empresaId,
          clave,
          activa: true,
          NOT: { vigenciaInicio: RETENCION_SEED_VIGENCIA.inicio },
        },
        data: { activa: false },
      }),
      db.configuracionEmpresa.upsert({
        where: {
          empresaId_clave_vigenciaInicio: {
            empresaId,
            clave,
            vigenciaInicio: RETENCION_SEED_VIGENCIA.inicio,
          },
        },
        update: {
          valor,
          vigenciaFin: RETENCION_SEED_VIGENCIA.fin,
          activa: true,
        },
        create: {
          empresaId,
          clave,
          valor,
          vigenciaInicio: RETENCION_SEED_VIGENCIA.inicio,
          vigenciaFin: RETENCION_SEED_VIGENCIA.fin,
          activa: true,
        },
      }),
    ]);
  }
}

/**
 * Seed every empresa. Returns counts for logging. Re-running never duplicates:
 * the compound unique key targets the canonical window row.
 */
export async function seedRetencionConfig(
  db: ConfigClient,
): Promise<{ empresas: number; clavesPorEmpresa: number }> {
  const empresas = await db.empresa.findMany({ select: { id: true } });
  for (const empresa of empresas) {
    await seedRetencionConfigParaEmpresa(db, empresa.id);
  }
  return {
    empresas: empresas.length,
    clavesPorEmpresa: Object.keys(RETENCION_SEED_VALORES).length,
  };
}

/**
 * CLI entry point (run via `pnpm seed:retencion`). Kept out of the module
 * export path used by tests: it only executes when this file is the script.
 */
async function main(): Promise<void> {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "seed-retencion-config: set DIRECT_URL (preferred) or DATABASE_URL in .env",
    );
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const res = await seedRetencionConfig(db);
    console.log(
      `OK: seeded ${res.clavesPorEmpresa} retention keys for ${res.empresas} empresa(s) (idempotent).`,
    );
  } finally {
    await db.$disconnect();
  }
}

// Run only as a script (tsx `pnpm seed:retencion`); importing the functions for
// tests must not open a connection.
if (process.argv[1] !== undefined && process.argv[1].includes("seed-retencion-config")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
