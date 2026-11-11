"use server";

/**
 * Caja read actions (S6) — the thin adapters behind /caja.
 *
 * Each action is the SAME three steps and NOTHING more (zero business logic):
 *   1. zod-parse the payload → `VALIDATION_ERROR` on a bad shape (the schema is strict, so a
 *      retroactive date or a scope override never reaches the use case);
 *   2. resolve the tenant context from the Supabase session (an AUTH read, not tenant-DB access);
 *   3. inside `withTenantTransaction`: enforce the server-side role gate against `ROLES_VER_CAJA`
 *      (deny-by-default — a non-Administrador is refused BEFORE any aggregate runs), then delegate
 *      to the use case and forward its typed result.
 *
 * The day is TODAY in America/Santo_Domingo and the scope is the tenant context; no action accepts
 * a date or a branch. The use cases own the SD window and the Admin company-wide widen.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { tieneRolPermitidoEnTx } from "@/modules/venta/infrastructure/venta-repository";
import {
  consultarCierreDiario,
  type CierreDiarioVista,
} from "../application/consultar-cierre-diario";
import {
  consultarResumenDia,
  type ResumenDiaVista,
} from "../application/consultar-resumen-dia";
import { CAJA_NO_AUTORIZADO, messageFor } from "../domain/errors";
import {
  SESION_INVALIDA,
  VALIDATION_ERROR,
  mensajeTransporte,
  zConsultarCajaInput,
} from "./validations";
import {
  type ActionResult,
  type CierreDiarioDto,
  type MetodoRowDto,
  type ResumenDiaDto,
  fail,
  ok,
  resolverCtx,
  ROLES_VER_CAJA,
} from "./shared";

/** The use-case view → the wire DTO (field by field: rows never cross the boundary). */
function aCierreDto(v: CierreDiarioVista): CierreDiarioDto {
  const metodos: MetodoRowDto[] = v.metodos.map((m) => ({
    metodo: m.metodo,
    cobros: m.cobros,
    cantidad: m.cantidad,
  }));
  return {
    fechaSD: v.fechaSD,
    totalFacturado: v.totalFacturado,
    totalCobrado: v.totalCobrado,
    efectivoEsperado: v.efectivoEsperado,
    diferencia: v.diferencia,
    metodos,
    corte: { cobros: v.corte.cobros, devoluciones: v.corte.devoluciones },
  };
}

/** The use-case view → the 06b wire DTO. */
function aResumenDto(v: ResumenDiaVista): ResumenDiaDto {
  return {
    fechaSD: v.fechaSD,
    ventas: v.ventas,
    costoVendido: v.costoVendido,
    margenBruto: v.margenBruto,
    margenPorcentaje: v.margenPorcentaje,
  };
}

/**
 * The 06a board read: today's close (KPIs, method rows, corte). Administrador-only.
 */
export async function consultarCierreCajaAction(
  input: unknown,
): Promise<ActionResult<CierreDiarioDto>> {
  const parsed = zConsultarCajaInput.safeParse(input ?? {});
  if (!parsed.success) {
    return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));
  }

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_VER_CAJA,
    );
    if (!permitido) return fail(CAJA_NO_AUTORIZADO, messageFor(CAJA_NO_AUTORIZADO));

    const result = await consultarCierreDiario(tx, ctx);
    if (!result.ok) return fail(result.code, result.message);
    return ok(aCierreDto(result.data));
  });
}

/**
 * The 06b board read: today's sales, cost of goods sold and margin. Administrador-only, and read
 * SEPARATELY from the close (S2: the two boards are never merged into one payload).
 */
export async function consultarResumenDiaAction(
  input: unknown,
): Promise<ActionResult<ResumenDiaDto>> {
  const parsed = zConsultarCajaInput.safeParse(input ?? {});
  if (!parsed.success) {
    return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));
  }

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_VER_CAJA,
    );
    if (!permitido) return fail(CAJA_NO_AUTORIZADO, messageFor(CAJA_NO_AUTORIZADO));

    const result = await consultarResumenDia(tx, ctx);
    if (!result.ok) return fail(result.code, result.message);
    return ok(aResumenDto(result.data));
  });
}

/**
 * Whether the caller may see the Caja boards, answered from the named group so the screen never
 * names a role. It is only a UI question (render the boards or the access message); each read action
 * re-checks on the server.
 */
export async function obtenerPermisosCajaAction(): Promise<
  ActionResult<{ puedeVer: boolean }>
> {
  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const puedeVer = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_VER_CAJA,
    );
    return ok({ puedeVer });
  });
}
