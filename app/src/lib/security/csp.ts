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
 */

const NONCE_BYTES = 16;

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
  ].join("; ");
}
