/**
 * Composed read for the printed fiscal invoice (odd/tasks/factura-print.md T1).
 *
 * Application seam only: it composes three persisted sources and derives
 * NOTHING from today's parameters — the invoice identity and frozen lines come
 * from the venta repository read, the per-rate ITBIS breakdown is a pure
 * aggregation of those frozen lines (S3), and the balance is derived from the
 * cobros canonical query (ADR-017: never a materialized value), which exists
 * for VIGENTE invoices only. `REEMBOLSO` pagos net against the balance inside
 * the canonical query, so the view never recomputes money.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { consultarSaldoCxcEnTx } from "@/modules/cobros/infrastructure/saldo-cxc.repository";
import {
  FACTURA_NO_ENCONTRADA,
  messageFor,
  type VentaErrorCode,
  type VentaResult,
} from "@/modules/venta/domain/errors";
import { desglosarItbisPorTasa } from "@/modules/venta/domain/itbis-desglose";
import type { EstadoDocumento } from "@/generated/prisma/client";
import { leerFacturaParaImpresionEnTx } from "@/modules/venta/infrastructure/venta-repository";

export interface FacturaParaImpresionInput {
  readonly facturaId: number;
}

export interface FacturaParaImpresionVista {
  readonly facturaId: number;
  readonly ventaId: number;
  readonly tipoNcf: string;
  readonly ncf: string;
  readonly correlativoInterno: string;
  readonly estado: EstadoDocumento;
  readonly fechaEmision: string;
  readonly ventaFecha: string;
  readonly ncfVigenciaFin: string | null;
  readonly empresa: {
    readonly nombreComercial: string;
    readonly razonSocial: string;
    readonly rnc: string;
    readonly direccionFiscal: string;
    readonly telefono: string;
    readonly regimenFiscal: string;
  };
  readonly sucursal: {
    readonly nombre: string;
    readonly direccion: string;
    readonly telefono: string;
  };
  readonly cliente: {
    readonly nombre: string;
    readonly identificacionFiscal: string | null;
    readonly esConsumidorFinal: boolean;
  };
  readonly usuarioNombre: string;
  readonly lineas: readonly {
    readonly productoNombre: string;
    readonly cantidad: string;
    readonly precioUnitario: string;
    readonly tasaItbis: string;
    readonly descuentoLinea: string;
    readonly descuentoTipo: string;
    readonly itbisLinea: string;
    readonly subtotalLinea: string;
  }[];
  readonly desgloseItbis: readonly { readonly tasa: string; readonly itbis: string }[];
  readonly subtotalGravado: string;
  readonly subtotalExento: string;
  readonly descuento: string;
  readonly itbis: string;
  readonly total: string;
  /** ADR-017 derived balance; `null` for a CANCELADA/ANULADA invoice (no fiscal effect). */
  readonly saldo: {
    readonly total: string;
    readonly cobrosAplicados: string;
    readonly saldoPendiente: string;
  } | null;
}

export type FacturaParaImpresionResult = VentaResult<FacturaParaImpresionVista> & {
  readonly code?: VentaErrorCode;
};

export async function consultarFacturaParaImpresion(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: FacturaParaImpresionInput,
): Promise<FacturaParaImpresionResult> {
  const row = await leerFacturaParaImpresionEnTx(tx, ctx, input.facturaId);
  if (row === null) {
    return {
      ok: false,
      code: FACTURA_NO_ENCONTRADA,
      message: messageFor(FACTURA_NO_ENCONTRADA),
    };
  }

  const desgloseItbis = desglosarItbisPorTasa(
    row.lineas.map((l) => ({ tasaItbis: l.tasaItbis, itbisLinea: l.itbisLinea })),
  );

  let saldo: FacturaParaImpresionVista["saldo"] = null;
  if (row.estado === "VIGENTE") {
    const filas = await consultarSaldoCxcEnTx(tx, ctx);
    const fila = filas.find((f) => f.facturaId === input.facturaId) ?? null;
    if (fila !== null) {
      saldo = {
        total: fila.total,
        cobrosAplicados: fila.cobrosAplicados,
        saldoPendiente: fila.saldoPendiente,
      };
    }
  }

  return {
    ok: true,
    data: {
      facturaId: row.id,
      ventaId: row.ventaId,
      tipoNcf: row.tipoNcf,
      ncf: row.ncf,
      correlativoInterno: row.correlativoInterno,
      estado: row.estado,
      fechaEmision: row.fechaEmision.toISOString(),
      ventaFecha: row.ventaFecha.toISOString(),
      // Calendar date in America/Santo_Domingo (business-calculation layer,
      // AGENTS.md dates): a 23:59:59 UTC-4 expiry must not print as the NEXT
      // UTC day. en-CA yields the YYYY-MM-DD the view renders.
      ncfVigenciaFin:
        row.ncfVigenciaFin === null
          ? null
          : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo" }).format(
              row.ncfVigenciaFin,
            ),
      empresa: row.empresa,
      sucursal: row.sucursal,
      cliente: row.cliente,
      usuarioNombre: row.usuarioNombre,
      lineas: row.lineas,
      desgloseItbis,
      subtotalGravado: row.subtotalGravado,
      subtotalExento: row.subtotalExento,
      descuento: row.descuento,
      itbis: row.itbis,
      total: row.total,
      saldo,
    },
  };
}
