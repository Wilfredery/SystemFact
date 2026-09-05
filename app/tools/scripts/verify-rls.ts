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

  const url = process.env.DATABASE_URL ?? "";
  if (!isTransactionModePooling(url)) {
    if (isProductionEnvironment(process.env.NODE_ENV)) {
      throw new Error("DATABASE_URL must use transaction-mode pooling in production");
    }
    console.warn("WARN: local DATABASE_URL does not use transaction-mode pooling (expected for localhost:5433)");
  }

  console.log(`OK: role "${user}" has rolbypassrls=false and is not privileged`);
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
