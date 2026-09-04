/**
 * Integration test for withTenantTransaction.
 *
 * REQUIRES: Local Postgres running with DATABASE_URL set.
 * RUN VIA: `npx tsx src/modules/tenant/infrastructure/withTenantTransaction.test.ts`
 * NOT via: `pnpm test` (Jest CJS/ESM gap for Prisma).
 */

import "dotenv/config";
import assert from "node:assert";
import { prisma } from "@/lib/prisma";
import { withTenantTransaction, NestedTenantTransactionError, type PrismaTx } from "./withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";

type Guc = { v: string | null };
type Id = { id: number };
const unset = (v: string | null) => v === null || v === "";
const guc = async (tx: PrismaTx, n: string) => ((await tx.$queryRaw<Guc[]>`SELECT current_setting(${n}, true) AS v`)[0]?.v ?? null);
const now = () => new Date().toISOString();

const createEmpresa = async () => {
  const rnc = `WTT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [row] = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
    await tx.$executeRaw`INSERT INTO "EMPRESA" ("nombreComercial","rnc","razonSocial","direccionFiscal","telefono","correo","logo","regimenFiscal","createdAt","updatedAt") VALUES ('WTT', ${rnc}, 'WTT', 'x', '0', 'x', '', 'NORMAL', ${now()}::timestamptz, ${now()}::timestamptz)`;
    return tx.$queryRaw<Id[]>`SELECT id FROM "EMPRESA" WHERE "rnc" = ${rnc}`;
  });
  return row.id;
};

const createCategoria = async (empresaId: number) => {
  const nombre = `WTT-${Date.now()}-${empresaId}`;
  const [row] = await withTenantTransaction({ empresaId, sucursalId: 1, usuarioId: 1, esAdmin: true }, async (tx) => {
    await tx.$executeRaw`INSERT INTO "CATEGORIA" ("empresaId","nombre","createdAt","updatedAt") VALUES (${empresaId}, ${nombre}, ${now()}::timestamptz, ${now()}::timestamptz)`;
    return tx.$queryRaw<Id[]>`SELECT id FROM "CATEGORIA" WHERE "nombre" = ${nombre}`;
  });
  return row.id;
};

const createProduct = async (tx: PrismaTx, empresaId: number, categoriaId: number) => {
  const codigo = `WTT-${Date.now()}-${empresaId}`;
  await tx.$executeRaw`INSERT INTO "PRODUCTO" ("empresaId","categoriaId","nombre","codigo","codigoBarras","unidadMedida","unidadEmpaque","stockMinimo","precioCompra","precioVenta","costoPromedio","tasaItbis","createdAt","updatedAt") VALUES (${empresaId}, ${categoriaId}, 'test', ${codigo}, 'x', 'u', 'c', 0, 0, 0, 0, 18, ${now()}::timestamptz, ${now()}::timestamptz)`;
  return codigo;
};

const count = async (tx: PrismaTx, empresaId: number) => Number((await tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "PRODUCTO" WHERE "empresaId" = ${empresaId}`)[0].count);

async function main() {
  console.log("=== withTenantTransaction integration tests ===\n");
  const a = await createEmpresa();
  const b = await createEmpresa();
  const cat = await createCategoria(a);
  const ctxA: TenantCtx = { empresaId: a, sucursalId: 1, usuarioId: 100, esAdmin: false };
  const ctxB: TenantCtx = { empresaId: b, sucursalId: 1, usuarioId: 200, esAdmin: false };
  let codigo: string | undefined;
  try {
    console.log("Test 1: happy path");
    await withTenantTransaction(ctxA, async (tx) => {
      assert.strictEqual(await guc(tx, "app.current_empresa_id"), String(a));
      assert.strictEqual(await guc(tx, "app.current_sucursal_id"), "1");
      assert.strictEqual(await guc(tx, "app.current_usuario_id"), "100");
      assert.strictEqual(await guc(tx, "app.current_es_admin"), "false");
      codigo = await createProduct(tx, a, cat);
    });
    await withTenantTransaction(ctxB, async (tx) => assert.strictEqual(await count(tx, a), 0, "cross-tenant RLS should hide rows"));
    await withTenantTransaction(ctxA, async (tx) => assert.ok((await count(tx, a)) >= 1, "same-tenant RLS should show rows"));
    console.log("  ✅ passed\n");

    console.log("Test 2: rollback");
    try {
      await withTenantTransaction(ctxA, async (tx) => { assert.strictEqual(await guc(tx, "app.current_empresa_id"), String(a)); throw new Error("rollback sentinel"); });
      assert.fail("expected error");
    } catch (e) { assert.ok(e instanceof Error && e.message === "rollback sentinel", "error should propagate"); }
    await prisma.$transaction(async (tx) => assert.ok(unset(await guc(tx as PrismaTx, "app.current_empresa_id")), "GUC reverted"));
    console.log("  ✅ passed\n");

    console.log("Test 3: nested rejection");
    try {
      await withTenantTransaction(ctxA, async () => { await withTenantTransaction(ctxA, async () => assert.fail("inner should not run")); });
      assert.fail("expected NestedTenantTransactionError");
    } catch (e) { assert.ok(e instanceof NestedTenantTransactionError, `expected NestedTenantTransactionError, got ${e}`); }
    console.log("  ✅ passed\n");
    console.log("=== all integration tests passed ===");
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
      await tx.$executeRaw`SELECT set_config('app.current_empresa_id', ${String(a)}, true)`;
      if (codigo) await tx.$executeRaw`DELETE FROM "PRODUCTO" WHERE "codigo" = ${codigo}`;
      await tx.$executeRaw`DELETE FROM "CATEGORIA" WHERE "id" = ${cat}`;
      await tx.$executeRaw`DELETE FROM "EMPRESA" WHERE "id" IN (${a}, ${b})`;
    });
  }
}

main().then(async () => { await prisma.$disconnect(); process.exit(0); }).catch(async (e) => { console.error("\n❌ failed:", e); await prisma.$disconnect(); process.exit(1); });
