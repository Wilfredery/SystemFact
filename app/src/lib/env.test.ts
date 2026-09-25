/**
 * `env.ts` DATABASE_URL allowlist (ADR-019 defense in depth).
 *
 * Regression cover for the run-2 audit finding `env.assertAppRoleUrl.denylist-vs-supabase_admin`:
 * the previous denylist of "superuser-looking" role names let `supabase_admin`
 * and the dotted pooler form `postgres.<project-ref>` through, both of which
 * bypass RLS silently. The allowlist closes both.
 *
 * Module-evaluation order matters: `env.ts` runs `parseServer()` as a side
 * effect of being imported, so the four required variables are assigned
 * BEFORE the module is loaded. A static `import` is hoisted above these
 * assignments by the CommonJS transform and would throw, so the module under
 * test is loaded with a dynamic `import()` in `beforeAll` instead.
 */

const ORIGINAL_ENV = {
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

// The test fixture must be in place before the module under test is loaded,
// so it is assigned here (module scope) and restored in `afterAll` below so
// it never leaks into later suites in the same Jest worker.
process.env.DATABASE_URL =
  "postgresql://systemfact_app:unit-test@localhost:5432/systemfact_test";
process.env.DIRECT_URL =
  "postgresql://postgres:unit-test@localhost:5432/systemfact_test";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "unit-test-key";

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

import type * as EnvModule from "@/lib/env";

let assertAppRoleUrl: typeof EnvModule.assertAppRoleUrl;
let isAppRoleUsername: typeof EnvModule.isAppRoleUsername;

beforeAll(async () => {
  ({ assertAppRoleUrl, isAppRoleUsername } = await import("@/lib/env"));
});

describe("isAppRoleUsername", () => {
  it("accepts the plain application role", () => {
    expect(isAppRoleUsername("systemfact_app")).toBe(true);
  });

  it("accepts the dotted transaction-pooler form", () => {
    expect(isAppRoleUsername("systemfact_app.abcdefghijkl")).toBe(true);
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    expect(isAppRoleUsername("SystemFact_App")).toBe(true);
    expect(isAppRoleUsername("  systemfact_app.abcdefghijkl  ")).toBe(true);
  });

  it("rejects the dedicated-role prefix with an empty project ref", () => {
    expect(isAppRoleUsername("systemfact_app.")).toBe(false);
  });

  it("rejects the privileged Supabase role the old denylist missed", () => {
    expect(isAppRoleUsername("supabase_admin")).toBe(false);
  });

  it.each([
    "postgres",
    "postgresql",
    "root",
    "admin",
    "dbo",
    "sa",
    "supabase_admin",
  ])("rejects the RLS-bypassing role %s", (role) => {
    expect(isAppRoleUsername(role)).toBe(false);
  });

  it("rejects the dotted pooler form of every privileged role", () => {
    expect(isAppRoleUsername("postgres.abcdefghijkl")).toBe(false);
    expect(isAppRoleUsername("supabase_admin.abcdefghijkl")).toBe(false);
  });

  it("rejects role names that merely embed the application role", () => {
    expect(isAppRoleUsername("xsystemfact_app")).toBe(false);
    expect(isAppRoleUsername("systemfact_app2")).toBe(false);
  });
});

describe("assertAppRoleUrl", () => {
  const LABEL = "DATABASE_URL";

  it("accepts DATABASE_URL pointing at the application role", () => {
    expect(() =>
      assertAppRoleUrl(
        "postgresql://systemfact_app:<ephemeral>@host:5432/systemfact",
        LABEL,
      ),
    ).not.toThrow();
  });

  it("accepts the dotted pooler form of the application role", () => {
    expect(() =>
      assertAppRoleUrl(
        "postgresql://systemfact_app.abcdefghijkl:pw@pooler.supabase.com:5432/postgres",
        LABEL,
      ),
    ).not.toThrow();
  });

  it("rejects supabase_admin, which the previous denylist missed", () => {
    expect(() =>
      assertAppRoleUrl("postgresql://supabase_admin:pw@host/postgres", LABEL),
    ).toThrow(/bypasses RLS policies/);
  });

  it("rejects the dotted pooler form of a privileged role", () => {
    expect(() =>
      assertAppRoleUrl(
        "postgresql://postgres.abcdefghijkl:pw@pooler.supabase.com:5432/postgres",
        LABEL,
      ),
    ).toThrow(/bypasses RLS policies/);
  });

  it("names the required role in the failure message", () => {
    expect(() =>
      assertAppRoleUrl("postgresql://supabase_admin:pw@host/postgres", LABEL),
    ).toThrow(/systemfact_app/);
  });

  it("still rejects a non-postgres scheme and a malformed URL", () => {
    expect(() => assertAppRoleUrl("mysql://systemfact_app:pw@host/db", LABEL)).toThrow(
      /postgresql:\/\/ or postgres:\/\//,
    );
    expect(() => assertAppRoleUrl("not-a-url", LABEL)).toThrow(/is not a valid URL/);
  });
});
