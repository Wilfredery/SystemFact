/**
 * Use case: branch-scoped, read-only movement history
 * (odd/tasks/inventario-historial.md S4/S5).
 *
 * Orchestration only: validate pagination, default/validate the SD date range
 * in the pure domain (with an injectable `ahora`), then delegate the tenant-
 * scoped page + count to the repository with the SAME filters. No Prisma here.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { conSucursalAmpliadaEnTx } from "@/modules/reportes/infrastructure/widen-sucursal-guc";
import { nombresUsuariosEnTx } from "@/modules/tenant/infrastructure/usuario-repository";
import {
  LIMITE_PAGINACION_INVALIDO,
  PAGINA_INVALIDA,
  messageFor,
  type InventarioErrorCode,
} from "../domain/errors";
import {
  resolverRangoMovimientos,
  type TipoMovimientoInventario,
} from "../domain/movimientos";
import {
  contarMovimientosEnTx,
  listarMovimientosEnTx,
  type MovimientoRow,
  type MovimientosFiltros,
} from "../infrastructure/movimientos-repository";

export interface ListarMovimientosQuery {
  readonly page: number;
  readonly limit: number;
  readonly tipo?: TipoMovimientoInventario;
  readonly producto?: string;
  /** SD business day `YYYY-MM-DD` (inclusive). Defaults to 29 days before `hasta`. */
  readonly desde?: string;
  /** SD business day `YYYY-MM-DD` (inclusive). Defaults to today in SD. */
  readonly hasta?: string;
}

export type MovimientoListItem = MovimientoRow;

export interface ListarMovimientosOutput {
  readonly items: MovimientoListItem[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  /** The range actually applied (after defaulting), `YYYY-MM-DD`. */
  readonly desde: string;
  readonly hasta: string;
}

export type ListarMovimientosResult =
  | { ok: true; data: ListarMovimientosOutput }
  | { ok: false; code: InventarioErrorCode; message: string };

function buildError(code: InventarioErrorCode): { ok: false; code: InventarioErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * RLS pins USUARIO to the session branch, so the author of a movement made in
 * another branch reads as null. An Administrador gets those names through ONE
 * name-only lookup for the page, widened to the empresa for that read alone.
 * Everyone else keeps null (no privacy change). The ledger page itself stays on
 * the session branch.
 */
async function completarAutores(
  tx: PrismaTx,
  ctx: TenantCtx,
  items: MovimientoRow[],
): Promise<MovimientoRow[]> {
  if (!ctx.esAdmin) return items;
  const faltantes = [...new Set(items.filter((i) => i.usuarioNombre === null).map((i) => i.usuarioId))];
  if (faltantes.length === 0) return items;
  const nombres = await conSucursalAmpliadaEnTx(tx, ctx, (t) => nombresUsuariosEnTx(t, ctx, faltantes));
  return items.map((i) => (i.usuarioNombre === null ? { ...i, usuarioNombre: nombres.get(i.usuarioId) ?? null } : i));
}

export async function listarMovimientosInventario(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarMovimientosQuery,
  ahora: Date = new Date(),
): Promise<ListarMovimientosResult> {
  if (query.limit < 1 || query.limit > 100) {
    return buildError(LIMITE_PAGINACION_INVALIDO);
  }
  if (query.page < 1) {
    return buildError(PAGINA_INVALIDA);
  }

  const rango = resolverRangoMovimientos({ desde: query.desde, hasta: query.hasta }, ahora);
  if (!rango.ok) {
    return buildError(rango.code);
  }

  const filtros: MovimientosFiltros = {
    inicio: rango.rango.inicio,
    fin: rango.rango.fin,
    ...(query.tipo === undefined ? {} : { tipo: query.tipo }),
    ...(query.producto === undefined ? {} : { producto: query.producto }),
  };

  const [items, total] = await Promise.all([
    listarMovimientosEnTx(tx, ctx, filtros, { page: query.page, limit: query.limit }),
    contarMovimientosEnTx(tx, ctx, filtros),
  ]);

  return {
    ok: true,
    data: {
      items: await completarAutores(tx, ctx, items),
      total,
      page: query.page,
      limit: query.limit,
      desde: rango.rango.desde,
      hasta: rango.rango.hasta,
    },
  };
}
