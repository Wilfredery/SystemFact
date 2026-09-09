import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  COMPRA_INMUTABLE,
  COMPRA_NO_ENCONTRADA,
  CONCURRENCIA_CONFLICTO,
  NFC_DUPLICADO,
  messageFor,
  CompraDomainError,
  type CompraErrorCode,
} from "../domain/errors";
import {
  ESTADO_COMPRA,
  type CompraLineaInput,
  type CompraResult,
  type TipoNcfCompra,
} from "../domain/compra";
import { MONTO_CERO } from "../domain/calculators";
import {
  actualizarCompraBorradorEnTx,
  leerCompraEnTx,
  leerProveedorClasificadoEnTx,
  registrarAuditCompraEnTx,
  reemplazarLineasEnTx,
} from "../infrastructure/compra-repository";
import { prepararLineas } from "./preparar-lineas";

export interface ActualizarCompraInput {
  readonly id: number;
  /** Full replacement set of lines (delete-and-reinsert semantics). */
  readonly lineas: readonly CompraLineaInput[];
  readonly ncf?: string | null;
  readonly tipoNcf?: TipoNcfCompra | null;
}

export interface ActualizarCompraOutput {
  readonly id: number;
  readonly total: string;
}

export type ActualizarCompraResult = CompraResult<ActualizarCompraOutput>;

function buildError(
  code: CompraErrorCode,
): { ok: false; code: CompraErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * CMP-EDIT: edit a purchase, allowed ONLY while it is a `BORRADOR` (spec
 * "Edit after confirm rejected"). Lines are fully replaced and re-frozen from
 * the current product rates; totals are recomputed. The supplier cannot be
 * changed on edit (cancel-and-recreate instead). A `PENDIENTE` (or otherwise
 * non-draft) purchase returns `COMPRA_INMUTABLE`. The header update is guarded
 * on `estado='BORRADOR'` so a concurrent confirm/cancel wins exactly once and
 * surfaces as `CONCURRENCIA_CONFLICTO`.
 */
export async function actualizarCompra(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ActualizarCompraInput,
): Promise<ActualizarCompraResult> {
  const actual = await leerCompraEnTx(tx, ctx, input.id);
  if (actual === null) {
    return buildError(COMPRA_NO_ENCONTRADA);
  }
  if (actual.estado !== ESTADO_COMPRA.BORRADOR) {
    return buildError(COMPRA_INMUTABLE);
  }

  const proveedor = await leerProveedorClasificadoEnTx(
    tx,
    ctx.empresaId,
    actual.proveedorId,
  );
  const preparado = await prepararLineas(
    tx,
    ctx.empresaId,
    actual.proveedorId,
    proveedor?.activo ?? false,
    proveedor !== null,
    input.lineas,
  );
  if (!preparado.ok) {
    return buildError(preparado.code);
  }

  const ncf = input.ncf && input.ncf.length > 0 ? input.ncf : null;

  try {
    const { updated } = await actualizarCompraBorradorEnTx(tx, ctx, input.id, {
      ncf,
      tipoNcf: input.tipoNcf ?? null,
      totales: {
        subtotalGravado: preparado.totales.subtotalGravado,
        itbis: preparado.totales.itbis,
        subtotalExento: preparado.totales.subtotalExento,
        subtotal: preparado.totales.subtotal,
        // Draft edits never carry retentions; they are frozen at confirm.
        retencionIsr: MONTO_CERO,
        retencionItbis: MONTO_CERO,
        total: preparado.totales.total,
      },
    });
    if (!updated) {
      // Raced with a confirm/cancel since the read: draft no longer editable.
      return buildError(CONCURRENCIA_CONFLICTO);
    }

    await reemplazarLineasEnTx(tx, input.id, preparado.lineas);

    await registrarAuditCompraEnTx(
      tx,
      ctx,
      "ACTUALIZAR",
      input.id,
      { estado: ESTADO_COMPRA.BORRADOR },
      { estado: ESTADO_COMPRA.BORRADOR, total: preparado.totales.total },
    );

    return { ok: true, data: { id: input.id, total: preparado.totales.total } };
  } catch (err) {
    if (err instanceof CompraDomainError && err.code === NFC_DUPLICADO) {
      return buildError(NFC_DUPLICADO);
    }
    throw err;
  }
}
