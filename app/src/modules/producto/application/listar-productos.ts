import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  LIMITE_PAGINACION_INVALIDO,
  PAGINA_INVALIDA,
  messageFor,
  type ProductoErrorCode,
} from "../domain/errors";
import type { Producto } from "../domain/producto";
import type { ListarProductosQuery } from "../infrastructure/producto-repository";
import {
  contarProductos,
  listarProductosEnTx,
  registrarProductoListadoEnTx,
} from "../infrastructure/producto-repository";

export interface ListarProductosOutput {
  readonly items: Producto[];
  readonly total: number;
  readonly page: number;
}

export type ListarProductosResult =
  | { ok: true; data: ListarProductosOutput }
  | { ok: false; code: ProductoErrorCode; message: string };

function buildError(
  code: ProductoErrorCode,
): { ok: false; code: ProductoErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

export async function listarProductos(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarProductosQuery,
): Promise<ListarProductosResult> {
  if (query.limit < 1 || query.limit > 100) {
    return buildError(LIMITE_PAGINACION_INVALIDO);
  }
  if (query.page < 1) {
    return buildError(PAGINA_INVALIDA);
  }

  const [items, total] = await Promise.all([
    listarProductosEnTx(tx, ctx, query),
    contarProductos(tx, ctx, query),
  ]);

  await registrarProductoListadoEnTx(tx, ctx, query.page, items.length, total);

  return {
    ok: true,
    data: { items, total, page: query.page },
  };
}
