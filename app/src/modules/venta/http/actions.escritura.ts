"use server";

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { crearVenta, actualizarVenta, cancelarVenta } from "../application/venta-service";
import { confirmarVenta } from "../application/confirmar-venta";
import { tieneRolPermitidoEnTx } from "../infrastructure/venta-repository";
import {
  zCrearVentaInput,
  zActualizarVentaInput,
  zCancelarVentaInput,
  zConfirmarVentaInput,
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  mensajeTransporte,
} from "./validations";
import { type ActionResult, ok, fail, resolverCtx, ROLES_VENTA } from "./shared";

export async function crearVentaAction(
  input: unknown,
): Promise<
  ActionResult<{
    id: number;
    estado: string;
    total: string;
    subtotalGravado: string;
    subtotalExento: string;
  }>
> {
  const parsed = zCrearVentaInput.safeParse(input);
  if (!parsed.success) return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, ROLES_VENTA);
    if (!permitido) {
      return fail(NO_AUTORIZADO, "No tiene permisos para registrar ventas");
    }
    const result = await crearVenta(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data, result.warnings);
  });
}

export async function actualizarVentaAction(
  input: unknown,
): Promise<ActionResult<{ id: number; total: string }>> {
  const parsed = zActualizarVentaInput.safeParse(input);
  if (!parsed.success) return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, ROLES_VENTA);
    if (!permitido) {
      return fail(NO_AUTORIZADO, "No tiene permisos para editar ventas");
    }
    const result = await actualizarVenta(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data, result.warnings);
  });
}

export async function cancelarVentaAction(
  input: unknown,
): Promise<ActionResult<{ id: number; estado: string }>> {
  const parsed = zCancelarVentaInput.safeParse(input);
  if (!parsed.success) return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, ROLES_VENTA);
    if (!permitido) {
      return fail(NO_AUTORIZADO, "No tiene permisos para cancelar ventas");
    }
    const result = await cancelarVenta(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data);
  });
}

/**
 * VENT-CONFIRM (R-V15): confirm a `BORRADOR` and emit its `VIGENTE` invoice
 * atomically. Same three-step adapter contract: zod → tenant ctx → tenant
 * transaction with the coarse role gate, then the use case owns the observable
 * order (emission gate → NCF eligibility → hard stock preview → NCF lock+consume
 * → guarded flip → invoice → stock exit). The NCF_UMBRAL_90 threshold surfaces
 * as `ncfWarning` directly on the payload — a banner, never a block.
 */
export async function confirmarVentaAction(
  input: unknown,
): Promise<
  ActionResult<{
    id: number;
    estado: string;
    facturaId: number;
    ncf: string;
    tipoNcf: string;
    correlativoInterno: string;
    total: string;
    ncfWarning: string | null;
  }>
> {
  const parsed = zConfirmarVentaInput.safeParse(input);
  if (!parsed.success) return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, ROLES_VENTA);
    if (!permitido) {
      return fail(NO_AUTORIZADO, "No tiene permisos para confirmar ventas");
    }
    const result = await confirmarVenta(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    const { data } = result;
    return ok({
      id: data.id,
      estado: data.estado,
      facturaId: data.facturaId,
      ncf: data.ncf,
      tipoNcf: data.tipoNcf,
      correlativoInterno: data.correlativoInterno,
      total: data.total,
      ncfWarning:
        result.warnings !== undefined && result.warnings.length > 0
          ? result.warnings[0].code
          : null,
    });
  });
}
