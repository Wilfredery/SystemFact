/**
 * Venta discount cap rules — pure, DB-free (spec R-V7, R-V8).
 *
 * {@link validarDescuentosContraMaximo} enforces, on the GROSS bases:
 *   1. every line's resolved discount money ≤ `descMax`% of that line's
 *      `subtotalBruto`;
 *   2. a PORCENTAJE header's percentage input ≤ `descMax`;
 *   3. the total effective discount (Σ line money + header money) ≤ `descMax`%
 *      of Σ `subtotalBruto`.
 * Any violation → `DESCUENTO_EXCEDE_MAXIMO` (zero writes; enforcement is invoked
 * by the use case BEFORE the write in PR-2 — this is the pure decision rule).
 * A resolved discount exceeding its own base → `DESCUENTO_EXCEDE_BASE`.
 * A malformed shape (MONTO 0.00, negative/non-numeric amount, unknown type) →
 * `DESCUENTO_INVALIDO`. A zero discount is the canonical PORCENTAJE/0.00 with a
 * NULL `descuentoAutorizadoPor` (R-V7) and needs NO `DESC_MAX` lookup.
 */

import { Decimal } from "decimal.js";
import {
  DESCUENTO_EXCEDE_BASE,
  DESCUENTO_EXCEDE_MAXIMO,
  DESCUENTO_INVALIDO,
  type VentaErrorCode,
} from "./errors";
import {
  DESCUENTO_CERO,
  DESCUENTO_TIPO,
  esDescuentoCero,
  type Descuento,
  type DescuentoTipo,
} from "./venta";
import { resolverDescuentoAMoney } from "./calculators";

/** One line's cap-relevant data (gross base + its discount, as submitted). */
export interface DescuentoLineaCap {
  readonly subtotalBruto: string;
  readonly descuento: Descuento;
}

/** Input to {@link validarDescuentosContraMaximo}. */
export interface ValidacionDescuentosInput {
  readonly lineas: readonly DescuentoLineaCap[];
  readonly descuentoCabecera: Descuento;
  /** The tenant `DESC_MAX` percentage cap (e.g. "4.00"). Never hardcoded. */
  readonly descMax: string;
}

/** Normalized, stored discount shape (money is resolved downstream). */
export interface DescuentoNormalizado {
  readonly descuentoTipo: DescuentoTipo;
  readonly descuentoValor: string;
  /** `null` for a zero discount (no authorizer); admin id is set by the use case. */
  readonly descuentoAutorizadoPor: number | null;
}

const TIPOS_VALIDOS = new Set<string>([
  DESCUENTO_TIPO.PORCENTAJE,
  DESCUENTO_TIPO.MONTO,
]);

/** Normalize an absent/zero discount to the canonical PORCENTAJE/0.00 shape (R-V7). */
export function normalizarDescuento(d: Descuento | null | undefined): Descuento {
  if (!d || esDescuentoCero(d)) return DESCUENTO_CERO;
  return d;
}

/**
 * Validate the SHAPE of a single discount. Returns the stable code, or `null`
 * when well-formed. A zero discount (PORCENTAJE 0.00) is valid; MONTO 0.00 and
 * any negative/non-numeric amount or unknown type is `DESCUENTO_INVALIDO`.
 */
export function validarFormaDescuento(d: Descuento): VentaErrorCode | null {
  if (!TIPOS_VALIDOS.has(d.descuentoTipo)) return DESCUENTO_INVALIDO;
  // Validate the RAW value (no trim): decimal.js rejects padded strings, so
  // " 5.00" must be a typed DESCUENTO_INVALIDO, not a Decimal constructor throw.
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(d.descuentoValor)) {
    return DESCUENTO_INVALIDO;
  }
  const valor = new Decimal(d.descuentoValor);
  if (valor.isNegative()) return DESCUENTO_INVALIDO;
  // A MONTO of exactly 0.00 is a shape mismatch — the zero convention is PORCENTAJE.
  if (d.descuentoTipo === DESCUENTO_TIPO.MONTO && valor.isZero()) {
    return DESCUENTO_INVALIDO;
  }
  return null;
}

/** True when the whole draft carries no discount effect (header + every line). */
export function noHayDescuento(
  lineas: readonly DescuentoLineaCap[],
  cabecera: Descuento,
): boolean {
  if (!esDescuentoCero(normalizarDescuento(cabecera))) return false;
  return lineas.every((l) => esDescuentoCero(normalizarDescuento(l.descuento)));
}

/**
 * Triple-cap + shape/base validation on the GROSS bases. Returns `ok:true` when
 * the discounts are admissible, or the first stable violation. Does NOT perform
 * the Administrador authorization check (that is a server-side role test in the
 * use case, PR-2); this rule only knows about `DESC_MAX`.
 */
export function validarDescuentosContraMaximo(
  input: ValidacionDescuentosInput,
): { ok: true } | { ok: false; code: VentaErrorCode } {
  const { lineas, descuentoCabecera, descMax } = input;
  const max = new Decimal(descMax);

  // --- Shape validation (header then lines) → DESCUENTO_INVALIDO ---
  const headerForma = validarFormaDescuento(descuentoCabecera);
  if (headerForma) return { ok: false, code: headerForma };
  for (const l of lineas) {
    const forma = validarFormaDescuento(l.descuento);
    if (forma) return { ok: false, code: forma };
  }

  let sumaBruta = new Decimal(0);
  let sumaLineaMoney = new Decimal(0);
  let sumaBaseNeta = new Decimal(0); // Σ (bruto − lineMoney) — header base ceiling

  // --- Per-line cap on gross base + base-exceed → MAXIMO / BASE ---
  for (const l of lineas) {
    const bruto = new Decimal(l.subtotalBruto);
    const money = new Decimal(resolverDescuentoAMoney(l.descuento, bruto.toFixed(2)));
    const capLinea = round2dec(bruto.times(max).dividedBy(100));

    if (money.greaterThan(capLinea)) {
      return { ok: false, code: DESCUENTO_EXCEDE_MAXIMO };
    }
    if (money.greaterThan(bruto)) {
      return { ok: false, code: DESCUENTO_EXCEDE_BASE };
    }
    sumaBruta = sumaBruta.plus(bruto);
    sumaLineaMoney = sumaLineaMoney.plus(money);
    sumaBaseNeta = sumaBaseNeta.plus(bruto.minus(money));
  }

  // --- Header cap on gross base + base-exceed ---
  const headerMoney = new Decimal(
    resolverDescuentoAMoney(descuentoCabecera, sumaBruta.toFixed(2)),
  );
  if (
    descuentoCabecera.descuentoTipo === DESCUENTO_TIPO.PORCENTAJE &&
    new Decimal(descuentoCabecera.descuentoValor).greaterThan(max)
  ) {
    return { ok: false, code: DESCUENTO_EXCEDE_MAXIMO };
  }
  if (headerMoney.greaterThan(sumaBaseNeta)) {
    return { ok: false, code: DESCUENTO_EXCEDE_BASE };
  }

  // --- Aggregate effective discount ≤ descMax% of Σ bruto ---
  const totalEfectivo = sumaLineaMoney.plus(headerMoney);
  const capTotal = round2dec(sumaBruta.times(max).dividedBy(100));
  if (totalEfectivo.greaterThan(capTotal)) {
    return { ok: false, code: DESCUENTO_EXCEDE_MAXIMO };
  }

  return { ok: true };
}

function round2dec(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
