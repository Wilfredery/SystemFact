/**
 * Tenant repository — the USUARIO directory read for the Administración screen
 * (screens plan Step 7, S4/S5).
 *
 * S5 (RLS constraint, explicitly in scope as a CONSTRAINT): the listing shows the
 * users of the session branch, because the existing `usuario_select` policy
 * already restricts `USUARIO` to `empresaId` + `sucursalId` of the transaction's
 * GUCs. So this query pins `empresaId` (AGENTS.md defense-in-depth: never rely on
 * RLS alone) and deliberately does NOT add a `sucursalId` predicate: the branch
 * scope must stay owned by the policy, or this file would silently become the
 * authority on who is visible — and would have to be undone the day the
 * company-wide policy exists (that policy is DEFERRED, out of scope). The branch
 * GUC is never blanked here: blanking it is exactly the empresa-wide read this
 * step must not introduce.
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
  readonly sucursalNombre: string;
  readonly roles: readonly string[];
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
      sucursal: { select: { nombre: true } },
      roles: { select: { rol: { select: { nombre: true } } } },
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
    sucursalNombre: fila.sucursal.nombre,
    roles: fila.roles.map((r) => r.rol.nombre),
  }));
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
