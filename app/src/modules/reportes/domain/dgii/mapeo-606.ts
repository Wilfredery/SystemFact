/**
 * Reportes domain — the DGII 606 code derivations from `Compra` facts (FIS-4/FIS-1; slice E,
 * task 5.4).
 *
 * ADR-013: PURE TypeScript, Decimal-only money. The 606 exporter reads the STORED purchase
 * amounts (`Compra.itbis`, `Compra.retencionItbis`, `Compra.retencionIsr` — the retention RATES
 * were already applied by the compra domain at confirm and persisted, so the export NEVER
 * re-derives a rate; AGENTS.md "Parameters from DB"). This module only CLASSIFIES the document
 * (D3 goods/services, D17 ISR-type, D23 forma-pago) and SPLITS the ITBIS (D14 al-costo / D15 por-
 * adelantar) per the binding FIS-1 rule.
 *
 * B11 / INFORMAL (research §7, spec FIS-1): an informal-supplier purchase yields NO ITBIS credit —
 * its ITBIS is carried to cost. So {@link derivarItbis606} puts the whole ITBIS in D14 (al-costo)
 * and zeroes D15 (por-adelantar); a FORMAL purchase takes ITBIS as advance (D15 = facturado,
 * D14 = 0). V1 has no proportional-credit (art. 349) split, so D13 stays 0 (documented default).
 *
 * The D3 / D17 DGII code VALUES that are business classifications come from a pure table keyed on
 * `Compra.tipoCompra`. D17 (ISR retention type 1–8) is a code whose exact 1–8 enumeration is
 * research-UNVERIFIED (like U3) — so its resolver takes an OPTIONAL DB map + a documented safe
 * default, the same config seam used for Tipo-Ingreso. D23 FormaPago is derived from whether a
 * payment was applied (V1 has only EFECTIVO).
 */

import { Decimal } from "decimal.js";
import { TIPO_INGRESO_POR_DEFECTO, type MapaTipoIngreso } from "./tipo-ingreso";

/** One rounded money value (2 dp) as a fixed string. */
function dinero(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}

/** The 606 D3 "Tipo Bienes/Servicios" categories (research §5, authoritative NG 06-2014 list). */
export const TIPO_BIENES_SERVICIOS = {
  PERSONAL: 1,
  TRABAJOS_SUMINISTROS_SERVICIOS: 2,
  ARRENDAMIENTOS: 3,
  ACTIVOS_FIJOS: 4,
  REPRESENTACION: 5,
  OTRAS_DEDUCCIONES: 6,
  FINANCIEROS: 7,
  EXTRAORDINARIOS: 8,
  COSTO_DE_VENTA: 9,
  ADQUISICION_ACTIVOS: 10,
  SEGUROS: 11,
} as const;

/**
 * Map a `Compra.tipoCompra` (the persisted fiscal classification) to the 606 D3 code. MERCANCIA →
 * 09 (cost of goods), SERVICIO_* → 02 (works/supplies/services), ALQUILER → 03 (leases). An
 * unknown/absent type falls back to 06 (otras deducciones admitidas) — never a blank.
 */
export function derivarTipoBienesServicios(tipoCompra: string | null | undefined): number {
  switch (tipoCompra) {
    case "MERCANCIA":
      return TIPO_BIENES_SERVICIOS.COSTO_DE_VENTA;
    case "SERVICIO_PROFESIONAL":
    case "SERVICIO_TECNICO":
      return TIPO_BIENES_SERVICIOS.TRABAJOS_SUMINISTROS_SERVICIOS;
    case "ALQUILER":
      return TIPO_BIENES_SERVICIOS.ARRENDAMIENTOS;
    default:
      return TIPO_BIENES_SERVICIOS.OTRAS_DEDUCCIONES;
  }
}

/**
 * The 606 D17 "Tipo de Retención en ISR" codes (1–8). The exact 1–8 DGII enumeration is
 * research-UNVERIFIED; the values below are the documented SystemFact defaults keyed on
 * `tipoCompra`, and the whole table is DB-overridable via `mapa` (the same config seam as
 * Tipo-Ingreso). 0 means "no ISR retention".
 */
export const TIPO_RETENCION_ISR = {
  NINGUNA: 0,
  PROFESIONAL: 1, // servicios profesionales / técnicos (30% or 2% per provider type)
  ALQUILER: 2,
} as const;

/** The documented safe D17 default when nothing is configured for the class. */
export const TIPO_RETENCION_ISR_POR_DEFECTO = TIPO_RETENCION_ISR.NINGUNA;

/**
 * Resolve the 606 D17 ISR-retention type code from the (optional) DB `mapa` keyed on `tipoCompra`,
 * falling back to a pure `tipoCompra` classification: an ISR was actually withheld
 * (`montoRetencionIsr > 0`) → PROFESIONAL/ALQUILER by class; a zero ISR retention → NINGUNA (0).
 * Never a guess beyond the documented default; the code TABLE itself is a U3-style tool seam.
 */
export function derivarTipoRetencionISR(params: {
  readonly tipoCompra: string | null | undefined;
  readonly montoRetencionIsr: string;
  readonly mapa?: MapaTipoIngreso;
}): number {
  if (params.mapa) {
    const cfg = params.mapa[params.tipoCompra ?? ""];
    if (cfg !== undefined && cfg !== "" && /^\d+$/.test(cfg)) return Number(cfg);
  }
  // No ISR actually withheld → code 0.
  if (new Decimal(params.montoRetencionIsr).isZero()) return TIPO_RETENCION_ISR.NINGUNA;
  if (params.tipoCompra === "ALQUILER") return TIPO_RETENCION_ISR.ALQUILER;
  return TIPO_RETENCION_ISR.PROFESIONAL;
}

/** The 606 D23 "Forma de Pago" codes (research §4, S13/S11: 1–7). */
export const FORMA_PAGO_606 = {
  EFECTIVO: 1,
  CHEQUE_TRANSFERENCIA: 2,
  TARJETA: 3,
  CREDITO: 4,
  PERMUTA: 5,
  NOTAS_CREDITO: 6,
  MIXTO: 7,
} as const;

/**
 * Derive the 606 D23 FormaPago from the purchase state + whether a supplier payment was applied
 * (V1's only method is EFECTIVO). A PAGADA purchase (or one with an applied pago) → 1 (Efectivo);
 * a RECIBIDA with no payment applied → 4 (compra a crédito). Deterministic and Decimal-free.
 */
export function derivarFormaPago606(params: {
  readonly estado: string; // Compra.estado (RECIBIDA | PAGADA)
  readonly pagado: string; // Σ applied PagoProveedor, Decimal string
}): number {
  const pagado = new Decimal(params.pagado);
  if (params.estado === "PAGADA" || pagado.gt(0)) return FORMA_PAGO_606.EFECTIVO;
  return FORMA_PAGO_606.CREDITO;
}

/** The 606 D14/D15 ITBIS split — D14 carried to cost, D15 taken as fiscal advance. */
export interface DesgloseITBIS606 {
  readonly itbisAlCosto: string; // D14
  readonly itbisPorAdelantar: string; // D15 (= facturado − al-costo)
  readonly itbisProporcionalidad: string; // D13 (art. 349 — 0 in V1)
}

/**
 * Split the purchase ITBIS into al-costo vs por-adelantar (FIS-1 B11 rule). An INFORMAL (B11)
 * purchase carries the WHOLE ITBIS to cost (no fiscal credit); a FORMAL purchase takes the whole
 * ITBIS as advance. V1 has no proportional-credit split, so D13 = 0 (documented default, never a
 * hidden re-derivation of a rate).
 */
export function derivarItbis606(params: {
  readonly itbisFacturado: string; // D11
  readonly proveedorInformal: boolean; // Proveedor.tipoProveedor === "INFORMAL"
}): DesgloseITBIS606 {
  const itbis = new Decimal(params.itbisFacturado);
  const cero = dinero(new Decimal(0));
  if (params.proveedorInformal) {
    return { itbisAlCosto: dinero(itbis), itbisPorAdelantar: cero, itbisProporcionalidad: cero };
  }
  return { itbisAlCosto: cero, itbisPorAdelantar: dinero(itbis), itbisProporcionalidad: cero };
}

/**
 * Whether a purchase document belongs in 606 at all (spec FIS-4): `estado ∈ {RECIBIDA, PAGADA}`
 * ONLY — BORRADOR/PENDIENTE/CANCELADA are excluded. A pure predicate the repository AND the unit
 * tests share (the "Draft purchase excluded" scenario). Kept as a frozen set, never free strings.
 */
export const ESTADOS_COMPRA_606 = ["RECIBIDA", "PAGADA"] as const;
export function correspondeA606(estado: string): boolean {
  return (ESTADOS_COMPRA_606 as readonly string[]).includes(estado);
}

/** Re-export the income-code default so a caller wiring the 606 map needs no second import. */
export { TIPO_INGRESO_POR_DEFECTO };
