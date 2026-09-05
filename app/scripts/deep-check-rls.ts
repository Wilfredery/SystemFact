import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { isProductionEnvironment } from "../tools/scripts/verify-rls-policy";

async function deepCheck() {
  if (isProductionEnvironment(process.env.NODE_ENV)) {
    console.error("REFUSING to run mutating RLS probe in production. Use a local/dev database.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("=== DEEP CHECK: FORCE RLS ===\n");

  // 1. Estado específico de EMPRESA
  const empresaState = await prisma.$queryRaw<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
    relowner: string;
  }[]>`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS relowner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'EMPRESA'
  `;
  console.log(`[1] Estado de EMPRESA:`);
  console.log(JSON.stringify(empresaState[0], null, 2));

  // 2. ¿Quién es el owner y somos nosotros?
  const ourUser = await prisma.$queryRaw<{ current_user: string; usename: string }[]>`
    SELECT current_user, (SELECT usename FROM pg_user WHERE usename = current_user) AS usename
  `;
  console.log(`[2] current_user=${ourUser[0]?.current_user} usename=${ourUser[0]?.usename}`);

  // 3. ¿El rol postgres tiene BYPASSRLS?
  const roleAttrs = await prisma.$queryRaw<{ rolname: string; rolbypassrls: boolean }[]>`
    SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user
  `;
  console.log(`[3] Atributos del rol ${ourUser[0]?.current_user}:`);
  console.log(JSON.stringify(roleAttrs[0], null, 2));

  // 4. Inserto en transacción con flag bootstrap; después leo fuera de tenant context
  //    (sin bootstrap). Si RLS aplica, la fila debería ser invisible.
  console.log(`\n[4] TEST sin bootstrap, sin transacción:`);
  try {
    // No somos superuser: el flag bootstrap dentro de la transacción permite insertar.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
      await tx.empresa.create({
        data: {
          id: 99002,
          nombreComercial: "Test Bypass Check",
          rnc: "TEST-BYPASS-99002",
          razonSocial: "Test",
          direccionFiscal: "X",
          telefono: "0",
          correo: "x",
          logo: "",
          regimenFiscal: "GENERAL",
        },
      });
    });
    console.log(`    ✓ Insert OK`);

    // Ahora leo en una NUEVA query (fuera de la tx anterior)
    // Sin tenant context, sin bootstrap -> debería ver 0
    const count = await prisma.empresa.count({ where: { id: 99002 } });
    console.log(`    SELECT count(*) sin context -> ${count}`);

    // Y SELECT directo sin filter
    const allCount = await prisma.empresa.count();
    console.log(`    SELECT count(*) all -> ${allCount}`);

    // Cleanup
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
      await tx.empresa.delete({ where: { id: 99002 } });
    });
    console.log(`    ✓ Cleanup`);
  } catch (e) {
    console.log(`    ✗ Error:`, (e as Error).message);
  }

  await prisma.$disconnect();
}

deepCheck().catch(async (e) => {
  console.error("FAILED:", e);
  await prisma.$disconnect();
  process.exit(1);
});