/**
 * Reportes domain — the shared RESULT contracts every report/dashboard use case returns.
 *
 * ADR-013: this module imports NOTHING from Next.js, React, Prisma or Supabase — it is
 * the pure shape the application, http and ui layers all agree on. Two pieces:
 *
 *   - {@link Pagina} — the paginated list DTO (DB-5): a page of rows, the filtered
 *     `total` (NOT a page-limited subset), the echoed page/pageSize/totalPages, and a
 *     `resumen` of Decimal-string totals that come from the SAME canonical query as the
 *     rows, so screen totals and an export can never diverge (EXP-2).
 *   - {@link ReportResult} — the typed success/error envelope (19-directivas §9):
 *     success data OR a stable {@link ReporteErrorCode} + message, never a thrown
 *     internal error crossing the boundary.
 *
 * Money inside `resumen` is always a `Decimal` STRING (never a JS number) so the full
 * `Decimal(12,2)` precision survives across the SQL and JS boundaries (AGENTS.md
 * "Money = Decimal").
 */

import type { ReporteErrorCode } from "./errors";

/**
 * One page of a report plus the active-filter total and a Decimal-string summary of the
 * whole filtered set. `filas` is readonly — the DTO is a value the UI renders, never a
 * list the UI mutates. `resumen` keys are report-defined labels (e.g. `totalNeto`),
 * values are Decimal strings, so the same figures a CSV footer prints are the ones the
 * screen shows (EXP-2 totals parity).
 */
export interface Pagina<T> {
  readonly filas: readonly T[];
  /** Total rows matching the active filters, independent of the current page. */
  readonly total: number;
  /** 1-based page index echoed back (a page past the end simply yields empty filas). */
  readonly page: number;
  /** Rows per page, always within `[1, TAMANO_PAGINA_MAXIMO]`. */
  readonly pageSize: number;
  /** Page count for `total` at `pageSize` (0 when there are no rows). */
  readonly totalPages: number;
  /** Decimal-string totals from the canonical query, keyed by report label. */
  readonly resumen: Readonly<Record<string, string>>;
}

/**
 * Typed use-case result (19-directivas §9). Mirrors `AuditoriaResult` / `CobroResult`:
 * success data or a stable coded error. Any unexpected infrastructure failure (e.g. a
 * Prisma error) PROPAGATES — it is never translated into a typed result here; only the
 * outer adapter catches it and turns it into a transport-neutral generic response.
 */
export type ReportResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: ReporteErrorCode;
      readonly message: string;
    };

/** A successful {@link ReportResult}. */
export function ok<T>(data: T): ReportResult<T> {
  return { ok: true, data };
}

/** A failed {@link ReportResult} from a stable code + its catalog message. */
export function error<T>(
  code: ReporteErrorCode,
  message: string,
): ReportResult<T> {
  return { ok: false, code, message };
}
