"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { tieneRolPermitidoEnTx } from "../../venta/infrastructure/venta-repository";
import { crearDevolucion, type DevolucionErrorCode, type DevolucionOutput, type DevolucionWarning } from "../application/crear-devolucion";
import { STOCK_MAXIMO_EXCEDIDO, VentaDomainError } from "../../venta/domain/errors";
import { NO_AUTORIZADO, SESION_INVALIDA, VALIDATION_ERROR, mensajeTransporte, zDevolverVentaInput } from "./validations";
import { ActionResult, DevolucionAccionesErrorCode, ok, fail, resolverCtx, ROLES_DEVOLUCION } from "./actions.shared";

export async function devolverVentaAction(
  input: unknown,
): Promise<ActionResult<DevolucionOutput>> {
  const parsed = zDevolverVentaInput.safeParse(input);
  if (!parsed.success) return await fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return await fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  try {
    return await withTenantTransaction(ctx, async (tx) => {
      const permitido = await tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, ROLES_DEVOLUCION);
      if (!permitido) {
        return await fail(NO_AUTORIZADO, mensajeTransporte(NO_AUTORIZADO));
      }
      const result = await crearDevolucion(tx, ctx, parsed.data);
      if (!result.ok) return await fail(result.code, result.message);
      return await ok(result.data, result.warnings);
    });
  } catch (err) {
    // A VENDIBLE ceiling error is thrown inside the transaction (normally by
    // the locked-snapshot preflight, with repository defense-in-depth). The
    // wrapper rolls it back before this adapter returns the typed result.
    if (err instanceof VentaDomainError && err.code === STOCK_MAXIMO_EXCEDIDO) {
      return await fail(err.code, err.message);
    }
    throw err;
  }
}
