/**
 * PROBE R1.A — verificación empírica de que `set_config(..., true)` (equivalente
 * a `SET LOCAL`) persiste dentro de una transacción Prisma 7 con driver adapter
 * `@prisma/adapter-pg`, y NO leakea entre transacciones.
 *
 * Si esto pasa, las policies RLS de R1.B pueden confiar en leer
 * `current_setting('app.current_*', true)` desde cualquier query dentro del
 * mismo `$transaction`.
 *
 * USO:
 *   pnpm probe:set-local
 *
 * Sale con código 0 si todos los tests pasan, 1 si alguno falla.
 */

import "dotenv/config"; // carga .env ANTES de los módulos que leen env

import { prisma } from "@/lib/prisma";
import { setTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";

type Row = { v: string | null };

/**
 * Acepta NULL o string vacío como "no seteado" (ver Hallazgo 2 del probe R1.A:
 * `current_setting('x', true)` puede devolver NULL o '' cuando nunca se setea,
 * según el path del driver adapter pg — ambos son equivalentes para RLS).
 */
function isUnset(v: string | null): boolean {
  return v === null || v === "";
}

function fmt(label: string, expected: string | null | "UNSET", actual: string | null): boolean {
  let ok: boolean;
  if (expected === "UNSET") {
    ok = isUnset(actual);
  } else {
    ok = actual === expected;
  }
  const mark = ok ? "OK  " : "FAIL";
  const expStr = expected === "UNSET" ? "(null|'')  " : String(expected).padEnd(8);
  console.log(`  [${mark}] ${label.padEnd(34)} esperado=${expStr}  actual=${JSON.stringify(actual)}`);
  return ok;
}

async function probe() {
  console.log("=== PROBE R1.A: set_config() en transacción Prisma 7 ===\n");

  const ctx: TenantCtx = {
    empresaId: 1,
    sucursalId: 10,
    usuarioId: 100,
    esAdmin: true,
  };

  let allOk = true;

  // ─────────────────────────────────────────────────────────────────────
  // Test 1: dentro de tx, después de setTenantContext, los 4 settings visibles.
  // ─────────────────────────────────────────────────────────────────────
  console.log("Test 1: lectura de settings dentro de tx con contexto seteado");
  await prisma.$transaction(async (tx) => {
    await setTenantContext(tx, ctx);

    const r1 = await tx.$queryRaw<Row[]>`SELECT current_setting('app.current_empresa_id', true) AS v`;
    allOk = fmt("app.current_empresa_id", "1", r1[0]?.v ?? null) && allOk;

    const r2 = await tx.$queryRaw<Row[]>`SELECT current_setting('app.current_sucursal_id', true) AS v`;
    allOk = fmt("app.current_sucursal_id", "10", r2[0]?.v ?? null) && allOk;

    const r3 = await tx.$queryRaw<Row[]>`SELECT current_setting('app.current_usuario_id', true) AS v`;
    allOk = fmt("app.current_usuario_id", "100", r3[0]?.v ?? null) && allOk;

    const r4 = await tx.$queryRaw<Row[]>`SELECT current_setting('app.current_es_admin', true) AS v`;
    allOk = fmt("app.current_es_admin", "true", r4[0]?.v ?? null) && allOk;
  });
  console.log("");

  // ─────────────────────────────────────────────────────────────────────
  // Test 2: nueva tx SIN setTenantContext → settings NULL (no leak entre tx).
  // ─────────────────────────────────────────────────────────────────────
  console.log("Test 2: nueva tx sin contexto → settings NULL/'' (sin leak entre tx)");
  await prisma.$transaction(async (tx) => {
    const r1 = await tx.$queryRaw<Row[]>`SELECT current_setting('app.current_empresa_id', true) AS v`;
    allOk = fmt("app.current_empresa_id", "UNSET", r1[0]?.v ?? null) && allOk;

    const r2 = await tx.$queryRaw<Row[]>`SELECT current_setting('app.current_sucursal_id', true) AS v`;
    allOk = fmt("app.current_sucursal_id", "UNSET", r2[0]?.v ?? null) && allOk;
  });
  console.log("");

  // ─────────────────────────────────────────────────────────────────────
  // Test 3: Admin empresa-wide (sucursalId=null) → sucursalId NO se setea.
  // ─────────────────────────────────────────────────────────────────────
  console.log("Test 3: Admin empresa-wide → sucursalId no se setea (queda NULL/'')");
  const adminCtx: TenantCtx = {
    empresaId: 1,
    sucursalId: null,
    usuarioId: 100,
    esAdmin: true,
  };
  await prisma.$transaction(async (tx) => {
    await setTenantContext(tx, adminCtx);
    const r1 = await tx.$queryRaw<Row[]>`SELECT current_setting('app.current_empresa_id', true) AS v`;
    allOk = fmt("app.current_empresa_id", "1", r1[0]?.v ?? null) && allOk;
    const r2 = await tx.$queryRaw<Row[]>`SELECT current_setting('app.current_sucursal_id', true) AS v`;
    allOk = fmt("app.current_sucursal_id", "UNSET", r2[0]?.v ?? null) && allOk;
  });
  console.log("");

  // ─────────────────────────────────────────────────────────────────────
  // Test 4: el valor persiste entre queries separadas dentro de la misma tx.
  // (Garantiza que el driver adapter pg no cambia de conexión entre queries.)
  // ─────────────────────────────────────────────────────────────────────
  console.log("Test 4: el valor persiste entre queries separadas dentro de la misma tx");
  await prisma.$transaction(async (tx) => {
    await setTenantContext(tx, ctx);
    // Simulamos "trabajo" en el medio. Usamos $executeRaw para queries sin
    // resultados esperados (pg_sleep retorna void — Prisma no lo deserializa).
    await tx.$executeRaw`SELECT 1::int`;
    await tx.$executeRaw`SELECT pg_sleep(0.05)`;
    const r = await tx.$queryRaw<Row[]>`SELECT current_setting('app.current_empresa_id', true) AS v`;
    allOk = fmt("app.current_empresa_id", "1", r[0]?.v ?? null) && allOk;
  });
  console.log("");

  console.log("=== PROBE COMPLETADO ===");
  if (!allOk) {
    console.error("\n❌ ALGUNOS TESTS FALLARON");
    process.exit(1);
  }
  console.log("\n✅ TODOS LOS TESTS PASARON — set_config() funciona correctamente con @prisma/adapter-pg");
}

probe()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("PROBE FAILED:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
