/**
 * Cobros Server Actions — thin HTTP adapters (fase-6, R-C6, R-B1).
 *
 * Each action is the SAME three steps and NOTHING more (zero business logic):
 *   1. zod-parse the payload → stable `VALIDATION_ERROR` on a bad shape (the
 *      refund key is MANDATORY here);
 *   2. resolve the tenant context from the Supabase session (an AUTH read, not
 *      tenant-DB access, so it precedes the wrapper — venta/devolucion convention);
 *   3. inside `withTenantTransaction`: enforce the server-side role gate
 *      (R-C6 — a Despachador is denied all of Cobros; a refund additionally needs
 *      an authorizing role), then delegate to the use case and forward its typed
 *      result. An unauthorized actor is refused BEFORE the use case runs, i.e.
 *      before any write and before any receipt number is burned.
 *
 * Hiding UI controls is NOT the control: the role check queries the user's actual
 * DB roles via `tieneRolPermitidoEnTx` (reused from `venta` like `devolucion`),
 * and every read/write is tenant-scoped under the RLS GUCs. The authorization
 * refusal is the cobros catalog's `PAGO_NO_AUTORIZADO`, so the whole error surface
 * stays inside the single versioned catalog (R-C5). No `withTenantTransaction`
 * call sits outside these wrappers (satisfies the project-local ESLint rule).
 */

"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { tieneRolPermitidoEnTx } from "@/modules/venta/infrastructure/venta-repository";
import {
  PAGO_NO_AUTORIZADO,
  messageFor,
  type CobroErrorCode,
} from "../domain/errors";
import {
  registrarCobro,
  type RegistrarCobroOutput,
} from "../application/registrar-cobro";
import {
  registrarReembolso,
  type RegistrarReembolsoOutput,
} from "../application/registrar-reembolso";
import {
  consultarSaldoCxC,
  type SaldoCxCVista,
} from "../application/consultar-saldo-cxc";
import {
  SESION_INVALIDA,
  VALIDATION_ERROR,
  mensajeTransporte,
  zRegistrarCobroInput,
  zRegistrarReembolsoInput,
  zConsultarSaldoCxcInput,
} from "./validations";

/** Cobros collections + reads are operational (Admin + Operador); Despachador denied. */
const ROLES_COBROS = ["Administrador", "Operador"];
/** Refunds require an authorizing role (Administrador only, §10 / R-C6). */
const ROLES_REEMBOLSO = ["Administrador"];

/** Composed action error surface: cobros catalog ∪ transport codes. */
export type CobrosAccionesErrorCode =
  | CobroErrorCode
  | typeof VALIDATION_ERROR
  | typeof SESION_INVALIDA;

export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: CobrosAccionesErrorCode;
        readonly message: string;
      };
    };

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function fail(code: CobrosAccionesErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

/** The tenant context comes from the Supabase session (auth read), not the DB. */
async function resolverCtx() {
  const supabase = await createClient();
  return getCurrentTenantContext(supabase);
}

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
