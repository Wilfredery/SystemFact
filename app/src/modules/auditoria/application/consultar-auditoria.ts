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
  type AuditoriaConsulta,
  type AuditoriaFiltro,
  type AuditoriaFiltroEntrada,
  type AuditoriaPagina,
  type AuditoriaSucursalOpcion,
} from "../domain/auditoria";
import {
  consultarAuditoriaConOpcionesEnTx,
  consultarAuditoriaEnTx,
} from "../infrastructure/consultar-auditoria.repository";
import { listarSucursalesAdministracion } from "@/modules/tenant/application/listarSucursalesAdministracion";

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

const defaultDeps = {
  consultarConOpciones: consultarAuditoriaConOpcionesEnTx,
  listarSucursales: listarSucursalesAdministracion,
};

/**
 * Same gate and normalisation as {@link consultarAuditoria}, but returns the page
 * AND the Usuario/Sucursal filter option lists from ONE transaction and ONE
 * widened-branch window (Board 09 slice B, S2-S4). The admin gate and the filter
 * validation run BEFORE any query, so a denied or invalid call reads no row and no
 * option. Branch options come from the tenant admin-gated lister (active AND
 * inactive), reduced here to `{ id, nombre, activa }` — nothing else leaves.
 */
export async function consultarAuditoriaConOpciones(
  tx: PrismaTx,
  ctx: TenantCtx,
  entrada: AuditoriaFiltroEntrada,
  deps: {
    readonly consultarConOpciones: typeof consultarAuditoriaConOpcionesEnTx;
    readonly listarSucursales: typeof listarSucursalesAdministracion;
  } = defaultDeps,
): Promise<AuditoriaResult<AuditoriaConsulta>> {
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

  const leerSucursales = async (): Promise<readonly AuditoriaSucursalOpcion[]> => {
    const r = await deps.listarSucursales(ctx, tx);
    // Unreachable for an admin (same `esAdmin` flag), but fail closed if it ever is.
    if (!r.ok) throw new AuditoriaDomainError(AUDITORIA_NO_AUTORIZADO);
    return r.sucursales.map((s) => ({ id: s.id, nombre: s.nombre, activa: s.activa }));
  };

  try {
    const { filas, total, opciones } = await deps.consultarConOpciones(
      tx,
      ctx,
      filtro,
      leerSucursales,
    );
    return {
      ok: true,
      data: { pagina: mapearAPagina({ filas, total, filtro }), opciones },
    };
  } catch (e) {
    if (e instanceof AuditoriaDomainError) {
      return { ok: false, code: e.code, message: e.message };
    }
    throw e;
  }
}
