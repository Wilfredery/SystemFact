/**
 * Devolucion domain — pure B04 Nota de Crédito business rules (fase-5d).
 *
 * ADR-013: this module imports NOTHING from Next.js, React, Prisma or Supabase.
 * Money and quantities travel as `Decimal`-compatible strings (`Decimal(12,2)`
 * amounts, `Decimal(12,3)` quantities) or as `decimal.js` values at the pure
 * function boundary; floats MUST NOT appear (AGENTS.md "Money = Decimal").
 *
 * Error discipline (design D2): THERE IS NO separate devolucion error catalog.
 * The four return codes (`DEVOLUCION_FUERA_DE_PLAZO` 601,
 * `CANTIDAD_EXCEDE_ORIGINAL` 602, `FACTURA_NO_VIGENTE` 603,
 * `VENTA_NO_CONFIRMADA` 604) live in the frozen venta catalog
 * (`venta/domain/errors.ts`, tasks 1.5) and are RE-EXPORTED here so the module
 * speaks the single versioned contract (R-V13). The validators THROW
 * `VentaDomainError` (throw-on-reject, matching `cancelarVentaConfirmada`).
 * `LINEA_INVALIDA` is reused for a malformed/locked return type.
 *
 * Dates: the return window is compared on the `America/Santo_Domingo` CALENDAR
 * DAY via the standard `Intl.DateTimeFormat` API with an explicit `timeZone` —
 * the ratified project equivalent of a dedicated tz library (see
 * `ncf/domain/ncf-rules.ts` and `venta/ui/fecha.ts`), satisfying AGENTS.md "no
 * manual hour arithmetic". Santo Domingo is UTC-4 with NO DST, so adding whole
 * days as fixed 86_400_000 ms intervals shifts the SD calendar date by exactly
 * that many days. `now` is a CLOCK-INJECTED parameter (spec task 1.10: pure
 * functions, no DB, deterministic tests).
 */

import { Decimal } from "decimal.js";
import {
  CANTIDAD_EXCEDE_ORIGINAL,
  DEVOLUCION_FUERA_DE_PLAZO,
  LINEA_INVALIDA,
  VentaDomainError,
} from "../../venta/domain/errors";

// --- Stable return codes (re-exported from the single venta catalog) ---

export {
  CANTIDAD_EXCEDE_ORIGINAL,
  DEVOLUCION_FUERA_DE_PLAZO,
  FACTURA_NO_VIGENTE,
  LINEA_INVALIDA,
  VENTA_NO_CONFIRMADA,
} from "../../venta/domain/errors";

/**
 * Stock-replenishment classification of a returned unit (frozen Prisma enum
 * `TipoReposicion`, kept as a local union so the domain stays generated-client
 * free — same discipline as `TipoNcf` in the ncf domain).
 *   VENDIBLE → the unit can be re-sold: `ENTRADA_DEVOLUCION`,
 *   DANADO   → the unit is a total loss:  `SALIDA_MERMA`.
 */
export const TIPO_REPOSICION = {
  VENDIBLE: "VENDIBLE",
  DANADO: "DANADO",
} as const;
export type TipoReposicion = (typeof TIPO_REPOSICION)[keyof typeof TIPO_REPOSICION];

/** Accepted per-line ITBIS rates (Ley 30-26): 18 / 16 / 0 percent. */
const TASAS_ITBIS_VALIDAS = new Set(["18", "16", "0"]);

/** Round a Decimal to a 2dp money string, half-up (parity with venta calculators). */
function round2(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** `en-CA` yields an ISO-like `YYYY-MM-DD` that compares in calendar order. */
const FORMATO_FECHA_SD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santo_Domingo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Freeze a UTC instant to its `America/Santo_Domingo` calendar date string. */
function fechaEnSD(valor: Date): string {
  return FORMATO_FECHA_SD.format(valor);
}

/** One millisecond-day; SD has no DST, so adding it shifts the SD date exactly. */
const MILISEGUNDOS_POR_DIA = 86_400_000;

/**
 * R-D2 — return-window gate (tasks 1.1 / 1.10): a return is legal only when the
 * injected `now` instant falls ON or BEFORE `fechaVenta + plazoDias` Santo
 * Domingo calendar days. The boundary day is INCLUSIVE (day 15 of a 15-day
 * window is valid). Throws `DEVOLUCION_FUERA_DE_PLAZO` (601) outside the
 * window; a non-integer/negative `plazoDias` is a CONFIG defect, not a business
 * error, and fails loud without touching the catalog.
 */
export function validarPlazoDevolucion(
  fechaVenta: Date,
  plazoDias: number,
  now: Date,
): void {
  if (!Number.isInteger(plazoDias) || plazoDias < 0) {
    throw new Error(
      `validarPlazoDevolucion: plazoDias inválido (${String(plazoDias)}); revise PLAZO_DEVOLUCION`,
    );
  }
  const limite = new Date(fechaVenta.getTime() + plazoDias * MILISEGUNDOS_POR_DIA);
  if (fechaEnSD(now) > fechaEnSD(limite)) {
    throw new VentaDomainError(DEVOLUCION_FUERA_DE_PLAZO, {
      fechaVenta: fechaVenta.toISOString(),
      plazoDias,
      ahora: now.toISOString(),
      limite: limite.toISOString(),
    });
  }
}

/**
 * R-D3 [CRITICAL] — CUMULATIVE quantity gate (tasks 1.3 / 3.1): the running
 * returned total for one (factura, producto) may never exceed the original sold
 * quantity. The repository sums ALL prior VIGENTE `DETALLE_NOTA_CREDITO`
 * quantities for the same factura+product INSIDE the enclosing transaction;
 * this pure function applies the invariant `cantidadDevuelta + yaDevuelto ≤
 * cantidadOriginal`. A non-positive requested quantity is rejected with the
 * same stable code (a zero/negative return is never legal). Throws
 * `CANTIDAD_EXCEDE_ORIGINAL` (602).
 */
export function validarCantidadDevuelta(
  cantidadDevuelta: Decimal,
  cantidadOriginal: Decimal,
  yaDevuelto: Decimal,
): void {
  const disponible = cantidadOriginal.minus(yaDevuelto);
  // NOTE: `isPositive()` is SIGN-based in decimal.js and returns true for a
  // plain zero (s=1), so the strict `lessThanOrEqualTo(0)` guard is used here
  // (same convention as `validarLineaVenta`).
  if (
    cantidadDevuelta.lessThanOrEqualTo(0) ||
    cantidadDevuelta.greaterThan(disponible)
  ) {
    throw new VentaDomainError(CANTIDAD_EXCEDE_ORIGINAL, {
      cantidadDevuelta: cantidadDevuelta.toFixed(3),
      cantidadOriginal: cantidadOriginal.toFixed(3),
      yaDevuelto: yaDevuelto.toFixed(3),
    });
  }
}

/**
 * R-D4 — return-type gate: every returned line is classified `VENDIBLE` (re-sold
 * stock entry) or `DANADO` (merchandise loss). A persisted/transported value
 * outside the frozen enum is a data-integrity guard and rejects with
 * `LINEA_INVALIDA` (the reused frozen catalog code) — fail loud, never coerce
 * (same discipline as `estadoVentaDesdeDb`).
 */
export function validarReturnType(tipoReposicion: string): void {
  if (
    tipoReposicion !== TIPO_REPOSICION.VENDIBLE &&
    tipoReposicion !== TIPO_REPOSICION.DANADO
  ) {
    throw new VentaDomainError(LINEA_INVALIDA, { tipoReposicion });
  }
}

/**
 * One B04 Nota de Crédito line as computed per frozen NC semantics: the unit
 * price and ITBIS rate are FROZEN from the ORIGINAL SALE line at the moment of
 * the return (the NC detail columns freeze them at creation, schema comment
 * `congelada al momento de la devolución`).
 */
export interface DetalleNotaCreditoInput {
  readonly productoId: number;
  /** Positive base-unit quantity as a `Decimal(12,3)` string. */
  readonly cantidad: string;
  /** ITBIS-EXCLUSIVE unit price as a `Decimal(12,2)` string. */
  readonly precioUnitario: string;
  /** ITBIS rate frozen from the sale line: "18" | "16" | "0". */
  readonly tasaItbis: string;
  readonly tipoReposicion: TipoReposicion;
}

/**
 * R-D5 — NC header totals AND per-line computed money (frozen computation
 * order, parity with `venta/domain/calculators.ts`):
 *   subtotalLinea = round2(cantidad × precioUnitario)
 *   itbisLinea    = round2(subtotalLinea × tasaItbis / 100)
 *   monto = Σ subtotalLinea ; itbis = Σ itbisLinea   (sums of ROUNDED values)
 * The per-line values are returned alongside the header because every
 * `DETALLE_NOTA_CREDITO` row persists its own `subtotalLinea`/`itbis` (NOT
 * NULL columns) and they MUST be the exact values the header sums — the
 * application persists them verbatim, never recomputes a second formula.
 * A malformed line (non-positive quantity, negative price, rate outside
 * 18/16/0) rejects with `LINEA_INVALIDA` BEFORE any arithmetic.
 *
 * `lineas` in the result mirrors the INPUT order (the iteration IS the input
 * array), so callers zip by index.
 */
export interface TotalesNotaCredito {
  readonly monto: string;
  readonly itbis: string;
  readonly lineas: readonly {
    readonly productoId: number;
    readonly subtotalLinea: string;
    readonly itbisLinea: string;
  }[];
}

export function calcularTotalesNotaCredito(
  lineas: readonly DetalleNotaCreditoInput[],
): TotalesNotaCredito {
  let monto = new Decimal(0);
  let itbis = new Decimal(0);
  const porLinea: { productoId: number; subtotalLinea: string; itbisLinea: string }[] = [];
  for (const l of lineas) {
    if (
      !/^\d{1,9}(\.\d{1,3})?$/.test(l.cantidad) ||
      !/^\d{1,9}(\.\d{1,2})?$/.test(l.precioUnitario) ||
      !TASAS_ITBIS_VALIDAS.has(l.tasaItbis)
    ) {
      throw new VentaDomainError(LINEA_INVALIDA, { productoId: l.productoId });
    }
    if (
      new Decimal(l.cantidad).lessThanOrEqualTo(0) ||
      new Decimal(l.precioUnitario).lessThan(0)
    ) {
      throw new VentaDomainError(LINEA_INVALIDA, { productoId: l.productoId });
    }
    validarReturnType(l.tipoReposicion);

    const subtotalLinea = round2(new Decimal(l.cantidad).times(new Decimal(l.precioUnitario)));
    const itbisLinea = round2(
      new Decimal(subtotalLinea).times(new Decimal(l.tasaItbis)).dividedBy(100),
    );
    monto = monto.plus(subtotalLinea);
    itbis = itbis.plus(itbisLinea);
    porLinea.push({ productoId: l.productoId, subtotalLinea, itbisLinea });
  }
  return { monto: round2(monto), itbis: round2(itbis), lineas: porLinea };
}