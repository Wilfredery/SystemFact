"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { listarCategorias } from "../application/listar-categorias";
import { tieneRolPermitidoEnTx } from "../infrastructure/categoria-repository";
import {
  zListarCategoriasQuery,
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
  ROLES_GESTION_CATEGORIAS,
} from "./shared";

/**
 * Thin read adapter: session-before-wrapper, role gate Admin/Operador.
 */
export async function listarCategoriasAction(
  query: unknown,
): Promise<
  ActionResult<{
    items: { id: number; nombre: string; activa: boolean }[];
    total: number;
    page: number;
  }>
> {
  const parseResult = zListarCategoriasQuery.safeParse(query);
  if (!parseResult.success) {
    return error(VALIDATION_ERROR, messageFor(VALIDATION_ERROR));
  }

  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    return error(SESION_INVALIDA, "Sesión no válida");
  }

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_GESTION_CATEGORIAS,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para listar categorías");
    }

    const result = await listarCategorias(tx, ctx, parseResult.data);

    if (!result.ok) {
      return error(result.code, result.message);
    }

    return ok({
      items: result.data.items.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        activa: c.activa,
      })),
      total: result.data.total,
      page: result.data.page,
    });
  });
}
