/**
 * Caja shared helpers — the ActionResult envelope, the transport DTOs, the role group and the
 * adapter plumbing (S6).
 *
 * Three rules this file exists to hold:
 *
 * 1. THE LITERAL ROLE NAME LIVES HERE ONLY. `ROLES_VER_CAJA` mirrors the wireframe's "Roles que la
 *    ven: Administrador" for BOTH boards (06a and 06b). Actions read the group; no screen and no
 *    other module names a role. Deny-by-default: a role absent from the group is refused server-side
 *    (hiding UI is not the control).
 * 2. TRANSPORT DTOs, NOT DOMAIN ROWS. The DTOs below are the wire contract the UI consumes. Raw
 *    repository rows and Prisma types never cross this boundary — the actions map the use-case view
 *    into these shapes field by field. Money is a `Decimal(12,2)` STRING everywhere (AGENTS.md
 *    "Money = Decimal"); no DTO ever carries a `number` amount.
 * 3. ONE ENVELOPE. `ActionResult` is the same `{ok:true,data} | {ok:false,error:{code,message}}`
 *    shape compra/cobros already speak, so the client island handles Caja like any other screen.
 */

import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { type CajaErrorCode } from "../domain/errors";
import { SESION_INVALIDA, VALIDATION_ERROR } from "./validations";

/**
 * Who may SEE the close and the day summary. The wireframe labels both boards "Roles que la ven:
 * Administrador" (S1/S2/S6). One named group per capability, so a future change of who may look at
 * the drawer is a one-line edit here.
 */
export const ROLES_VER_CAJA = ["Administrador"];

/** Composed action error surface: caja catalog ∪ transport codes. */
export type CajaAccionesErrorCode =
  | CajaErrorCode
  | typeof VALIDATION_ERROR
  | typeof SESION_INVALIDA;

export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: CajaAccionesErrorCode;
        readonly message: string;
      };
    };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(code: CajaAccionesErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

/** The tenant context comes from the Supabase session (auth read), not the DB. */
export async function resolverCtx() {
  const supabase = await createClient();
  return getCurrentTenantContext(supabase);
}

/**
 * One row of the 06a Método table. `cobros` is what the close can attribute per method; the Ventas
 * column has no per-method source in the schema (S6 defines ONE day-level `VENTA` total), so the row
 * carries the cash figure and its receipt count only — the screen composes the Ventas cell and the
 * Total row from the day-level DTO fields.
 */
export interface MetodoRowDto {
  /** The `Pago.metodoPago` label (`EFECTIVO` in V1) — display only. */
  readonly metodo: string;
  /** Σ cash receipts for that method that SD day, `Decimal(12,2)` string. */
  readonly cobros: string;
  /** How many receipts make up that sum. */
  readonly cantidad: number;
}

/**
 * The 06a "Cierre diario de caja" board (S1): the four KPIs, the method table and the corte panel's
 * terms. `efectivoEsperado` is the panel's "Esperado" — exposed ONCE so the KPI and the panel can
 * never print two different numbers.
 */
export interface CierreDiarioDto {
  /** Today's SD calendar date (`YYYY-MM-DD`) — the subtitle. Never a caller-supplied date. */
  readonly fechaSD: string;
  /** Total facturado — Σ CONFIRMADA sales that SD day. */
  readonly totalFacturado: string;
  /** Total cobrado — Σ cash receipts (COBRO EFECTIVO APLICADO) that SD day. */
  readonly totalCobrado: string;
  /** Efectivo esperado = Cobros − Devoluciones; negative when refunds exceed receipts. */
  readonly efectivoEsperado: string;
  /** Diferencia = total cobrado − total facturado (kept separate from the corte). */
  readonly diferencia: string;
  readonly metodos: readonly MetodoRowDto[];
  /** The corte panel's two inputs (its result is `efectivoEsperado`). */
  readonly corte: { readonly cobros: string; readonly devoluciones: string };
}

/** The 06b "Resumen del día" board (S2): the four sales/cost/margin KPIs. */
export interface ResumenDiaDto {
  /** Today's SD calendar date (`YYYY-MM-DD`) — the subtitle. */
  readonly fechaSD: string;
  readonly ventas: string;
  readonly costoVendido: string;
  readonly margenBruto: string;
  /** Margin at 1 decimal (`"32.6"`), `"0.0"` on a zero-sales day. */
  readonly margenPorcentaje: string;
}
