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
 * The ONLY role allowed as the `DATABASE_URL` username: a plain application
 * role with no SUPERUSER/BYPASSRLS attribute and no ownership of the tables,
 * so RLS policies are actually enforced. Created by migration
 * `20260902150000_create_app_role`.
 *
 * `DIRECT_URL` (used by `prisma migrate`) is deliberately exempt — it must
 * connect with a privileged role.
 */
const APP_ROLE = "systemfact_app";

/**
 * The Supabase transaction-pooler username is the application role plus the
 * project ref as a suffix: `systemfact_app.<project-ref>`.
 */
const APP_ROLE_POOLER_PREFIX = `${APP_ROLE}.`;

/**
 * True when `username` is the dedicated application role, in either accepted
 * form: `systemfact_app` or the dotted pooler form `systemfact_app.<project-ref>`
 * (any non-empty suffix). Comparison is case-insensitive after trimming.
 *
 * This is an ALLOWLIST on purpose. A denylist of "superuser-looking" names
 * cannot be exhaustive: it misses privileged roles this project never named
 * (`supabase_admin`) and every dotted pooler variant of them
 * (`postgres.<project-ref>`, `supabase_admin.<project-ref>`), all of which
 * silently bypass RLS. Deny-by-default is the only rule that stays closed as
 * the platform adds roles.
 */
export function isAppRoleUsername(username: string): boolean {
  const name = username.trim().toLowerCase();
  if (name === APP_ROLE) return true;
  if (!name.startsWith(APP_ROLE_POOLER_PREFIX)) return false;
  return name.length > APP_ROLE_POOLER_PREFIX.length;
}

/**
 * Enforce that `url` connects as the application role. Defense in depth
 * (ADR-019): a `DATABASE_URL` that points at a privileged role disables every
 * RLS policy in the database while still looking like a working configuration.
 */
export function assertAppRoleUrl(url: string, label: string): void {
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
  const username = decodeURIComponent(parsed.username).trim().toLowerCase();
  if (!isAppRoleUsername(username)) {
    throw new Error(
      `${label} must use the dedicated application role "${APP_ROLE}" so that ` +
        `multi-tenancy isolation is enforced at the database level, but it uses ` +
        `role "${username}", which bypasses RLS policies (SUPERUSER, BYPASSRLS or ` +
        `table owner). For migrations, use DIRECT_URL with the privileged role.`,
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
