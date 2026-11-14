/**
 * Inventario domain — movement history rules (odd/tasks/inventario-historial.md, S1/S4).
 *
 * Pure TypeScript (ADR-013): no Next.js, React, Prisma or Supabase. It owns
 *   - the human label of every `TipoMovimiento` value, and
 *   - the date range of the history: mandatory, defaulting to the last 30
 *     America/Santo_Domingo (SD) days, at most 90 days wide.
 *
 * Range model: `desde`/`hasta` are SD business days (`YYYY-MM-DD`), both
 * INCLUSIVE. They become the half-open UTC window `[inicio, fin)` through the
 * ratified caja `ventanaDiaSD` (no manual hour arithmetic): `inicio` is SD
 * 00:00 of `desde`, `fin` is SD 00:00 of the day after `hasta` (exclusive).
 * "Today" is computed from the injected `ahora`, never from a hidden clock.
 */

import { ventanaDiaSD, fechaHoySD } from "@/modules/caja/domain/zona";
import {
  RANGO_FECHAS_EXCEDIDO,
  RANGO_FECHAS_INVALIDO,
  type InventarioErrorCode,
} from "./errors";

/** Same members as the Prisma `TipoMovimiento` enum (a unit test pins the equality). */
export const TIPOS_MOVIMIENTO = [
  "ENTRADA_COMPRA",
  "SALIDA_VENTA",
  "ENTRADA_DEVOLUCION",
  "SALIDA_MERMA",
  "AJUSTE",
  "REPOSICION_CANCELACION",
  "SALIDA_CANCELACION_COMPRA",
] as const;

export type TipoMovimientoInventario = (typeof TIPOS_MOVIMIENTO)[number];

const ETIQUETAS_TIPO: Readonly<Record<TipoMovimientoInventario, string>> = {
  ENTRADA_COMPRA: "Entrada por compra",
  SALIDA_VENTA: "Salida por venta",
  ENTRADA_DEVOLUCION: "Entrada por devolución",
  SALIDA_MERMA: "Salida por merma",
  AJUSTE: "Ajuste manual",
  REPOSICION_CANCELACION: "Reposición por cancelación",
  SALIDA_CANCELACION_COMPRA: "Salida por cancelación de compra",
};

/** Spanish end-user label of a movement type. */
export function etiquetaTipoMovimiento(tipo: TipoMovimientoInventario): string {
  return ETIQUETAS_TIPO[tipo];
}

/** Default span when the caller sends no range: today and the 29 days before it. */
export const DIAS_RANGO_DEFECTO = 30;
/** Widest allowed span, both ends counted. */
export const DIAS_RANGO_MAXIMO = 90;

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_POR_DIA = 86_400_000;

export interface RangoMovimientosEntrada {
  /** First SD day, `YYYY-MM-DD` (inclusive). */
  readonly desde?: string;
  /** Last SD day, `YYYY-MM-DD` (inclusive). */
  readonly hasta?: string;
}

export interface RangoMovimientos {
  readonly desde: string;
  readonly hasta: string;
  /** Inclusive UTC lower bound: SD 00:00 of `desde`. */
  readonly inicio: Date;
  /** EXCLUSIVE UTC upper bound: SD 00:00 of the day after `hasta`. */
  readonly fin: Date;
}

export type ResolverRangoResultado =
  | { readonly ok: true; readonly rango: RangoMovimientos }
  | { readonly ok: false; readonly code: InventarioErrorCode };

/** A real calendar date as UTC epoch ms at 00:00 (calendar math only), or null. */
function diaEpoch(fecha: string): number | null {
  const m = RE_FECHA.exec(fecha);
  if (m === null) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const f = new Date(ms);
  if (f.getUTCFullYear() !== y || f.getUTCMonth() + 1 !== mo || f.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

/** Calendar subtraction of whole days from a valid `YYYY-MM-DD`. */
function restarDias(fecha: string, dias: number): string {
  const base = diaEpoch(fecha);
  if (base === null) throw new RangeError(`Fecha inválida: ${fecha}`);
  const f = new Date(base - dias * MS_POR_DIA);
  const mm = String(f.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(f.getUTCDate()).padStart(2, "0");
  return `${String(f.getUTCFullYear()).padStart(4, "0")}-${mm}-${dd}`;
}

/**
 * Default and validate the history range.
 *
 * Missing `hasta` = today in SD; missing `desde` = 29 days before `hasta`
 * (30 days counting both ends). A malformed/non-existent date or `desde` after
 * `hasta` is `RANGO_FECHAS_INVALIDO`; a span over 90 days is
 * `RANGO_FECHAS_EXCEDIDO`. The UTC window comes from `ventanaDiaSD`.
 */
export function resolverRangoMovimientos(
  entrada: RangoMovimientosEntrada,
  ahora: Date,
): ResolverRangoResultado {
  const hasta = entrada.hasta ?? fechaHoySD(ahora);
  const hastaMs = diaEpoch(hasta);
  if (hastaMs === null) return { ok: false, code: RANGO_FECHAS_INVALIDO };

  const desde = entrada.desde ?? restarDias(hasta, DIAS_RANGO_DEFECTO - 1);
  const desdeMs = diaEpoch(desde);
  if (desdeMs === null || desdeMs > hastaMs) {
    return { ok: false, code: RANGO_FECHAS_INVALIDO };
  }

  const dias = Math.round((hastaMs - desdeMs) / MS_POR_DIA) + 1;
  if (dias > DIAS_RANGO_MAXIMO) return { ok: false, code: RANGO_FECHAS_EXCEDIDO };

  return {
    ok: true,
    rango: {
      desde,
      hasta,
      inicio: ventanaDiaSD(desde).inicio,
      fin: ventanaDiaSD(hasta).fin,
    },
  };
}
