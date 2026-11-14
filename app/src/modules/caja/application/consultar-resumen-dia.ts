/**
 * Caja application — "Resumen del día — Ventas, costo y margen bruto" (06b / S2 / S6).
 *
 * A separate read from the close (S2: the two boards are never mixed) that reuses the SAME canonical
 * total-facturado aggregate (`totalesVentaDiaEnTx`), so 06b's "Ventas del día" and 06a's "Total
 * facturado" are the same number by construction — never a second sum definition. The cost of goods
 * sold comes from ONE `DETALLE_VENTA ⋈ VENTA ⋈ PRODUCTO` aggregate valorized at
 * `Producto.costoPromedio`, and the margin figures are computed by the pure domain (`resumen.ts`).
 *
 * Same rules as the close: TODAY ONLY in America/Santo_Domingo (no retroactive date exists anywhere
 * in this module), an Admin reads company-wide through `conSucursalAmpliadaEnTx` while any other
 * caller stays branch-pinned, everything inside the caller's `withTenantTransaction`, money always a
 * `Decimal(12,2)` string.
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { conSucursalAmpliadaEnTx } from "@/modules/reportes/infrastructure/widen-sucursal-guc";
import { CajaDomainError, messageFor } from "../domain/errors";
import { calcularResumenDia } from "../domain/resumen";
import { ventanaDiaActualSD, type VentanaDiaSD } from "../domain/zona";
import {
  costoVendidoDiaEnTx,
  totalesVentaDiaEnTx,
} from "../infrastructure/caja-repository";
import { error, ok, type CajaResult } from "./resultado";

/** The 06b board: the four KPIs, money at `Decimal(12,2)` and the margin at 1 decimal. */
export interface ResumenDiaVista {
  /** The SD calendar date the summary belongs to (`YYYY-MM-DD`) — the screenshot subtitle. */
  readonly fechaSD: string;
  /** Ventas del día — the SAME aggregate as 06a's Total facturado. */
  readonly ventas: string;
  readonly costoVendido: string;
  /** `ventas − costoVendido`; negative is a real loss and is never clamped. */
  readonly margenBruto: string;
  /** `margenBruto ÷ ventas × 100` at 1 dp; `"0.0"` for a zero-sales day. */
  readonly margenPorcentaje: string;
}

/** Today's SD day window, or the typed `CAJA_VALIDACION` refusal (defects still propagate). */
function ventanaOHoy(ahora: Date): CajaResult<VentanaDiaSD> {
  try {
    return ok(ventanaDiaActualSD(ahora));
  } catch (e) {
    if (e instanceof CajaDomainError) return error(e.code, messageFor(e.code));
    throw e;
  }
}

/** Read the day's sales/cost/margin summary. `ahora` defaults to the real clock (today-only). */
export async function consultarResumenDia(
  tx: PrismaTx,
  ctx: TenantCtx,
  ahora: Date = new Date(),
): Promise<CajaResult<ResumenDiaVista>> {
  const ventana = ventanaOHoy(ahora);
  if (!ventana.ok) return error(ventana.code, ventana.message);

  const { data: dia } = ventana;
  const sucursalId = ctx.esAdmin ? null : ctx.sucursalId;

  const lectura = async (txLectura: PrismaTx): Promise<ResumenDiaVista> => {
    const [totales, costo] = await Promise.all([
      totalesVentaDiaEnTx(txLectura, ctx, dia, sucursalId),
      costoVendidoDiaEnTx(txLectura, ctx, dia, sucursalId),
    ]);
    const resumen = calcularResumenDia({
      ventasTotal: totales.totalFacturado,
      costoVendido: costo.costoVendido,
    });
    return {
      fechaSD: dia.fechaSD,
      ventas: resumen.ventas,
      costoVendido: resumen.costoVendido,
      margenBruto: resumen.margenBruto,
      margenPorcentaje: resumen.margenPorcentaje,
    };
  };

  const datos = ctx.esAdmin
    ? await conSucursalAmpliadaEnTx(tx, ctx, lectura)
    : await lectura(tx);
  return ok(datos);
}
