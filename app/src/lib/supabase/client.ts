import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";

/**
 * Supabase client for Server Components and Server Actions.
 *
 * Reads the auth cookies via `next/headers` and exposes a typed client.
 * This is shared infrastructure utility (exception to the module layout —
 * see AGENTS.md / auth module docs).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(cookieStore.toString());
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component: cookies() is read-only there.
            // The middleware refreshes the session on navigation, so this
            // is safe to ignore.
          }
        },
      },
    },
  );
}
