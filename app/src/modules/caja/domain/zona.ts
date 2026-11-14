/**
 * Caja domain — the Santo-Domingo day the close is defined on (S5).
 *
 * ADR-013: pure TypeScript. No imports from Next.js, React, Prisma or Supabase.
 *
 * The daily close is "today in America/Santo_Domingo" (S1: no retroactive date selector), while
 * `Pago.fecha` / `Venta.fecha` are UTC `timestamptz`. So the screen's day must be turned into the
 * UTC window the repositories filter on.
 *
 * REUSE, NOT DUPLICATION (AGENTS.md "conversions via a dedicated library; no manual hour
 * arithmetic"): the SD↔UTC conversion is ALREADY ratified in `auditoria/domain/zona-horaria.ts`
 * (`fechaSDaUTC`), which discovers the zone offset through `Intl.DateTimeFormat` instead of
 * hardcoding UTC-4. This module ADAPTS that seam — the same way `reportes/domain/zona-horaria.ts`
 * does — and maps its `AUDITORIA_VALIDACION` to `CAJA_VALIDACION` so the close never leaks a
 * foreign module's code. The calendar-date formatter is the project's existing `fechaEnSD`.
 *
 * Two properties this module pins that the close depends on:
 *
 * 1. HALF-OPEN `[inicio, fin)`. The audited seam's `"fin"` is SD 23:59:59.999 (inclusive) for
 *    range filters; a close aggregation should not depend on millisecond tail arithmetic, so
 *    `fin` here is the NEXT SD day's 00:00 as an EXCLUSIVE bound. The two forms select the same
 *    instants, but the half-open one cannot drop or double-count the trailing millisecond.
 * 2. EXACTLY 24 h. SD observes no DST, so every window is 24 h wide and the UTC start is fixed at
 *    04:00Z. The offset is still discovered from the zone (never assumed), and the tests assert
 *    the fixed -4 result across the year.
 */

import { AuditoriaDomainError } from "@/modules/auditoria/domain/errors";
import { fechaSDaUTC as fechaSDaUTCAuditoria } from "@/modules/auditoria/domain/zona-horaria";
import { fechaEnSD } from "@/modules/ncf/domain/ncf-rules";
import { CAJA_VALIDACION, CajaDomainError } from "./errors";

/** A bare SD calendar date `YYYY-MM-DD`. */
const RE_FECHA_SD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** One SD calendar day as the half-open UTC window `[inicio, fin)` a query filters on. */
export interface VentanaDiaSD {
  /** The SD calendar date the window represents (`YYYY-MM-DD`). */
  readonly fechaSD: string;
  /** Inclusive UTC lower bound: SD 00:00:00.000 of that day (04:00Z under SD's fixed UTC-4). */
  readonly inicio: Date;
  /** EXCLUSIVE UTC upper bound: SD 00:00:00.000 of the NEXT day (belongs to that next day). */
  readonly fin: Date;
}

/**
 * SD 00:00:00.000 of `fechaSD` as a UTC instant, via the ratified auditoria conversion. A
 * malformed or non-existent calendar date (e.g. `2026-02-31`, `2026-13-01`) fails loud as
 * `CAJA_VALIDACION` — the caller never aggregates a silently-wrong day.
 */
function inicioDiaSD(fechaSD: string): Date {
  try {
    return fechaSDaUTCAuditoria(fechaSD, "inicio");
  } catch (e) {
    if (e instanceof AuditoriaDomainError) {
      throw new CajaDomainError(CAJA_VALIDACION, { campo: "fechaSD", fechaSD });
    }
    throw e;
  }
}

/** A UTC instant's `America/Santo_Domingo` calendar date (`YYYY-MM-DD`) — never the UTC date. */
export function fechaSDDe(instante: Date): string {
  return fechaEnSD(instante);
}

/** "Today" in `America/Santo_Domingo` (`YYYY-MM-DD`), from `ahora` (defaults to the real clock). */
export function fechaHoySD(ahora: Date = new Date()): string {
  return fechaSDDe(ahora);
}

/** Pad a calendar part to two digits (`en-CA`-compatible `YYYY-MM-DD`). */
function dosDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The SD calendar day after `fechaSD`, as `YYYY-MM-DD`. Pure CALENDAR arithmetic on UTC parts
 * (no hour or offset arithmetic): `Date.UTC` normalises the rollover, including month, year and
 * leap-day ends. Validating `fechaSD` first means an unusable date never reaches this step.
 */
function diaSiguienteSD(fechaSD: string): string {
  const m = RE_FECHA_SD.exec(fechaSD);
  if (!m) {
    throw new CajaDomainError(CAJA_VALIDACION, { campo: "fechaSD", fechaSD });
  }
  const siguiente = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1),
  );
  return `${String(siguiente.getUTCFullYear()).padStart(4, "0")}-${dosDigitos(
    siguiente.getUTCMonth() + 1,
  )}-${dosDigitos(siguiente.getUTCDate())}`;
}

/**
 * Resolve one SD calendar date (`YYYY-MM-DD`) to its half-open UTC window `[inicio, fin)`:
 * `inicio` = SD 00:00 of that day, `fin` = SD 00:00 of the next day (exclusive). The window is
 * exactly 24 h wide because SD observes no DST.
 */
export function ventanaDiaSD(fechaSD: string): VentanaDiaSD {
  const inicio = inicioDiaSD(fechaSD);
  const fin = inicioDiaSD(diaSiguienteSD(fechaSD));
  return { fechaSD, inicio, fin };
}

/** Today's SD day window, resolved from `ahora` (defaults to the real clock). */
export function ventanaDiaActualSD(ahora: Date = new Date()): VentanaDiaSD {
  return ventanaDiaSD(fechaHoySD(ahora));
}

/**
 * Half-open membership: `inicio <= instante < fin`. The boundary instant itself belongs to the
 * day; the `fin` instant belongs to the NEXT day (so two adjacent windows never share an instant).
 */
export function estaEnVentanaSD(instante: Date, ventana: VentanaDiaSD): boolean {
  const t = instante.getTime();
  return t >= ventana.inicio.getTime() && t < ventana.fin.getTime();
}
