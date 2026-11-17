import { CSP_REPORT_PATH, buildContentSecurityPolicy, generateNonce } from "./csp";

const SUPABASE_URL = "https://abcdefgh.supabase.co";

function directives(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const raw of policy.split(";")) {
    const [name, ...sources] = raw.trim().split(/\s+/);
    if (name) map.set(name, sources);
  }
  return map;
}

describe("generateNonce", () => {
  it("returns a different value on every call", () => {
    const nonces = new Set(Array.from({ length: 200 }, () => generateNonce()));
    expect(nonces.size).toBe(200);
  });

  it("returns valid base64 that decodes to 16 random bytes", () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(nonce, "base64")).toHaveLength(16);
  });
});

describe("buildContentSecurityPolicy", () => {
  const policy = buildContentSecurityPolicy({
    nonce: "TESTNONCE123==",
    supabaseUrl: SUPABASE_URL,
  });
  const parsed = directives(policy);

  it("carries every directive the owner's policy names", () => {
    const expected = [
      "default-src",
      "script-src",
      "style-src",
      "img-src",
      "font-src",
      "connect-src",
      "frame-ancestors",
      "frame-src",
      "form-action",
      "base-uri",
      "object-src",
      "report-uri",
    ];
    expect([...parsed.keys()].sort()).toEqual([...expected].sort());
  });

  it("reports violations to the same-origin endpoint (S1)", () => {
    expect(CSP_REPORT_PATH).toBe("/api/security/csp-report");
    expect(parsed.get("report-uri")).toEqual([CSP_REPORT_PATH]);
  });

  // S4: reporting is not a capability, so it must not have bought a single looser directive.
  // The whole enforced policy is frozen here EXCEPT the one directive reporting added.
  it("adds report-uri and changes no other directive (S4)", () => {
    const frozen = new Map<string, string[]>([
      ["default-src", ["'self'"]],
      ["script-src", ["'self'", "'nonce-TESTNONCE123=='", "'strict-dynamic'"]],
      ["style-src", ["'self'", "'unsafe-inline'"]],
      ["img-src", ["'self'", "data:"]],
      ["font-src", ["'self'"]],
      ["connect-src", ["'self'", SUPABASE_URL]],
      ["frame-ancestors", ["'none'"]],
      ["frame-src", ["'none'"]],
      ["form-action", ["'self'"]],
      ["base-uri", ["'none'"]],
      ["object-src", ["'none'"]],
      ["report-uri", [CSP_REPORT_PATH]],
    ]);
    expect([...parsed.entries()]).toEqual([...frozen.entries()]);
  });

  // `report-to` only fires once the browser has cached a Reporting-Endpoints header, so naming a
  // group the proxy does not advertise would silently report nothing. Documented in csp.ts.
  it("does not name a report-to group it cannot advertise", () => {
    expect(parsed.has("report-to")).toBe(false);
    expect(parsed.has("reporting-endpoints")).toBe(false);
  });

  it("makes scripts nonce-only: the nonce, strict-dynamic, no unsafe-inline", () => {
    expect(parsed.get("script-src")).toEqual([
      "'self'",
      "'nonce-TESTNONCE123=='",
      "'strict-dynamic'",
    ]);
  });

  it("lets styles keep 'unsafe-inline' (owner decision S2)", () => {
    expect(parsed.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("never allows unsafe-eval anywhere", () => {
    expect(policy).not.toContain("unsafe-eval");
  });

  it("derives the connect-src origin from the Supabase URL, dropping path and query", () => {
    const withPath = buildContentSecurityPolicy({
      nonce: "n",
      supabaseUrl: "https://other-ref.supabase.co/rest/v1/?apikey=x",
    });
    expect(directives(withPath).get("connect-src")).toEqual([
      "'self'",
      "https://other-ref.supabase.co",
    ]);
    expect(withPath).not.toContain("apikey");
    expect(parsed.get("connect-src")).toEqual(["'self'", SUPABASE_URL]);
  });

  it("locks down frames, forms, base and objects", () => {
    expect(parsed.get("frame-ancestors")).toEqual(["'none'"]);
    expect(parsed.get("frame-src")).toEqual(["'none'"]);
    expect(parsed.get("form-action")).toEqual(["'self'"]);
    expect(parsed.get("base-uri")).toEqual(["'none'"]);
    expect(parsed.get("object-src")).toEqual(["'none'"]);
  });

  it("fails loudly on an invalid Supabase URL instead of falling back", () => {
    expect(() =>
      buildContentSecurityPolicy({ nonce: "n", supabaseUrl: "not a url" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
