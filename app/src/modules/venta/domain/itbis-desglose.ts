/**
 * Per-rate ITBIS breakdown for the printed invoice (DGII 254-06 Art. 11:
 * "ITBIS desglosado"; odd/tasks/factura-print.md S3). Pure domain: Decimal
 * arithmetic over the FROZEN line values only — the breakdown never recomputes
 * a rate, so "today's" TASA_ITBIS can never touch a past invoice.
 */

import { Decimal } from "decimal.js";

export interface LineaItbisFrozen {
  readonly tasaItbis: string;
  readonly itbisLinea: string;
}

export interface DesgloseItbisFila {
  /** The frozen rate as stored on the line (e.g. "0.18", "0.16", "0.00"). */
  readonly tasa: string;
  /** Sum of the lines' `itbisLinea` for that rate, 2-decimal string. */
  readonly itbis: string;
}

/** Aggregate the frozen line ITBIS by rate, sorted by rate descending. */
export function desglosarItbisPorTasa(
  lineas: readonly LineaItbisFrozen[],
): readonly DesgloseItbisFila[] {
  const porTasa = new Map<string, Decimal>();
  for (const linea of lineas) {
    const tasa = linea.tasaItbis;
    const previa = porTasa.get(tasa) ?? new Decimal(0);
    porTasa.set(tasa, previa.plus(new Decimal(linea.itbisLinea)));
  }
  return [...porTasa.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([tasa, itbis]) => ({ tasa, itbis: itbis.toFixed(2) }));
}
