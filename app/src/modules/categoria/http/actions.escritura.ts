"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { crearCategoria } from "../application/crear-categoria";
import { actualizarCategoria } from "../application/actualizar-categoria";
import { desactivarCategoria } from "../application/desactivar-categoria";
import { tieneRolPermitidoEnTx } from "../infrastructure/categoria-repository";
import {
  zCrearCategoriaInput,
  zActualizarCategoriaInput,
  zDesactivarCategoriaInput,
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
  ROLES_ADMIN_ONLY,
} from "./shared";

/**
 * Thin creation adapter: session-before-wrapper, role gate Admin/Operador,
 * delegate to use case, map to DTO.
 */
export async function crearCategoriaAction(
  input: unknown,
): Promise<ActionResult<{ id: number; nombre: string; version: number }>> {
  const parseResult = zCrearCategoriaInput.safeParse(input);
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
      return error(NO_AUTORIZADO, "No tiene permisos para crear categorías");
    }

    const result = await crearCategoria(tx, ctx, parseResult.data);

    if (!result.ok) {
      return error(result.code, result.message);
    }

    return ok({
      id: result.data.id,
      nombre: result.data.nombre,
      version: result.data.version,
    });
  });
}

/**
 * Update adapter: Admin/Operador gate, session-before-wrapper, optimistic locking handled by use case.
 */
export async function actualizarCategoriaAction(
  input: unknown,
): Promise<ActionResult<{ id: number; version: number }>> {
  const parseResult = zActualizarCategoriaInput.safeParse(input);
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
      return error(NO_AUTORIZADO, "No tiene permisos para editar categorías");
    }

    const result = await actualizarCategoria(tx, ctx, parseResult.data);

    if (!result.ok) {
      return error(result.code, result.message);
    }

    return ok({ id: result.data.id, version: result.data.version });
  });
}

/**
 * Deactivation adapter: Admin-only gate, session-before-wrapper.
 */
export async function desactivarCategoriaAction(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parseResult = zDesactivarCategoriaInput.safeParse(input);
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
      return error(
        NO_AUTORIZADO,
        "Solo un administrador puede desactivar categorías",
      );
    }

    const result = await desactivarCategoria(tx, ctx, parseResult.data);

    if (!result.ok) {
      return error(result.code, result.message);
    }

    return ok({ id: result.data.id });
  });
}
