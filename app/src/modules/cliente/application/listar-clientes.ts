import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { Cliente, ClienteResult } from "../domain/cliente";
import { messageFor, type ClienteErrorCode } from "../domain/errors";
import type { ListarClientesQuery } from "../infrastructure/cliente-repository";
import {
  listarClientesEnEmpresa,
  contarClientesEnEmpresa,
} from "../infrastructure/cliente-repository";

export interface ListarClientesOutput {
  readonly items: Cliente[];
  readonly total: number;
  readonly page: number;
  /** Page size of this read, so the screen can compute the total pages. */
  readonly limit: number;
}

export type ListarClientesResult = ClienteResult<ListarClientesOutput>;

function buildError(
  code: ClienteErrorCode,
): { ok: false; code: ClienteErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * CLI-LIST: explicit pagination (page ≥ 1, 1 ≤ limit ≤ 100, default 25 at the
 * Zod boundary and re-checked here so the use case owns its contract even when
 * called directly). Active-only unless `incluirInactivos` or an explicit
 * `estado` (the Clientes screen filter); Consumidor Final is ALWAYS excluded
 * from operator listing (the repository's `incluirConsumidorFinal` is left
 * unset, i.e. `false`), so the reserved per-empresa fiscal row never leaks into
 * a UI list. `buscar` is forwarded verbatim; the repository owns the
 * name/fiscal-digit OR translation. Credit fields ride in the projection so
 * 5b/5c/6 consume them without re-plumbing. A page past the end is clamped to
 * the last page instead of rendering an empty table.
 */
export async function listarClientes(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarClientesQuery,
): Promise<ListarClientesResult> {
  if (
    !Number.isInteger(query.page) ||
    query.page < 1 ||
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 100
  ) {
    return buildError("VALIDATION_ERROR");
  }

  const total = await contarClientesEnEmpresa(tx, ctx, query);
  const page = Math.min(
    query.page,
    Math.max(1, Math.ceil(total / query.limit)),
  );
  const items = await listarClientesEnEmpresa(tx, ctx, { ...query, page });

  return { ok: true, data: { items, total, page, limit: query.limit } };
}
