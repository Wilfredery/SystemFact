/**
 * Movimiento history reader (odd/tasks/inventario-historial.md S3/S4) — read-only.
 *
 * Kept apart from `inventario-repository.ts` on purpose: that file holds the
 * writers; this one only reads. `MOVIMIENTO_INVENTARIO` has no empresa/sucursal/
 * producto column of its own, so the tenant anchor is its `inventario` relation:
 * `inventario.sucursalId = ctx.sucursalId` AND `inventario.sucursal.empresaId =
 * ctx.empresaId` (the same `inventarioTenantWhere` the stock list uses), in the
 * query itself and in addition to RLS (`movinventario_isolation`).
 *
 * Callers must pass the plain tenant `PrismaTx` (branch GUC pinned). Never run
 * this inside a widened/blanked-branch transaction such as the one behind
 * `stockTotalEmpresaEnTx`.
 *
 * `select` is explicit and never names `idempotencyKey` or any cost column.
 * The page and the total are built from the SAME `where`.
 */

import { Prisma } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { TipoMovimientoInventario } from "../domain/movimientos";
import { escaparLike, inventarioTenantWhere } from "./inventario-repository";

export interface MovimientosFiltros {
  /** Inclusive UTC lower bound of `fecha`. */
  readonly inicio: Date;
  /** EXCLUSIVE UTC upper bound of `fecha`. */
  readonly fin: Date;
  readonly tipo?: TipoMovimientoInventario;
  /** Text matched (case-insensitive contains) against producto codigo OR nombre. */
  readonly producto?: string;
}

export interface MovimientosPagina {
  readonly page: number;
  readonly limit: number;
}

export interface MovimientoRow {
  readonly id: number;
  /** UTC instant, ISO-8601. The UI renders it in America/Santo_Domingo. */
  readonly fecha: string;
  readonly tipo: TipoMovimientoInventario;
  readonly productoCodigo: string;
  readonly productoNombre: string;
  /** Signed delta, Decimal(12,3)-compatible string. */
  readonly cantidadMovida: string;
  readonly cantidadAnterior: string;
  readonly cantidadNueva: string;
  /**
   * Null when the author's USUARIO row is not visible to the session: RLS pins
   * USUARIO to the branch GUC, so a user of another branch reads as null (the
   * ledger row itself is still the session branch's).
   */
  readonly usuarioNombre: string | null;
  readonly motivo: string;
}

const movimientoSelect = {
  id: true,
  fecha: true,
  tipoMovimiento: true,
  motivo: true,
  cantidadMovida: true,
  cantidadAnterior: true,
  cantidadNueva: true,
  usuario: { select: { nombre: true } },
  inventario: { select: { producto: { select: { codigo: true, nombre: true } } } },
} satisfies Prisma.MovimientoInventarioSelect;

type MovimientoSelected = Prisma.MovimientoInventarioGetPayload<{
  select: typeof movimientoSelect;
}>;

function movimientosWhere(
  ctx: TenantCtx,
  filtros: MovimientosFiltros,
): Prisma.MovimientoInventarioWhereInput {
  const termino = filtros.producto?.trim();
  // Prisma `contains` does not escape LIKE wildcards: escape them so `%` and `_` match literally.
  const texto = termino ? escaparLike(termino) : undefined;
  return {
    fecha: { gte: filtros.inicio, lt: filtros.fin },
    ...(filtros.tipo === undefined ? {} : { tipoMovimiento: filtros.tipo }),
    inventario: {
      ...inventarioTenantWhere(ctx),
      ...(texto
        ? {
            producto: {
              OR: [
                { codigo: { contains: texto, mode: "insensitive" } },
                { nombre: { contains: texto, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
  };
}

function toMovimientoRow(row: MovimientoSelected): MovimientoRow {
  // Typed as required, but RLS can hide the related USUARIO row (see MovimientoRow).
  const usuario: { nombre: string } | null = row.usuario;
  return {
    id: row.id,
    fecha: row.fecha.toISOString(),
    tipo: row.tipoMovimiento,
    productoCodigo: row.inventario.producto.codigo,
    productoNombre: row.inventario.producto.nombre,
    cantidadMovida: new Prisma.Decimal(row.cantidadMovida).toString(),
    cantidadAnterior: new Prisma.Decimal(row.cantidadAnterior).toString(),
    cantidadNueva: new Prisma.Decimal(row.cantidadNueva).toString(),
    usuarioNombre: usuario?.nombre ?? null,
    motivo: row.motivo,
  };
}

/** One page of the branch's movements, newest first (`fecha desc, id desc`). */
export async function listarMovimientosEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtros: MovimientosFiltros,
  pagina: MovimientosPagina,
): Promise<MovimientoRow[]> {
  const rows = await tx.movimientoInventario.findMany({
    where: movimientosWhere(ctx, filtros),
    select: movimientoSelect,
    orderBy: [{ fecha: "desc" }, { id: "desc" }],
    skip: (pagina.page - 1) * pagina.limit,
    take: pagina.limit,
  });
  return rows.map(toMovimientoRow);
}

/** Total movements matching the SAME filters as the page. */
export async function contarMovimientosEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtros: MovimientosFiltros,
): Promise<number> {
  return tx.movimientoInventario.count({ where: movimientosWhere(ctx, filtros) });
}
