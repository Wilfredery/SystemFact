"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { listarProductos } from "../application/listar-productos";
import {
  consultarProductos,
  type ConsultarProductosOutput,
} from "../application/consultar-productos";
import { obtenerProductoDetalle } from "../application/obtener-producto";
import { tieneRolPermitidoEnTx } from "../infrastructure/producto-repository";
import {
  zConsultarProductosQuery,
  zListarProductosQuery,
  zObtenerProductoPorIdInput,
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
  ROLES_VER_PRODUCTOS,
} from "./shared";
import type { ProductoConsultaItem } from "../application/producto-consulta-projection";

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
      ROLES_VER_PRODUCTOS,
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

/**
 * Productos screen listing (plan Step 2, S1/S4): paginated, filtered projection
 * with the category selector options. Same conventions as the listing above —
 * session before the wrapper, every role check and Prisma call inside it — and
 * the view group also covers Operador and Despachador (S3, view-only).
 */
export async function consultarProductosAction(
  query: unknown,
): Promise<ActionResult<ConsultarProductosOutput>> {
  const parseResult = zConsultarProductosQuery.safeParse(query);
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
      ROLES_VER_PRODUCTOS,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para listar productos");
    }

    const result = await consultarProductos(tx, ctx, parseResult.data);
    if (!result.ok) {
      return error(result.code, result.message);
    }
    return ok(result.data);
  });
}

/**
 * One product with its full projection, including the row `version` the edit
 * dialog submits back for the optimistic lock. Reading is a view capability.
 */
export async function obtenerProductoPorIdAction(
  input: unknown,
): Promise<ActionResult<ProductoConsultaItem>> {
  const parseResult = zObtenerProductoPorIdInput.safeParse(input);
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
      ROLES_VER_PRODUCTOS,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para ver productos");
    }

    const result = await obtenerProductoDetalle(tx, ctx, parseResult.data);
    if (!result.ok) {
      return error(result.code, result.message);
    }
    return ok(result.producto);
  });
}

/**
 * Whether the caller may create, edit or deactivate products, answered from the
 * manage role group so the screen never names a role. It is only a UI question
 * (show or hide the manage controls); each write action re-checks on the server.
 */
export async function obtenerPermisosProductoAction(): Promise<
  ActionResult<{ puedeGestionar: boolean }>
> {
  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    return error(SESION_INVALIDA, messageFor(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const puedeGestionar = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_GESTION_PRODUCTOS,
    );
    return ok({ puedeGestionar });
  });
}
