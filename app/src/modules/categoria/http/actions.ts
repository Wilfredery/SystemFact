"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { crearCategoria } from "../application/crear-categoria";
import { listarCategorias } from "../application/listar-categorias";
import { actualizarCategoria } from "../application/actualizar-categoria";
import { desactivarCategoria } from "../application/desactivar-categoria";
import { tieneRolPermitidoEnTx } from "../infrastructure/categoria-repository";
import {
  zCrearCategoriaInput,
  zListarCategoriasQuery,
  zActualizarCategoriaInput,
  zDesactivarCategoriaInput,
} from "./validations";
import {
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  messageFor,
  type CategoriaErrorCode,
} from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: CategoriaErrorCode; message: string } };

// CRUD and listing are operational management actions: Admin + Operador (D1).
const ROLES_GESTION_CATEGORIAS = ["Administrador", "Operador"];

// Deactivation is a lifecycle decision with downstream product effects;
// design D1 reserves it for Administrador.
const ROLES_ADMIN_ONLY = ["Administrador"];

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function error(
  code: CategoriaErrorCode,
  message: string,
): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

// The tenant context must be resolved from the Supabase session (an auth read,
// not tenant-DB access) BEFORE withTenantTransaction can receive it, so the
// wrapper cannot be the literal first statement. All authorization and every
// Prisma call still run inside the wrapper below (Producto convention).

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

// Same session-before-wrapper convention: zod + tenant ctx + role check gate
// the call; duplicate probing and optimistic locking live in the use case.
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

// Thin deactivation adapter: Admin-only, then the explicit active-product
// guard and soft-delete orchestration belong to the use case.
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
