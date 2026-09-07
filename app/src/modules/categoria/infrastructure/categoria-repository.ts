import {
  Prisma,
  AccionAuditoria,
} from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { Categoria } from "../domain/categoria";
import { NOMBRE_CATEGORIA_DUPLICADO, CategoriaDomainError } from "../domain/errors";

export interface ListarCategoriasQuery {
  readonly page: number;
  readonly limit: number;
  readonly incluirInactivas?: boolean;
}

const categoriaSelect = {
  id: true,
  empresaId: true,
  nombre: true,
  activa: true,
  version: true,
} satisfies Prisma.CategoriaSelect;

type CategoriaRow = Prisma.CategoriaGetPayload<{
  select: typeof categoriaSelect;
}>;

function toDomainCategoria(row: CategoriaRow): Categoria {
  return {
    id: row.id,
    empresaId: row.empresaId,
    nombre: row.nombre,
    activa: row.activa,
    version: row.version,
  };
}

function buildWhere(
  ctx: TenantCtx,
  query: ListarCategoriasQuery,
): Prisma.CategoriaWhereInput {
  const where: Prisma.CategoriaWhereInput = { empresaId: ctx.empresaId };
  // Active-only by default (CAT-003); inactivas appear only when explicitly asked.
  if (!query.incluirInactivas) {
    where.activa = true;
  }
  return where;
}

/**
 * Tenant-filtered single-category fetch. A foreign-tenant id is indistinguishable
 * from a missing one: no cross-tenant disclosure (CAT-006-B).
 */
export async function categoriaByIdEnEmpresa(
  tx: PrismaTx,
  empresaId: number,
  id: number,
): Promise<Categoria | null> {
  const row = await tx.categoria.findFirst({
    where: { id, empresaId },
    select: categoriaSelect,
  });
  return row === null ? null : toDomainCategoria(row);
}

/**
 * Duplicate probe over ACTIVE rows only (CAT-002): the partial unique index
 * (empresaId, nombre) also covers only activa=true, so deactivated names are
 * legitimately reusable. On edit, the row itself is excluded.
 */
export async function existeNombreEnEmpresa(
  tx: PrismaTx,
  empresaId: number,
  nombre: string,
  excludeCategoriaId?: number,
): Promise<boolean> {
  const row = await tx.categoria.findFirst({
    where: {
      empresaId,
      nombre,
      activa: true,
      ...(excludeCategoriaId !== undefined
        ? { id: { not: excludeCategoriaId } }
        : {}),
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * The partial unique (empresaId, nombre) is the real guard against the
 * application pre-check TOCTOU race; map its P2002 violation to the domain
 * duplicate-name error. Any other error is a defect and propagates untouched.
 */
function esDuplicadoNombre(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  );
}

export async function crearCategoriaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  nombre: string,
): Promise<Categoria> {
  let row: CategoriaRow;
  try {
    row = await tx.categoria.create({
      data: { empresaId: ctx.empresaId, nombre, activa: true },
      select: categoriaSelect,
    });
  } catch (err) {
    if (esDuplicadoNombre(err)) {
      throw new CategoriaDomainError(NOMBRE_CATEGORIA_DUPLICADO);
    }
    throw err;
  }
  return toDomainCategoria(row);
}

/**
 * Optimistic-lock update (CAT-004): `UPDATE ... WHERE id AND empresaId AND
 * version`. Zero affected rows means the caller's version is stale →
 * { updated: false }, mapped to CONCURRENCIA_CONFLICTO upstream.
 */
export async function actualizarCategoriaEnTx(
  tx: PrismaTx,
  empresaId: number,
  id: number,
  version: number,
  nombre: string,
): Promise<{ updated: boolean; newVersion: number }> {
  const newVersion = version + 1;
  try {
    const result = await tx.categoria.updateMany({
      where: { id, empresaId, version },
      data: { nombre, version: newVersion },
    });
    if (result.count === 0) return { updated: false, newVersion: version };
    return { updated: true, newVersion };
  } catch (err) {
    // Same TOCTOU mapping as create: concurrent rename onto a taken name.
    if (esDuplicadoNombre(err)) {
      throw new CategoriaDomainError(NOMBRE_CATEGORIA_DUPLICADO);
    }
    throw err;
  }
}

/**
 * Soft deactivation (CAT-005): sets activa=false, never deletes. `activa: true`
 * in the WHERE makes the write idempotent — a concurrent deactivation sees
 * { deactivated: false } instead of double-firing audit. The partial unique on
 * (empresaId, nombre) releases the name automatically.
 */
export async function desactivarCategoriaEnTx(
  tx: PrismaTx,
  empresaId: number,
  id: number,
): Promise<{ deactivated: boolean }> {
  const result = await tx.categoria.updateMany({
    where: { id, empresaId, activa: true },
    data: { activa: false },
  });
  return { deactivated: result.count > 0 };
}

export async function contarCategoriasEnEmpresa(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarCategoriasQuery,
): Promise<number> {
  return tx.categoria.count({ where: buildWhere(ctx, query) });
}

export async function listarCategoriasEnEmpresa(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarCategoriasQuery,
): Promise<Categoria[]> {
  const rows = await tx.categoria.findMany({
    where: buildWhere(ctx, query),
    select: categoriaSelect,
    orderBy: { nombre: "asc" },
    skip: (query.page - 1) * query.limit,
    take: query.limit,
  });
  return rows.map(toDomainCategoria);
}

/**
 * Explicit active-reference guard for deactivation (CAT-005). Soft-delete is
 * an UPDATE, so FK Restrict never fires; the business rule is "any Producto
 * with activo=true still points here", checked in one tenant-scoped count.
 */
export async function tieneProductosActivos(
  tx: PrismaTx,
  empresaId: number,
  categoriaId: number,
): Promise<boolean> {
  const activos = await tx.producto.count({
    where: { categoriaId, empresaId, activo: true },
  });
  return activos > 0;
}

/**
 * Role-based authorization lookup for category Server Actions (CAT-006).
 * Prisma access stays in infrastructure; only the boolean decision crosses
 * back into `http/`. Scoped to the tenant: id + empresaId must both match.
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

/**
 * Append-only audit row for a category mutation (CAT-001/CAT-004/CAT-005).
 * Runs inside the same tenant transaction as the mutation, so a rolled-back
 * write rolls the event back with it. Entity "Categoria" reuses the frozen
 * AccionAuditoria enum (design D2: no migration for a new value).
 */
export async function registrarAuditCategoriaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  accion: AccionAuditoria,
  categoriaId: number,
  valoresAnteriores: Record<string, unknown> | null,
  valoresNuevos: Record<string, unknown> | null,
  motivo: string | null = null,
): Promise<void> {
  await tx.movimientoAuditoria.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      usuarioId: ctx.usuarioId,
      fechaHora: new Date(),
      accion,
      entidad: "Categoria",
      idEntidad: String(categoriaId),
      valorAnterior:
        valoresAnteriores === null ? null : JSON.stringify(valoresAnteriores),
      valorNuevo: valoresNuevos === null ? null : JSON.stringify(valoresNuevos),
      motivo,
    },
  });
}

/**
 * Cross-tenant category-ownership check, relocated from producto-repository
 * (design D3): the helper validates Categoria ownership, so the Categoria
 * module owns it; Producto imports it. Behavior is unchanged.
 */
export async function categoriaPerteneceAEmpresa(
  tx: PrismaTx,
  empresaId: number,
  categoriaId: number,
): Promise<boolean> {
  const row = await tx.categoria.findUnique({
    where: { id: categoriaId },
    select: { empresaId: true },
  });
  return row !== null && row.empresaId === empresaId;
}
