"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import type { InventarioListItem } from "../application/listar-inventario";
import { listarInventario } from "../application/listar-inventario";
import { ajustarInventario } from "../application/ajustar-inventario";
import { tieneRolPermitidoEnTx } from "../infrastructure/inventario-repository";
import {
  zListarInventarioQuery,
  zAjustarInventarioInput,
} from "./validations";
import {
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  messageFor,
  type InventarioErrorCode,
} from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: InventarioErrorCode; message: string } };

// Stock is operational data; both listing and adjustment are management
// actions restricted to Administrador + Operador (spec: authorized roles).
const ROLES_GESTION_INVENTARIO = ["Administrador", "Operador"];

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function error(code: InventarioErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

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
      ROLES_GESTION_INVENTARIO,
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
 * Authorized manual stock adjustment.
 *
 * Validates the DTO, resolves the tenant session, gates Administrador /
 * Operador, and runs the atomic stock update + movement + audit inside the
 * tenant transaction. The signed `cantidad` delta and the mandatory `motivo`
 * are validated by the use case.
 */
export async function ajustarInventarioAction(
  input: unknown,
): Promise<
  ActionResult<{
    inventarioId: number;
    productoId: number;
    cantidadAnterior: string;
    cantidadNueva: string;
  }>
> {
  const parseResult = zAjustarInventarioInput.safeParse(input);
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
      return error(NO_AUTORIZADO, "No tiene permisos para ajustar inventario");
    }

    const parsed = parseResult.data;
    const result = await ajustarInventario(tx, ctx, {
      productoId: parsed.productoId,
      cantidad: parsed.cantidad,
      motivo: parsed.motivo,
    });
    if (!result.ok) {
      return error(result.code, result.message);
    }

    return ok(result.data);
  });
}
