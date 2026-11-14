"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import type { InventarioListItem } from "../application/listar-inventario";
import { listarInventario } from "../application/listar-inventario";
import {
  consultarInventario,
  type ConsultarInventarioOutput,
} from "../application/consultar-inventario";
import {
  listarMovimientosInventario,
  type ListarMovimientosOutput,
} from "../application/listar-movimientos-inventario";
import { tieneRolPermitidoEnTx } from "../infrastructure/inventario-repository";
import {
  zConsultarInventarioQuery,
  zListarInventarioQuery,
  zListarMovimientosQuery,
} from "./validations";
import {
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  messageFor,
} from "../domain/errors";
import {
  type ActionResult,
  ok,
  error,
  ROLES_GESTION_INVENTARIO,
  ROLES_VER_INVENTARIO,
} from "./shared";

/**
 * Branch-scoped, paginated stock listing with the `stockMinimo` KPI.
 *
 * Convention (shared with the producto adapters): the tenant context is
 * resolved from the Supabase session — an auth read, not tenant-DB access —
 * BEFORE `withTenantTransaction` can receive it, so the wrapper is not the
 * literal first statement. Every role check and every Prisma call still runs
 * inside the wrapper below (enforced by `systemfact/server-action-must-wrap-tenant`).
 */
export async function listarInventarioAction(
  query: unknown,
): Promise<
  ActionResult<{
    items: InventarioListItem[];
    total: number;
    page: number;
    limit: number;
  }>
> {
  const parseResult = zListarInventarioQuery.safeParse(query);
  if (!parseResult.success) {
    return error(VALIDATION_ERROR, messageFor(VALIDATION_ERROR));
  }

  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    return error(SESION_INVALIDA, messageFor(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_VER_INVENTARIO,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para listar inventario");
    }

    const result = await listarInventario(tx, ctx, parseResult.data);
    if (!result.ok) {
      return error(result.code, result.message);
    }

    return ok({
      items: result.data.items,
      total: result.data.total,
      page: result.data.page,
      limit: result.data.limit,
    });
  });
}

/**
 * Inventario consulta screen: products with branch stock, status filters, KPI
 * cards and category options. Same tenant/role conventions as the listing above
 * (view group: Administrador, Operador, Despachador).
 */
export async function consultarInventarioAction(
  query: unknown,
): Promise<ActionResult<ConsultarInventarioOutput>> {
  const parseResult = zConsultarInventarioQuery.safeParse(query);
  if (!parseResult.success) {
    return error(VALIDATION_ERROR, messageFor(VALIDATION_ERROR));
  }

  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    return error(SESION_INVALIDA, messageFor(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_VER_INVENTARIO,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para consultar inventario");
    }

    const result = await consultarInventario(tx, ctx, parseResult.data);
    if (!result.ok) {
      return error(result.code, result.message);
    }
    return ok(result.data);
  });
}

/**
 * Whether the caller may adjust stock, answered from the manage role group so
 * screens never name a role. It is only a question for the UI (show the
 * `+ Ajustar` link, gate the form page); the real gate stays inside
 * `ajustarInventarioAction`, which re-checks on every call.
 */
export async function obtenerPermisosInventarioAction(): Promise<
  ActionResult<{ puedeAjustar: boolean }>
> {
  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    return error(SESION_INVALIDA, messageFor(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const puedeAjustar = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_GESTION_INVENTARIO,
    );
    return ok({ puedeAjustar });
  });
}

/**
 * Read-only movement history of the SESSION branch (odd/tasks/inventario-historial.md
 * S1-S5). Manage group only (Administrador): the history reveals who adjusted
 * stock and why. Same tenant/role conventions as the listings above; the role is
 * checked inside the wrapper, and no audit row is written per read (like the stock list).
 */
export async function listarMovimientosInventarioAction(
  query: unknown,
): Promise<ActionResult<ListarMovimientosOutput>> {
  const parseResult = zListarMovimientosQuery.safeParse(query);
  if (!parseResult.success) {
    return error(VALIDATION_ERROR, messageFor(VALIDATION_ERROR));
  }

  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    return error(SESION_INVALIDA, messageFor(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_GESTION_INVENTARIO,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para ver el historial de movimientos");
    }

    const result = await listarMovimientosInventario(tx, ctx, parseResult.data);
    if (!result.ok) {
      return error(result.code, result.message);
    }
    return ok(result.data);
  });
}
