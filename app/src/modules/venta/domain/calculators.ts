/**
 * Venta calculators — pure Decimal-as-string fiscal math (ADR-013: no DB).
 *
 * Frozen computation order (spec R-V5), per line:
 *   subtotalBruto = round2(cantidad × precioUnitario)
 *   → resolve LINE discount by `descuentoTipo` (PORCENTAJE: round2(bruto × valor/100);
 *     MONTO: round2(valor)) → net base = bruto − line discount
 *   → HEADER proration across all lines (spec R-V6) → itbisLinea = round2(base × tasa/100)
 * Totals are the SUMS of per-line rounded values. All arithmetic uses decimal
 * strings (decimal.js, half-up 2dp); floats MUST NOT appear. Parity with
 * `compra/domain/calculators.ts`.
 *
 * `precioUnitario` is ITBIS-EXCLUSIVE (ADR-018 net base): the customer pays
 * `total = base + ITBIS`.
 */

import { Decimal } from "decimal.js";
import {
  LINEA_INVALIDA,
  VentaDomainError,
  type VentaErrorCode,
} from "./errors";
import {
  DESCUENTO_CERO,
  DESCUENTO_TIPO,
  type Descuento,
  type TotalesVenta,
  type VentaLineaCalculada,
  type VentaLineaInput,
} from "./venta";

/** Canonical zero amount for the `Decimal(12,2)` money columns. */
export const MONTO_CERO = "0.00";

/** Accepted per-line ITBIS rates (Ley 30-26): 18 / 16 / 0 percent. */
const TASAS_ITBIS_VALIDAS = new Set(["18", "16", "0"]);

/** Round a Decimal to a 2dp money string, half-up (decimal.js default). */
function round2(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/**
 * Validate a draft line at the domain boundary: strictly positive quantity
 * (`Decimal(12,3)`), non-negative unit price (`Decimal(12,2)`), and a frozen
 * ITBIS rate restricted to 18 / 16 / 0. Product ownership/inactivity is a DB
 * concern checked by the application layer. Returns `null` when valid, otherwise
 * the stable `LINEA_INVALIDA` code (spec R-V1).
 */
export function validarLineaVenta(
  input: VentaLineaInput,
  tasaItbis: string,
): VentaErrorCode | null {
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(input.cantidad)) return LINEA_INVALIDA;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(input.precioUnitario)) return LINEA_INVALIDA;
  if (new Decimal(input.cantidad).lessThanOrEqualTo(0)) return LINEA_INVALIDA;
  if (new Decimal(input.precioUnitario).lessThan(0)) return LINEA_INVALIDA;
  if (!TASAS_ITBIS_VALIDAS.has(tasaItbis)) return LINEA_INVALIDA;
  return null;
}

/**
 * Resolve a discount's MONEY value against a base:
 *   PORCENTAJE → round2(base × valor / 100)
 *   MONTO      → round2(valor)
 * The result is 2dp and never negative.
 */
export function resolverDescuentoAMoney(d: Descuento, base: string): string {
  const b = new Decimal(base);
  const valor = new Decimal(d.descuentoValor);
  if (d.descuentoTipo === DESCUENTO_TIPO.PORCENTAJE) {
    return round2(b.times(valor).dividedBy(100));
  }
  return round2(valor);
}

/**
 * Compute the per-line PRE-HEADER amounts for one draft line: gross subtotal,
 * resolved line-discount money, the net base (`bruto − descuentoLinea`) and the
 * ITBIS on that base at the line's frozen rate. Header proration is applied on
 * top of `baseLinea` by {@link calcularTotalesVenta}.
 */
export function calcularLineaVenta(
  input: VentaLineaInput,
  tasaItbis: string,
): VentaLineaCalculada {
  const cantidad = new Decimal(input.cantidad);
  const precioUnitario = new Decimal(input.precioUnitario);
  const tasa = new Decimal(tasaItbis);

  const subtotalBruto = round2(cantidad.times(precioUnitario));
  const descuentoLinea = resolverDescuentoAMoney(
    input.descuento,
    subtotalBruto,
  );

  const baseLinea = new Decimal(subtotalBruto).minus(new Decimal(descuentoLinea));
  const itbisLinea =
    tasa.isZero() || baseLinea.isZero()
      ? "0.00"
      : round2(baseLinea.times(tasa).dividedBy(100));

  return {
    productoId: input.productoId,
    cantidad: input.cantidad,
    precioUnitario: input.precioUnitario,
    tasaItbis,
    subtotalBruto,
    descuentoTipo: input.descuento.descuentoTipo,
    descuentoLinea,
    baseLinea: baseLinea.toFixed(2),
    itbisLinea,
  };
}

/** A line after header proration: final base and final ITBIS. */
export interface VentaLineaFinal {
  readonly productoId: number;
  readonly tasaItbis: string;
  readonly subtotalBruto: string;
  readonly descuentoLinea: string;
  /** Prorated header share applied to this line (2dp). */
  readonly descuentoCabeceraLinea: string;
  /** Final net base: `baseLinea − descuentoCabeceraLinea`. */
  readonly baseFinal: string;
  readonly itbisLinea: string;
}

/** Full sale computation: final per-line detail plus the fiscal totals. */
export interface VentaTotalesCalculo {
  readonly lineas: readonly VentaLineaFinal[];
  readonly totales: TotalesVenta;
}

/**
 * Resolve the HEADER discount to money. PORCENTAJE is measured on the aggregate
 * gross subtotal (Σ `subtotalBruto`); MONTO is taken as-is. Zero discount
 * (PORCENTAJE 0.00) resolves to 0.00.
 */
function resolverDescuentoCabecera(d: Descuento, subtotalBrutoTotal: string): string {
  return resolverDescuentoAMoney(d, subtotalBrutoTotal);
}

/**
 * Compute the prorated header discount shares across all lines.
 *
 * Algorithm (spec R-V6):
 *   denominator = Σ net bases over ALL lines (gravado AND exento alike), where the
 *   net base is the post-line-discount `baseLinea`.
 *   raw share_i = D × baseLinea_i / denominator, rounded half-up to 2dp.
 *   remainder = D − Σ shares.
 *   The remainder is applied to the line with the LARGEST `baseLinea`; ties go to
 *   the EARLIEST line position, so Σ shares = D exactly.
 * With zero header discount, every share is 0.00 and no remainder arises.
 */
function prorratearDescuentoCabecera(
  lineas: readonly VentaLineaCalculada[],
  descuentoCabecera: string,
): string[] {
  const shares = lineas.map((l) => new Decimal(l.baseLinea));
  const denominator = shares.reduce((acc, b) => acc.plus(b), new Decimal(0));
  const D = new Decimal(descuentoCabecera);

  if (D.isZero() || denominator.isZero()) {
    return lineas.map(() => MONTO_CERO);
  }

  // Round each share half-up; track the original (unrounded) base for the
  // largest-base tie-break using the net base (baseLinea).
  const rounded = lineas.map((l) =>
    round2(D.times(new Decimal(l.baseLinea)).dividedBy(denominator)),
  );

  const sumRounded = rounded.reduce(
    (acc, s) => acc.plus(new Decimal(s)),
    new Decimal(0),
  );
  const remainder = D.minus(sumRounded);

  if (!remainder.isZero()) {
    // Largest net base; ties → earliest position.
    let target = 0;
    for (let i = 1; i < lineas.length; i++) {
      if (
        new Decimal(lineas[i].baseLinea).greaterThan(
          new Decimal(lineas[target].baseLinea),
        )
      ) {
        target = i;
      }
    }
    rounded[target] = new Decimal(rounded[target]).plus(remainder).toFixed(2);
  }

  return rounded;
}

/**
 * Compute the authoritative sale totals from the per-line base calculations plus
 * a header discount. Applies the R-V6 proration before ITBIS so a mixed
 * gravado/exento draft totals exactly, and returns (never stores) the
 * gravado/exento breakdown. The stored identity
 * `total = subtotal − descuento + itbis` holds exactly (spec R-V6).
 */
export function calcularTotalesVenta(
  lineas: readonly VentaLineaCalculada[],
  headerDiscount: Descuento,
): VentaTotalesCalculo {
  const subtotal = lineas
    .reduce((acc, l) => acc.plus(new Decimal(l.subtotalBruto)), new Decimal(0))
    .toFixed(2);

  const descuentoCabecera = resolverDescuentoCabecera(headerDiscount, subtotal);
  const shares = prorratearDescuentoCabecera(lineas, descuentoCabecera);

  let subtotalGravado = new Decimal(0);
  let subtotalExento = new Decimal(0);
  let itbis = new Decimal(0);
  let descuentoLineasTotal = new Decimal(0);

  const finales: VentaLineaFinal[] = lineas.map((l, i) => {
    const share = shares[i];
    const baseFinal = new Decimal(l.baseLinea).minus(new Decimal(share));
    const tasa = new Decimal(l.tasaItbis);
    const itbisLinea =
      tasa.isZero() || baseFinal.isZero()
        ? "0.00"
        : round2(baseFinal.times(tasa).dividedBy(100));

    if (tasa.greaterThan(0)) {
      subtotalGravado = subtotalGravado.plus(baseFinal);
    } else {
      subtotalExento = subtotalExento.plus(baseFinal);
    }
    itbis = itbis.plus(new Decimal(itbisLinea));
    descuentoLineasTotal = descuentoLineasTotal.plus(new Decimal(l.descuentoLinea));

    return {
      productoId: l.productoId,
      tasaItbis: l.tasaItbis,
      subtotalBruto: l.subtotalBruto,
      descuentoLinea: l.descuentoLinea,
      descuentoCabeceraLinea: share,
      baseFinal: baseFinal.toFixed(2),
      itbisLinea,
    };
  });

  // Stored `descuento` = Σ line discounts + header money (R-V7: money, never raw %).
  const descuento = descuentoLineasTotal
    .plus(new Decimal(descuentoCabecera))
    .toFixed(2);

  const total = new Decimal(subtotal)
    .minus(new Decimal(descuento))
    .plus(itbis)
    .toFixed(2);

  return {
    lineas: finales,
    totales: {
      subtotal,
      descuentoCabecera,
      descuento,
      itbis: itbis.toFixed(2),
      subtotalGravado: subtotalGravado.toFixed(2),
      subtotalExento: subtotalExento.toFixed(2),
      total,
    },
  };
}

/** Convenience: full pipeline from raw inputs (validates line shapes) → totals. */
export function calcularVenta(
  entradas: readonly { linea: VentaLineaInput; tasaItbis: string }[],
  headerDiscount: Descuento = DESCUENTO_CERO,
): VentaTotalesCalculo {
  const calculadas = entradas.map((e) => {
    // Honor the documented contract: the pipeline validates before calculating
    // (defense-in-depth; the application layer already validates per line).
    const invalid = validarLineaVenta(e.linea, e.tasaItbis);
    if (invalid !== null) throw new VentaDomainError(invalid);
    return calcularLineaVenta(e.linea, e.tasaItbis);
  });
  return calcularTotalesVenta(calculadas, headerDiscount);
}
