import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";

/**
 * Supabase client for Next.js middleware.
 *
 * Refreshes the session by setting new cookies on the outgoing response when
 * the access token is close to expiring (official @supabase/ssr pattern).
 */
export function createMiddlewareClient(
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
