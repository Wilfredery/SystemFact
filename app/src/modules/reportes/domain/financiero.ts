/**
 * Reportes domain — the CxP and comparativa row contracts (FIN-4, FIN-5; slice C).
 *
 * ADR-013: pure TypeScript. These are the value shapes the financial reports return (as
 * `Pagina<T>` rows) and that BOTH the UI panels and the CSV export render from the SAME
 * figures, so a screen total and an exported total can never diverge (EXP-2). EVERY monetary
 * figure is a `Decimal(12,2)` STRING — never a JS number — crossing the SQL boundary already
 * text-cast (the CxP outstanding balance is DERIVED at query time, ADR-017/FIN-4: `Compra.total
 * − ΣPagoProveedor APLICADO` over `estado ∈ {PENDIENTE, RECIBIDA}`; a PAGADA purchase nets 0).
 */

/**
 * The frozen purchase states the CxP report surfaces (FIN-4). `COMPRA.estado` is a DB enum
 * (`EstadoCompra`); an open payable exists ONLY for the two states the CxP aggregate selects, so
 * the row type narrows to that pair — never a free string (AGENTS.md "State enums frozen").
 */
export type EstadoCompraAbierta = "PENDIENTE" | "RECIBIDA";

/** One supplier purchase with its derived outstanding balance (FIN-4). */
export interface CxpFila {
  readonly compraId: number;
  readonly proveedorId: number;
  readonly proveedorNombre: string;
  readonly sucursalId: number;
  readonly sucursalNombre: string;
  /** The purchase document's SD calendar date (`YYYY-MM-DD`) of `Compra.fecha`. */
  readonly fechaSD: string;
  /** The open purchase state (PENDIENTE/RECIBIDA) — a frozen union, never a stored balance. */
  readonly estado: EstadoCompraAbierta;
  /** Purchase gross total, `Decimal(12,2)` string. */
  readonly total: string;
  /** Σ supplier payments APLICADO, `Decimal(12,2)` string. */
  readonly pagado: string;
  /** DERIVED outstanding = total − pagado, `Decimal(12,2)` string (0 never shown as negative). */
  readonly saldoPendiente: string;
}

/** One current-window day row of the comparativa (FIN-5 — the Total row is current-only). */
export interface ComparativaFila {
  /** SD calendar date of the CURRENT window (`YYYY-MM-DD`). */
  readonly fechaSD: string;
  /** Σ confirmed-sales neto that SD day (current window), `Decimal(12,2)` string. */
  readonly monto: string;
}
