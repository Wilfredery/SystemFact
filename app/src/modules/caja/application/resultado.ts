/**
 * Caja application — the typed result of every Caja read (S6).
 *
 * ADR-013: the application layer never throws a business error across its boundary (19-directivas
 * §9). A read returns EITHER its data OR a stable {@link CajaErrorCode} with the catalog's Spanish
 * copy. Any unexpected infrastructure failure (a Prisma error) PROPAGATES — it is never translated
 * into a typed result here, because a raw DB error must not reach the client and the outer adapter
 * owns the generic transport response.
 *
 * The shape mirrors the ratified `ReportResult` / `CobroResult` contracts, so the Caja actions compose
 * the SAME envelope the rest of the app already speaks.
 */

import type { CajaErrorCode } from "../domain/errors";

/** Typed use-case result: success data, or a stable coded error. */
export type CajaResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: CajaErrorCode; readonly message: string };

/** A successful {@link CajaResult}. */
export function ok<T>(data: T): CajaResult<T> {
  return { ok: true, data };
}

/** A failed {@link CajaResult} from a stable code plus its catalog message. */
export function error<T>(code: CajaErrorCode, message: string): CajaResult<T> {
  return { ok: false, code, message };
}
