import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";

/**
 * Supabase client for the Next.js proxy (`app/proxy.ts`).
 *
 * Refreshes the session by setting new cookies on the outgoing response when
 * the access token is close to expiring (official @supabase/ssr pattern).
 *
 * Named after the Next 16 file convention: `middleware.ts` is deprecated in
 * favor of `proxy.ts` (see `app/node_modules/next/dist/docs/01-app/03-api-
 * reference/03-file-conventions/proxy.md`), and the export it feeds is `proxy`.
 */
export function createProxyClient(
  request: NextRequest,
  response: NextResponse,
) {
  return createServerClient(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.cookies.toString());
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
          // Set headers (Cache-Control, Expires, Pragma) that must accompany
          // auth cookies so no CDN/reverse-proxy caches the response.
          Object.entries(headers).forEach(([key, value]) => {
            response.headers.set(key, value);
          });
        },
      },
    },
  );
}
