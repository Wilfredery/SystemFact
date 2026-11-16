"use server";

/**
 * Server actions for the Configuración tab's WRITE surface
 * (feature itbis-tasas-edit). Thin adapters: validate the transport shape,
 * resolve the session, wrap in `withTenantTransaction`, check the role
 * SERVER-SIDE inside the transaction, delegate to the use case. The database
 * RLS policy (`configempresa_insert/update`, migration
 * 20261116100000_configempresa_writes_admin_only) is the independent second
 * wall.
 */

import { z } from "@/lib/zod";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { resolverCtx, ok, error, type ActionResult } from "./shared";
import { VALIDATION_ERROR, SESION_INVALIDA, mensajeTransporte } from "./validations";
import { ROLES_GESTION_CONFIGURACION } from "./shared";
import { tieneRolPermitidoEnTx } from "../infrastructure/usuario-repository";
import { TEN_OPS_NO_AUTORIZADO, messageFor } from "../domain/errors";
import { guardarTasasItbis, type TasaItbisGuardada } from "../application/gestion-configuracion";

/** The submitted list as the user typed it (canonicalized by the use case). */
const zEditarTasasItbisInput = z.object({
  valor: z.string().max(255),
});

/**
 * Save the empresa's allowed ITBIS rate list (Administrador only). History is
 * preserved: the current window closes and a new row opens at the change
 * instant; saving the same set again is a no-op.
 */
export async function editarTasasItbisAction(
  input: unknown,
): Promise<ActionResult<TasaItbisGuardada>> {
  const parsed = zEditarTasasItbisInput.safeParse(input);
  if (!parsed.success) {
    return error(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));
  }

  const ctx = await resolverCtx();
  if (ctx === null) {
    return error(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_GESTION_CONFIGURACION,
    );
    if (!permitido) {
      return error(TEN_OPS_NO_AUTORIZADO, messageFor(TEN_OPS_NO_AUTORIZADO));
    }
    const result = await guardarTasasItbis(tx, ctx, parsed.data.valor);
    return result.ok
      ? ok(result.data)
      : error(result.code, result.message);
  });
}
