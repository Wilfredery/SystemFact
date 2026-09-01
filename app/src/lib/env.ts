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
