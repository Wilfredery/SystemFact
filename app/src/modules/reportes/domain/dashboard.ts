/**
 * Reportes domain — the dashboard view contract (DB-1 KPI tiles).
 *
 * Pure types (ADR-013). The `application/consultar-dashboard` use case assembles this from
 * the infrastructure aggregates; the `/dashboard` UI renders only the tiles the caller's
 * role is permitted (DB-2). EVERY monetary figure is a `Decimal(12,2)` STRING and every
 * quantity a `Decimal(12,3)` STRING — never a JS number — so the dashboard, the matching
 * `/reportes` panel and a future CSV all carry byte-identical figures (EXP-2 parity).
 *
 * A tile the caller may NOT see is `null` (the use case never even runs its aggregate), so
 * a Cobrador's payload structurally cannot contain another family's data (DB-2).
 */

/** The confirmed-sales total for one SD calendar period (DB-1: ventas del día/mes). */
export interface VentasPeriodoKpi {
  /** Σ total of CONFIRMADA ventas in the window, Decimal(12,2) string. */
  readonly neto: string;
  /** Number of confirmed sales (COUNT), never a page-limited subset. */
  readonly operaciones: number;
}

/** One top-selling product row (DB-1: top sellers via `DetalleVenta` groupBy). */
export interface ProductoTopKpi {
  readonly productoId: number;
  readonly nombre: string;
  /** Σ units sold, Decimal(12,3) string. */
  readonly unidades: string;
  /** Σ line subtotal for the period, Decimal(12,2) string. */
  readonly monto: string;
}

/** The receivables family (pending invoices + total CxC), derived from the canonical query. */
export interface CxCResumenKpi {
  readonly facturasPendientes: number;
  readonly saldoTotal: string;
}

/** The inventory state (DB-1: units, low/out counts, valuation). */
export interface InventarioKpi {
  /** Σ units across the scope, Decimal(12,3) string. */
  readonly unidades: string;
  /** Σ (cantidad × costoPromedio) valuation, Decimal(12,2) string. */
  readonly valor: string;
  /** Products at/below `stockMinimo` but still > 0 units. */
  readonly bajoStock: number;
  /** Products at 0 (or below) units. */
  readonly agotados: number;
}

/**
 * The assembled dashboard. `alcance` records WHICH gate produced it (ADMIN company-wide or
 * COBRADOR own-branch) so the UI + tests can assert the widen path was actually taken.
 * Tiles the role cannot see are `null`.
 */
export interface DashboardVista {
  readonly alcance: "ADMIN" | "COBRADOR";
  readonly ventasDia: VentasPeriodoKpi | null;
  readonly ventasMes: VentasPeriodoKpi | null;
  readonly topVendedores: readonly ProductoTopKpi[] | null;
  readonly cxC: CxCResumenKpi | null;
  readonly inventario: InventarioKpi | null;
}

/** Cap on the top-sellers tile — it is a KPI, not a paginated report (a display limit). */
export const LIMITE_TOP_VENDEDORES = 10;
