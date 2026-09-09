import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  NFC_DUPLICADO,
  messageFor,
  CompraDomainError,
  type CompraErrorCode,
} from "../domain/errors";
import {
  ESTADO_COMPRA,
  type CompraResult,
  type EstadoCompraCore,
  type TipoNcfCompra,
  type TipoCompra,
  type CompraLineaInput,
} from "../domain/compra";
import { MONTO_CERO } from "../domain/calculators";
import {
  crearCompraConLineasEnTx,
  leerProveedorClasificadoEnTx,
  registrarAuditCompraEnTx,
} from "../infrastructure/compra-repository";
import { prepararLineas } from "./preparar-lineas";

export interface CrearCompraInput {
  readonly proveedorId: number;
  readonly tipoCompra: TipoCompra;
  readonly fecha: Date;
  readonly ncf?: string | null;
  readonly tipoNcf?: TipoNcfCompra | null;
  readonly lineas: readonly CompraLineaInput[];
}

export interface CrearCompraOutput {
  readonly id: number;
  readonly estado: EstadoCompraCore;
  readonly correlativoInterno: string;
  readonly total: string;
}

export type CrearCompraResult = CompraResult<CrearCompraOutput>;

function buildError(
  code: CompraErrorCode,
): { ok: false; code: CompraErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * CMP-CREATE: create a tenant-scoped `BORRADOR` purchase.
 *
 * The supplier must exist and be active and every line must reference a
 * product owned by the same empresa (still active) with a valid quantity/cost
 * and an 18/16/0 rate; line rules and totals come from {@link prepararLineas}.
 * Per-line ITBIS rates are frozen from the product at save time. Retentions and
 * the internal `CMP` correlativo are deferred to confirm (the draft stores
 * zeros and an empty correlativo). A duplicate optional NCF within the empresa
 * is rejected with `NFC_DUPLICADO`.
 */
export async function crearCompra(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CrearCompraInput,
): Promise<CrearCompraResult> {
  const proveedor = await leerProveedorClasificadoEnTx(
    tx,
    ctx.empresaId,
    input.proveedorId,
  );

  const preparado = await prepararLineas(
    tx,
    ctx.empresaId,
    input.proveedorId,
    proveedor?.activo ?? false,
    proveedor !== null,
    input.lineas,
  );
  if (!preparado.ok) {
    return buildError(preparado.code);
  }

  const ncf = input.ncf && input.ncf.length > 0 ? input.ncf : null;

  try {
    const { id } = await crearCompraConLineasEnTx(tx, ctx, {
      sucursalId: ctx.sucursalId,
      proveedorId: input.proveedorId,
      usuarioId: ctx.usuarioId,
      tipoCompra: input.tipoCompra,
      fecha: input.fecha,
      ncf,
      tipoNcf: input.tipoNcf ?? null,
      correlativoInterno: "",
      lineas: preparado.lineas,
      totales: {
        subtotalGravado: preparado.totales.subtotalGravado,
        itbis: preparado.totales.itbis,
        subtotalExento: preparado.totales.subtotalExento,
        subtotal: preparado.totales.subtotal,
        retencionIsr: MONTO_CERO,
        retencionItbis: MONTO_CERO,
        total: preparado.totales.total,
      },
    });

    await registrarAuditCompraEnTx(tx, ctx, "CREAR", id, null, {
      id,
      estado: ESTADO_COMPRA.BORRADOR,
      total: preparado.totales.total,
    });

    return {
      ok: true,
      data: {
        id,
        estado: ESTADO_COMPRA.BORRADOR,
        correlativoInterno: "",
        total: preparado.totales.total,
      },
    };
  } catch (err) {
    if (err instanceof CompraDomainError && err.code === NFC_DUPLICADO) {
      return buildError(NFC_DUPLICADO);
    }
    throw err;
  }
}
