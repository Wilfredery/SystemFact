import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  VALIDATION_ERROR,
  messageFor,
  type ProveedorErrorCode,
} from "../domain/errors";
import type { Proveedor, ProveedorResult } from "../domain/proveedor";
import type { ListarProveedoresQuery } from "../infrastructure/proveedor-repository";
import {
  listarProveedoresEnEmpresa,
  contarProveedoresEnEmpresa,
} from "../infrastructure/proveedor-repository";

export interface ListarProveedoresOutput {
  readonly items: Proveedor[];
  readonly total: number;
  readonly page: number;
}

export type ListarProveedoresResult = ProveedorResult<ListarProveedoresOutput>;

function buildError(
  code: ProveedorErrorCode,
): { ok: false; code: ProveedorErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * PRV-LIST: explicit pagination (1–100 per page, page >= 1) and active-only
 * results by default; `buscar` is forwarded verbatim so the repository owns
 * the nombre/RNC OR translation. Pagination is validated here because the use
 * case owns its contract even when the Zod adapter enforces the same bounds.
 */
export async function listarProveedores(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarProveedoresQuery,
): Promise<ListarProveedoresResult> {
  if (
    !Number.isInteger(query.page) ||
    query.page < 1 ||
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 100
  ) {
    return buildError(VALIDATION_ERROR);
  }

  const [items, total] = await Promise.all([
    listarProveedoresEnEmpresa(tx, ctx, query),
    contarProveedoresEnEmpresa(tx, ctx, query),
  ]);

  return { ok: true, data: { items, total, page: query.page } };
}
