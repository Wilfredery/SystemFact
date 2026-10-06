"use server";

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { tieneRolPermitidoEnTx } from "@/modules/venta/infrastructure/venta-repository";
import {
  registrarCobro,
  type RegistrarCobroOutput,
} from "../application/registrar-cobro";
import {
  registrarReembolso,
  type RegistrarReembolsoOutput,
} from "../application/registrar-reembolso";
import {
  SESION_INVALIDA,
  VALIDATION_ERROR,
  mensajeTransporte,
  zRegistrarCobroInput,
  zRegistrarReembolsoInput,
} from "./validations";
import { PAGO_NO_AUTORIZADO, messageFor } from "../domain/errors";
import {
  type ActionResult,
  ok,
  fail,
  resolverCtx,
  ROLES_COBROS,
  ROLES_REEMBOLSO,
} from "./shared";

export async function registrarCobroAction(
  input: unknown,
): Promise<ActionResult<RegistrarCobroOutput>> {
  const parsed = zRegistrarCobroInput.safeParse(input);
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
    const result = await registrarCobro(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data);
  });
}

export async function registrarReembolsoAction(
  input: unknown,
): Promise<ActionResult<RegistrarReembolsoOutput>> {
  const parsed = zRegistrarReembolsoInput.safeParse(input);
  if (!parsed.success) return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    // Authorization gate runs BEFORE the use case: an unauthorized actor is
    // refused before any write and before any receipt number is allocated.
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_REEMBOLSO,
    );
    if (!permitido) {
      return fail(PAGO_NO_AUTORIZADO, messageFor(PAGO_NO_AUTORIZADO));
    }
    const result = await registrarReembolso(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data);
  });
}
