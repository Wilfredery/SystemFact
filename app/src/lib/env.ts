import { z } from "zod";

/**
 * Validated runtime environment variables.
 *
 * Loaded once at module evaluation time. If any required variable is missing
 * or malformed, the app fails fast and explicitly instead of producing
 * cryptic Supabase/Prisma errors at runtime (19-directivas_desarrollo.md §13).
 *
 * - Server-only: never import this from a Client Component (it would inline
 *   the secret-bearing URL into the client bundle). Import from
 *   `lib/supabase/*` (server) and `lib/prisma.ts` (server) only.
 * - `NEXT_PUBLIC_*` are inlined by Next.js into the client bundle; they are
 *   NOT secrets and are safe to expose in `env.ts`.
 */

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
});

/**
 * Roles whose connection string MUST NOT be used as DATABASE_URL because they
 * bypass RLS policies (either via SUPERUSER, BYPASSRLS, or owning the tables).
 * Only `DIRECT_URL` (used by `prisma migrate`) is allowed to use these.
 *
 * If you find yourself wanting to set DATABASE_URL to one of these to debug
 * something, do it via a separate shell variable and a one-off script —
 * never via `.env` committed to the repo.
 */
const SUPERUSER_LIKE_ROLES = new Set([
  "postgres",
  "postgresql",
  "root",
  "admin",
  "dbo",
  "sa",
]);

function assertAppRoleUrl(url: string, label: string): void {
  // Parse defensively — a malformed URL should fail with a clear error,
  // not silently pass through to the driver adapter.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `${label} is not a valid URL. Check your .env file against .env.example.`,
    );
  }
  // Postgres URLs can use `postgresql://` or `postgres://`. Both parse the same.
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(
      `${label} must use the postgresql:// or postgres:// scheme (got "${parsed.protocol}").`,
    );
  }
  const username = decodeURIComponent(parsed.username).toLowerCase();
  if (SUPERUSER_LIKE_ROLES.has(username)) {
    throw new Error(
      `${label} uses role "${username}" which bypasses RLS policies. ` +
        `Use the dedicated application role (e.g. systemfact_app) so that ` +
        `multi-tenancy isolation is enforced at the database level. ` +
        `For migrations, use DIRECT_URL with the privileged role.`,
    );
  }
}

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

function parseServer() {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid server environment variables:\n${issues}\n` +
        `Check your .env file against .env.example.`,
    );
  }
  // Defense in depth (ADR-019): DATABASE_URL must use a non-superuser role
  // so that RLS policies are enforced. DIRECT_URL is allowed to use the
  // privileged role because it's only used by `prisma migrate`.
  assertAppRoleUrl(parsed.data.DATABASE_URL, "DATABASE_URL");
  return parsed.data;
}

function parsePublic() {
  // The browser bundle only sees NEXT_PUBLIC_* vars; validate those alone.
  const browserEnv = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  const parsed = publicSchema.safeParse(browserEnv);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid public environment variables:\n${issues}\n` +
        `Check your .env file against .env.example.`,
    );
  }
  return parsed.data;
}

/** Server-side env (Server Components, Server Actions, middleware, Node runtime). */
export const serverEnv = parseServer();

/** Client-side env (browser bundle). */
export const publicEnv = parsePublic();
