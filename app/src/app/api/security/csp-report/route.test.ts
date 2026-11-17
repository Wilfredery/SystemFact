/**
 * Unit — `/api/security/csp-report` route handler (S1 / S4,
 * odd/tasks/csp-reporting-and-bump-guard.md).
 *
 * The endpoint is untrusted, pre-auth network input: a browser POSTs violation reports and ignores
 * whatever comes back. These tests pin the observable contract on the public interface only:
 *
 *   204 in every case (valid, malformed, foreign content type, oversized);
 *   one structured JSON log line per violation, carrying the normalized fields + the raw report;
 *   NOTHING logged for an oversized, malformed, empty or foreign-type body (unbounded logging is
 *      the failure mode this endpoint has to resist);
 *   no throw for any of them;
 *   GET -> 405.
 *
 * Both wire formats are covered: legacy `application/csp-report` (what `report-uri` sends) and
 * `application/reports+json` (an ARRAY body).
 */

import { GET, POST } from "./route";
import { CSP_VIOLATION_EVENT, MAX_REPORT_BYTES, MAX_LOGGED_REPORTS } from "@/lib/security/csp-report";

const ENDPOINT = "https://systemfact.vercel.app/api/security/csp-report";

const LEGACY = {
  "document-uri": "https://systemfact.vercel.app/login",
  referrer: "",
  "violated-directive": "script-src",
  "effective-directive": "script-src-elem",
  "original-policy": "default-src 'self'",
  "blocked-uri": "inline",
  "source-file": "https://systemfact.vercel.app/_next/static/chunks/1.js",
  "line-number": 42,
  "column-number": 7,
  "status-code": 200,
  "script-sample": "eval",
};

function post(body: string, contentType: string, init: RequestInit = {}): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
    ...init,
  });
}

/** The log lines emitted by the handler, parsed back into objects. */
function loggedLines(log: jest.SpyInstance): Record<string, unknown>[] {
  return log.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

let log: jest.SpyInstance;

beforeEach(() => {
  log = jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  log.mockRestore();
});

describe("POST /api/security/csp-report — legacy application/csp-report", () => {
  it("answers 204 with no body and one structured line for a valid report", async () => {
    const res = await POST(
      post(JSON.stringify({ "csp-report": LEGACY }), "application/csp-report"),
    );

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const lines = loggedLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      event: CSP_VIOLATION_EVENT,
      blockedUri: "inline",
      effectiveDirective: "script-src-elem",
      sourceFile: "https://systemfact.vercel.app/_next/static/chunks/1.js",
      lineNumber: 42,
      documentUri: "https://systemfact.vercel.app/login",
      report: LEGACY,
    });
  });

  it("still logs when 'effective-directive' is missing, falling back to 'violated-directive'", async () => {
    const report: Record<string, unknown> = { ...LEGACY };
    delete report["effective-directive"];

    const res = await POST(post(JSON.stringify({ "csp-report": report }), "application/csp-report"));

    expect(res.status).toBe(204);
    const lines = loggedLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0].effectiveDirective).toBe("script-src");
  });

  it("keeps an absent field distinguishable from an empty one (null, not '')", async () => {
    const res = await POST(post(JSON.stringify({ "csp-report": {} }), "application/csp-report"));

    expect(res.status).toBe(204);
    const lines = loggedLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      blockedUri: null,
      effectiveDirective: null,
      sourceFile: null,
      lineNumber: null,
      documentUri: null,
    });
  });
});

describe("POST /api/security/csp-report — application/reports+json (array body)", () => {
  const batch = [
    {
      type: "csp-violation",
      url: "https://systemfact.vercel.app/venta",
      body: {
        documentURL: "https://systemfact.vercel.app/venta",
        blockedURL: "https://evil.example/x.js",
        effectiveDirective: "script-src-elem",
        sourceFile: "https://systemfact.vercel.app/venta",
        lineNumber: 3,
        disposition: "enforce",
      },
    },
    // Not a CSP entry: the Reporting API multiplexes every endpoint's reports here.
    { type: "deprecation", url: "https://systemfact.vercel.app/venta", body: { id: "x" } },
    {
      type: "csp-violation",
      url: "https://systemfact.vercel.app/venta",
      body: { documentURL: "https://systemfact.vercel.app/venta", effectiveDirective: "style-src" },
    },
  ];

  it("answers 204 and logs one line per csp-violation entry, ignoring other report types", async () => {
    const res = await POST(post(JSON.stringify(batch), "application/reports+json"));

    expect(res.status).toBe(204);
    const lines = loggedLines(log);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      event: CSP_VIOLATION_EVENT,
      blockedUri: "https://evil.example/x.js",
      effectiveDirective: "script-src-elem",
      sourceFile: "https://systemfact.vercel.app/venta",
      lineNumber: 3,
      documentUri: "https://systemfact.vercel.app/venta",
    });
    expect(lines[0].report).toEqual(batch[0].body);
    expect(lines[1]).toMatchObject({ effectiveDirective: "style-src", blockedUri: null });
  });

  it("caps how many entries of ONE batch reach the log", async () => {
    const flood = Array.from({ length: MAX_LOGGED_REPORTS + 30 }, (_, i) => ({
      type: "csp-violation",
      url: "https://systemfact.vercel.app/login",
      body: { documentURL: "https://systemfact.vercel.app/login", lineNumber: i },
    }));

    const res = await POST(post(JSON.stringify(flood), "application/reports+json"));

    expect(res.status).toBe(204);
    expect(loggedLines(log)).toHaveLength(MAX_LOGGED_REPORTS);
  });
});

describe("POST /api/security/csp-report — hostile and broken input", () => {
  it.each([
    ["malformed JSON", "{not json", "application/csp-report"],
    ["an empty body", "", "application/csp-report"],
    ["a body with no csp-report key", JSON.stringify({ hello: "world" }), "application/csp-report"],
    ["a JSON array sent as csp-report", "[]", "application/csp-report"],
    ["a reports+json body that is an object, not an array", JSON.stringify({ body: {} }), "application/reports+json"],
    ["a foreign content type", JSON.stringify({ "csp-report": LEGACY }), "application/json"],
    ["no content type at all", JSON.stringify({ "csp-report": LEGACY }), ""],
  ])("answers 204 and logs nothing for %s", async (_case, body, contentType) => {
    const request =
      contentType === ""
        ? new Request(ENDPOINT, { method: "POST", body })
        : post(body, contentType);

    const res = await POST(request);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(log).not.toHaveBeenCalled();
  });

  it("answers 204 and degrades the log line for a deeply nested report that JSON.parse accepts but JSON.stringify cannot serialize", async () => {
    // Deterministic Node behavior: parse succeeds while stringify throws
    // RangeError at nesting depths far under the 32 KB byte cap.
    const depth = 5000;
    // Built by concatenation on purpose: the wire body is valid JSON that
    // JSON.parse accepts, but JSON.stringify cannot serialize it — which is
    // exactly the asymmetry under test.
    const nested =
      '{"csp-report":{"document-uri":"https://app.test/x","effective-directive":"script-src","violated-directive":"script-src","script-sample":' +
      "[".repeat(depth) +
      "0" +
      "]".repeat(depth) +
      "}}";
    expect(nested.length).toBeLessThan(MAX_REPORT_BYTES);

    const res = await POST(post(nested, "application/csp-report"));

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(log.mock.calls[0][0] as string) as { event: string; reportSerialization?: string };
    expect(line.event).toBe("csp_violation");
    expect(line.reportSerialization).toBe("failed");
  });

  it("answers 204 without logging a body larger than the cap (declared Content-Length)", async () => {
    const oversized = JSON.stringify({
      "csp-report": { ...LEGACY, "script-sample": "x".repeat(MAX_REPORT_BYTES) },
    });
    expect(oversized.length).toBeGreaterThan(MAX_REPORT_BYTES);

    const res = await POST(post(oversized, "application/csp-report"));

    expect(res.status).toBe(204);
    expect(log).not.toHaveBeenCalled();
  });

  it("stops reading a chunked body at the cap and logs nothing", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(8 * 1024).fill(120);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 64) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
    });

    const res = await POST(
      new Request(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/csp-report" },
        body: stream,
        // Required by undici for a streaming request body.
        duplex: "half",
      } as RequestInit),
    );

    expect(res.status).toBe(204);
    expect(log).not.toHaveBeenCalled();
    // The cap is enforced by cancelling the stream, never by buffering all of it.
    expect(pulled).toBeLessThan(64);
  });
});

describe("GET /api/security/csp-report", () => {
  it("answers 405 and advertises POST only", () => {
    const res = GET();

    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(log).not.toHaveBeenCalled();
  });
});
