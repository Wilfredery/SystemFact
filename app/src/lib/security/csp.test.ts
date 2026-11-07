import { buildContentSecurityPolicy, generateNonce } from "./csp";

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
    ];
    expect([...parsed.keys()].sort()).toEqual([...expected].sort());
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
