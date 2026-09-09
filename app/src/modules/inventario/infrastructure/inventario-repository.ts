/**
 * Inventario repository — the ONLY place in the module that touches Prisma.
 *
 * Tenant isolation strategy (frozen schema, no migration):
 *   - `INVENTARIO` has no own `empresaId`; its only tenant anchor is
 *     `sucursalId`. Every read/write therefore filters through the
 *     `sucursal.empresaId` navigation AND the current `sucursalId`, per the
 *     convention documented in `tenant/domain/tenant.ts`.
 *   - `MOVIMIENTO_INVENTARIO` is a child of a single inventory row, so it is
 *     scoped implicitly via its `inventarioId` (already tenant-checked).
 *
 * Concurrency (design "Concurrent mutation"): the manual adjustment locks the
 * exact `(sucursalId, productoId)` row with `SELECT ... FOR UPDATE`, reads the
 * authoritative quantity, applies a verified non-negative update, then appends
 * the movement + audit rows — all inside the caller's single `PrismaTx`, so the
 * whole effect commits or rolls back atomically.
 */

import {
  Prisma,
  AccionAuditoria,
  TipoMovimiento,
} from "@/generated/prisma/client";
import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  INVENTARIO_NO_ENCONTRADO,
  STOCK_INSUFICIENTE,
  InventarioDomainError,
} from "../domain/errors";
import type {
  InventarioStockRow,
  InventorySource,
} from "../domain/inventario";

export interface ListarInventarioQuery {
  readonly page: number;
  readonly limit: number;
}

/** Shape of the atomic manual-adjustment request handed to the repository. */
export interface AjustarStockEnTxInput {
  readonly productoId: number;
  /** Signed delta as a decimal string (negative reduces stock). */
  readonly delta: string;
  readonly motivo: string;
  readonly source: InventorySource;
}

/** Authoritative before/after snapshot after a movement commits. */
export interface MovimientoAplicado {
  readonly inventoryId: number;
  readonly previousQuantity: string;
  readonly newQuantity: string;
}

/**
 * Tenant-scoped `where` for `INVENTARIO`: company via `sucursal.empresaId`
 * navigation plus the concrete branch. `MOVIMIENTO_INVENTARIO` history reuses
 * the same anchor through its `inventario` relation.
 */
function inventarioTenantWhere(ctx: TenantCtx): Prisma.InventarioWhereInput {
  return {
    sucursalId: ctx.sucursalId,
    sucursal: { empresaId: ctx.empresaId },
  };
}

const inventarioRowSelect = {
  id: true,
  productoId: true,
  cantidad: true,
  producto: { select: { codigo: true, nombre: true, stockMinimo: true } },
} satisfies Prisma.InventarioSelect;

type InventarioRow = Prisma.InventarioGetPayload<{
  select: typeof inventarioRowSelect;
}>;

function toStockRow(row: InventarioRow): InventarioStockRow {
  return {
    inventarioId: row.id,
    productoId: row.productoId,
    codigo: row.producto.codigo,
    nombre: row.producto.nombre,
    cantidad: new Prisma.Decimal(row.cantidad).toString(),
    stockMinimo: row.producto.stockMinimo,
  };
}

/**
 * Paginated, tenant-scoped stock listing. Stable ordering: product code asc,
 * tie-broken by the inventory id so two rows with an identical code across
 * branches cannot interleave differently between pages.
 */
export async function listarInventarioEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarInventarioQuery,
): Promise<InventarioStockRow[]> {
  const rows = await tx.inventario.findMany({
    where: inventarioTenantWhere(ctx),
    select: inventarioRowSelect,
    orderBy: [{ producto: { codigo: "asc" } }, { id: "asc" }],
    skip: (query.page - 1) * query.limit,
    take: query.limit,
  });
  return rows.map(toStockRow);
}

/** Total rows for the branch's tenant scope, matching the listing filter. */
export async function contarInventarioEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
): Promise<number> {
  return tx.inventario.count({ where: inventarioTenantWhere(ctx) });
}

/**
 * Tenant-scoped single-inventory fetch by product. Returns the row id and its
 * current quantity, or `null` when no inventory exists for that product in the
 * caller's branch. Used to confirm an inventory belongs to the tenant before
 * any adjustment.
 */
export async function obtenerInventarioPorProductoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  productoId: number,
): Promise<{ inventarioId: number; cantidad: string } | null> {
  const row = await tx.inventario.findFirst({
    where: { ...inventarioTenantWhere(ctx), productoId },
    select: { id: true, cantidad: true },
  });
  if (row === null) return null;
  return { inventarioId: row.id, cantidad: new Prisma.Decimal(row.cantidad).toString() };
}

/**
 * Product ownership guard: a PRODUCTO row must belong to the caller's company
 * before an adjustment may create or touch its inventory. This blocks a
 * cross-tenant `productoId` from producing an inventory row under a foreign
 * product (which would otherwise satisfy only the FK, not the tenant).
 */
async function productoExisteEnEmpresa(
  tx: PrismaTx,
  empresaId: number,
  productoId: number,
): Promise<boolean> {
  const row = await tx.producto.findFirst({
    where: { id: productoId, empresaId },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Append-only audit row for a manual stock adjustment. Runs inside the same
 * transaction as the mutation: a rolled-back adjustment rolls this back too.
 */
async function registrarAjusteEnAuditoria(
  tx: PrismaTx,
  ctx: TenantCtx,
  inventarioId: number,
  motivo: string,
  anterior: string,
  nueva: string,
): Promise<void> {
  await tx.movimientoAuditoria.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
      fechaHora: new Date(),
      accion: AccionAuditoria.AJUSTAR,
      entidad: "Inventario",
      idEntidad: String(inventarioId),
      valorAnterior: anterior,
      valorNuevo: nueva,
      motivo,
    },
  });
}

/**
 * Atomic, row-locked manual adjustment. Steps — all inside the supplied tx:
 *   1. reject a product outside the tenant (`INVENTARIO_NO_ENCONTRADO`);
 *   2. guarantee the branch's inventory row exists (upsert a zero row);
 *   3. `SELECT ... FOR UPDATE` to serialize concurrent same-row adjustments;
 *   4. compute next = current + delta and reject an exit below zero
 *      (`STOCK_INSUFICIENTE`);
 *   5. update the quantity, then append the immutable `AJUSTE` movement and the
 *      audit row.
 *
 * `costoPromedio` is never read or written here (3.4a boundary).
 *
 * @throws InventarioDomainError(STOCK_INSUFICIENTE | INVENTARIO_NO_ENCONTRADO)
 */
export async function ajustarStockEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: AjustarStockEnTxInput,
): Promise<MovimientoAplicado> {
  const existe = await productoExisteEnEmpresa(tx, ctx.empresaId, input.productoId);
  if (!existe) {
    throw new InventarioDomainError(INVENTARIO_NO_ENCONTRADO, {
      productoId: input.productoId,
    });
  }

  // Ensure the per-branch row exists before locking it; a first-time
  // adjustment on a fresh product starts from a zero quantity.
  const ensured = await tx.inventario.upsert({
    where: {
      sucursalId_productoId: {
        sucursalId: ctx.sucursalId,
        productoId: input.productoId,
      },
    },
    update: {},
    create: {
      sucursalId: ctx.sucursalId,
      productoId: input.productoId,
      cantidad: new Prisma.Decimal(0),
    },
    select: { id: true },
  });

  // Serialize on the exact row and read the authoritative current quantity.
  const locked = await tx.$queryRaw<
    { cantidad: Prisma.Decimal }[]
  >`SELECT "cantidad" FROM "INVENTARIO" WHERE "id" = ${ensured.id} FOR UPDATE`;

  if (locked.length === 0) {
    throw new InventarioDomainError(INVENTARIO_NO_ENCONTRADO, {
      inventarioId: ensured.id,
    });
  }

  const anterior = new Decimal(locked[0].cantidad.toString());
  const delta = new Decimal(input.delta);
  const nueva = anterior.plus(delta);

  // Non-negative invariant — reject the exit WITHOUT writing anything; the
  // surrounding transaction rolls back the upsert of a freshly-created row too.
  if (nueva.isNegative()) {
    throw new InventarioDomainError(STOCK_INSUFICIENTE, {
      inventarioId: ensured.id,
      disponible: anterior.toFixed(3),
      pretendida: delta.toString(),
    });
  }

  await tx.inventario.update({
    where: { id: ensured.id },
    data: { cantidad: new Prisma.Decimal(nueva) },
  });

  await tx.movimientoInventario.create({
    data: {
      inventarioId: ensured.id,
      tipoMovimiento: TipoMovimiento.AJUSTE,
      motivo: input.motivo,
      cantidadMovida: new Prisma.Decimal(delta),
      cantidadAnterior: new Prisma.Decimal(anterior),
      cantidadNueva: new Prisma.Decimal(nueva),
      usuarioId: ctx.usuarioId,
      fecha: new Date(),
    },
  });

  await registrarAjusteEnAuditoria(
    tx,
    ctx,
    ensured.id,
    input.motivo,
    anterior.toFixed(3),
    nueva.toFixed(3),
  );

  return {
    inventoryId: ensured.id,
    previousQuantity: anterior.toFixed(3),
    newQuantity: nueva.toFixed(3),
  };
}

/**
 * Role authorization for the inventory actions, mirroring the producto /
 * categoria / proveedor repositories (third-party copy; centralization was
 * evaluated and deferred as YAGNI). Prisma access stays here; only the boolean
 * crosses back into `http/`. The user is resolved by id + empresaId so a
 * cross-tenant id collision can never authorize a role.
 */
export async function tieneRolPermitidoEnTx(
  tx: PrismaTx,
  usuarioId: number,
  empresaId: number,
  rolesPermitidos: readonly string[],
): Promise<boolean> {
  const usuario = await tx.usuario.findUnique({
    where: { id: usuarioId, empresaId },
    select: {
      roles: { select: { rol: { select: { nombre: true } } } },
    },
  });
  if (usuario === null) return false;
  return usuario.roles.some((r) => rolesPermitidos.includes(r.rol.nombre));
}
