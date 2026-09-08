"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { crearProveedor } from "../application/crear-proveedor";
import { listarProveedores } from "../application/listar-proveedores";
import { actualizarProveedor } from "../application/actualizar-proveedor";
import { desactivarProveedor } from "../application/desactivar-proveedor";
import { tieneRolPermitidoEnTx } from "../infrastructure/proveedor-repository";
import {
  zCrearProveedorInput,
  zListarProveedoresQuery,
  zActualizarProveedorInput,
  zDesactivarProveedorInput,
} from "./validations";
import {
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  messageFor,
  type ProveedorErrorCode,
} from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ProveedorErrorCode; message: string } };

// CRUD and listing are operational management actions: Admin + Operador.
const ROLES_GESTION_PROVEEDORES = ["Administrador", "Operador"];

// Deactivation is a lifecycle decision with downstream purchase effects
// (fase 4 CxP); the role matrix reserves it for Administrador.
const ROLES_ADMIN_ONLY = ["Administrador"];

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function error(
  code: ProveedorErrorCode,
  message: string,
): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

// The tenant context must be resolved from the Supabase session (an auth read,
// not tenant-DB access) BEFORE withTenantTransaction can receive it, so the
// wrapper cannot be the literal first statement. All authorization and every
// Prisma call still run inside the wrapper below (Producto convention).

export async function crearProveedorAction(
  input: unknown,
): Promise<ActionResult<{ id: number; nombre: string; version: number }>> {
  const parseResult = zCrearProveedorInput.safeParse(input);
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
      ROLES_GESTION_PROVEEDORES,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para crear proveedores");
    }

    const result = await crearProveedor(tx, ctx, parseResult.data);

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

export async function listarProveedoresAction(
  query: unknown,
): Promise<
  ActionResult<{
    items: {
      id: number;
      nombre: string;
      contacto: string;
      telefono: string;
      rnc: string | null;
      tipoProveedor: string;
      tipoPersona: string;
      activo: boolean;
    }[];
    total: number;
    page: number;
  }>
> {
  const parseResult = zListarProveedoresQuery.safeParse(query);
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
      ROLES_GESTION_PROVEEDORES,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para listar proveedores");
    }

    const result = await listarProveedores(tx, ctx, parseResult.data);

    if (!result.ok) {
      return error(result.code, result.message);
    }

    // Prisma models never cross HTTP boundaries: explicit row mapping.
    return ok({
      items: result.data.items.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        contacto: p.contacto,
        telefono: p.telefono,
        rnc: p.rnc,
        tipoProveedor: p.tipoProveedor,
        tipoPersona: p.tipoPersona,
        activo: p.activo,
      })),
      total: result.data.total,
      page: result.data.page,
    });
  });
}

// Same session-before-wrapper convention: zod + tenant ctx + role check gate
// the call; RNC normalization, duplicate probing and optimistic locking live
// in the use case.
export async function actualizarProveedorAction(
  input: unknown,
): Promise<ActionResult<{ id: number; version: number }>> {
  const parseResult = zActualizarProveedorInput.safeParse(input);
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
      ROLES_GESTION_PROVEEDORES,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para editar proveedores");
    }

    const result = await actualizarProveedor(tx, ctx, parseResult.data);

    if (!result.ok) {
      return error(result.code, result.message);
    }

    return ok({ id: result.data.id, version: result.data.version });
  });
}

// Thin deactivation adapter: Admin-only, then the non-cancelled-purchase
// guard and soft-delete orchestration belong to the use case.
export async function desactivarProveedorAction(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parseResult = zDesactivarProveedorInput.safeParse(input);
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
        "Solo un administrador puede desactivar proveedores",
      );
    }

    const result = await desactivarProveedor(tx, ctx, parseResult.data);

    if (!result.ok) {
      return error(result.code, result.message);
    }

    return ok({ id: result.data.id });
  });
}
