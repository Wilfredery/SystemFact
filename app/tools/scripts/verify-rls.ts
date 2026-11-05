/**
 * Runtime smoke test for RLS prerequisites.
 *
 * Verifies the Prisma connection role cannot bypass RLS and the pool is
 * configured for transaction-mode pooling. Run via `pnpm rls:verify`.
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { isProductionEnvironment, isTransactionModePooling } from "./verify-rls-policy";

type RoleRow = { current_user: string; rolbypassrls: boolean };
type OwnerRow = { tableowner: string };
type IndexRow = { indexname: string; indexdef: string };
type TriggerRow = { tgname: string };
type TableRlsRow = { relname: string; relrowsecurity: boolean; policies: number; permisivas: number };

/**
 * Tables the application never queries, so a restrictive-only posture is enough for them.
 * Anything NOT listed here must give the runtime role a PERMISSIVE policy, because
 * `systemfact_app` is NOSUPERUSER NOBYPASSRLS and does not own the tables — restrictive
 * policies are ANDed, so a restrictive-only table is invisible to the app while `rls:verify`
 * still reported it green. That false green is how `LOGIN_INTENTO` shipped inert.
 */
const TABLAS_SIN_ROL_APP = new Set(["_prisma_migrations"]);

async function main() {
  const [role] = await prisma.$queryRaw<RoleRow[]>`
    SELECT current_user::text AS current_user, rolbypassrls
    FROM pg_roles WHERE rolname = current_user`;

  if (role === undefined) throw new Error("could not resolve current_user");
  const { current_user: user, rolbypassrls } = role;

  if (["postgres", "supabase_admin"].includes(user)) {
    throw new Error(`role "${user}" is privileged and bypasses RLS`);
  }
  if (rolbypassrls) {
    throw new Error(`role "${user}" has BYPASSRLS=true`);
  }

  const [owner] = await prisma.$queryRaw<OwnerRow[]>`
    SELECT tableowner FROM pg_tables WHERE tablename = 'PRODUCTO' LIMIT 1`;
  if (owner !== undefined && owner.tableowner === user) {
    throw new Error(`role "${user}" owns PRODUCTO and bypasses RLS on it`);
  }

  await verifyV2r01IdentityControls();
  await verifyEveryTableHasRls();

  const url = process.env.DATABASE_URL ?? "";
  if (!isTransactionModePooling(url)) {
    if (isProductionEnvironment(process.env.NODE_ENV)) {
      throw new Error("DATABASE_URL must use transaction-mode pooling in production");
    }
    console.warn("WARN: local DATABASE_URL does not use transaction-mode pooling (expected for localhost:5433)");
  }

  console.log(`OK: role "${user}" has rolbypassrls=false and is not privileged`);
}

/**
 * Assert the two database objects that make the v2r-01 identity binding safe.
 *
 * Neither object is expressible in `schema.prisma`, so neither is visible to the
 * compiler, to a schema diff, or to any unit test. If one is dropped -- by a
 * regenerated migration, a schema push, or a reverted migration -- nothing in the
 * build fails and the failure is silent:
 *
 *   - Without `usuario_auth_user_id_uk`, `findFirst({ where: { authUserId } })`
 *     may match an arbitrary tenant's row, which turns session resolution into
 *     cross-tenant identity binding.
 *   - Without `trg_usuario_auth_user_id_no_null`, a full-field admin update can
 *     write an already-bound `authUserId` back to NULL, silently re-opening the
 *     same vulnerability class this binding closes.
 *
 * This runs against a real migrated database, which is the only place either
 * object can actually be observed. Predicates are asserted, not just names: a
 * rebuilt index that kept the name but widened its predicate would pass a
 * name-only check while removing the guarantee.
 */
async function verifyV2r01IdentityControls(): Promise<void> {
  // Query by the EXACT index name, never indexes[0] of an ILIKE scan: pg_indexes
  // returns rows in arbitrary order, so any other index on authUserId (a plain
  // secondary index) could win [0] and make this check abort with a false
  // negative -- or silently stand in for the real one (audit finding R3-001).
  const indexes = await prisma.$queryRaw<IndexRow[]>`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'USUARIO'
      AND indexname = 'usuario_auth_user_id_uk'`;

  const bindingIndex = indexes[0];
  if (bindingIndex === undefined) {
    throw new Error(
      'missing the partial unique index on "USUARIO"."authUserId" ' +
        "(usuario_auth_user_id_uk): without it, session resolution by sub is not single-row",
    );
  }
  if (!/^CREATE UNIQUE INDEX/i.test(bindingIndex.indexdef)) {
    throw new Error(`index "${bindingIndex.indexname}" must be UNIQUE: a non-unique index permits duplicate authUserId values`);
  }
  if (!/IS NOT NULL/i.test(bindingIndex.indexdef)) {
    throw new Error(
      `index "${bindingIndex.indexname}" must stay partial with an "IS NOT NULL" predicate ` +
        "so that unbound rows (authUserId NULL) can coexist",
    );
  }

  const triggers = await prisma.$queryRaw<TriggerRow[]>`
    SELECT tgname FROM pg_trigger
    WHERE tgrelid = '"USUARIO"'::regclass
      AND NOT tgisinternal`;

  if (!triggers.some((t) => t.tgname === "trg_usuario_auth_user_id_no_null")) {
    throw new Error(
      'missing trigger trg_usuario_auth_user_id_no_null on "USUARIO": without it, a bound authUserId can be written back to NULL',
    );
  }

  console.log(`OK: v2r-01 controls present (index "${bindingIndex.indexname}", trigger trg_usuario_auth_user_id_no_null)`);
}

/**
 * Every table in the app schema must have RLS ENABLED and at least one policy.
 *
 * Why this exists (`docs/22` T5): the rest of this script proves the ROLE cannot
 * bypass RLS, which is a different claim from "every table actually has
 * policies". A new context-aware table — or a migration that recreates one — can
 * ship with `relrowsecurity = false` and zero policies, and then:
 *   - the role is still NOBYPASSRLS, so the existing check stays green;
 *   - unit and integration tests still pass, because they authenticate;
 *   - every query that forgets `empresaId` returns another tenant's rows.
 * Multi-tenancy is this project's #1 risk (`AGENTS.md`), so the guard belongs in
 * CI where a merge is blocked, not in a review checklist.
 *
 * The failure names every offending table, in both directions, so the fix is
 * visible from the log: RLS off is one class, RLS on with zero policies is the
 * other (enabled but nobody wrote a rule = still wide open).
 */
async function verifyEveryTableHasRls(): Promise<void> {
  // The runtime role's own oid. "A permissive policy exists" is NOT the property we need —
  // "a permissive policy APPLIES TO THIS ROLE" is. A policy written `TO authenticated` (the
  // shape a Supabase habit produces, and the one that would silently disable the throttle
  // again) matches no app role while `permisivas > 0` still read green.
  // PUBLIC is the pseudo-role oid 0 inside `polroles` (`{0}`), NOT an empty array — treating it
  // as empty rejected the 25 tables whose policies are legitimately `TO PUBLIC`.
  const [rol] = await prisma.$queryRaw<{ oid: number; name: string }[]>`
    SELECT oid::int AS oid, rolname::text AS name FROM pg_roles WHERE rolname = current_user`;
  if (rol === undefined) throw new Error("could not resolve current_user oid");

  const tables = await prisma.$queryRaw<TableRlsRow[]>`
    SELECT c.relname,
           c.relrowsecurity,
           COALESCE(p.n, 0)::int AS policies,
           COALESCE(p.pn, 0)::int AS permisivas
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    LEFT JOIN (
      SELECT polrelid,
             COUNT(*) AS n,
             COUNT(*) FILTER (
               WHERE polpermissive
                 AND (0 = ANY (polroles) OR ${rol.oid}::oid = ANY (polroles))
             ) AS pn
      FROM pg_policy GROUP BY polrelid
    ) p ON p.polrelid = c.oid
    WHERE ns.nspname = current_schema()
      AND c.relkind = 'r'
    ORDER BY c.relname`;

  // An empty result must fail, never pass: it would mean the query looked in the
  // wrong schema and "verified" nothing.
  if (tables.length === 0) {
    throw new Error("RLS coverage found no tables in the current schema: the check verified nothing");
  }

  const sinRls = tables.filter((t) => !t.relrowsecurity).map((t) => t.relname);
  const sinPolitica = tables.filter((t) => t.policies === 0).map((t) => t.relname);
  const soloRestrictiva = tables
    .filter((t) => t.policies > 0 && t.permisivas === 0 && !TABLAS_SIN_ROL_APP.has(t.relname))
    .map((t) => t.relname);

  if (sinRls.length > 0 || sinPolitica.length > 0 || soloRestrictiva.length > 0) {
    const partes: string[] = [];
    if (sinRls.length > 0) partes.push(`RLS disabled on: ${sinRls.join(", ")}`);
    if (sinPolitica.length > 0) partes.push(`no policy at all on: ${sinPolitica.join(", ")}`);
    if (soloRestrictiva.length > 0) {
      partes.push(
        `no PERMISSIVE policy that applies to this role on: ${soloRestrictiva.join(", ")} — a ` +
          "restrictive-only table (or a policy naming some other role) leaves the app with no " +
          "permission at all, and a fail-open caller turns that into a silently disabled control",
      );
    }
    throw new Error(
      `RLS coverage incomplete — ${partes.join(" | ")}. ` +
        "Every table in the schema needs ENABLE ROW LEVEL SECURITY and at least one PERMISSIVE " +
        "policy for the runtime role; without them, any connection using the app role can read or " +
        "write another tenant's rows — or, with a restrictive-only table, cannot use it at all.",
    );
  }

  console.log(
    `OK: all ${tables.length} tables have RLS enabled and a permissive policy that applies to "${rol.name}"`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
