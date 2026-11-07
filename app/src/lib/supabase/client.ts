import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";

/**
 * Supabase client for Server Components and Server Actions.
 *
 * Reads the auth cookies via `next/headers` and exposes a typed client.
 * This is shared infrastructure utility (exception to the module layout —
 * see AGENTS.md / auth module docs).
 *
 * Cookie flags: the auth cookies keep the @supabase/ssr defaults on purpose
 * (`httpOnly: false`, `sameSite: "lax"`, `path: "/"`, no explicit `secure`;
 * whether `Secure` reaches production is verified, never assumed — docs/22
 * T6). Do NOT force
 * `httpOnly: true` here or in `proxy.ts`: that is a session-lifecycle change,
 * not a one-line hardening, and it must be tested against refresh before it
 * ships. There is also deliberately no browser-side Supabase client in this
 * app (pinned by `tools/config/supabase-session-model.test.ts`): only the proxy
 * refreshes the session, which is what makes the inactivity timeout mean what
 * it says. See docs/22 T6.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          // @supabase/ssr 0.5+ accepts the typed shape directly.
          // The previous parseCookieHeader(cookieStore.toString()) round-trip
          // dropped cookies with `=` in their value (base64 JWTs).
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component: cookies() is read-only there.
            // The proxy refreshes the session on navigation, so this
            // is safe to ignore.
          }
        },
      },
    },
  );
}
