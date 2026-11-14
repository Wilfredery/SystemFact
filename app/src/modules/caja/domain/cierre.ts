/**
 * Caja domain — the Cierre diario figures (S1, S5).
 *
 * ADR-013: pure TypeScript. No imports from Next.js, React, Prisma or Supabase. EVERY money
 * figure is a `Decimal(12,2)` STRING in and out — never a JS float (AGENTS.md "Money = Decimal") —
 * and the rounding policy lives in one place ({@link aDinero} in `./decimal`).
 *
 * The formula the board prints, verbatim (S1 "Corte de caja"):
 *
 *   Efectivo esperado = Cobros en efectivo − Devoluciones en efectivo
 *
 * `devoluciones` is the MAGNITUDE of the cash refunds (Σ REEMBOLSO EFECTIVO APLICADO), so the
 * expected cash can legitimately go NEGATIVE when refunds exceed receipts — that is a real
 * drawer signal and is never clamped.
 *
 * The diferencia is deliberately a SEPARATE figure (S1 "Diferencia" KPI vs the corte panel):
 *   diferencia = total cobrado − total facturado
 * It is NOT `esperado − facturado`; docs keep collected-vs-invoiced apart from the cash corte.
 * It is negative when the day collected less than it invoiced, and that is preserved.
 *
 * V1 has cash as the only `MetodoPago`, but {@link calcularTotalCobrado} takes the per-method
 * groups and sums them WITHOUT matching on the method name, so adding a method later is a data
 * change, not a domain change.
 */

import { aDinero, MOTOR_DECIMAL } from "./decimal";

/** One payment-method row of the 06a table (`Método | Ventas | Cobros | Total`) — the COBROS cell. */
export interface GrupoCobroMetodo {
  /** The `Pago.metodoPago` label (e.g. `EFECTIVO`); never matched on by this layer. */
  readonly metodo: string;
  /** Σ COBRO in APLICADO state for that method that SD day, `Decimal(12,2)` string. */
  readonly cobros: string;
}

/** The "Corte de caja" panel values (S1) — Cobros / Devoluciones / Esperado, all `Decimal(12,2)`. */
export interface CorteCaja {
  /** Σ cash receipts (COBRO EFECTIVO APLICADO). */
  readonly cobros: string;
  /** Σ cash refunds (REEMBOLSO EFECTIVO APLICADO) as a MAGNITUDE. */
  readonly devoluciones: string;
  /** `cobros − devoluciones`; negative when refunds exceed receipts. */
  readonly esperado: string;
}

/** The raw cash inputs of the corte (refunds as a magnitude, not a negative amount). */
export interface EntradaCorteCaja {
  readonly cobrosEfectivo: string;
  readonly devolucionesEfectivo: string;
}

/** `Efectivo esperado = Cobros en efectivo − Devoluciones en efectivo`, half-up at 2 dp. */
export function calcularEfectivoEsperado(entrada: EntradaCorteCaja): string {
  return aDinero(
    new MOTOR_DECIMAL(entrada.cobrosEfectivo).minus(
      new MOTOR_DECIMAL(entrada.devolucionesEfectivo),
    ),
  );
}

/**
 * Σ COBRO across the provided method groups. Method-AGNOSTIC: the `metodo` label is carried for
 * the table but never inspected here, so V1's single EFECTIVO group and any future mix sum the
 * same way. An empty group list (zero day) is `"0.00"`.
 */
export function calcularTotalCobrado(grupos: readonly GrupoCobroMetodo[]): string {
  return aDinero(
    grupos.reduce(
      (total, grupo) => total.plus(new MOTOR_DECIMAL(grupo.cobros)),
      new MOTOR_DECIMAL(0),
    ),
  );
}

/**
 * The "Diferencia" KPI: `total cobrado − total facturado`, half-up at 2 dp. Negative results are
 * preserved: a day that collected less than it invoiced is under-collection, not an error.
 */
export function calcularDiferencia(datos: {
  readonly totalCobrado: string;
  readonly totalFacturado: string;
}): string {
  return aDinero(
    new MOTOR_DECIMAL(datos.totalCobrado).minus(new MOTOR_DECIMAL(datos.totalFacturado)),
  );
}

/**
 * The Corte de caja struct displayed as-is (S1 panel): the two cash inputs at the money scale plus
 * the expected cash derived from them. A zero day is all `"0.00"`.
 */
export function calcularCorte(entrada: EntradaCorteCaja): CorteCaja {
  return {
    cobros: aDinero(entrada.cobrosEfectivo),
    devoluciones: aDinero(entrada.devolucionesEfectivo),
    esperado: calcularEfectivoEsperado(entrada),
  };
}
