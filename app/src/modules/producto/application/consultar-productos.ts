/**
 * Use case: the Productos screen listing (plan Step 2, S1/S4).
 *
 * Orchestration only (ADR-013): validates pagination, normalizes the state
 * filter, clamps a page past the end, and delegates every tenant-scoped read to
 * the repository. Nothing here touches Prisma.
 *
 * The state filter supports the screen's `estado` and the previous boolean
 * `incluirInactivos`, so callers written before this screen keep their
 * behavior: omitted + `incluirInactivos=false` lists active products, omitted +
 * `incluirInactivos=true` lists both, and an explicit `estado` always wins.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  LIMITE_PAGINACION_INVALIDO,
  PAGINA_INVALIDA,
  messageFor,
  type ProductoErrorCode,
} from "../domain/errors";
import {
  contarConsultaProductosEnTx,
  consultarProductosEnTx,
  listarCategoriasProductoEnTx,
  type CategoriaOpcion,
  type ConsultarProductosQuery,
} from "../infrastructure/producto-repository";
import {
  mapearProductoConsulta,
  type ProductoConsultaItem,
} from "./producto-consulta-projection";

export type { ConsultarProductosQuery, EstadoProductoFiltro } from "../infrastructure/producto-repository";
export type { ProductoConsultaItem, CategoriaOpcion };

export interface ConsultarProductosOutput {
  readonly items: ProductoConsultaItem[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly categorias: CategoriaOpcion[];
}

export type ConsultarProductosResult =
  | { ok: true; data: ConsultarProductosOutput }
  | { ok: false; code: ProductoErrorCode; message: string };

function buildError(
  code: ProductoErrorCode,
): { ok: false; code: ProductoErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/** Resolves the screen's state filter, keeping the legacy boolean working. */
export function resolverEstadoProducto(
  query: ConsultarProductosQuery,
): "activos" | "inactivos" | "todos" {
  if (query.estado !== undefined) return query.estado;
  return query.incluirInactivos === true ? "todos" : "activos";
}

export async function consultarProductos(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ConsultarProductosQuery,
): Promise<ConsultarProductosResult> {
  if (query.limit < 1 || query.limit > 100) {
    return buildError(LIMITE_PAGINACION_INVALIDO);
  }
  if (query.page < 1) {
    return buildError(PAGINA_INVALIDA);
  }

  const normalizada: ConsultarProductosQuery = {
    ...query,
    estado: resolverEstadoProducto(query),
  };

  // A page past the end (stale link, or the result shrank between loads) is
  // clamped to the last page instead of rendering an empty table.
  const total = await contarConsultaProductosEnTx(tx, ctx, normalizada);
  const page = Math.min(
    query.page,
    Math.max(1, Math.ceil(total / query.limit)),
  );
  const [filas, categorias] = await Promise.all([
    consultarProductosEnTx(tx, ctx, { ...normalizada, page }),
    listarCategoriasProductoEnTx(tx, ctx),
  ]);

  return {
    ok: true,
    data: {
      items: filas.map(mapearProductoConsulta),
      total,
      page,
      limit: query.limit,
      categorias,
    },
  };
}
