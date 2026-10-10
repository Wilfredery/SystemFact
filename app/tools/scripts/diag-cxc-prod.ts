/**
 * READ-ONLY CxC derived diagnostic (`pnpm diag:cxc`, OPERATOR tool).
 *
 * Prints every FACTURA row of every tenant with its DERIVED pending balance
 * (total - COBROs APLICADO - NC VIGENTE + ND VIGENTE), the single canonical
 * formula per ADR-017 (balances are derived, never materialized). Mirrors what
 * `buscarPendiente` (e2e/cobros.spec.ts) and the cobros board/estado-de-cuenta
 * resolve, so a UI/suite disagreement can be reconciled against raw rows.
 *
 * Connection: DOES NOT SHARE the popover envs of the other seeds. Sets NOTHING;
 * reads `DIRECT_URL` directly (run via `diag-cxc-prod.ps1` hidden-input
 * launcher). Superuser/operator connection only (one tenant-agnostic query).
 * ZERO writes: the script body is exactly one select.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

interface Fila {
  empresaId: number;
  facturaId: number;
  ncf: string;
  estado: string;
  clienteId: number | null;
  total: string;
  saldoPendiente: string;
}

async function main(): Promise<void> {
  const url = process.env["DIRECT_URL"];
  if (!url) {
    throw new Error("diag-cxc-prod: DIRECT_URL not set (run via diag-cxc-prod.ps1, hidden input).");
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    // ADR-017 derived pending: cobros APLICADO pagados e notas vigentes.
    const filas = await db.$queryRaw<Fila[]>`
      select f."empresaId",
             f.id as "facturaId",
             f.ncf,
             f.estado,
             f."clienteId",
             f.total::text as total,
             (f.total
                - coalesce((select sum(p.monto) from "PAGO" p
                             where p."facturaId" = f.id and p."tipo" = 'COBRO' and p.estado = 'APLICADO'), 0)
                - coalesce((select sum(nc.monto) from "NOTA_CREDITO" nc
                             where nc."facturaOriginalId" = f.id and nc.estado = 'VIGENTE'), 0)
                + coalesce((select sum(nd.monto) from "NOTA_DEBITO" nd
                             where nd."facturaOriginalId" = f.id and nd.estado = 'VIGENTE'), 0)
             )::text as "saldoPendiente"
        from "FACTURA" f
       order by f."empresaId", f.id`;
    console.log("empresaId | factura | ncf | estado | clienteId | total | saldoPendiente");
    let pendientes = 0;
    for (const f of filas) {
      if (Number(f.saldoPendiente) > 0) pendientes += 1;
      console.log(
        `${f.empresaId} | ${f.facturaId} | ${f.ncf} | ${f.estado} | ${String(f.clienteId)} | ${f.total} | ${f.saldoPendiente}`,
      );
    }
    console.log(`SUMMARY: ${filas.length} FACTURA rows; ${pendientes} with saldoPendiente > 0`);
  } finally {
    await db.$disconnect();
  }
}

// CLI wiring parity with the other tools scripts: no top-level await.
const invokedAsMain = process.argv[1] !== undefined && process.argv[1].endsWith("diag-cxc-prod.ts");
if (invokedAsMain) {
  void main();
}
