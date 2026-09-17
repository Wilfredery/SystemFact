/**
 * Reportes UI — presentation formatters (dashboard tiles + selector labels).
 *
 * Boundary-only helpers turning the Decimal-STRING figures the use case returns into
 * Dominican display. They compute NOTHING business-wise: money is parsed through `decimal.js`
 * and converted to a JS number only INSIDE the `Intl` currency formatter (a display
 * boundary, not arithmetic — AGENTS.md "Money = Decimal"). {@link formatearMontoDO} and
 * {@link formatearCantidad} REUSE the ratified cobros formatters (the same `es-DO`/DOP and
 * 3-dp quantity dialect) rather than re-implementing them, so a dashboard total and a CxC
 * board total render identically (EXP-2 parity of DISPLAY).
 */

import { Decimal } from "decimal.js";
import type { FamiliaReporte, ReporteId } from "../domain/catalogo";

// Re-exported so the dashboard/reportes UI has ONE money formatter to reach for.
export { formatearMontoDO, formatearFechaDO } from "@/modules/cobros/ui/format";

const NUMERO_DO = new Intl.NumberFormat("es-DO", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/** A `Decimal(12,3)` quantity string → Dominican 3-dp display (never a float sum). */
export function formatearCantidad(valor: string): string {
  const t = valor.trim();
  if (!/^-?\d{1,12}(\.\d{1,3})?$/.test(t)) return valor;
  return NUMERO_DO.format(new Decimal(t).toNumber());
}

/** A plain integer count (operations / invoices) → grouped display. */
export function formatearEntero(valor: number): string {
  return new Intl.NumberFormat("es-DO").format(valor);
}

/** Spanish selector label per report family heading. */
export const ETIQUETA_FAMILIA: Record<FamiliaReporte, string> = {
  DASHBOARD: "Panel",
  OPERACIONAL: "Operacionales",
  FINANCIERO: "Financieros",
  COMPARATIVO: "Comparativos",
  RENTABILIDAD: "Rentabilidad",
  FISCAL: "Fiscales",
};

/** A short one-line description for each report (UX 2.5.2/2.5.3 list-before-export). */
export const DESCRIPCION_REPORTE: Partial<Record<ReporteId, string>> = {
  dashboard: "KPIs del día y del mes en Santo Domingo, top vendedores, CxC e inventario.",
  ventas: "Ventas confirmadas agrupadas por día Santo-Domingo.",
  productos: "Productos más y menos vendidos en el período.",
  inventario: "Inventario valorizado por sucursal al costo promedio actual.",
  facturas: "Estado de cobro derivado (Pendiente/Parcial/Pagada) por factura.",
  cxc: "Cuentas por cobrar con aging y mora, saldo derivado canónico.",
  cxp: "Cuentas por pagar sobre compras recibidas menos pagos aplicados.",
  comparativa: "Período actual contra el período inmediatamente anterior.",
  rentabilidad: "Margen por producto (costo promedio actual — ver limitación).",
  itbis: "Resumen ITBIS trasladado y retenido por período.",
  it1: "Resumen de casillas IT-1 (débito/crédito/retenido).",
  "dgii-606": "Compras — exportación TXT DGII 606.",
  "dgii-607": "Ventas — exportación TXT DGII 607.",
  "dgii-608": "Anulados — exportación TXT DGII 608.",
};
