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
  const indexes = await prisma.$queryRaw<IndexRow[]>`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'USUARIO'
      AND indexdef ILIKE '%authUserId%'`;

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
