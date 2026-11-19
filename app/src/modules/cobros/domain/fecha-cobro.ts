/**
 * Payment-date band gate — board 03 S14 (editable `Fecha del pago`).
 *
 * `PAGO.fecha` arrives from the wire (an SD calendar date picked in the payment
 * modal) and is the anchor the receipt, the collection history and the daily cash
 * close attribute the money to. A forward-dated payment would book cash that has
 * not been received yet and a backdated one would silently rewrite a closed day,
 * so the value is bounded AT THE COLLECTION BOUNDARY — the same product decision
 * `venta/domain/fecha-venta.ts` already ratified for the sale date:
 *
 *   - future dates are ALWAYS rejected (`FECHA_COBRO_FUTURA`), no configuration
 *     can widen it;
 *   - the retroactive horizon is the tenant parameter
 *     `RETROACTIVO_FECHA_VENTA_DIAS` (calendar days, ≥ 0), read through the SAME
 *     `leerRetroactivoFechaVentaEnTx` seam the sale date uses — one tenant
 *     retroactive-date policy, never a second hardcoded constant and never a new
 *     config key that the seed would not carry.
 *
 * Both bounds are compared as `America/Santo_Domingo` CALENDAR DAYS against the
 * SERVER instant injected by the caller, so a stale or hostile client clock can
 * never widen the band (AGENTS.md "Dates & time": SD is only the calculation
 * layer; SD is UTC-4 with no DST, so the fixed `-04:00` anchor below is exact).
 *
 * PURE: no Prisma / Next / Supabase imports (ADR-013). This mirrors
 * `validarFechaVenta` (its SD `Intl` pattern is the ratified conversion in this
 * project) and keeps the cobros catalog as the single error surface (R-C5).
 */

import {
  CobroDomainError,
  FECHA_COBRO_FUTURA,
  FECHA_COBRO_RETROACTIVA_EXCEDIDA,
} from "./errors";

/** `en-CA` yields an ISO-like `YYYY-MM-DD` that compares in calendar order. */
const FORMATO_FECHA_SD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santo_Domingo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** One millisecond-day; SD has no DST, so subtracting it shifts the SD date exactly. */
const MILISEGUNDOS_POR_DIA = 86_400_000;

/** The SD calendar day (`YYYY-MM-DD`) of a UTC instant. */
export function hoyEnSD(now: Date): string {
  return FORMATO_FECHA_SD.format(now);
}

/**
 * A wire SD calendar date (`YYYY-MM-DD`) → the instant persisted on `PAGO.fecha`,
 * anchored at SD noon (16:00Z) so no timezone can shift the day either way when
 * the history formats it back. A malformed or non-existent date fails loud: Zod
 * already rejects it at the transport boundary, and silently coercing here would
 * hide a programming defect behind a wrong payment day.
 */
export function instanteDeFechaCobroSD(fechaSD: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaSD)) {
    throw new Error(`instanteDeFechaCobroSD: fecha inválida (${fechaSD})`);
  }
  const instante = new Date(`${fechaSD}T12:00:00-04:00`);
  if (Number.isNaN(instante.getTime()) || hoyEnSD(instante) !== fechaSD) {
    throw new Error(`instanteDeFechaCobroSD: fecha inválida (${fechaSD})`);
  }
  return instante;
}

/**
 * S14 band gate. Legal iff, in `America/Santo_Domingo`:
 *
 *   `hoy_SD - horizonteDias  ≤  fechaSD(fechaCobro)  ≤  hoy_SD`
 *
 * both bounds INCLUSIVE. Throws {@link CobroDomainError} with a stable catalog
 * code (`FECHA_COBRO_FUTURA` / `FECHA_COBRO_RETROACTIVA_EXCEDIDA`). A non-integer
 * or negative `horizonteDias` is a CONFIG defect, not a business state, so it
 * fails loud with a plain `Error` — the `validarFechaVenta` discipline.
 *
 * @param fechaCobro the wire payment date, already validated as parseable.
 * @param horizonteDias per-tenant retroactive horizon in calendar days (≥ 0).
 * @param now the SERVER instant — injected so the rule is deterministic in tests.
 */
export function validarFechaCobro(
  fechaCobro: Date,
  horizonteDias: number,
  now: Date,
): void {
  if (!Number.isInteger(horizonteDias) || horizonteDias < 0) {
    throw new Error(
      `validarFechaCobro: horizonteDias inválido (${String(horizonteDias)}); revise RETROACTIVO_FECHA_VENTA_DIAS`,
    );
  }

  const fechaCobroSD = FORMATO_FECHA_SD.format(fechaCobro);
  const ahora = now.toISOString();

  if (fechaCobroSD > hoyEnSD(now)) {
    throw new CobroDomainError(FECHA_COBRO_FUTURA, {
      fechaCobro: fechaCobro.toISOString(),
      ahora,
    });
  }

  const limite = new Date(now.getTime() - horizonteDias * MILISEGUNDOS_POR_DIA);
  if (fechaCobroSD < FORMATO_FECHA_SD.format(limite)) {
    throw new CobroDomainError(FECHA_COBRO_RETROACTIVA_EXCEDIDA, {
      fechaCobro: fechaCobro.toISOString(),
      horizonteDias,
      ahora,
      limiteRetroactivo: limite.toISOString(),
    });
  }
}
