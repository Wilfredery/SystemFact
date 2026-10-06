"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { listarProductos } from "../application/listar-productos";
import { tieneRolPermitidoEnTx } from "../infrastructure/producto-repository";
import {
  zListarProductosQuery,
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
  ROLES_GESTION_PRODUCTOS,
} from "./shared";

// Same setup as crearProductoAction: the tenant context is resolved from the
// session before withTenantTransaction can receive it; the listing query and
// audit write all run inside the wrapper.
export async function listarProductosAction(
  query: unknown,
): Promise<
  ActionResult<{
    items: { id: number; codigo: string; nombre: string; precioVenta: string; tasaItbis: string }[];
    total: number;
    page: number;
  }>
> {
  const parseResult = zListarProductosQuery.safeParse(query);
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
      ROLES_GESTION_PRODUCTOS,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para listar productos");
    }

    const result = await listarProductos(tx, ctx, parseResult.data);

    if (!result.ok) {
      return error(result.code, result.message);
    }

    return ok({
      items: result.data.items.map((p) => ({
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        precioVenta: p.precioVenta.toFixed(2),
        tasaItbis: p.itbis.tasa,
      })),
      total: result.data.total,
      page: result.data.page,
    });
  });
}
