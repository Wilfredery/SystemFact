import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  COMPRA_NO_ENCONTRADA,
  CONCURRENCIA_CONFLICTO,
  TRANSICION_INVALIDA,
  VALIDATION_ERROR,
  messageFor,
  type CompraErrorCode,
} from "../domain/errors";
import {
  ESTADO_COMPRA,
  type CompraResult,
  type EstadoCompraCore,
} from "../domain/compra";
import { transicionarCancelar } from "../domain/compra";
import {
  cancelarCompraEnTx,
  leerCompraEnTx,
  registrarAuditCompraEnTx,
} from "../infrastructure/compra-repository";

export interface CancelarCompraInput {
  readonly id: number;
  readonly motivo: string;
}

export interface CancelarCompraOutput {
  readonly id: number;
  readonly estado: EstadoCompraCore;
}

export type CancelarCompraResult = CompraResult<CancelarCompraOutput>;

function buildError(
  code: CompraErrorCode,
): { ok: false; code: CompraErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * CMP-CANCEL: cancel a pre-receipt purchase to terminal `CANCELADA`, reachable
 * from `BORRADOR` or `PENDIENTE`. A blank motivo is rejected with
 * `VALIDATION_ERROR` (nothing written). The transition is guarded on the row's
 * current `estado`, so a concurrent transition produces `CONCURRENCIA_CONFLICTO`
 * for the loser. Cancel performs NO fiscal/inventory reversal and never clears
 * the `ncf` value, so the per-empresa NCF uniqueness slot stays occupied
 * (spec: "cancel does not free the NCF slot"). The motivo is preserved in the
 * append-only audit row.
 */
export async function cancelarCompra(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CancelarCompraInput,
): Promise<CancelarCompraResult> {
  const motivo = input.motivo.trim();
  if (motivo.length === 0) {
    return buildError(VALIDATION_ERROR);
  }

  const compra = await leerCompraEnTx(tx, ctx, input.id);
  if (compra === null) {
    return buildError(COMPRA_NO_ENCONTRADA);
  }

  const transicion = transicionarCancelar(compra.estado);
  if (!transicion.ok) {
    return buildError(TRANSICION_INVALIDA);
  }
  if (compra.estado !== ESTADO_COMPRA.BORRADOR && compra.estado !== ESTADO_COMPRA.PENDIENTE) {
    // Defensive: transicionarCancelar already rejects terminal/foreign states.
    return buildError(TRANSICION_INVALIDA);
  }

  const { cancelled } = await cancelarCompraEnTx(tx, ctx, input.id, compra.estado);
  if (!cancelled) {
    return buildError(CONCURRENCIA_CONFLICTO);
  }

  await registrarAuditCompraEnTx(
    tx,
    ctx,
    "CANCELAR",
    input.id,
    { estado: compra.estado },
    { estado: ESTADO_COMPRA.CANCELADA },
    motivo,
  );

  return { ok: true, data: { id: input.id, estado: ESTADO_COMPRA.CANCELADA } };
}
