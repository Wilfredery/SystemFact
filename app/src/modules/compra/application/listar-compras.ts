import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  VALIDATION_ERROR,
  messageFor,
  type CompraErrorCode,
} from "../domain/errors";
import type { CompraResult } from "../domain/compra";
import {
  contarComprasEnTx,
  listarComprasEnTx,
  type CompraListRow,
} from "../infrastructure/compra-repository";

export interface ListarComprasInput {
  readonly page: number;
  readonly limit: number;
}

export interface ListarComprasOutput {
  readonly items: readonly CompraListRow[];
  readonly total: number;
  readonly page: number;
}

export type ListarComprasResult = CompraResult<ListarComprasOutput>;

/** Default page size and hard upper bound (19-directivas §Performance). */
const PAGE_DEFECTO = 25;
const LIMITE_MAXIMO = 100;

/**
 * Tenant-scoped, paginated purchase listing with a deterministic order (fecha
 * desc, id desc). Bounds are enforced HERE (not just in zod): page >= 1, limit
 * between 1 and 100 (a larger limit is rejected, never silently clamped), so no
 * code path can issue an unbounded scan. Every query pins `empresaId`.
 */
export async function listarCompras(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ListarComprasInput,
): Promise<ListarComprasResult> {
  const page = Number.isInteger(input.page) && input.page >= 1 ? input.page : 0;
  const limit =
    Number.isInteger(input.limit) &&
    input.limit >= 1 &&
    input.limit <= LIMITE_MAXIMO
      ? input.limit
      : 0;

  if (page === 0 || limit === 0) {
    return {
      ok: false,
      code: VALIDATION_ERROR as CompraErrorCode,
      message: messageFor(VALIDATION_ERROR),
    };
  }

  const [items, total] = await Promise.all([
    listarComprasEnTx(tx, ctx, { page, limit }),
    contarComprasEnTx(tx, ctx),
  ]);

  return { ok: true, data: { items, total, page } };
}

// Re-export the default so callers (and the zod schema) share one constant.
export { PAGE_DEFECTO, LIMITE_MAXIMO };
