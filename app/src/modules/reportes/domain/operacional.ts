/**
 * Reportes domain — the operational report row contracts (OP-1..OP-4).
 *
 * ADR-013: pure TypeScript. These are the value shapes every operational slice-B report
 * returns (as `Pagina<T>` rows) and that both the UI panels and the CSV export render from
 * the SAME figures, so screen and file can never diverge (EXP-2). EVERY monetary figure is
 * a `Decimal(12,2)` STRING and every quantity a `Decimal(12,3)` STRING — never a JS number —
 * crossing the SQL boundary already text-cast (OP-5).
 */

import { Decimal } from "decimal.js";

/** One Santo-Domingo calendar day of confirmed sales (OP-1). */
export interface VentasPeriodoFila {
  /** SD calendar date `YYYY-MM-DD` the rows group into (never a raw UTC date). */
  readonly fechaSD: string;
  /** Σ total of CONFIRMADA ventas that SD day, `Decimal(12,2)` string. */
  readonly neto: string;
  /** Confirmed sales in that day (COUNT), not a page-limited subset. */
  readonly operaciones: number;
}

/** One product's sold units + monto in the window (OP-2 — ranking applied in the domain). */
export interface ProductoVendidoFila {
  readonly productoId: number;
  readonly nombre: string;
  /** Σ units sold, `Decimal(12,3)` string. */
  readonly unidades: string;
  /** Σ line subtotal, `Decimal(12,2)` string. */
  readonly monto: string;
}

/** The per-line stock state, derived from `cantidad` vs `stockMinimo` (never stored). */
export type EstadoStock = "NORMAL" | "BAJO" | "AGOTADO";

/** One branch's stock line, valorized at the current `costoPromedio` (OP-3). */
export interface InventarioValorizadoFila {
  readonly inventarioId: number;
  readonly sucursalId: number;
  readonly sucursalNombre: string;
  readonly productoId: number;
  readonly productoNombre: string;
  /** Current stock, `Decimal(12,3)` string. */
  readonly cantidad: string;
  /** Current average cost, `Decimal(12,2)` string. */
  readonly costoPromedio: string;
  /** cantidad × costoPromedio valuation, `Decimal(12,2)` string. */
  readonly valor: string;
  readonly stockMinimo: number;
  readonly estadoStock: EstadoStock;
}

/** One `Factura.estado` × `tipoNcf` grid cell with derived payment-state counts (OP-4). */
export interface EstadoFacturaCelda {
  /** Stored fiscal state (VIGENTE/CANCELADA/ANULADA) — NOT a payment state. */
  readonly estado: string;
  /** The NCF series (B01/B02). */
  readonly tipoNcf: string;
  /** Invoices in this cell (COUNT). */
  readonly facturas: number;
  /** Σ invoice totals in this cell, `Decimal(12,2)` string. */
  readonly monto: string;
  /** VIGENTE invoices whose derived balance ≥ total (nothing collected). */
  readonly pendientes: number;
  /** VIGENTE invoices whose derived balance is strictly between 0 and total. */
  readonly parciales: number;
  /** VIGENTE invoices whose derived balance ≤ 0 (settled). */
  readonly pagadas: number;
}

/**
 * Classify one stock line's state (OP-3 flag) purely from its quantity and threshold — the
 * SAME semantics the dashboard rollup uses (agotado = `cantidad <= 0`; bajo = `0 < cantidad
 * <= stockMinimo`), expressed once as a reusable rule the row mapping applies. Compares with
 * `decimal.js` so a `0.000` and a `0.001` are never conflated by float rounding.
 */
export function clasificarStock(
  cantidad: string,
  stockMinimo: number,
): EstadoStock {
  const c = new Decimal(cantidad);
  if (c.lte(0)) return "AGOTADO";
  if (c.lte(new Decimal(stockMinimo))) return "BAJO";
  return "NORMAL";
}
