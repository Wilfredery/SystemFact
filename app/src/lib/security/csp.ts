/**
 * Content-Security-Policy for the proxy (docs/22 T1 stage 2, odd/tasks/csp-nonce.md).
 *
 * Pure and Edge-safe: it runs inside `src/proxy.ts`, so it uses Web Crypto and
 * `btoa` only — no Node imports.
 *
 * The proxy sends this as the ENFORCING `Content-Security-Policy` (S7). Scripts are
 * nonce-only (S2): no `'unsafe-inline'`, and `'unsafe-eval'` is never emitted.
 * (zod's `new Function` probe is silenced by `src/lib/zod.ts`, never by loosening
 * this policy.) `'strict-dynamic'` follows the Next.js CSP guide, which pairs it with
 * the nonce so the scripts Next loads from its own bootstrap are trusted.
 * Styles keep `'unsafe-inline'` by owner decision (S2).
 *
 * Reporting (S1): the enforced policy posts violations to our own endpoint via
 * `report-uri`. `report-uri` is deprecated in the CSP3 draft but is the only
 * reporting mechanism EVERY browser in the field implements, and reporting is an
 * observability signal, not a control: it must never be the reason a page breaks.
 * A modern `report-to` group is deliberately NOT emitted: it only fires once the
 * browser has cached a `Reporting-Endpoints` header for the origin, so a policy
 * that names a group the response headers do not advertise silently reports
 * nothing. Half-wiring it is worse than not wiring it.
 *
 * Reporting is not a relaxed directive: `report-uri` grants the page no extra
 * capability (S4).
 */

const NONCE_BYTES = 16;

/**
 * Where the browser posts CSP violations. Same origin, reachable pre-auth (violations fire
 * on `/login` too, the page that matters most), and it writes nothing to the database.
 */
export const CSP_REPORT_PATH = "/api/security/csp-report";

/** Fresh, unguessable nonce: 16 random bytes, base64 (what Next parses from the CSP). */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return btoa(String.fromCharCode(...bytes));
}

function supabaseOrigin(supabaseUrl: string): string {
  try {
    return new URL(supabaseUrl).origin;
  } catch {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not a valid URL: cannot derive the CSP connect-src origin.",
    );
  }
}

export function buildContentSecurityPolicy(params: {
  nonce: string;
  supabaseUrl: string;
}): string {
  const { nonce, supabaseUrl } = params;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${supabaseOrigin(supabaseUrl)}`,
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}
