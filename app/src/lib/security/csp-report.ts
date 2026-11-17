/**
 * CSP violation report parsing and logging (S1, odd/tasks/csp-reporting-and-bump-guard.md).
 *
 * Two wire formats arrive here:
 *  - legacy `application/csp-report` — `{ "csp-report": { ...kebab-case fields } }`
 *    (the only format `report-uri` produces, and every browser still speaks it);
 *  - `application/reports+json` — an ARRAY of `{ type, url, body }` entries
 *    (the Reporting API format, kebab-free camelCase fields).
 *
 * Pure and Edge-safe (JSON + console only, no Node imports), and TOTAL: every function here
 * returns a value for ANY input. A violation report is untrusted network input from a browser we
 * cannot answer, so a malformed body is an expected outcome, not an error — it yields zero reports
 * and the endpoint still answers 204. That is why the single `catch` below is correct and not a
 * swallowed bug: there is no one to report the failure to, and throwing would turn a hostile POST
 * into a 500 in the logs.
 *
 * What is deliberately NOT here: any database write. CSP reports are an observability signal, not
 * audit data (the audit log is append-only tenant data, S1).
 */

/** Bodies larger than this are dropped without being read, parsed or logged. */
export const MAX_REPORT_BYTES = 32 * 1024;

/**
 * Upper bound on how many entries of ONE `reports+json` batch reach the log. A 32 KB body can
 * still carry hundreds of tiny entries; the cap keeps a single hostile POST from flooding the
 * log stream while every genuine browser batch (one violation per navigation) fits easily.
 */
export const MAX_LOGGED_REPORTS = 20;

/** The `event` field every emitted line carries, so the log stream is greppable. */
export const CSP_VIOLATION_EVENT = "csp_violation";

/**
 * Per-instance log budget for violations (Judgment Day advisory: per-request caps alone let a
 * repeated small POST grow log volume without bound). A token bucket refilled continuously:
 * `MAX_LOGS_PER_WINDOW` lines per rolling `LOG_WINDOW_MS`, kept per serverless instance.
 *
 * Honest limits, stated here so no comment overclaims: this is REAL protection for one instance
 * and NO global guarantee — serverless fan-out multiplies it, and instances recycle. The durable
 * global cap belongs to a Vercel Firewall rate rule on this path (dashboard owner; recommended
 * in odd/tasks/csp-reporting-and-bump-guard.md). Dropped lines still answered 204; the browser
 * contract never changes.
 */
export const MAX_LOGS_PER_WINDOW = 30;
export const LOG_WINDOW_MS = 60_000;

/**
 * Module-level budget state. Sliding window of accepted timestamps, pruned on each call — a few
 * numbers per instance, never per request.
 */
const logBudget: number[] = [];

/**
 * True when this instance still has budget to log one more violation line at `nowMs`.
 * Exported for tests; the route calls it before `logCspViolations`.
 */
export function shouldLogViolationNow(nowMs: number = Date.now()): boolean {
  while (logBudget.length > 0 && nowMs - logBudget[0] >= LOG_WINDOW_MS) {
    logBudget.shift();
  }
  if (logBudget.length >= MAX_LOGS_PER_WINDOW) return false;
  logBudget.push(nowMs);
  return true;
}

/** Longest value kept for one summary field; the raw report is logged as received. */
const MAX_FIELD_LENGTH = 512;

/**
 * One violation, normalized across both wire formats. `null` means "the report did not carry it"
 * — never an empty string, so an absent field is distinguishable from an empty one.
 */
export type CspViolationReport = {
  documentUri: string | null;
  blockedUri: string | null;
  effectiveDirective: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
  /** The report object exactly as the browser sent it (bounded by `MAX_REPORT_BYTES`). */
  raw: Record<string, unknown>;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `application/csp-report; charset=utf-8` -> `application/csp-report`. */
function mediaType(contentType: string | null): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

/** Legacy `report-uri` body: one report, kebab-case keys. */
function legacyReport(parsed: unknown): CspViolationReport[] {
  const envelope = asRecord(parsed);
  const report = envelope === null ? null : asRecord(envelope["csp-report"]);
  if (report === null) return [];
  return [
    {
      documentUri: asString(report["document-uri"]),
      blockedUri: asString(report["blocked-uri"]),
      effectiveDirective:
        asString(report["effective-directive"]) ?? asString(report["violated-directive"]),
      sourceFile: asString(report["source-file"]),
      lineNumber: asNumber(report["line-number"]),
      raw: report,
    },
  ];
}

/** Reporting API body: an array of entries, camelCase keys, only `csp-violation` entries apply. */
function reportingApiReports(parsed: unknown): CspViolationReport[] {
  if (!Array.isArray(parsed)) return [];
  const reports: CspViolationReport[] = [];
  for (const entry of parsed) {
    const item = asRecord(entry);
    if (item === null || item["type"] !== "csp-violation") continue;
    const body = asRecord(item["body"]) ?? {};
    reports.push({
      documentUri: asString(body["documentURL"]),
      blockedUri: asString(body["blockedURL"]),
      effectiveDirective: asString(body["effectiveDirective"]),
      sourceFile: asString(body["sourceFile"]),
      lineNumber: asNumber(body["lineNumber"]),
      raw: body,
    });
  }
  return reports;
}

/**
 * Parse a violation body into normalized reports. Returns `[]` for an unknown content type,
 * malformed JSON, or a shape that carries no violation — never throws.
 */
export function parseCspReports(
  contentType: string | null,
  body: string,
): CspViolationReport[] {
  if (body.length === 0) return [];
  const type = mediaType(contentType);
  if (type !== "application/csp-report" && type !== "application/reports+json") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Expected: unparseable body. Nobody to notify, nothing to retry.
    return [];
  }

  return type === "application/csp-report"
    ? legacyReport(parsed)
    : reportingApiReports(parsed);
}

function truncate(value: string | null): string | null {
  if (value === null) return null;
  return value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}…` : value;
}

/**
 * Serialize one violation without ever throwing. `JSON.stringify` raises RangeError on deeply
 * nested structures that `JSON.parse` accepted, and this endpoint is pre-auth: a hostile body must
 * never break the 204 contract, so a serialization failure degrades to a flat marker line that
 * names the failing report class instead of the payload.
 */
function serializeViolation(report: CspViolationReport): string {
  try {
    return JSON.stringify({
      event: CSP_VIOLATION_EVENT,
      blockedUri: truncate(report.blockedUri),
      effectiveDirective: truncate(report.effectiveDirective),
      sourceFile: truncate(report.sourceFile),
      lineNumber: report.lineNumber,
      documentUri: truncate(report.documentUri),
      report: report.raw,
    });
  } catch {
    return JSON.stringify({
      event: CSP_VIOLATION_EVENT,
      blockedUri: truncate(report.blockedUri),
      effectiveDirective: truncate(report.effectiveDirective),
      sourceFile: truncate(report.sourceFile),
      lineNumber: report.lineNumber,
      documentUri: truncate(report.documentUri),
      reportSerialization: "failed",
    });
  }
}

/**
 * Emit ONE structured JSON line per violation to the server console (visible in Vercel logs).
 *
 * The fields the operator reads first are lifted to the top level; the browser's own report rides
 * along as `report` so nothing is lost. `JSON.stringify` is what makes it a single line even when
 * a report contains newlines.
 */
export function logCspViolations(reports: readonly CspViolationReport[]): void {
  for (const report of reports.slice(0, MAX_LOGGED_REPORTS)) {
    console.log(serializeViolation(report));
  }
}
