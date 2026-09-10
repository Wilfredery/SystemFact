import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { ClienteResult } from "../domain/cliente";
import { messageFor, type ClienteErrorCode } from "../domain/errors";
import {
  clienteByIdEnEmpresa,
  desactivarClienteEnTx,
  tieneVentasNoCanceladas,
  registrarAuditClienteEnTx,
} from "../infrastructure/cliente-repository";

export interface DesactivarClienteInput {
  readonly id: number;
}

export type DesactivarClienteOutput = {
  readonly id: number;
  readonly nombre: string;
};

export type DesactivarClienteResult =
  ClienteResult<DesactivarClienteOutput>;

function buildError(
  code: ClienteErrorCode,
): { ok: false; code: ClienteErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * CLI-DEACT: guarded soft deactivation — the row is never deleted (master
 * entities with history are `activo=false`, AGENTS.md data-integrity). Order
 * guarantees zero mutation on failure:
 *   1. tenant row load (foreign id → CLIENTE_NO_ENCONTRADO, R1);
 *   2. Consumidor Final is protected (CONSUMIDOR_FINAL_PROTEGIDO) — the fiscal
 *      anchor must not be retired through operator CRUD;
 *   3. already-inactive is idempotent (CLIENTE_YA_INACTIVO);
 *   4. the real `Venta` guard blocks while any non-CANCELADA sale references the
 *      client (CLIENTE_TIENE_VENTAS) — soft delete never fires the FK, so this
 *      is the only correct integrity check;
 *   5. `desactivarClienteEnTx` is idempotent (`activo=true` in the WHERE), so a
 *      concurrent deactivation collapses to CLIENTE_YA_INACTIVO;
 *   6. the fiscal ID is released automatically: the DB partial unique covers
 *      active rows only, so a new active client may reuse it (R6).
 * Admin-only authorization is enforced at the action layer inside the same
 * transaction; this use case keeps every read/write tenant-scoped.
 */
export async function desactivarCliente(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: DesactivarClienteInput,
): Promise<DesactivarClienteResult> {
  const actual = await clienteByIdEnEmpresa(tx, ctx.empresaId, input.id);
  if (actual === null) return buildError("CLIENTE_NO_ENCONTRADO");
  if (actual.esConsumidorFinal) {
    return buildError("CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO");
  }
  if (!actual.activo) return buildError("CLIENTE_YA_INACTIVO");

  const enUso = await tieneVentasNoCanceladas(tx, ctx.empresaId, input.id);
  if (enUso) return buildError("CLIENTE_TIENE_VENTAS");

  const { deactivated } = await desactivarClienteEnTx(
    tx,
    ctx.empresaId,
    input.id,
  );
  if (!deactivated) {
    // Lost a race against a concurrent deactivation: same user-visible state.
    return buildError("CLIENTE_YA_INACTIVO");
  }

  // CANCELAR is the frozen-enum closest to "retire without destruction" (no
  // enum extension, no migration); motivo keeps it traceable. Minimal payload.
  await registrarAuditClienteEnTx(
    tx,
    ctx,
    "CANCELAR",
    input.id,
    { activo: true },
    { activo: false },
    "cliente.desactivado",
  );

  return { ok: true, data: { id: input.id, nombre: actual.nombre } };
}
