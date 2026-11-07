import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { buildContentSecurityPolicy, generateNonce } from "@/lib/security/csp";
import { createProxyClient } from "@/lib/supabase/proxy";

/**
 * Public routes that do NOT require authentication.
 * Everything else is protected by default.
 */
const PUBLIC_PATHS = ["/login"];

const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Report-only CSP (docs/22 T1 stage 2): a fresh nonce per request. Next reads
  // the nonce from the CSP header of the REQUEST (report-only is accepted) and
  // stamps its own inline scripts; `x-nonce` is the guide's way to read it in
  // Server Components. Nothing is blocked: the browser only reports.
  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: serverEnv.NEXT_PUBLIC_SUPABASE_URL,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(CSP_REPORT_ONLY_HEADER, csp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set(CSP_REPORT_ONLY_HEADER, csp);

  const supabase = createProxyClient(request, response);

  // Refresh the session before any protected route handler runs.
  // Also triggers Set-Cookie refresh on the response if the token is stale.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = isPublicPath(pathname);

  // Authenticated user visiting a public (login) route -> go to dashboard.
  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    redirect.headers.set(CSP_REPORT_ONLY_HEADER, csp);
    return redirect;
  }

  // Unauthenticated user visiting a protected route -> go to login.
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    redirect.headers.set(CSP_REPORT_ONLY_HEADER, csp);
    return redirect;
  }

  return response;
}

export const config = {
  // Match all paths except Next.js internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
