"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { listarProveedores } from "../application/listar-proveedores";
import { obtenerProveedor } from "../application/obtener-proveedor";
import { tieneRolPermitidoEnTx } from "../infrastructure/proveedor-repository";
import { zListarProveedoresQuery, zObtenerProveedorInput } from "./validations";
import {
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  messageFor,
} from "../domain/errors";
import {
  type ActionResult,
  type ProveedorDetalleDto,
  type ProveedorDto,
  ok,
  error,
  toDetalleDto,
  ROLES_GESTION_PROVEEDORES,
  ROLES_VER_PROVEEDORES,
} from "./shared";

// Reads are a VIEW capability (screens plan Step 4, S3 / owner L9): the supplier
// list is open to Administrador, Operador and Despachador through the named view
// group — Operador and Despachador receive purchases. The manage group only
// decides the write actions and the screen's manage controls.

export async function listarProveedoresAction(
  query: unknown,
): Promise<ActionResult<{ items: ProveedorDto[]; total: number; page: number }>> {
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
      ROLES_VER_PROVEEDORES,
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

/**
 * Single-supplier read for the edit dialog: it carries the stored `version` so
 * the optimistic lock round-trips to `actualizarProveedorAction` (S4). It is a
 * view capability, like the listing.
 */
export async function obtenerProveedorAction(
  input: unknown,
): Promise<ActionResult<ProveedorDetalleDto>> {
  const parsed = zObtenerProveedorInput.safeParse(input);
  if (!parsed.success) {
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
      ROLES_VER_PROVEEDORES,
    );
    if (!permitido) {
      return error(NO_AUTORIZADO, "No tiene permisos para ver proveedores");
    }

    const result = await obtenerProveedor(tx, ctx, parsed.data);
    if (!result.ok) {
      return error(result.code, result.message);
    }
    return ok(toDetalleDto(result.data));
  });
}

/**
 * Whether the caller may create, edit and deactivate suppliers, answered from
 * the named manage group so the screen never names a role. It is only a UI
 * question (show or hide the manage controls); each write action re-checks on
 * the server.
 */
export async function obtenerPermisosProveedorAction(): Promise<
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
      ROLES_GESTION_PROVEEDORES,
    );
    return ok({ puedeGestionar });
  });
}
