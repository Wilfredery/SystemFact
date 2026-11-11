/**
 * Caja application — the daily close read (06a / S1 / S6).
 *
 * The close is a DERIVED report (S3: no `CIERRE_CAJA` entity, no persistence), so this use case is a
 * single read orchestration with ZERO business math of its own: it resolves the Santo-Domingo day,
 * reads the three aggregates and hands the figures to the pure domain (`cierre.ts`), which owns
 * every formula and the decimal policy.
 *
 *   totalFacturado   ← Σ VENTA.total CONFIRMADA del día        (the SAME canonical aggregate 06b uses)
 *   totalCobrado     ← Σ COBRO EFECTIVO APLICADO del día       (the method groups, summed by the domain)
 *   corte            ← Cobros / Devoluciones / Esperado = cobros − devoluciones
 *   diferencia       ← totalCobrado − totalFacturado           (KEPT SEPARATE from the corte)
 *
 * TODAY ONLY (S1/S6): the window comes from `ventanaDiaActualSD(ahora)` — "today in
 * America/Santo_Domingo", never a caller-supplied date. There is no retroactive parameter anywhere
 * in this module, and `ahora` exists only so tests can stand at a fixed instant.
 *
 * SCOPE (DB-2/DB-4): an Admin reads company-wide — the aggregates run inside the ratified
 * `conSucursalAmpliadaEnTx` widen (branch GUC cleared, empresa GUC never touched) and no branch
 * predicate is bound. Any other caller stays pinned to its own branch. The tenant pin is inside the
 * SQL either way, and the whole read runs in the caller's `withTenantTransaction`.
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { conSucursalAmpliadaEnTx } from "@/modules/reportes/infrastructure/widen-sucursal-guc";
import {
  calcularCorte,
  calcularDiferencia,
  calcularTotalCobrado,
} from "../domain/cierre";
import { CajaDomainError, messageFor } from "../domain/errors";
import { ventanaDiaActualSD, type VentanaDiaSD } from "../domain/zona";
import {
  cobrosEfectivoPorMetodoEnTx,
  reembolsosEfectivoEnTx,
  totalesVentaDiaEnTx,
} from "../infrastructure/caja-repository";
import { error, ok, type CajaResult } from "./resultado";

/** One row of the 06a table: the method label, its cash receipts and how many make them up. */
export interface MetodoCobroVista {
  readonly metodo: string;
  readonly cobros: string;
  readonly cantidad: number;
}

/**
 * The 06a board as the screen renders it. Every money value is a `Decimal(12,2)` STRING.
 *
 * The Método rows carry COBROS only: sales are not attributed to a payment method in the schema
 * (S6 defines ONE day-level `VENTA` total), so a per-method "Ventas" cell has no source and is
 * deliberately not invented here — the table's Ventas column and its Total row are composed from
 * the day-level `totalFacturado` the DTO already carries.
 */
export interface CierreDiarioVista {
  /** The SD calendar date the close belongs to (`YYYY-MM-DD`) — the screenshot subtitle. */
  readonly fechaSD: string;
  readonly totalFacturado: string;
  readonly totalCobrado: string;
  /** KPI "Efectivo esperado" — the same value as the corte panel's Esperado (one truth). */
  readonly efectivoEsperado: string;
  /** `totalCobrado − totalFacturado`, negative when the day collected less than it invoiced. */
  readonly diferencia: string;
  readonly metodos: readonly MetodoCobroVista[];
  /** The corte panel's two inputs, so the screen prints the formula's terms next to its result. */
  readonly corte: { readonly cobros: string; readonly devoluciones: string };
}

/**
 * Today's SD day window, or the typed `CAJA_VALIDACION` refusal. Only a `CajaDomainError` becomes a
 * result — a defect (e.g. an impossible clock) propagates instead of hiding behind a message.
 */
function ventanaOHoy(ahora: Date): CajaResult<VentanaDiaSD> {
  try {
    return ok(ventanaDiaActualSD(ahora));
  } catch (e) {
    if (e instanceof CajaDomainError) return error(e.code, messageFor(e.code));
    throw e;
  }
}

/**
 * Read the day's close. `ahora` defaults to the real clock (today-only); it is injectable solely so
 * tests can pin an instant.
 */
export async function consultarCierreDiario(
  tx: PrismaTx,
  ctx: TenantCtx,
  ahora: Date = new Date(),
): Promise<CajaResult<CierreDiarioVista>> {
  const ventana = ventanaOHoy(ahora);
  if (!ventana.ok) return error(ventana.code, ventana.message);

  const { data: dia } = ventana;
  // A permitted Caja caller is an Administrador (S6), so the company-wide widen is the right scope.
  // The non-Admin path stays pinned to the caller's branch — the SQL always keeps the tenant pin.
  const sucursalId = ctx.esAdmin ? null : ctx.sucursalId;

  const lectura = async (txLectura: PrismaTx): Promise<CierreDiarioVista> => {
    const [grupos, reembolsos, totales] = await Promise.all([
      cobrosEfectivoPorMetodoEnTx(txLectura, ctx, dia, sucursalId),
      reembolsosEfectivoEnTx(txLectura, ctx, dia, sucursalId),
      totalesVentaDiaEnTx(txLectura, ctx, dia, sucursalId),
    ]);

    // The aggregate pins `metodoPago = 'EFECTIVO'`, so the SUM of the groups IS the cash collected —
    // the domain sums the rows without matching a method name (a second method stays a data change).
    const cobrosEfectivo = calcularTotalCobrado(grupos);
    const corte = calcularCorte({
      cobrosEfectivo,
      devolucionesEfectivo: reembolsos.devoluciones,
    });

    return {
      fechaSD: dia.fechaSD,
      totalFacturado: totales.totalFacturado,
      totalCobrado: cobrosEfectivo,
      efectivoEsperado: corte.esperado,
      diferencia: calcularDiferencia({
        totalCobrado: cobrosEfectivo,
        totalFacturado: totales.totalFacturado,
      }),
      metodos: grupos.map((g) => ({
        metodo: g.metodo,
        cobros: g.cobros,
        cantidad: g.cantidad,
      })),
      corte: { cobros: corte.cobros, devoluciones: corte.devoluciones },
    };
  };

  const datos = ctx.esAdmin
    ? await conSucursalAmpliadaEnTx(tx, ctx, lectura)
    : await lectura(tx);
  return ok(datos);
}
