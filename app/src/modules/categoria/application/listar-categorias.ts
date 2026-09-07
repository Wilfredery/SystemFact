import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  VALIDATION_ERROR,
  messageFor,
  type CategoriaErrorCode,
} from "../domain/errors";
import type { Categoria, CategoriaResult } from "../domain/categoria";
import type { ListarCategoriasQuery } from "../infrastructure/categoria-repository";
import {
  listarCategoriasEnEmpresa,
  contarCategoriasEnEmpresa,
  registrarAuditCategoriaEnTx,
} from "../infrastructure/categoria-repository";

export interface ListarCategoriasOutput {
  readonly items: Categoria[];
  readonly total: number;
  readonly page: number;
}

export type ListarCategoriasResult = CategoriaResult<ListarCategoriasOutput>;

function buildError(
  code: CategoriaErrorCode,
): { ok: false; code: CategoriaErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * CAT-003: explicit pagination (1–100 per page, page >= 1) and active-only
 * results by default. Pagination is validated here because the use case owns
 * its contract even when the Zod adapter enforces the same bounds; the stable
 * catalog code for both is VALIDATION_ERROR.
 */
export async function listarCategorias(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarCategoriasQuery,
): Promise<ListarCategoriasResult> {
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
    listarCategoriasEnEmpresa(tx, ctx, query),
    contarCategoriasEnEmpresa(tx, ctx, query),
  ]);

  await registrarAuditCategoriaEnTx(tx, ctx, "LEER", query.page, null, {
    count: items.length,
    total,
  });

  return { ok: true, data: { items, total, page: query.page } };
}
