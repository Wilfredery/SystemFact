/**
 * Configuration-integrity smoke guard for the venta business keys (F5 companion).
 *
 * Every venta save path hard-fails at RUNTIME when a tenant lacks a required
 * `CONFIGURACION_EMPRESA` row: `leerConfigVentaEnTx` → `DESC_MAX_FALTANTE`,
 * `leerPlazoDevolucionEnTx` → `PLAZO_DEVOLUCION_FALTANTE` and
 * `leerRetroactivoFechaVentaEnTx` → `RETROACTIVO_FECHA_VENTA_FALTANTE`. Today the
 * first signal that a row is missing is a BLOCKED SALE in production — i.e. the
 * defect is discovered by an operator, at the worst possible moment. This script
 * moves that signal to deploy/CI time and doubles as the onboarding check for a
 * brand-new tenant ("is this tenant ready?"). Run via `pnpm config:verify`.
 * It mirrors the existing `tools/scripts/verify-rls.ts` shape and role.
 *
 * WHAT IS CHECKED, per empresa, for each required clave: at least one row that is
 * `activa: true` AND whose validity window covers NOW
 * (`vigenciaInicio <= ahora <= vigenciaFin`). That is deliberately the SAME
 * predicate the three production readers use
 * (`{ activa: true, vigenciaInicio: { lte: fecha }, vigenciaFin: { gte: fecha } }`),
 * so a green run means the readers WILL find a value — not merely that some row
 * exists. As with R-V17, any covering row counts: this is an existence check and
 * does not attempt to resolve overlapping windows (the readers pin the newest
 * `vigenciaInicio`; that ordering is a correctness matter for the readers, not
 * for "is the key present?").
 *
 * WHY A SUPERUSER CONNECTION AND NOT `withTenantTransaction` — two independent
 * reasons, both structural:
 *
 *   1. RLS. `CONFIGURACION_EMPRESA` has `ENABLE`d AND `FORCE`d ROW LEVEL SECURITY
 *      with a single-tenant policy `configempresa_isolation`
 *      (`current_setting('app.current_empresa_id')::int = "empresaId"`, defaulting
 *      to `'0'`). A tenant-scoped transaction can only ever see ONE empresa's rows
 *      — so a single `withTenantTransaction` call is structurally incapable of
 *      auditing all tenants, and one call per empresa would have to fabricate a
 *      `TenantCtx` (usuarioId + esAdmin) for a tenant that may have no user yet.
 *   2. SCOPE. This is a diagnostic/ops script, not a business action: it has no
 *      caller identity, mutates nothing, and MUST see all tenants — which is
 *      exactly the population whose missing rows it exists to find.
 *
 * So it connects with `DIRECT_URL` (the same superuser the seeds use) precisely
 * because that connection is not RLS-bound. If `DIRECT_URL` is absent it falls
 * back to `DATABASE_URL` and WARNS LOUDLY: on the RLS-forced app role every key
 * would read as missing and the report would be a false alarm. A green run is only
 * meaningful when the report header does not carry that warning.
 *
 * A database with ZERO empresas is VALID (fresh install: nothing to provision
 * yet) and exits 0 — absence of tenants is not tenant misconfiguration.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  DESC_MAX_CLAVE,
  PLAZO_DEVOLUCION_CLAVE,
  RETROACTIVO_FECHA_VENTA_CLAVE,
} from "./seed-venta-config";

/**
 * The required business keys, read FROM the seed so the guard can never drift
 * from what the seed provisions (single source of truth — no duplicated string
 * literals in this file).
 */
const CLAVES_REQUERIDAS: readonly string[] = [
  DESC_MAX_CLAVE,
  PLAZO_DEVOLUCION_CLAVE,
  RETROACTIVO_FECHA_VENTA_CLAVE,
];

type ConfigRow = {
  empresaId: number;
  clave: string;
  vigenciaInicio: Date;
  vigenciaFin: Date;
};

/** Build the RLS-bypassing diagnostic client the way the seed scripts do. */
function crearCliente(): PrismaClient {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "verify-venta-config: set DIRECT_URL (preferred) or DATABASE_URL in .env",
    );
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/** Held at module scope so the runner can always disconnect it (verify-rls shape). */
let db: PrismaClient | null = null;

async function main(): Promise<number> {
  db = crearCliente();
  const usandoSuperuser = (process.env.DIRECT_URL ?? "") !== "";

  // Single reference instant for the whole audit, so a window expiring mid-run
  // cannot make two empresas disagree about the same key.
  const ahora = new Date();

  const empresas = await db.empresa.findMany({
    select: { id: true, razonSocial: true },
    orderBy: { id: "asc" },
  });
  const configs = await db.configuracionEmpresa.findMany({
    where: { activa: true, clave: { in: [...CLAVES_REQUERIDAS] } },
    select: { empresaId: true, clave: true, vigenciaInicio: true, vigenciaFin: true },
  });

  if (!usandoSuperuser) {
    console.warn(
      "WARN: DIRECT_URL is not set — falling back to DATABASE_URL. If that role is RLS-bound the rows are invisible and EVERY key below will read as missing.",
    );
  }
  console.log(
    `verify-venta-config: ${empresas.length} empresa(s), ${configs.length} active row(s) for the required keys, evaluated at ${ahora.toISOString()}`,
  );
  console.log(`required claves: ${CLAVES_REQUERIDAS.join(", ")}`);

  // A key is present for an empresa when SOME active row's window covers NOW.
  // `vigenciaFin` is NOT NULL in the schema, so "open-ended" is expressed as a
  // far-future instant (the seed uses 2099-12-31) — same as the readers, which
  // rely on `vigenciaFin: { gte: fecha }` and therefore also skip NULLs.
  const cubreAhora = (c: ConfigRow): boolean =>
    c.vigenciaInicio.getTime() <= ahora.getTime() && ahora.getTime() <= c.vigenciaFin.getTime();

  // Collect EVERY missing pair (never stop at the first): a partially
  // provisioned tenant must surface all its gaps in one run.
  const faltantes: { empresaId: number; razonSocial: string; clave: string }[] = [];
  for (const empresa of empresas) {
    for (const clave of CLAVES_REQUERIDAS) {
      const presente = configs.some(
        (c) => c.empresaId === empresa.id && c.clave === clave && cubreAhora(c),
      );
      if (!presente) {
        faltantes.push({ empresaId: empresa.id, razonSocial: empresa.razonSocial, clave });
      }
    }
  }

  if (faltantes.length > 0) {
    console.error("");
    console.error(
      `FAIL: ${faltantes.length} missing required venta config key(s) — ventas would be blocked at runtime:`,
    );
    for (const f of faltantes) {
      console.error(`  empresa ${f.empresaId} (${f.razonSocial}) le falta la clave ${f.clave}`);
    }
    console.error("");
    console.error("remediation: run pnpm seed:venta (idempotente) and re-run pnpm config:verify");
    return 1;
  }

  console.log(
    `OK: all ${empresas.length} empresa(s) have ${CLAVES_REQUERIDAS.join(", ")} active and in force`,
  );
  return 0;
}

main()
  .then(async (codigo) => {
    await db?.$disconnect();
    process.exit(codigo);
  })
  .catch(async (e) => {
    console.error(e);
    await db?.$disconnect();
    process.exit(1);
  });
