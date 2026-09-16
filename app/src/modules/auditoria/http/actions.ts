/**
 * Auditoria Server Action — thin HTTP adapter for the admin audit consultation
 * (Slice D, task 4.1; AC-1 / AC-4 / AC-5).
 *
 * The whole action is the SAME three steps and NOTHING more (zero business logic),
 * mirroring `cobros/http/actions.ts`:
 *   1. Zod-parse the payload → stable `VALIDATION_ERROR` on a bad SHAPE (ids, page,
 *      date format). The domain owns the deeper business validation and surfaces
 *      `AUDITORIA_VALIDACION`; Zod is never the authority for that.
 *   2. Resolve the tenant context from the Supabase session — an AUTH read, not
 *      tenant-DB access, so it precedes the wrapper (venta/devolucion convention).
 *   3. Inside `withTenantTransaction`: enforce the server-side Admin role gate via
 *      `tieneRolPermitidoEnTx` (AC-1 — hiding the UI is NOT the control), then
 *      delegate to the `consultarAuditoria` use case and forward its typed result.
 *
 * A non-admin is refused BEFORE the use case runs, so no row is ever read for a
 * denied actor (AC-1). Every query is tenant-pinned + RLS-scoped inside the wrapper
 * (AC-4). The consultation surface is READ-ONLY by construction (AC-5): there is no
 * create/update/delete action here at all, and no `prisma.*` access outside a wrap,
 * so the project-local ESLint rule `systemfact/server-action-must-wrap-tenant`
 * passes. Only stable catalog codes cross this boundary — Prisma/DB errors never
 * leak to the client (AGENTS.md "Never expose stack traces or internal Prisma errors").
 */

"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { tieneRolPermitidoEnTx } from "@/modules/venta/infrastructure/venta-repository";
import {
  AUDITORIA_NO_AUTORIZADO,
  messageFor,
  type AuditoriaErrorCode,
} from "../domain/errors";
import type { AuditoriaPagina } from "../domain/auditoria";
import { consultarAuditoria } from "../application/consultar-auditoria";
import {
  SESION_INVALIDA,
  VALIDATION_ERROR,
  mensajeTransporte,
  zConsultarAuditoriaInput,
} from "./validations";

/** Audit consultation is Admin-only (AC-1); every other role is denied server-side. */
const ROLES_AUDITORIA = ["Administrador"];

/** Composed action error surface: auditoria catalog ∪ transport codes. */
export type AuditoriaAccionesErrorCode =
  | AuditoriaErrorCode
  | typeof VALIDATION_ERROR
  | typeof SESION_INVALIDA;

export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: AuditoriaAccionesErrorCode;
        readonly message: string;
      };
    };

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function fail(
  code: AuditoriaAccionesErrorCode,
  message: string,
): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

/** The tenant context comes from the Supabase session (auth read), not the DB. */
async function resolverCtx() {
  const supabase = await createClient();
  return getCurrentTenantContext(supabase);
}

/**
 * Reads one paginated, filtered page of the tenant's audit log for an Administrator.
 * The payload is the raw consultation filter (from the URL/client form); the returned
 * DTO is already ordered newest-first and carries the active-filter total (AC-2/AC-3).
 */
export async function consultarAuditoriaAction(
  input: unknown,
): Promise<ActionResult<AuditoriaPagina>> {
  const parsed = zConsultarAuditoriaInput.safeParse(input ?? {});
  if (!parsed.success) {
    return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));
  }

  const ctx = await resolverCtx();
  if (ctx === null) {
    return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    // Authorization gate runs BEFORE the use case: a non-admin is refused before any
    // audit row is read (AC-1). The role check queries the user's actual DB roles.
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_AUDITORIA,
    );
    if (!permitido) {
      return fail(
        AUDITORIA_NO_AUTORIZADO,
        messageFor(AUDITORIA_NO_AUTORIZADO),
      );
    }
    const result = await consultarAuditoria(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data);
  });
}
