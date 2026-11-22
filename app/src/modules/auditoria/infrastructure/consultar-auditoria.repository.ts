/**
 * Auditoria infrastructure — company-wide ADMIN read of the append-only audit
 * log inside the caller's tenant transaction (RLS enforced by the app role).
 *
 * Runs within the enclosing `withTenantTransaction`; the explicit `empresaId`
 * pin and the RLS GUCs are two independent defenses (AGENTS.md "Multi-tenancy
 * ALWAYS", ADR-019 defense-in-depth). This function is READ-only by
 * construction: it exposes no create, update or delete — the log is
 * append-only per ADR-016 (AC-5).
 *
 * Admin company-wide visibility:
 *   `TenantCtx` is branch-shaped and `setTenantContext` writes the caller's
 *   `sucursalId` into `app.current_sucursal_id`. The audit `audit_select` RLS
 *   policy (`20260902120000_enable_rls`) treats an EMPTY branch GUC as
 *   "company-wide visibility over the pinned empresa": it allows rows whose
 *   `sucursalId` IS NULL or equals the branch GUC, and short-circuits to allow
 *   every branch when the GUC is empty. We therefore issue a `SET LOCAL` clear
 *   of the branch GUC inside the transaction (`set_config(..., true)`) so the
 *   Admin sees every branch of the company plus the enterprise-level rows
 *   (LOGIN/LOGOUT with `sucursalId IS NULL`), and restore it in `finally` so
 *   later statements inside the same transaction still see the caller's branch.
 *   The empresa GUC is never cleared — the tenant anchor stays pinned. An
 *   optional `filtro.sucursalId` then narrows the set at the Prisma level for
 *   a per-branch audit view.
 *
 * Names (Board 09 slice B): the page query resolves the acting user's and the
 * branch's display names through Prisma RELATION SELECTS in the SAME `findMany`
 * (no N+1, no second query per row). They run inside the widened window, so an
 * admin pinned to branch A sees the names of branch B of the same empresa and
 * nothing outside the empresa (the empresa GUC stays pinned; `usuario_select`
 * and `sucursal_select` admit company-wide reads when the branch GUC is empty).
 * ONLY `nombreUsuario`/`nombre`/`activo` (user) and `nombre`/`activa` (branch)
 * are selected — never email, hash, auth id or role. The filter option lists
 * are read in that same window by {@link consultarAuditoriaConOpcionesEnTx}.
 *
 * Explicit `select` plus ordered `findMany` + `count` — never a raw SQL and
 * never a full include (AGENTS.md "Explicit `select` on heavy lists; `full
 * include` only on detail views"). Ordering is `fechaHora DESC, id DESC`; the
 * `(empresaId, fechaHora, id)` index added in Slice A is the access path for
 * the default page.
 */

import { type Prisma } from "@/generated/prisma/client";
import { tenantFilter, type TenantCtx } from "@/modules/tenant/domain/tenant";
import { tenantWhere } from "@/modules/tenant/infrastructure/tenant-where";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  CAMPOS_TEXTO_LIBRE,
  MAX_OPCIONES_USUARIOS,
  accionAuditoriaDesdeDb,
  type AuditoriaFiltro,
  type AuditoriaOpciones,
  type AuditoriaRegistro,
  type AuditoriaSucursalOpcion,
  type AuditoriaUsuarioOpcion,
  proyectarCambioAuditoria,
} from "../domain/auditoria";
import { calcularOffset } from "@/shared/domain/pagination";
import { accionAuditoriaADb } from "./prisma-accion";

/**
 * Explicit projection — exactly the fields the DTO surfaces. The two relations
 * select NAMES ONLY (S5): the person's `nombreUsuario`/`nombre`/`activo` and the
 * branch's `nombre`/`activa`. No other user or branch column is ever read here.
 */
const SELECCION = {
  id: true,
  empresaId: true,
  sucursalId: true,
  usuarioId: true,
  fechaHora: true,
  accion: true,
  entidad: true,
  idEntidad: true,
  valorAnterior: true,
  valorNuevo: true,
  motivo: true,
  usuario: { select: { nombreUsuario: true, nombre: true, activo: true } },
  sucursal: { select: { nombre: true, activa: true } },
} satisfies Prisma.MovimientoAuditoriaSelect;

/** The row + count the caller assembles into a paginated DTO. */
export interface ConsultaAuditoriaLeida {
  readonly filas: AuditoriaRegistro[];
  readonly total: number;
}

/** The page plus the filter option lists, read in one widened window. */
export interface ConsultaAuditoriaConOpcionesLeida extends ConsultaAuditoriaLeida {
  readonly opciones: AuditoriaOpciones;
}

/**
 * Runs `leer` with the branch GUC cleared (company-wide RLS under the pinned
 * empresa) and restores the caller's branch in `finally`. The restore is
 * unconditional: the transaction is not ours to leave in a widened state.
 */
async function enVentanaEmpresa<T>(
  tx: PrismaTx,
  ctx: TenantCtx,
  leer: () => Promise<T>,
): Promise<T> {
  // SET LOCAL: clear the branch GUC so RLS widens to the whole company. This
  // is the ONLY tenant GUC we ever touch here — the empresa GUC stays pinned.
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', '', true)`;
  try {
    return await leer();
  } finally {
    // Restore the branch GUC (SET LOCAL) so any later statement in the SAME
    // transaction sees the caller's branch again.
    await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${String(
      ctx.sucursalId,
    )}, true)`;
  }
}

/**
 * The page query. MUST be called inside {@link enVentanaEmpresa}: it relies on
 * the widened branch GUC both for the rows and for the relation names.
 */
async function leerPaginaEnVentana(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: AuditoriaFiltro,
): Promise<ConsultaAuditoriaLeida> {
  // Pin empresaId ONLY (never the caller's branch); an optional
  // `filtro.sucursalId` narrows further for a per-branch admin view.
  const where: Prisma.MovimientoAuditoriaWhereInput = {
    ...tenantWhere(tenantFilter(ctx), /* omitSucursalId */ true),
  };
  if (filtro.accion !== undefined) {
    where.accion = accionAuditoriaADb(filtro.accion);
  }
  if (filtro.usuarioId !== undefined) {
    where.usuarioId = filtro.usuarioId;
  }
  if (filtro.sucursalId !== undefined) {
    where.sucursalId = filtro.sucursalId;
  }
  if (filtro.desde !== undefined || filtro.hasta !== undefined) {
    const fechaHora: { gte?: Date; lte?: Date } = {};
    if (filtro.desde !== undefined) fechaHora.gte = filtro.desde;
    if (filtro.hasta !== undefined) fechaHora.lte = filtro.hasta;
    where.fechaHora = fechaHora;
  }
  if (filtro.texto !== undefined) {
    // Free-text targets are `entidad` / `idEntidad` / `motivo` ONLY. The
    // JSON payload columns (`valorAnterior` / `valorNuevo`) are deliberately
    // excluded (AC-3) and asserted so by a unit guard in Slice A's tests.
    where.OR = CAMPOS_TEXTO_LIBRE.map((campo) => ({
      [campo]: { contains: filtro.texto },
    }));
  }

  // `findMany` and `count` in one `Promise.all` — a single round-trip pair, not
  // an N+1 (AGENTS.md "No N+1"). The names ride on the same `findMany`.
  const [filas, total] = await Promise.all([
    tx.movimientoAuditoria.findMany({
      where,
      select: SELECCION,
      orderBy: [{ fechaHora: "desc" }, { id: "desc" }],
      skip: calcularOffset(filtro.page, filtro.pageSize),
      take: filtro.pageSize,
    }),
    tx.movimientoAuditoria.count({ where }),
  ]);

  return {
    filas: filas.map((r) => ({
      id: r.id,
      empresaId: r.empresaId,
      sucursalId: r.sucursalId,
      usuarioId: r.usuarioId,
      fechaHora: r.fechaHora,
      accion: accionAuditoriaDesdeDb(r.accion),
      entidad: r.entidad,
      idEntidad: r.idEntidad,
      cambio: proyectarCambioAuditoria({
        entidad: r.entidad,
        accion: accionAuditoriaDesdeDb(r.accion),
        valorAnterior: r.valorAnterior,
        valorNuevo: r.valorNuevo,
      }),
      motivo: r.motivo,
      usuario:
        r.usuario === null || r.usuario === undefined
          ? null
          : {
              nombreUsuario: r.usuario.nombreUsuario,
              nombre: r.usuario.nombre,
              activo: r.usuario.activo,
            },
      sucursal:
        r.sucursal === null || r.sucursal === undefined
          ? null
          : { nombre: r.sucursal.nombre, activa: r.sucursal.activa },
    })),
    total,
  };
}

/**
 * Thin reader of the Usuario filter options: ONLY `{ id, nombreUsuario, nombre,
 * activo }`, pinned to the caller's empresa, hard-capped at
 * {@link MAX_OPCIONES_USUARIOS}, active users first then `nombreUsuario`.
 * Inactive users stay (old rows reference them). Must run inside the widened
 * window (the `usuario_select` policy is branch-scoped otherwise).
 */
export async function listarUsuariosOpcionesEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
): Promise<AuditoriaUsuarioOpcion[]> {
  const usuarios = await tx.usuario.findMany({
    where: { ...tenantWhere(tenantFilter(ctx), /* omitSucursalId */ true) },
    select: { id: true, nombreUsuario: true, nombre: true, activo: true },
    orderBy: [{ activo: "desc" }, { nombreUsuario: "asc" }],
    take: MAX_OPCIONES_USUARIOS,
  });
  return usuarios.map((u) => ({
    id: u.id,
    nombreUsuario: u.nombreUsuario,
    nombre: u.nombre,
    activo: u.activo,
  }));
}

/**
 * Reads one page of the tenant's audit log, ordered newest-first, plus the
 * matching total over the SAME filter (never a page-limited subset). `total`
 * counts every row visible under the empty branch GUC — company-wide by
 * construction.
 */
export async function consultarAuditoriaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: AuditoriaFiltro,
): Promise<ConsultaAuditoriaLeida> {
  return enVentanaEmpresa(tx, ctx, () => leerPaginaEnVentana(tx, ctx, filtro));
}

/**
 * The page AND both filter option lists in ONE widened window (S2/S3). The
 * caller (the use case, behind the admin gate) supplies `leerSucursales` — the
 * tenant branch lister — so it executes inside this window too.
 */
export async function consultarAuditoriaConOpcionesEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: AuditoriaFiltro,
  leerSucursales: () => Promise<readonly AuditoriaSucursalOpcion[]>,
): Promise<ConsultaAuditoriaConOpcionesLeida> {
  return enVentanaEmpresa(tx, ctx, async () => {
    const { filas, total } = await leerPaginaEnVentana(tx, ctx, filtro);
    const usuarios = await listarUsuariosOpcionesEnTx(tx, ctx);
    const sucursales = await leerSucursales();
    return { filas, total, opciones: { usuarios, sucursales } };
  });
}
