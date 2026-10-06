"use server";

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { tieneRolPermitidoEnTx } from "@/modules/venta/infrastructure/venta-repository";
import {
  consultarSaldoCxC,
  type SaldoCxCVista,
} from "../application/consultar-saldo-cxc";
import {
  consultarRecibo,
  type ReciboVista,
} from "../application/consultar-recibo";
import {
  SESION_INVALIDA,
  VALIDATION_ERROR,
  mensajeTransporte,
  zConsultarSaldoCxcInput,
  zConsultarReciboInput,
} from "./validations";
import { PAGO_NO_AUTORIZADO, messageFor } from "../domain/errors";
import {
  type ActionResult,
  ok,
  fail,
  resolverCtx,
  ROLES_COBROS,
} from "./shared";

export async function consultarSaldoCxcAction(
  input: unknown,
): Promise<ActionResult<SaldoCxCVista[]>> {
  const parsed = zConsultarSaldoCxcInput.safeParse(input ?? {});
  if (!parsed.success) return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_COBROS,
    );
    if (!permitido) {
      return fail(PAGO_NO_AUTORIZADO, messageFor(PAGO_NO_AUTORIZADO));
    }
    const result = await consultarSaldoCxC(tx, ctx, {});
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data);
  });
}

/**
 * Reads a persisted receipt for REPRINTING (R-C4, R-C6). A reprint is a NON-fiscal
 * copy of a payment already reflected on its VIGENTE invoice — it never emits a new
 * tax document, and the read is gated by the same Cobros role as the rest of the
 * module (a Despachador is denied) and scoped to the tenant under the RLS GUCs. The
 * missing/foreign case collapses to the cobros catalog's `PAGO_NO_ENCONTRADO`.
 */
export async function consultarReciboAction(
  input: unknown,
): Promise<ActionResult<ReciboVista>> {
  const parsed = zConsultarReciboInput.safeParse(input);
  if (!parsed.success) return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_COBROS,
    );
    if (!permitido) {
      return fail(PAGO_NO_AUTORIZADO, messageFor(PAGO_NO_AUTORIZADO));
    }
    const result = await consultarRecibo(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data);
  });
}
