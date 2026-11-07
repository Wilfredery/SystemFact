/**
 * Cookie option hardening shared by the two Supabase `setAll` paths
 * (`client.ts` and `proxy.ts`). Pure: no Next.js or Supabase imports.
 *
 * @supabase/ssr and Next never set `Secure` on their own, so the auth cookies
 * reached production without it (found by the prod smoke, docs/22 T6). It is
 * set only when the request is HTTPS: forcing it over plain http would make
 * the browser drop the cookie on localhost and in the E2E stack.
 */
type CookieFlags = {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none";
  secure?: boolean;
};

export function withSecureOnHttps<T extends CookieFlags>(
  options: T,
  forwardedProto: string | null | undefined,
): T & CookieFlags {
  const firstProto = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (firstProto === "https") return { ...options, secure: true };
  return { ...options };
}
