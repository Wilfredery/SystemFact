import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { isProductionEnvironment } from "../tools/scripts/verify-rls-policy";

async function diagnose() {
  if (isProductionEnvironment(process.env.NODE_ENV)) {
    console.error("REFUSING to run mutating RLS probe in production. Use a local/dev database.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("=== DIAGNÓSTICO RLS ===\n");

  // 1. ¿Quiénes somos?
  const who = await prisma.$queryRaw<{ current_user: string; is_superuser: boolean }[]>`
    SELECT current_user::text AS current_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser
  `;
  console.log(`[1] current_user=${who[0]?.current_user} is_superuser=${who[0]?.is_superuser}`);

  // 2. ¿FORCE RLS está activo?
  const forceRls = await prisma.$queryRaw<{ tablename: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
    SELECT c.relname AS tablename, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
    ORDER BY c.relname
    LIMIT 30
  `;
  console.log(`[2] FORCE RLS en tablas con RLS (esperado: relforcerowsecurity=true para que aplique a owners):`);
  const forceCount = forceRls.filter(r => r.relforcerowsecurity).length;
  const totalRls = forceRls.length;
  console.log(`    ${forceCount}/${totalRls} tablas tienen FORCE RLS activo`);

  // 3. TEST CRÍTICO: ¿RLS bloquea queries a nuestro usuario?
  console.log(`\n[3] TEST CRÍTICO: ¿INSERT EMPRESA funciona con is_bootstrap=true?`);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
      await tx.empresa.create({
        data: {
          id: 99001,
          nombreComercial: "RLS Probe",
          rnc: "RLS-PROBE-99001",
          razonSocial: "Probe SA",
          direccionFiscal: "Probe",
          telefono: "000",
          correo: "probe@test",
          logo: "",
          regimenFiscal: "GENERAL",
        },
      });
    });
    console.log(`    ✓ INSERT exitoso`);

    const count = await prisma.empresa.count({ where: { id: 99001 } });
    console.log(`    SELECT sin tenant context -> count=${count}`);
    if (count === 0) {
      console.log(`    ✓ RLS ENFORCED: policy USING bloqueó el SELECT.`);
    } else if (count === 1) {
      console.log(`    ✗ RLS BYPASSED: SELECT devolvió la fila. Somos owner, las policies no nos aplican.`);
      console.log(`    CAUSA: Falta ALTER TABLE ... FORCE ROW LEVEL SECURITY.`);
    }

    // Cleanup
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
      await tx.empresa.delete({ where: { id: 99001 } });
    });
    console.log(`    ✓ Cleanup: EMPRESA 99001 eliminada`);
  } catch (e) {
    console.log(`    ✗ Falló:`, (e as Error).message);
  }

  await prisma.$disconnect();
}

diagnose().catch(async (e) => {
  console.error("DIAGNOSE FAILED:", e);
  await prisma.$disconnect();
  process.exit(1);
});