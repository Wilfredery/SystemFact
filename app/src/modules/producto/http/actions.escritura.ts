"use server";

import { Prisma } from "@/generated/prisma/client";
import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { crearProducto } from "../application/crear-producto";
import { actualizarProducto } from "../application/actualizar-producto";
import { desactivarProducto } from "../application/desactivar-producto";
import { tieneRolPermitidoEnTx } from "../infrastructure/producto-repository";
import {
  zCrearProductoInput,
  zActualizarProductoInput,
  zDesactivarProductoInput,
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
  ROLES_ADMIN_ONLY,
} from "./shared";

// The tenant context must be resolved from the Supabase session (an auth read,
// not tenant-DB access) BEFORE withTenantTransaction can receive it, so the
// wrapper cannot be the literal first statement. All authorization and every
// Prisma call still run inside the wrapper below.
export async function crearProductoAction(
  input: unknown,
): Promise<ActionResult<{ id: number; codigo: string }>> {
  const parseResult = zCrearProductoInput.safeParse(input);
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
      return error(NO_AUTORIZADO, "No tiene permisos para crear productos");
    }

    const parsed = parseResult.data;
    const result = await crearProducto(tx, ctx, {
      categoriaId: parsed.categoriaId,
      codigo: parsed.codigo,
      nombre: parsed.nombre,
      descripcion: parsed.descripcion,
      precioVenta: new Prisma.Decimal(parsed.precioVenta),
      itbisTasa: parsed.itbisTasa,
      itbisVigenteDesde: parsed.itbisVigenteDesde,
      itbisVigenteHasta: parsed.itbisVigenteHasta ?? null,
      itbisAplicaRetencionITBIS: parsed.itbisAplicaRetencionITBIS,
    });

    if (!result.ok) {
      return error(result.code, result.message);
    }

    return ok({ id: result.producto.id, codigo: result.producto.codigo });
  });
}

// Same session-before-wrapper convention as the other actions: zod + tenant
// ctx + role check gate the call, business rules live in actualizarProducto.
export async function actualizarProductoAction(
  input: unknown,
): Promise<ActionResult<{ id: number; version: number }>> {
  const parseResult = zActualizarProductoInput.safeParse(input);
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
      return error(NO_AUTORIZADO, "No tiene permisos para editar productos");
    }

    const parsed = parseResult.data;
    const result = await actualizarProducto(tx, ctx, {
      id: parsed.id,
      version: parsed.version,
      ...(parsed.nombre !== undefined ? { nombre: parsed.nombre } : {}),
      ...(parsed.descripcion !== undefined
        ? { descripcion: parsed.descripcion }
        : {}),
      ...(parsed.precioVenta !== undefined
        ? { precioVenta: new Prisma.Decimal(parsed.precioVenta) }
        : {}),
      ...(parsed.itbisTasa !== undefined
        ? { itbisTasa: parsed.itbisTasa }
        : {}),
      ...(parsed.itbisVigenteDesde !== undefined
        ? { itbisVigenteDesde: parsed.itbisVigenteDesde }
        : {}),
      ...(parsed.itbisVigenteHasta !== undefined
        ? { itbisVigenteHasta: parsed.itbisVigenteHasta }
        : {}),
      ...(parsed.itbisAplicaRetencionITBIS !== undefined
        ? { itbisAplicaRetencionITBIS: parsed.itbisAplicaRetencionITBIS }
        : {}),
      ...(parsed.codigo !== undefined ? { codigo: parsed.codigo } : {}),
      ...(parsed.categoriaId !== undefined
        ? { categoriaId: parsed.categoriaId }
        : {}),
    });

    if (!result.ok) {
      return error(result.code, result.message);
    }

    return ok({ id: result.producto.id, version: result.version });
  });
}

// Thin deactivation adapter: Admin-only, then the explicit reference guard
// and soft-delete orchestration belong to the use case.
export async function desactivarProductoAction(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parseResult = zDesactivarProductoInput.safeParse(input);
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
      ROLES_ADMIN_ONLY,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "Solo un administrador puede desactivar productos");
    }

    const result = await desactivarProducto(tx, ctx, parseResult.data);

    if (!result.ok) {
      return error(result.code, result.message);
    }

    return ok({ id: result.productoId });
  });
}
