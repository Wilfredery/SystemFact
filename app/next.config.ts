import type { NextConfig } from "next";

/**
 * Baseline security response headers (docs/22 §T1 stage 1).
 *
 * Applied to every route from the config layer, so they are present even on
 * responses that never reach a route handler (redirects from the auth gate,
 * 404s, static assets). Pinned by `tools/config/next-config.test.ts`.
 *
 * Deliberately NOT here yet: `Content-Security-Policy`. A nonce CSP forces
 * dynamic rendering on every route and breaks Server Actions/login when it is
 * naive, so it ships as T1 stage 2 in `app/proxy.ts` after a Report-Only pass.
 */
const securityHeaders: { key: string; value: string }[] = [
  // Meaningful only over HTTPS (production/preview); browsers ignore it on
  // http://, which is why the local dev server can serve the same policy.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
