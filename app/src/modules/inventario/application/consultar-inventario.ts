/**
 * Use case: the Inventario consulta screen (wireframe `04-Inventario-Consulta`).
 *
 * Orchestration only (ADR-013): validates pagination against the domain rules,
 * then delegates the tenant-scoped reads to the repository. Returns the product
 * rows with their stock status, the KPI cards (whole branch, never the filtered
 * page) and the category options for the filter selector.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  LIMITE_PAGINACION_INVALIDO,
  PAGINA_INVALIDA,
  messageFor,
  type InventarioErrorCode,
} from "../domain/errors";
import { classifyStockKpi, type StockKpi } from "../domain/inventario";
import {
  consultarInventarioEnTx,
  contarConsultaInventarioEnTx,
  listarCategoriasFiltroEnTx,
  resumenInventarioEnTx,
  type ConsultaInventarioQuery,
} from "../infrastructure/inventario-repository";

export type ConsultarInventarioQuery = ConsultaInventarioQuery;

export interface InventarioConsultaItem {
  readonly productoId: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly unidadMedida: string;
  /** Current branch quantity as a Decimal(12,3)-compatible string. */
  readonly cantidad: string;
  readonly stockMinimo: number;
  readonly estado: StockKpi;
}

export interface InventarioResumen {
  readonly totalProductos: number;
  readonly bajoStock: number;
  readonly agotados: number;
  /** Decimal(12,2)-compatible string (money is never a float). */
  readonly valorInventario: string;
}

export interface ConsultarInventarioOutput {
  readonly items: InventarioConsultaItem[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly resumen: InventarioResumen;
  readonly categorias: { id: number; nombre: string }[];
}

export type ConsultarInventarioResult =
  | { ok: true; data: ConsultarInventarioOutput }
  | { ok: false; code: InventarioErrorCode; message: string };

function buildError(
  code: InventarioErrorCode,
): { ok: false; code: InventarioErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

export async function consultarInventario(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ConsultarInventarioQuery,
): Promise<ConsultarInventarioResult> {
  if (query.limit < 1 || query.limit > 100) {
    return buildError(LIMITE_PAGINACION_INVALIDO);
  }
  if (query.page < 1) {
    return buildError(PAGINA_INVALIDA);
  }

  const [rows, total, resumen, categorias] = await Promise.all([
    consultarInventarioEnTx(tx, ctx, query),
    contarConsultaInventarioEnTx(tx, ctx, query),
    resumenInventarioEnTx(tx, ctx),
    listarCategoriasFiltroEnTx(tx, ctx),
  ]);

  const items: InventarioConsultaItem[] = rows.map((row) => ({
    ...row,
    estado: classifyStockKpi(row.cantidad, row.stockMinimo),
  }));

  return {
    ok: true,
    data: { items, total, page: query.page, limit: query.limit, resumen, categorias },
  };
}
