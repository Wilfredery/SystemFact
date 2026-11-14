/**
 * Tenant domain — ITBIS rates IN USE (administracion-itbis S1/S3/S4).
 *
 * ADR-013: pure TypeScript, no Next/React/Prisma/Supabase. Read-only shaping of
 * the per-product `tasaItbis` + validity window groups the repository
 * aggregates. Nothing here decides which rates exist: whatever the data says is
 * shown as stored (the rate stays a decimal string, never a `number`).
 *
 * "Vigente hoy" compares INSTANTS like the sale line validation
 * (`tasaVigenteEn` in venta/application/preparar-lineas-venta.ts: desde <= t <=
 * hasta, hasta null = open-ended), but against TODAY'S `America/Santo_Domingo`
 * business day, resolved with the caja module's existing day-window helper
 * (no manual hour arithmetic, no new library): a rate is "vigente hoy" when its
 * window overlaps that day `[inicio, fin)`.
 */

import { Decimal } from "decimal.js";
import { ventanaDiaActualSD } from "@/modules/caja/domain/zona";

/** One group exactly as the repository aggregates it. */
export interface TasaItbisEnUsoLeida {
  /** Stored `Decimal(12,2)` as a string (e.g. "18.00"). */
  readonly tasaItbis: string;
  readonly vigenteDesde: Date;
  /** `null` = open-ended. */
  readonly vigenteHasta: Date | null;
  /** Active products of the empresa using this exact rate + window. */
  readonly productos: number;
}

/** One row as the screen consumes it (dates as ISO strings). */
export interface TasaItbisEnUso {
  readonly tasaItbis: string;
  readonly vigenteDesde: string;
  readonly vigenteHasta: string | null;
  readonly productos: number;
  readonly vigenteHoy: boolean;
}

/**
 * Whether the window covers any instant of today's SD business day.
 * `desde` must start before the day ends; `hasta` (inclusive, null = open)
 * must not be over before the day starts.
 */
export function tasaVigenteHoy(
  desde: Date,
  hasta: Date | null,
  ahora: Date = new Date(),
): boolean {
  const dia = ventanaDiaActualSD(ahora);
  const hastaMs = hasta === null ? Infinity : hasta.getTime();
  return desde.getTime() < dia.fin.getTime() && hastaMs >= dia.inicio.getTime();
}

/** Rate descending (numeric), then vigente desde ascending (S1). */
function compararTasas(a: TasaItbisEnUsoLeida, b: TasaItbisEnUsoLeida): number {
  const porTasa = new Decimal(b.tasaItbis).comparedTo(new Decimal(a.tasaItbis));
  if (porTasa !== 0) return porTasa;
  return a.vigenteDesde.getTime() - b.vigenteDesde.getTime();
}

/** Orders the groups and flags each one for today; empty in, empty out (S3). */
export function armarTasasItbisEnUso(
  filas: readonly TasaItbisEnUsoLeida[],
  ahora: Date = new Date(),
): TasaItbisEnUso[] {
  return [...filas].sort(compararTasas).map((fila) => ({
    tasaItbis: fila.tasaItbis,
    vigenteDesde: fila.vigenteDesde.toISOString(),
    vigenteHasta: fila.vigenteHasta === null ? null : fila.vigenteHasta.toISOString(),
    productos: fila.productos,
    vigenteHoy: tasaVigenteHoy(fila.vigenteDesde, fila.vigenteHasta, ahora),
  }));
}
