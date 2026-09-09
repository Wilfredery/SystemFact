import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  COMPRA_NO_ENCONTRADA,
  CONCURRENCIA_CONFLICTO,
  CONFIG_RETENCION_FALTANTE,
  PROVEEDOR_NO_ENCONTRADO,
  messageFor,
  CompraDomainError,
  type CompraErrorCode,
} from "../domain/errors";
import {
  ESTADO_COMPRA,
  type EstadoCompraCore,
  type CompraLineaCalculada,
  type CompraLineaInput,
  type CompraResult,
} from "../domain/compra";
import { transicionarConfirmar } from "../domain/compra";
import {
  calcularLinea,
  calcularRetenciones,
  calcularTotales,
  requiredRetentionKeys,
} from "../domain/calculators";
import {
  confirmarCompraEnTx,
  leerCompraEnTx,
  leerProveedorClasificadoEnTx,
  registrarAuditCompraEnTx,
} from "../infrastructure/compra-repository";
import { leerTasasRetencionEnTx } from "../infrastructure/configuracion-repository";

export interface ConfirmarCompraInput {
  readonly id: number;
}

export interface ConfirmarCompraOutput {
  readonly id: number;
  readonly estado: EstadoCompraCore;
  readonly correlativoInterno: string;
  readonly total: string;
  readonly retencionIsr: string;
  readonly retencionItbis: string;
}

export type ConfirmarCompraResult = CompraResult<ConfirmarCompraOutput>;

function buildError(
  code: CompraErrorCode,
): { ok: false; code: CompraErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * CMP-CONFIRM: guarded `BORRADOR → PENDIENTE`.
 *
 * Recalculates the fiscal totals from the purchase's own frozen lines (never
 * trusting a client-supplied amount), reads the applicable retention rates
 * from `ConfiguracionEmpresa` inside the transaction, and freezes the ISR/ITBIS
 * retentions. A required-but-missing config key blocks confirmation with
 * `CONFIG_RETENCION_FALTANTE` (no legal-default fallback). The state change,
 * the atomic `CMP-%06d` correlativo and the audit row all happen inside the
 * same transaction guarded by `estado='BORRADOR'`, so a retry or a concurrent
 * confirm produces no duplicate transition, number or audit row. NO inventory
 * movement is ever written here (3.4b seam only).
 */
export async function confirmarCompra(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ConfirmarCompraInput,
): Promise<ConfirmarCompraResult> {
  const compra = await leerCompraEnTx(tx, ctx, input.id);
  if (compra === null) {
    return buildError(COMPRA_NO_ENCONTRADA);
  }

  const transicion = transicionarConfirmar(compra.estado);
  if (!transicion.ok) {
    return buildError(transicion.code);
  }

  const proveedor = await leerProveedorClasificadoEnTx(
    tx,
    ctx.empresaId,
    compra.proveedorId,
  );
  if (proveedor === null) {
    return buildError(PROVEEDOR_NO_ENCONTRADO);
  }

  // Recompute totals purely from the stored frozen lines.
  const lineasCalculadas: CompraLineaCalculada[] = compra.lineas.map(
    (persistida) => {
      const lineaInput: CompraLineaInput = {
        productoId: persistida.productoId,
        cantidad: persistida.cantidad,
        costoUnitario: persistida.costoUnitario,
      };
      return calcularLinea(lineaInput, persistida.tasaItbis);
    },
  );
  const totales = calcularTotales(lineasCalculadas);

  const clavesRequeridas = requiredRetentionKeys({
    tipoCompra: compra.tipoCompra,
    tipoProveedor: proveedor.tipoProveedor,
    tipoPersona: proveedor.tipoPersona,
  });

  let rates;
  try {
    rates = await leerTasasRetencionEnTx(tx, ctx.empresaId, clavesRequeridas);
  } catch (err) {
    if (
      err instanceof CompraDomainError &&
      err.code === CONFIG_RETENCION_FALTANTE
    ) {
      return buildError(CONFIG_RETENCION_FALTANTE);
    }
    throw err;
  }

  const retenciones = calcularRetenciones(totales, {
    tipoCompra: compra.tipoCompra,
    tipoProveedor: proveedor.tipoProveedor,
    tipoPersona: proveedor.tipoPersona,
    rates,
  });

  const { confirmed, correlativo } = await confirmarCompraEnTx(
    tx,
    ctx,
    input.id,
    {
      subtotalGravado: totales.subtotalGravado,
      itbis: totales.itbis,
      subtotalExento: totales.subtotalExento,
      subtotal: totales.subtotal,
      retencionIsr: retenciones.retencionIsr,
      retencionItbis: retenciones.retencionItbis,
      total: totales.total,
    },
  );
  if (!confirmed) {
    // A concurrent confirm/cancel won the guarded update: no side effects here.
    return buildError(CONCURRENCIA_CONFLICTO);
  }

  await registrarAuditCompraEnTx(
    tx,
    ctx,
    "ACTUALIZAR",
    input.id,
    { estado: ESTADO_COMPRA.BORRADOR },
    { estado: ESTADO_COMPRA.PENDIENTE, correlativoInterno: correlativo },
    "compra.confirmada",
  );

  return {
    ok: true,
    data: {
      id: input.id,
      estado: ESTADO_COMPRA.PENDIENTE,
      correlativoInterno: correlativo,
      total: totales.total,
      retencionIsr: retenciones.retencionIsr,
      retencionItbis: retenciones.retencionItbis,
    },
  };
}
