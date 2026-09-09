/**
 * Use case: list branch-scoped stock with the `stockMinimo` KPI projection.
 *
 * Orchestration only (ADR-013): it validates pagination against the domain
 * rules, then delegates the tenant-scoped reads to the repository. No Prisma
 * call lives here — the active `PrismaTx` is threaded straight through.
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
  contarInventarioEnTx,
  listarInventarioEnTx,
} from "../infrastructure/inventario-repository";

export interface ListarInventarioQuery {
  readonly page: number;
  readonly limit: number;
}

export interface InventarioListItem {
  readonly inventarioId: number;
  readonly productoId: number;
  readonly codigo: string;
  readonly nombre: string;
  /** Current quantity as a Decimal(12,3)-compatible string. */
  readonly cantidad: string;
  /** Per-product minimum-stock threshold. */
  readonly stockMinimo: number;
  /** Derived KPI indicator for the listing UI. */
  readonly kpi: StockKpi;
}

export interface ListarInventarioOutput {
  readonly items: InventarioListItem[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export type ListarInventarioResult =
  | { ok: true; data: ListarInventarioOutput }
  | { ok: false; code: InventarioErrorCode; message: string };

function buildError(
  code: InventarioErrorCode,
): { ok: false; code: InventarioErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

export async function listarInventario(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarInventarioQuery,
): Promise<ListarInventarioResult> {
  if (query.limit < 1 || query.limit > 100) {
    return buildError(LIMITE_PAGINACION_INVALIDO);
  }
  if (query.page < 1) {
    return buildError(PAGINA_INVALIDA);
  }

  const [rows, total] = await Promise.all([
    listarInventarioEnTx(tx, ctx, query),
    contarInventarioEnTx(tx, ctx),
  ]);

  const items: InventarioListItem[] = rows.map((row) => ({
    inventarioId: row.inventarioId,
    productoId: row.productoId,
    codigo: row.codigo,
    nombre: row.nombre,
    cantidad: row.cantidad,
    stockMinimo: row.stockMinimo,
    kpi: classifyStockKpi(row.cantidad, row.stockMinimo),
  }));

  return {
    ok: true,
    data: { items, total, page: query.page, limit: query.limit },
  };
}
