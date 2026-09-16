/**
 * Auditoria application — the ADMIN read use case (ADR-013).
 *
 * Composition (AC-1 → AC-5):
 *   1. Admin gate: `ctx.esAdmin` MUST be true before any row is read. This is
 *      the domain contract the http adapter relies on later; a false value
 *      short-circuits with the stable `AUDITORIA_NO_AUTORIZADO` WITHOUT
 *      touching the database — no row is ever peeked for a denied actor.
 *   2. Normalise the raw entrada into a DB-ready filter. Transport violations
 *      (a non-numeric id, an unknown `accion`, or a malformed SD date) fail
 *      loud as `AUDITORIA_VALIDACION` — never silently (19-directivas §9).
 *   3. Delegate to the infrastructure read (which enforces RLS + the
 *      `empresaId` pin) and wrap the ordered page into the `AuditoriaPagina`
 *      DTO.
 *
 * Runs inside the caller's `withTenantTransaction` (the http adapter opens it
 * in Slice D; the integration tests open it here). The use case does NOT
 * re-wrap — that would nest transactions. It receives `tx` and `ctx` and
 * forwards them, keeping the composition linear like every other `EnTx`
 * repository in the codebase.
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  AUDITORIA_NO_AUTORIZADO,
  AuditoriaDomainError,
  messageFor,
  type AuditoriaErrorCode,
} from "../domain/errors";
import {
  mapearAPagina,
  normalizarFiltro,
  type AuditoriaFiltro,
  type AuditoriaFiltroEntrada,
  type AuditoriaPagina,
} from "../domain/auditoria";
import { consultarAuditoriaEnTx } from "../infrastructure/consultar-auditoria.repository";

/**
 * Typed use-case result (19-directivas §9). Mirrors `CobroResult` /
 * `VentaResult`: success data or a stable coded error. Any unexpected
 * infrastructure failure (e.g. a Prisma error) PROPAGATES — it is never
 * translated into a typed result here (AGENTS.md "Never expose stack traces
 * or internal Prisma errors to the client"); only the outer adapter catches
 * and turns it into a transport-neutral generic response.
 */
export type AuditoriaResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: AuditoriaErrorCode;
      readonly message: string;
    };

/**
 * Reads one paginated page of audit rows for an Admin caller. The
 * normalisation, admin gate and DTO assembly are the use case's whole
 * surface — the Prisma query itself lives in the infrastructure adapter.
 */
export async function consultarAuditoria(
  tx: PrismaTx,
  ctx: TenantCtx,
  entrada: AuditoriaFiltroEntrada,
): Promise<AuditoriaResult<AuditoriaPagina>> {
  if (!ctx.esAdmin) {
    return {
      ok: false,
      code: AUDITORIA_NO_AUTORIZADO,
      message: messageFor(AUDITORIA_NO_AUTORIZADO),
    };
  }

  let filtro: AuditoriaFiltro;
  try {
    filtro = normalizarFiltro(entrada);
  } catch (e) {
    if (e instanceof AuditoriaDomainError) {
      return { ok: false, code: e.code, message: e.message };
    }
    throw e;
  }

  const { filas, total } = await consultarAuditoriaEnTx(tx, ctx, filtro);
  return { ok: true, data: mapearAPagina({ filas, total, filtro }) };
}
