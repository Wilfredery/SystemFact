/**
 * Reportes domain — the server-side ROLE matrix and the dashboard tile gate (DB-2).
 *
 * Pure TypeScript (ADR-013). This is the single declarative source of truth for WHO may
 * read WHAT. The HTTP adapters enforce it with `tieneRolPermitidoEnTx` (which queries the
 * user's real DB roles) BEFORE any use case runs — hiding a UI button is NEVER the
 * control (AGENTS.md "Server-side authorization on every action"; DB-2 "UI hiding is not
 * the control"). Deny-by-default: a report id absent from the table, or a role that is
 * not listed, gets `REPORTE_NO_AUTORIZADO`.
 *
 * Binding proposal decision 5: Cobrador = CxC-family only (own branch, enforced
 * server-side); every other report/dashboard family = Administrador only. The per-report
 * table below already encodes that for the whole catalog so slices B–E consume the SAME
 * map and only extend it with new ids — the matrix never fragments.
 */

import type { ReporteId } from "./catalogo";
import { REPORTE_ID } from "./catalogo";

/** The persisted `ROL.nombre` values reportes cares about (matches the seeded catalog). */
export const ROL = {
  ADMINISTRADOR: "Administrador",
  OPERADOR: "Operador",
  COBRADOR: "Cobrador",
  DESPACHADOR: "Despachador",
} as const;

/** The CxC family — the ONLY reportes surface a Cobrador may reach (decision 5 / FIN-3). */
export const FAMILIA_CXC: readonly ReporteId[] = [REPORTE_ID.CXC];

/**
 * Allowed roles per report id. Default (any id NOT listed) is DENY — represented here by
 * the Administrador-only default via {@link rolesPermitidosParaReporte}. Only the CxC
 * family widens to Cobrador. Slice C keeps `CXC` and may add `CXP`/`COMPARATIVA` rows
 * here without touching any action — the map is the seam.
 */
export const ROLES_POR_REPORTE: Readonly<Partial<Record<ReporteId, readonly string[]>>> =
  {
    [REPORTE_ID.DASHBOARD]: [ROL.ADMINISTRADOR],
    [REPORTE_ID.VENTAS]: [ROL.ADMINISTRADOR],
    [REPORTE_ID.PRODUCTOS]: [ROL.ADMINISTRADOR],
    [REPORTE_ID.INVENTARIO]: [ROL.ADMINISTRADOR],
    [REPORTE_ID.FACTURAS]: [ROL.ADMINISTRADOR],
    [REPORTE_ID.CXC]: [ROL.ADMINISTRADOR, ROL.COBRADOR],
    [REPORTE_ID.CXP]: [ROL.ADMINISTRADOR],
    [REPORTE_ID.COMPARATIVA]: [ROL.ADMINISTRADOR],
    [REPORTE_ID.RENTABILIDAD]: [ROL.ADMINISTRADOR],
    [REPORTE_ID.ITBIS]: [ROL.ADMINISTRADOR],
    [REPORTE_ID.IT1]: [ROL.ADMINISTRADOR],
    [REPORTE_ID.DGII_606]: [ROL.ADMINISTRADOR],
    [REPORTE_ID.DGII_607]: [ROL.ADMINISTRADOR],
    [REPORTE_ID.DGII_608]: [ROL.ADMINISTRADOR],
  };

/**
 * The roles allowed to read a given report. An unlisted id falls back to
 * Administrador-only (deny-by-default widened only where the matrix says so), so a new
 * report added to the catalog without an explicit row is SAFE (admin-gated) by default.
 */
export function rolesPermitidosParaReporte(id: ReporteId): readonly string[] {
  return ROLES_POR_REPORTE[id] ?? [ROL.ADMINISTRADOR];
}

/** True when the user holds at least one of the report's allowed roles. */
export function rolPermitidoParaReporte(
  rolesUsuario: readonly string[],
  id: ReporteId,
): boolean {
  const permitidos = rolesPermitidosParaReporte(id);
  return rolesUsuario.some((r) => permitidos.includes(r));
}

// --- Dashboard tile gate (DB-2) ---

/** The dashboard's KPI tile identifiers (DB-1 KPI groups). */
export const TILE_DASHBOARD = {
  VENTAS_DIA: "VENTAS_DIA",
  VENTAS_MES: "VENTAS_MES",
  TOP_VENDEDORES: "TOP_VENDEDORES",
  FACTURAS_PENDIENTES: "FACTURAS_PENDIENTES",
  CXC: "CXC",
  INVENTARIO: "INVENTARIO",
} as const;
export type TileDashboard = (typeof TILE_DASHBOARD)[keyof typeof TILE_DASHBOARD];

const TODOS_TILES: readonly TileDashboard[] = Object.values(TILE_DASHBOARD);

/**
 * The CxC-family tiles a Cobrador may see. "Pending invoices count + total" and "total
 * CxC balance" are BOTH derived from the same canonical receivables query (DB-1), so the
 * receivables family is exactly these two tiles; sales, top-sellers and inventory are a
 * different family the Cobrador is denied.
 */
export const TILES_FAMILIA_CXC: readonly TileDashboard[] = [
  TILE_DASHBOARD.FACTURAS_PENDIENTES,
  TILE_DASHBOARD.CXC,
];

/**
 * Resolve the dashboard tile set a user may load (DB-2), purely from their role names:
 *   - Administrador → every tile (company-wide, the read then uses the ratified widen).
 *   - Cobrador (non-admin) → ONLY the CxC-family tiles, own branch (no widen, no branch
 *     parameter accepted — the caller passes their pinned `ctx`).
 *   - any other role (Despachador, Operador, …) → no tiles → the caller denies the whole
 *     dashboard read with `REPORTE_NO_AUTORIZADO` before running any aggregate.
 */
export function tilesPermitidos(rolesUsuario: readonly string[]): readonly TileDashboard[] {
  if (rolesUsuario.includes(ROL.ADMINISTRADOR)) return TODOS_TILES;
  if (rolesUsuario.includes(ROL.COBRADOR)) return [...TILES_FAMILIA_CXC];
  return [];
}

/** The two dashboard access scopes the read path branches on (DB-2, DB-4). */
export type AlcanceDashboard = "ADMIN" | "COBRADOR";

/**
 * Resolve the dashboard access SCOPE, or `null` to deny. Admin → company-wide (`ADMIN`,
 * the repository widens the branch GUC). Cobrador → own branch (`COBRADOR`, no widen).
 * Anyone else → `null` (deny before any query). An Admin who also holds Cobrador is
 * `ADMIN` (the wider access wins, and Admin already sees everything company-wide).
 */
export function alcanceDashboard(rolesUsuario: readonly string[]): AlcanceDashboard | null {
  if (rolesUsuario.includes(ROL.ADMINISTRADOR)) return "ADMIN";
  if (rolesUsuario.includes(ROL.COBRADOR)) return "COBRADOR";
  return null;
}
