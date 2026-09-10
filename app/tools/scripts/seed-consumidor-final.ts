/**
 * Production seed/backfill for the per-empresa Consumidor Final (fase-5a task 2.4,
 * cliente R2).
 *
 * Every empresa must carry exactly one `esConsumidorFinal=true` client with a NULL
 * fiscal ID, because a sale to an unidentified buyer (NCF B01/B02) resolves to it.
 * This provisions that row for tenants that predate the module and is SAFE TO
 * RE-RUN (idempotent), mirroring `seed-retencion-config.ts`.
 *
 * Idempotency + race safety are delegated to the SAME reserved seam Fase 5b will
 * call lazily from the sale path — `getOrCreateConsumidorFinalEnTx` (fetch →
 * insert → catch P2002 → refetch). The DB partial unique
 * `cliente_consumidor_final_uk` (empresaId WHERE esConsumidorFinal) is the
 * definitive backstop: no amount of concurrent seeding produces a second row.
 * This single-source reuse is why the CF shape can never drift between the seed
 * and the future sale path.
 *
 * Connection: a privileged/operator role (the app role is RLS-bound to one tenant
 * and branch; a company-wide backfill has no single-tenant context). It reuses
 * DIRECT_URL when present (superuser), else DATABASE_URL — the same convention as
 * the retention seed.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getOrCreateConsumidorFinalEnTx } from "@/modules/cliente/application/consumidor-final";
import type { Cliente } from "@/modules/cliente/domain/cliente";

/**
 * Provision the Consumidor Final for ONE empresa via the reserved get-or-create
 * seam. Idempotent: an existing row is returned untouched. A maintenance
 * `PrismaClient` is structurally a `PrismaTx` (extra `$*` methods are ignored),
 * so the seed and the future sale path share one implementation.
 */
export async function seedConsumidorFinalParaEmpresa(
  db: PrismaClient,
  empresaId: number,
): Promise<Cliente> {
  return getOrCreateConsumidorFinalEnTx(db as unknown as PrismaTx, empresaId);
}

/** Backfill every empresa. Returns the count for logging; re-running is a no-op. */
export async function seedConsumidorFinal(
  db: PrismaClient,
): Promise<{ empresas: number }> {
  const empresas = await db.empresa.findMany({ select: { id: true } });
  for (const empresa of empresas) {
    await seedConsumidorFinalParaEmpresa(db, empresa.id);
  }
  return { empresas: empresas.length };
}

/**
 * CLI entry point (run via `pnpm seed:cliente`). Kept out of the module export
 * path used by tests: it only opens a connection when this file is the script.
 *
 * On "hook into the empresa provisioning path": the project has NO in-app
 * empresa-creation service to hook (empresa creation is operator/seed-driven, and
 * `seedRetencionConfig` is likewise wired only as this maintenance script + the
 * integration fixtures). Parity is therefore deliberate: new tenants are
 * provisioned by running this idempotent script (and the fixtures call the same
 * seam), not by a hidden application hook.
 */
async function main(): Promise<void> {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "seed-consumidor-final: set DIRECT_URL (preferred) or DATABASE_URL in .env",
    );
  }
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  try {
    const res = await seedConsumidorFinal(db);
    console.log(
      `OK: ensured Consumidor Final for ${res.empresas} empresa(s) (idempotent).`,
    );
  } finally {
    await db.$disconnect();
  }
}

if (
  process.argv[1] !== undefined &&
  process.argv[1].includes("seed-consumidor-final")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
