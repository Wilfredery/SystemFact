"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { ajustarInventario } from "../application/ajustar-inventario";
import { tieneRolPermitidoEnTx } from "../infrastructure/inventario-repository";
import {
  zAjustarInventarioInput,
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
 * Authorized manual stock adjustment.
 *
 * Validates the DTO, resolves the tenant session, gates Administrador /
 * Operador, and runs the atomic stock update + movement + audit inside the
 * tenant transaction. The signed `cantidad` delta and the mandatory `motivo`
 * are validated by the use case.
 */
export async function ajustarInventarioAction(
  input: unknown,
): Promise<
  ActionResult<{
    inventarioId: number;
    productoId: number;
    cantidadAnterior: string;
    cantidadNueva: string;
  }>
> {
  const parseResult = zAjustarInventarioInput.safeParse(input);
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
      return error(NO_AUTORIZADO, "No tiene permisos para ajustar inventario");
    }

    const parsed = parseResult.data;
    const result = await ajustarInventario(tx, ctx, {
      productoId: parsed.productoId,
      cantidad: parsed.cantidad,
      motivo: parsed.motivo,
    });
    if (!result.ok) {
      return error(result.code, result.message);
    }

    return ok(result.data);
  });
}
