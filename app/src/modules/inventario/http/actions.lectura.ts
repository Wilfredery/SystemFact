"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import type { InventarioListItem } from "../application/listar-inventario";
import { listarInventario } from "../application/listar-inventario";
import { tieneRolPermitidoEnTx } from "../infrastructure/inventario-repository";
import {
  zListarInventarioQuery,
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
