/**
 * Sale-date boundary gate — F5 remediation for audit finding
 * `venta:crear-venta:backdated-fecha-devolucion-window` (v2r-11, medium).
 *
 * `Venta.fecha` arrives from the wire and is only validated for PARSEABILITY
 * (`zCrearVentaInput.fecha` / `zActualizarVentaInput.fecha` in
 * `http/validations.ts`), then persisted verbatim. That single unbounded value is
 * the anchor for the B04 return window (`validarPlazoDevolucion`) AND for
 * dashboard/operacional period attribution, so a forward-dated sale ADMITS
 * out-of-window returns while a backdated sale REJECTS in-window ones and shifts
 * period attribution. Bounding it AT THE CREATE/UPDATE BOUNDARY closes the
 * exploit at the source: the anchor can never be moved outside the legal band.
 *
 * PRODUCT DECISION (authoritative): future dates are ALWAYS rejected; the
 * retroactive horizon is a per-empresa CONFIGURABLE parameter
 * (`RETROACTIVO_FECHA_VENTA_DIAS`, seeded default 7 calendar days) — never a
 * hardcoded constant (AGENTS.md: "Parameters from DB, never hardcoded
 * constants"). Both bounds are compared as `America/Santo_Domingo` CALENDAR DAYS
 * against the SERVER clock, so a sale entered at 20:00 local with the browser's
 * stale date is judged on the SD day it actually belongs to.
 *
 * PURE: no Prisma / Next / Supabase imports (ADR-013). The SD calendar-date
 * pattern (`Intl.DateTimeFormat` with an explicit `timeZone`) is the ratified
 * timezone conversion in this project — `date-fns-tz` is not a dependency, and
 * the identical rule already lives in `devolucion/domain/devolucion.ts`
 * (`validarPlazoDevolucion`) and `cobros/domain/en-mora.ts`. It is copied
 * module-locally on purpose: centralizing it is a separate refactor, and
 * YAGNI forbids paying for it inside a bug fix.
 *
 * SD is UTC-4 with NO DST, so subtracting a whole number of 86_400_000 ms shifts
 * the SD calendar date by exactly that many days — no manual hour arithmetic
 * (19-directivas).
 */

import {
  FECHA_VENTA_FUTURA,
  FECHA_VENTA_RETROACTIVA_EXCEDIDA,
  VentaDomainError,
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

/** Freeze a UTC instant to its `America/Santo_Domingo` calendar date string. */
function fechaEnSD(valor: Date): string {
  return FORMATO_FECHA_SD.format(valor);
}

/**
 * R-F5 — the sale-date band gate. Legal iff, in `America/Santo_Domingo`:
 *
 *   `hoy_SD - horizonteDias  ≤  fechaSD(fechaVenta)  ≤  hoy_SD`
 *
 * both bounds INCLUSIVE, so "exactly `horizonteDias` ago" and "exactly today" are
 * both legal. Throws {@link VentaDomainError} with a stable catalog code:
 *
 *   - `FECHA_VENTA_FUTURA` when the SD date of `fechaVenta` is AFTER the SD date
 *     of `now` (never legal, no configuration can widen it);
 *   - `FECHA_VENTA_RETROACTIVA_EXCEDIDA` when it is BEFORE the SD date of
 *     `now - horizonteDias` days.
 *
 * A non-integer / negative `horizonteDias` is a CONFIG defect, not a business
 * error, and fails loud with a plain `Error` without touching the catalog —
 * exactly the `validarPlazoDevolucion` discipline. The config read path
 * (`leerRetroactivoFechaVentaEnTx`) already rejects a bad stored value, so this
 * is the defense-in-depth second gate.
 *
 * @param fechaVenta the wire sale date, already validated as parseable.
 * @param horizonteDias per-empresa retroactive horizon in calendar days (≥ 0).
 * @param now the SERVER instant — injected so the rule is deterministic in tests.
 */
export function validarFechaVenta(
  fechaVenta: Date,
  horizonteDias: number,
  now: Date,
): void {
  if (!Number.isInteger(horizonteDias) || horizonteDias < 0) {
    throw new Error(
      `validarFechaVenta: horizonteDias inválido (${String(horizonteDias)}); revise RETROACTIVO_FECHA_VENTA_DIAS`,
    );
  }

  const fechaVentaSD = fechaEnSD(fechaVenta);
  const ahora = now.toISOString();

  if (fechaVentaSD > fechaEnSD(now)) {
    throw new VentaDomainError(FECHA_VENTA_FUTURA, {
      fechaVenta: fechaVenta.toISOString(),
      ahora,
    });
  }

  const limite = new Date(now.getTime() - horizonteDias * MILISEGUNDOS_POR_DIA);
  if (fechaVentaSD < fechaEnSD(limite)) {
    throw new VentaDomainError(FECHA_VENTA_RETROACTIVA_EXCEDIDA, {
      fechaVenta: fechaVenta.toISOString(),
      horizonteDias,
      ahora,
      limiteRetroactivo: limite.toISOString(),
    });
  }
}
