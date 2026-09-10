import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { Cliente, ClienteResult } from "../domain/cliente";
import { messageFor, type ClienteErrorCode } from "../domain/errors";
import { clienteByIdEnEmpresa } from "../infrastructure/cliente-repository";

export interface ObtenerClienteInput {
  readonly id: number;
}

export type ObtenerClienteResult = ClienteResult<Cliente>;

function buildError(
  code: ClienteErrorCode,
): { ok: false; code: ClienteErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * CLI-GET: single tenant-scoped read. A foreign-empresa id is indistinguishable
 * from a missing one (R1: the repository filters by `empresaId`, so both return
 * `null` → `CLIENTE_NO_ENCONTRADO`; no existence leakage).
 *
 * The per-empresa Consumidor Final row is HIDDEN from operator detail: the
 * design groups list **and detail** as CF-excluding (only update/deactivate
 * surface it, and only to reject with `CONSUMIDOR_FINAL_PROTEGIDO`). A CF id is
 * therefore reported as `CLIENTE_NO_ENCONTRADO` here, and 5b reads the real row
 * through `getOrCreateConsumidorFinalEnTx` (by empresaId + esConsumidorFinal),
 * never through this operator path.
 */
export async function obtenerCliente(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ObtenerClienteInput,
): Promise<ObtenerClienteResult> {
  const cliente = await clienteByIdEnEmpresa(tx, ctx.empresaId, input.id);
  if (cliente === null || cliente.esConsumidorFinal) {
    return buildError("CLIENTE_NO_ENCONTRADO");
  }
  return { ok: true, data: cliente };
}
