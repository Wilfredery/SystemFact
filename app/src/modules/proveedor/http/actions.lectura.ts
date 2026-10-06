"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { listarProveedores } from "../application/listar-proveedores";
import { tieneRolPermitidoEnTx } from "../infrastructure/proveedor-repository";
import { zListarProveedoresQuery } from "./validations";
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
  ROLES_GESTION_PROVEEDORES,
} from "./shared";

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
