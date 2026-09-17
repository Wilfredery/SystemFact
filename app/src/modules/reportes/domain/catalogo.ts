/**
 * Reportes domain — the report CATALOG: stable ids, families and display labels.
 *
 * Pure data. No framework imports. The `/reportes` selector and the deep-link contract
 * (`?reporte=<id>`) both key off {@link ReporteId}, so the URL, the selector UI and the
 * role-gate share ONE enumerable source of truth — a report id is never a free string
 * typed at a call site. `esReporteId` is the transport guard the URL mapper uses to drop
 * an unknown `reporte` value before it ever reaches an action.
 *
 * Slice A lands the DASHBOARD and the shell; the operational/financial/fiscal ids below
 * are the stable selectors the later slices (B–E) wire their panels to — declaring them
 * here keeps the deep-link contract frozen from PR 1, exactly as design "File Changes"
 * and proposal Routes intend.
 */

/** Every report family. Drives the selector's grouping and the role matrix keys. */
export const FAMILIA_REPORTE = {
  DASHBOARD: "DASHBOARD",
  OPERACIONAL: "OPERACIONAL",
  FINANCIERO: "FINANCIERO",
  COMPARATIVO: "COMPARATIVO",
  RENTABILIDAD: "RENTABILIDAD",
  FISCAL: "FISCAL",
} as const;
export type FamiliaReporte =
  (typeof FAMILIA_REPORTE)[keyof typeof FAMILIA_REPORTE];

/** Stable report identifiers — the `?reporte=` value. Frozen; never a free string. */
export const REPORTE_ID = {
  DASHBOARD: "dashboard",
  VENTAS: "ventas",
  PRODUCTOS: "productos",
  INVENTARIO: "inventario",
  FACTURAS: "facturas",
  CXC: "cxc",
  CXP: "cxp",
  COMPARATIVA: "comparativa",
  RENTABILIDAD: "rentabilidad",
  ITBIS: "itbis",
  IT1: "it1",
  DGII_606: "dgii-606",
  DGII_607: "dgii-607",
  DGII_608: "dgii-608",
} as const;
export type ReporteId = (typeof REPORTE_ID)[keyof typeof REPORTE_ID];

const IDS = new Set<string>(Object.values(REPORTE_ID));

/** True when `valor` is a known report id (transport guard for the URL mapper). */
export function esReporteId(valor: unknown): valor is ReporteId {
  return typeof valor === "string" && IDS.has(valor);
}

/** One catalog entry: an id, its family and the Spanish selector label. */
export interface EntradaCatalogo {
  readonly id: ReporteId;
  readonly familia: FamiliaReporte;
  readonly etiqueta: string;
}

/**
 * The selector catalog in display order. The DASHBOARD entry is the home tile (slice A);
 * the rest are the reports slices B–E attach panels to. Only DASHBOARD is `DISPONIBLES`
 * in slice A — the shell renders an honest "próximamente" for a not-yet-wired id so the
 * deep-link and selector contract is real before every panel exists.
 */
export const CATALOGO_REPORTES: readonly EntradaCatalogo[] = [
  { id: REPORTE_ID.DASHBOARD, familia: FAMILIA_REPORTE.DASHBOARD, etiqueta: "Panel de control" },
  { id: REPORTE_ID.VENTAS, familia: FAMILIA_REPORTE.OPERACIONAL, etiqueta: "Ventas por período" },
  { id: REPORTE_ID.PRODUCTOS, familia: FAMILIA_REPORTE.OPERACIONAL, etiqueta: "Productos vendidos" },
  { id: REPORTE_ID.INVENTARIO, familia: FAMILIA_REPORTE.OPERACIONAL, etiqueta: "Inventario valorizado" },
  { id: REPORTE_ID.FACTURAS, familia: FAMILIA_REPORTE.OPERACIONAL, etiqueta: "Estado de facturas" },
  { id: REPORTE_ID.CXC, familia: FAMILIA_REPORTE.FINANCIERO, etiqueta: "Cuentas por cobrar (CxC)" },
  { id: REPORTE_ID.CXP, familia: FAMILIA_REPORTE.FINANCIERO, etiqueta: "Cuentas por pagar (CxP)" },
  { id: REPORTE_ID.COMPARATIVA, familia: FAMILIA_REPORTE.COMPARATIVO, etiqueta: "Comparativa de períodos" },
  { id: REPORTE_ID.RENTABILIDAD, familia: FAMILIA_REPORTE.RENTABILIDAD, etiqueta: "Rentabilidad por producto" },
  { id: REPORTE_ID.ITBIS, familia: FAMILIA_REPORTE.FISCAL, etiqueta: "Resumen ITBIS" },
  { id: REPORTE_ID.IT1, familia: FAMILIA_REPORTE.FISCAL, etiqueta: "IT-1 (casillas)" },
  { id: REPORTE_ID.DGII_606, familia: FAMILIA_REPORTE.FISCAL, etiqueta: "DGII 606 (compras)" },
  { id: REPORTE_ID.DGII_607, familia: FAMILIA_REPORTE.FISCAL, etiqueta: "DGII 607 (ventas)" },
  { id: REPORTE_ID.DGII_608, familia: FAMILIA_REPORTE.FISCAL, etiqueta: "DGII 608 (anulados)" },
];

/**
 * Report ids live in slice A (dashboard only). The `/reportes` shell renders a data
 * panel for these and a "próximamente" for the rest, keeping the selector honest.
 */
export const REPORTES_DISPONIBLES_SLICE_A: readonly ReporteId[] = [
  REPORTE_ID.DASHBOARD,
];

/** The catalog entry for an id, or `undefined` when unknown. */
export function entradaDeCatalogo(id: ReporteId): EntradaCatalogo | undefined {
  return CATALOGO_REPORTES.find((e) => e.id === id);
}
