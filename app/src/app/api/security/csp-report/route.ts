/**
 * `/api/security/csp-report` — where the enforced CSP posts its violations (S1,
 * odd/tasks/csp-reporting-and-bump-guard.md; the gap left open by odd/tasks/csp-nonce.md L2/L6:
 * "no violation-reporting endpoint", so a real user's blocked resource was visible only in that
 * browser's console).
 *
 * A POST-only route handler, thin by design: bounded read -> `parseCspReports` -> one structured
 * log line per violation. Everything else lives in `@/lib/security/csp-report`.
 *
 * Why a route handler and not a Server Action: browsers must be able to POST here with no session
 * and no `Next-Action` header. Violations fire on `/login`, the pre-auth page, so the endpoint is
 * public by necessity — and it is therefore untrusted input on every request.
 *
 * Contract (browsers ignore the body, so both answers are 204):
 *  - a valid legacy `application/csp-report` or `application/reports+json` body -> 204 + logs;
 *  - a malformed, empty, foreign-content-type or oversized (>32 KB) body -> 204, no log, no
 *    throw. Oversized bodies are never read, so a hostile POST cannot buy memory.
 *
 * Log-volume honesty (Judgment Day advisory): memory is bounded per request, but log LINES are
 * bounded per request AND per instance by the rate budget in `@/lib/security/csp-report`
 * (`shouldLogViolationNow`). That budget is per serverless instance: it is real protection per
 * instance, not a global guarantee — the durable global guarantee belongs to a Vercel Firewall
 * rate rule on this path, recommended in odd/tasks/csp-reporting-and-bump-guard.md for the
 * dashboard owner. This code never claims what it cannot enforce.
 *
 * Writes NOTHING to the database: CSP reports are an observability signal, not audit data (S1).
 * `GET` answers 405 — this endpoint is not a data source, and a 200 here would invite scraping.
 */

import { MAX_REPORT_BYTES, logCspViolations, parseCspReports, shouldLogViolationNow } from "@/lib/security/csp-report";

/** The single answer a browser can act on: "received, nothing to say". */
function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

/** A bounded read: never more than `MAX_REPORT_BYTES` in memory, never an unbounded body. */
type BoundedBody = { ok: true; text: string } | { ok: false; reason: "oversized" | "unreadable" };

function declaredLength(header: string | null): number | null {
  if (header === null) return null;
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function decode(chunks: readonly Uint8Array[], total: number): string {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readBoundedBody(request: Request): Promise<BoundedBody> {
  // A declared size over the cap short-circuits before a single byte is buffered.
  const declared = declaredLength(request.headers.get("content-length"));
  if (declared !== null && declared > MAX_REPORT_BYTES) {
    return { ok: false, reason: "oversized" };
  }
  if (request.body === null) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      // A chunked body carries no content-length: stop at the cap instead of trusting it.
      if (total > MAX_REPORT_BYTES) {
        await reader.cancel();
        return { ok: false, reason: "oversized" };
      }
      chunks.push(value);
    }
  } catch {
    // The browser hung up mid-body: nothing to report and nothing to log.
    return { ok: false, reason: "unreadable" };
  }

  return { ok: true, text: decode(chunks, total) };
}

export async function POST(request: Request): Promise<Response> {
  const body = await readBoundedBody(request);
  if (!body.ok) return noContent();

  if (shouldLogViolationNow()) {
    logCspViolations(parseCspReports(request.headers.get("content-type"), body.text));
  }

  return noContent();
}

export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
