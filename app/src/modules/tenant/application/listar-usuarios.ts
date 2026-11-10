/**
 * Application use case — `listarUsuarios` (screens plan Step 7, S4).
 *
 * Pagination is the SHARED contract (`shared/domain/pagination`): page ≥ 1 and
 * pageSize clamped to [1, 100], offset derived from them here so no code path
 * can issue an unbounded scan. The filters are forwarded trimmed, and a blank
 * search term is not a filter at all. Tenant scope (`empresaId`, and the branch
 * through the `usuario_select` RLS policy) comes from the caller's context
 * only — this surface accepts no empresa/sucursal parameter.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  calcularOffset,
  normalizarPagina,
  normalizarTamanoPagina,
} from "@/shared/domain/pagination";
import {
  contarUsuariosEnTx,
  listarUsuariosEnTx,
  type UsuarioListRow,
} from "../infrastructure/usuario-repository";

/** Raw transport filters; page/pageSize are optional and normalized here. */
export interface ListarUsuariosInput {
  readonly page?: number;
  readonly pageSize?: number;
  readonly buscar?: string;
  readonly activo?: boolean;
}

export interface ListarUsuariosOutput {
  readonly items: readonly UsuarioListRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export type ListarUsuariosResult = { ok: true; data: ListarUsuariosOutput };

/**
 * One page of the session branch's users plus the total for the same filters.
 * Page and count share one `where` (both handlers build it from the same
 * normalized filters), so "Página X de Y" can never describe a different set.
 */
export async function listarUsuarios(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ListarUsuariosInput,
): Promise<ListarUsuariosResult> {
  const page = normalizarPagina(input.page);
  const pageSize = normalizarTamanoPagina(input.pageSize);
  const offset = calcularOffset(page, pageSize);

  const termino = input.buscar?.trim();
  const filtros = {
    ...(termino === undefined || termino === "" ? {} : { buscar: termino }),
    ...(input.activo === undefined ? {} : { activo: input.activo }),
  };

  const [items, total] = await Promise.all([
    listarUsuariosEnTx(tx, ctx, { offset, limit: pageSize, ...filtros }),
    contarUsuariosEnTx(tx, ctx, filtros),
  ]);

  return { ok: true, data: { items, total, page, pageSize } };
}
