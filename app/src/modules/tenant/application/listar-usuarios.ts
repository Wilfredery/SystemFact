/**
 * Application use case — `listarUsuarios` (screens plan Step 7, S4).
 *
 * Pagination is the SHARED contract (`shared/domain/pagination`): page ≥ 1 and
 * pageSize clamped to [1, 100], offset derived from them here so no code path
 * can issue an unbounded scan. The filters are forwarded trimmed, and a blank
 * search term is not a filter at all. Tenant scope (`empresaId`, and the branch
 * through the `usuario_select` RLS policy) comes from the caller's context
 * only — this surface accepts no empresa/sucursal parameter. An Administrador
 * reads company-wide (branch GUC cleared for this read-only call, empresa GUC
 * untouched); anyone else would stay on the session branch.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { conSucursalAmpliadaEnTx } from "@/modules/reportes/infrastructure/widen-sucursal-guc";
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
 * One page of the users (company-wide for an Administrador, the session branch
 * otherwise) plus the total for the same filters. The widen wraps ONLY these two
 * reads and is restored before the caller's transaction continues, so a later
 * write in the same transaction never sees a blank branch.
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

  const lectura = (t: PrismaTx) =>
    Promise.all([
      listarUsuariosEnTx(t, ctx, { offset, limit: pageSize, ...filtros }),
      contarUsuariosEnTx(t, ctx, filtros),
    ]);
  const [items, total] = ctx.esAdmin
    ? await conSucursalAmpliadaEnTx(tx, ctx, lectura)
    : await lectura(tx);

  return { ok: true, data: { items, total, page, pageSize } };
}
