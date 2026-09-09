/**
 * Compra calculators — pure Decimal-as-string fiscal math (ADR-013: no DB).
 *
 * Two responsibilities, both total functions over immutable inputs:
 *   1. Mixed-rate totals (18 / 16 / 0): per-line ITBIS is computed at the
 *      line's FROZEN rate and summed, so a purchase that mixes taxable and
 *      exempt lines totals exactly (spec "18/16/0 mix").
 *   2. ISR/ITBIS retentions: a `tipoCompra × supplier-class` matrix, with every
 *      rate supplied by the caller from `ConfiguracionEmpresa` (never
 *      hardcoded). The matrix and {@link requiredRetentionKeys} stay in lockstep
 *      so confirmation knows which tenant config keys are applicable.
 *
 * Rounding: money is `Decimal(12,2)`; every intermediate product is rounded
 * half-up to two decimals, matching how the values are stored per line.
 */

import { Decimal } from "decimal.js";
import { LINEA_INVALIDA, type CompraErrorCode } from "./errors";
import type {
  ClaseProveedor,
  CompraLineaCalculada,
  CompraLineaInput,
  RetencionesCompra,
  RetentionRates,
  TipoCompra,
  TipoPersona,
  TotalesCompra,
} from "./compra";
import { CLASE_PROVEEDOR, TIPO_COMPRA, TIPO_PERSONA } from "./compra";

/** Canonical zero amount for the `Decimal(12,2)` money columns. */
export const MONTO_CERO = "0.00";

/** Accepted per-line ITBIS rates (Ley 30-26): 18 / 16 / 0 percent. */
const TASAS_ITBIS_VALIDAS = new Set(["18", "16", "0"]);

/**
 * Validate a draft line at the domain boundary: a strictly positive base-unit
 * quantity (`Decimal(12,3)`), a non-negative unit cost (`Decimal(12,2)`), and a
 * frozen ITBIS rate restricted to the 18 / 16 / 0 set. Ownership/inactivity of
 * the referenced product is a DB concern and is checked by the application
 * layer. Returns `null` when valid, otherwise the stable `LINEA_INVALIDA` code.
 */
export function validarLinea(
  input: CompraLineaInput,
  tasaItbis: string,
): CompraErrorCode | null {
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(input.cantidad)) return LINEA_INVALIDA;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(input.costoUnitario)) return LINEA_INVALIDA;
  if (new Decimal(input.cantidad).lessThanOrEqualTo(0)) return LINEA_INVALIDA;
  if (new Decimal(input.costoUnitario).lessThan(0)) return LINEA_INVALIDA;
  if (!TASAS_ITBIS_VALIDAS.has(tasaItbis)) return LINEA_INVALIDA;
  return null;
}

function round2(value: Decimal): string {
  // Decimal.js `toDecimalPlaces(2)` rounds half-up (ROUND_HALF_UP) by default.
  return value.toDecimalPlaces(2).toFixed(2);
}

/**
 * Compute the per-line totals for one draft line: `subtotalLinea = cantidad *
 * costoUnitario`, and `itbisLinea` at the line's frozen rate (0 when the rate
 * is 0, i.e. an exempt line). All three money/quantity inputs are decimal
 * strings.
 */
export function calcularLinea(
  input: CompraLineaInput,
  tasaItbis: string,
): CompraLineaCalculada {
  const cantidad = new Decimal(input.cantidad);
  const costoUnitario = new Decimal(input.costoUnitario);
  const tasa = new Decimal(tasaItbis);

  const subtotalLinea = cantidad.times(costoUnitario);
  const itbisLinea =
    tasa.isZero() || subtotalLinea.isZero()
      ? new Decimal(0)
      : subtotalLinea.times(tasa).dividedBy(100);

  return {
    productoId: input.productoId,
    cantidad: input.cantidad,
    costoUnitario: input.costoUnitario,
    tasaItbis,
    subtotalLinea: round2(subtotalLinea),
    itbisLinea: round2(itbisLinea),
  };
}

/**
 * Aggregate frozen per-line amounts into the purchase totals. A line is
 * GRAVADO when its frozen rate is greater than zero (contributes to
 * `subtotalGravado` and `itbis`); otherwise it is EXENTO (contributes to
 * `subtotalExento` with zero ITBIS). `total` is the gross billed amount
 * (subtotal + itbis).
 */
export function calcularTotales(
  lineas: readonly CompraLineaCalculada[],
): TotalesCompra {
  let subtotalGravado = new Decimal(0);
  let subtotalExento = new Decimal(0);
  let itbis = new Decimal(0);

  for (const linea of lineas) {
    const tasa = new Decimal(linea.tasaItbis);
    const subtotalLinea = new Decimal(linea.subtotalLinea);
    const itbisLinea = new Decimal(linea.itbisLinea);

    if (tasa.greaterThan(0)) {
      subtotalGravado = subtotalGravado.plus(subtotalLinea);
    } else {
      subtotalExento = subtotalExento.plus(subtotalLinea);
    }
    itbis = itbis.plus(itbisLinea);
  }

  const subtotal = subtotalGravado.plus(subtotalExento);
  const total = subtotal.plus(itbis);

  return {
    subtotalGravado: subtotalGravado.toFixed(2),
    itbis: itbis.toFixed(2),
    subtotalExento: subtotalExento.toFixed(2),
    subtotal: subtotal.toFixed(2),
    total: total.toFixed(2),
  };
}

/** Configuration keys backing the four retention rates. */
export const RETENCION_CLAVES = {
  RET_ISR_15: "RET_ISR_15",
  RET_ISR_2: "RET_ISR_2",
  RET_ITBIS_100: "RET_ITBIS_100",
  RET_ITBIS_30: "RET_ITBIS_30",
} as const;
export type RetencionClave = (typeof RETENCION_CLAVES)[keyof typeof RETENCION_CLAVES];

/**
 * The ConfiguracionEmpresa keys a confirmation of this purchase requires. Used
 * to decide, before any fallback, whether tenant configuration is complete:
 * an applicable-but-missing key blocks confirmation (spec "Missing key blocks
 * confirm"). Kept in lockstep with {@link calcularRetenciones}.
 *
 * Rules:
 *   - INFORMAL supplier             → RET_ITBIS_100 (ITBIS withheld at 100%).
 *   - FORMAL professional / física  → RET_ISR_15.
 *   - FORMAL professional / jurídica→ RET_ITBIS_30.
 *   - FORMAL technical service      → RET_ISR_2.
 *   - FORMAL rental / física        → RET_ISR_15.
 *   - otherwise (formal merchandise,
 *     formal rental jurídica)       → no keys (zero retentions).
 */
export function requiredRetentionKeys(input: {
  readonly tipoCompra: TipoCompra;
  readonly tipoProveedor: ClaseProveedor;
  readonly tipoPersona: TipoPersona;
}): readonly RetencionClave[] {
  const { tipoCompra, tipoProveedor, tipoPersona } = input;

  if (tipoProveedor === CLASE_PROVEEDOR.INFORMAL) {
    return [RETENCION_CLAVES.RET_ITBIS_100];
  }

  switch (tipoCompra) {
    case TIPO_COMPRA.SERVICIO_PROFESIONAL:
      return tipoPersona === TIPO_PERSONA.FISICA
        ? [RETENCION_CLAVES.RET_ISR_15]
        : [RETENCION_CLAVES.RET_ITBIS_30];
    case TIPO_COMPRA.SERVICIO_TECNICO:
      return [RETENCION_CLAVES.RET_ISR_2];
    case TIPO_COMPRA.ALQUILER:
      return tipoPersona === TIPO_PERSONA.FISICA
        ? [RETENCION_CLAVES.RET_ISR_15]
        : [];
    case TIPO_COMPRA.MERCANCIA:
    default:
      return [];
  }
}

/**
 * Compute the ISR/ITBIS retentions for a purchase from its totals, its
 * `tipoCompra`, the supplier class, and the caller-supplied rate percentages.
 * The applicable branch mirrors {@link requiredRetentionKeys}:
 *   - ISR bases on the GRAVADO subtotal (the taxed service/rental amount);
 *   - ITBIS bases on the purchase ITBIS (the withheld fiscal credit).
 * Non-applicable rates are zero. Amounts are `Decimal(12,2)` strings.
 */
export function calcularRetenciones(
  totales: TotalesCompra,
  input: {
    readonly tipoCompra: TipoCompra;
    readonly tipoProveedor: ClaseProveedor;
    readonly tipoPersona: TipoPersona;
    readonly rates: RetentionRates;
  },
): RetencionesCompra {
  const { tipoCompra, tipoProveedor, tipoPersona, rates } = input;

  const gravado = new Decimal(totales.subtotalGravado);
  const itbis = new Decimal(totales.itbis);

  let retencionIsr = new Decimal(0);
  let retencionItbis = new Decimal(0);

  // ITBIS retention.
  if (tipoProveedor === CLASE_PROVEEDOR.INFORMAL) {
    // Informal supplier: withhold the full ITBIS (B11 regime).
    retencionItbis = itbis.times(new Decimal(rates.itbis100)).dividedBy(100);
  } else if (
    tipoCompra === TIPO_COMPRA.SERVICIO_PROFESIONAL &&
    tipoPersona === TIPO_PERSONA.JURIDICA
  ) {
    // Professional service from a formal legal entity: 30% of ITBIS.
    retencionItbis = itbis.times(new Decimal(rates.itbis30)).dividedBy(100);
  }

  // ISR retention (formal suppliers only — informal has no ISR rule here).
  if (tipoProveedor === CLASE_PROVEEDOR.FORMAL) {
    switch (tipoCompra) {
      case TIPO_COMPRA.SERVICIO_PROFESIONAL:
      case TIPO_COMPRA.ALQUILER:
        if (tipoPersona === TIPO_PERSONA.FISICA) {
          retencionIsr = gravado.times(new Decimal(rates.isr15)).dividedBy(100);
        }
        break;
      case TIPO_COMPRA.SERVICIO_TECNICO:
        retencionIsr = gravado.times(new Decimal(rates.isr2)).dividedBy(100);
        break;
      case TIPO_COMPRA.MERCANCIA:
      default:
        break;
    }
  }

  return {
    retencionIsr: retencionIsr.toFixed(2),
    retencionItbis: retencionItbis.toFixed(2),
  };
}
