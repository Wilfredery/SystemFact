/**
 * Reportes application — the role-aware dashboard use case (DB-1, DB-2, DB-4).
 *
 * A thin read orchestration (ADR-013): it resolves the acting user's real DB roles, applies
 * the pure {@link alcanceDashboard}/{@link tilesPermitidos} gate, and calls ONE canonical
 * aggregate per permitted KPI. It runs inside the caller's `withTenantTransaction` (the
 * http adapter opens it) and does NOT re-wrap (no nested transactions). Composition:
 *
 *   1. DENY-BY-DEFAULT: a role with no dashboard scope (Operador/Despachador/…) is refused
 *      with `REPORTE_NO_AUTORIZADO` BEFORE any aggregate runs — no row is peeked for a
 *      denied actor (DB-2 "UI hiding is not the control").
 *   2. ADMIN → company-wide: the KPI reads run inside {@link conSucursalAmpliadaEnTx} (the
 *      ratified widen: branch GUC cleared, restored in `finally`; empresa never cleared,
 *      DB-4). Sales/top/inventory + the CxC summary all funnel through the SAME canonical
 *      aggregates the `/reportes` screens use, so the two can never diverge (EXP-2 parity).
 *   3. COBRADOR → own branch, CxC-family ONLY: the CxC read runs with their branch GUC in
 *      force (RLS pins to the assignment branch; no branch parameter is accepted), and the
 *      sales/top/inventory tiles are structurally `null` — never queried (DB-2).
 *
 * The CxC summary REUSES `consultarSaldoCxcEnTx` (the single canonical derived-balance
 * aggregate, ADR-017); the pending count + total is a Decimal reduction over its already-
 * derived per-invoice rows ({@link resumirCxC}), NOT a second balance query and NOT a
 * float sum.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { consultarSaldoCxcEnTx } from "@/modules/cobros/infrastructure/saldo-cxc.repository";
import {
  LIMITE_TOP_VENDEDORES,
  type DashboardVista,
  type CxCResumenKpi,
} from "../domain/dashboard";
import {
  REPORTE_NO_AUTORIZADO,
  messageFor,
} from "../domain/errors";
import { ok, type ReportResult } from "../domain/reporte-resultado";
import { resumenFromFilas } from "./cxc-mapeo";
import { alcanceDashboard } from "../domain/roles";
import { ventanaDiaSD, ventanaMesSD } from "../domain/periodo";
import { leerRolesUsuarioEnTx } from "../infrastructure/roles-repository";
import { conSucursalAmpliadaEnTx } from "../infrastructure/widen-sucursal-guc";
import {
  estadoInventarioEnTx,
  topVendedoresEnTx,
  totalesVentasEnTx,
} from "../infrastructure/dashboard-repository";

/** Options; `now` is injected for deterministic SD-boundary tests. */
export interface ConsultarDashboardInput {
  readonly now?: Date;
}

/**
 * Assembles the dashboard for the acting user under their permitted scope, or denies. Any
 * unexpected infrastructure failure PROPAGATES (never translated into a typed result here —
 * AGENTS.md "Never expose stack traces or internal Prisma errors to the client").
 */
export async function consultarDashboard(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ConsultarDashboardInput = {},
): Promise<ReportResult<DashboardVista>> {
  const roles = await leerRolesUsuarioEnTx(tx, ctx);
  const alcance = alcanceDashboard(roles);
  if (alcance === null) {
    return {
      ok: false,
      code: REPORTE_NO_AUTORIZADO,
      message: messageFor(REPORTE_NO_AUTORIZADO),
    };
  }

  const now = input.now ?? new Date();

  if (alcance === "COBRADOR") {
    // Own branch only, CxC family only, NO widen (branch GUC stays pinned by RLS).
    const filas = await consultarSaldoCxcEnTx(tx, ctx);
    const cxC: CxCResumenKpi = resumenFromFilas(filas);
    return ok<DashboardVista>({
      alcance: "COBRADOR",
      ventasDia: null,
      ventasMes: null,
      topVendedores: null,
      cxC,
      inventario: null,
    });
  }

  // ADMIN — company-wide via the ratified widen helper (empresa GUC never touched).
  const vista = await conSucursalAmpliadaEnTx(tx, ctx, async (txw) => {
    const dia = ventanaDiaSD(now);
    const mes = ventanaMesSD(now);
    const [ventasDia, ventasMes, top, filas, inventario] = await Promise.all([
      totalesVentasEnTx(txw, ctx, { desde: dia.desde, hasta: dia.hasta }),
      totalesVentasEnTx(txw, ctx, { desde: mes.desde, hasta: mes.hasta }),
      topVendedoresEnTx(txw, ctx, { desde: mes.desde, hasta: mes.hasta }, LIMITE_TOP_VENDEDORES),
      consultarSaldoCxcEnTx(txw, ctx),
      estadoInventarioEnTx(txw, ctx),
    ]);
    return {
      alcance: "ADMIN",
      ventasDia: { neto: ventasDia.neto, operaciones: ventasDia.operaciones },
      ventasMes: { neto: ventasMes.neto, operaciones: ventasMes.operaciones },
      topVendedores: top.map((t) => ({
        productoId: t.productoId,
        nombre: t.nombre,
        unidades: t.unidades,
        monto: t.monto,
      })),
      cxC: resumenFromFilas(filas),
      inventario: {
        unidades: inventario.unidades,
        valor: inventario.valor,
        bajoStock: inventario.bajoStock,
        agotados: inventario.agotados,
      },
    } satisfies DashboardVista;
  });

  return ok(vista);
}
