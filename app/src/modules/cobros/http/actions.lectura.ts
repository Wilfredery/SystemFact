"use server";

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { tieneRolPermitidoEnTx } from "@/modules/venta/infrastructure/venta-repository";
import {
  consultarSaldoCxcPaginado,
  consultarSaldoCxC,
  type SaldoCxCVista,
  type SaldoCxCVistaPagina,
} from "../application/consultar-saldo-cxc";
import {
  consultarRecibo,
  type ReciboVista,
} from "../application/consultar-recibo";
import {
  SESION_INVALIDA,
  VALIDATION_ERROR,
  mensajeTransporte,
  zConsultarEstadoCuentaInput,
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

/**
 * The CxC board page read (R-C9, design D4): the thin adapter forwards the
 * optional transport paging intent and returns the typed server metadata
 * `{filas, total, page, pageSize, totalPages}` — the page cut, the pinned order
 * and the filtered total all happened in SQL inside the use case; zero business
 * logic lives here (three steps only: zod, context, role gate + delegate).
 */
export async function consultarSaldoCxcAction(
  input: unknown,
): Promise<ActionResult<SaldoCxCVistaPagina>> {
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
    const result = await consultarSaldoCxcPaginado(tx, ctx, {
      page: parsed.data?.page,
      pageSize: parsed.data?.pageSize,
    });
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data);
  });
}

/**
 * The customer statement read (R-C7): the WHOLE account for the canonical
 * view — settled (`PAGADA`) rows included — so it never rides the board's
 * outstanding-filtered page; the same Cobros role gate as the rest of the
 * module (a Despachador is denied), scoped to the tenant under the RLS GUCs.
 */
export async function consultarEstadoDeCuentaAction(
  input: unknown,
): Promise<ActionResult<SaldoCxCVista[]>> {
  const parsed = zConsultarEstadoCuentaInput.safeParse(input ?? {});
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
    const result = await consultarSaldoCxC(tx, ctx);
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
