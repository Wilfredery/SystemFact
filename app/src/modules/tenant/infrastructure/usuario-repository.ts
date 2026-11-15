/**
 * Tenant repository — the USUARIO directory read for the Administración screen
 * (screens plan Step 7, S4/S5).
 *
 * Scope (RLS constraint): `usuario_select` restricts `USUARIO` to `empresaId` +
 * `sucursalId` of the transaction's GUCs, and lets a blank branch GUC read the
 * whole empresa. So these queries pin `empresaId` (AGENTS.md defense-in-depth:
 * never rely on RLS alone) and deliberately add NO `sucursalId` predicate: the
 * branch scope stays owned by the policy. Whether a read is branch-wide or
 * company-wide is decided by the CALLER (the use case runs the read inside
 * `conSucursalAmpliadaEnTx`, Administrador only); this file never blanks the
 * branch GUC itself.
 *
 * Reads only: no mutation, no role/branch assignment (read-only first, S1).
 */

import type { Prisma } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";

/** Optional AND-combined filters. An absent filter is no `where` clause at all. */
export interface UsuarioListFiltros {
  /** Case-insensitive contains over `nombreUsuario` OR `nombre`. */
  readonly buscar?: string;
  /** Tri-state: absent = both, `true` = active only, `false` = inactive only. */
  readonly activo?: boolean;
}

/** The same filters plus the pagination window the caller already normalized. */
export interface UsuarioListQuery extends UsuarioListFiltros {
  readonly offset: number;
  readonly limit: number;
}

/** One listing row: identity + branch/role display data, nothing deeper. */
export interface UsuarioListRow {
  readonly id: number;
  readonly nombreUsuario: string;
  readonly nombre: string;
  readonly activo: boolean;
  /** Optimistic-lock token the write actions require (`versionEsperada`). */
  readonly version: number;
  readonly sucursalId: number;
  readonly sucursalNombre: string;
  readonly roles: readonly string[];
  /** Same roles as `roles`, by catalog id (same order), to preselect the role dialog. */
  readonly rolIds: readonly number[];
}

/** A blank/whitespace-only search term is not a filter (it would match all). */
function textoBusqueda(buscar?: string): string | undefined {
  const limpio = buscar?.trim();
  return limpio === undefined || limpio === "" ? undefined : limpio;
}

/**
 * ONE `where` for both the page query and the count, so the total always
 * describes the rows actually shown.
 */
function buildWhere(
  empresaId: number,
  filtros: UsuarioListFiltros,
): Prisma.UsuarioWhereInput {
  const termino = textoBusqueda(filtros.buscar);
  return {
    empresaId,
    ...(filtros.activo === undefined ? {} : { activo: filtros.activo }),
    ...(termino === undefined
      ? {}
      : {
          OR: [
            { nombreUsuario: { contains: termino, mode: "insensitive" } },
            { nombre: { contains: termino, mode: "insensitive" } },
          ],
        }),
  };
}

/**
 * One page of the branch's users, ordered deterministically by `nombreUsuario`.
 * SUCURSAL name and USUARIO_ROL → ROL names are joined through an EXPLICIT
 * select (never a full `include` on a list, AGENTS.md Performance).
 */
export async function listarUsuariosEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: UsuarioListQuery,
): Promise<UsuarioListRow[]> {
  const filas = await tx.usuario.findMany({
    where: buildWhere(ctx.empresaId, query),
    select: {
      id: true,
      nombreUsuario: true,
      nombre: true,
      activo: true,
      version: true,
      sucursalId: true,
      sucursal: { select: { nombre: true } },
      roles: { select: { rol: { select: { id: true, nombre: true } } } },
    },
    orderBy: { nombreUsuario: "asc" },
    skip: query.offset,
    take: query.limit,
  });

  return filas.map((fila) => ({
    id: fila.id,
    nombreUsuario: fila.nombreUsuario,
    nombre: fila.nombre,
    activo: fila.activo,
    version: fila.version,
    sucursalId: fila.sucursalId,
    sucursalNombre: fila.sucursal.nombre,
    roles: fila.roles.map((r) => r.rol.nombre),
    rolIds: fila.roles.map((r) => r.rol.id),
  }));
}

/**
 * Display names of the given users (the author column of a ledger page): one
 * query for the whole page, never one per row. Pins `empresaId`; the branch
 * visibility is the caller's widen decision (see the file header). Ids RLS hides
 * are simply absent from the map.
 */
export async function nombresUsuariosEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ids: readonly number[],
): Promise<ReadonlyMap<number, string>> {
  if (ids.length === 0) return new Map();
  const filas = await tx.usuario.findMany({
    where: { empresaId: ctx.empresaId, id: { in: [...ids] } },
    select: { id: true, nombre: true },
  });
  return new Map(filas.map((f) => [f.id, f.nombre]));
}

/** Total rows matching the same `where` (paginated list contract, S4). */
export async function contarUsuariosEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtros: UsuarioListFiltros,
): Promise<number> {
  return tx.usuario.count({ where: buildWhere(ctx.empresaId, filtros) });
}

/**
 * Role-based authorization lookup for the Administración Server Actions
 * (S3): the same named-group gate compra/proveedor use. Prisma access stays in
 * infrastructure, only the boolean decision crosses into `http/`. Scoped to the
 * tenant: `id` and `empresaId` must both match, and an unknown user denies.
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
