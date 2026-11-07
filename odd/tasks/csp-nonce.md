# csp-nonce — docs/22 T1 stage 2 (inventory)

Objective: take the app from "5 static security headers" to a **nonce-based Content-Security-Policy**,
report-only first, then enforce. This file is the inventory and the trap list; specs and tasks land
here when the work is actually taken up.

Status: **specs recorded 2026-11-07, implementation in progress (report-only first).** Inventory prepared 2026-11-05 so the implementation starts from
facts instead of guesses.

## What exists today

`app/next.config.ts` → `headers()` returns one rule (`source: "/(.*)"`) with 5 static headers:

| header | value |
|---|---|
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` |

**There is no CSP at all today** — not even report-only. `app/proxy.ts` (the old `middleware.ts`) runs
the auth gate and does not set security headers.

## Static inventory (grepped, 2026-11-05)

| CSP concern | finding | consequence |
|---|---|---|
| Third-party **scripts** | none. No `next/script`, no `<Script>`, no `dangerouslySetInnerHTML` anywhere in `src/` | `script-src` has no external origin to allow; the only scripts are Next's own inline bootstrap |
| Third-party **origins** at runtime | none. Every external URL found in source is a comment (Prisma schema docs, issue links) | no `connect-src`/`img-src` allowances beyond our own API |
| **Fonts** | `next/font/google` — `Source_Sans_3` in `app/src/app/layout.tsx` | `next/font` **self-hosts** at build time, so **no** `fonts.googleapis.com` / `fonts.gstatic.com` at runtime → `font-src 'self'` |
| **Inline styles** | no `styled-jsx`, no `<style>` blocks, no React `style={{…}}` in `.tsx` | `style-src 'self'` *may* be possible; pending measurement (Next and `next/font` can inject style tags) |
| **Frames** | `X-Frame-Options: DENY`; no iframes | `frame-ancestors 'none'`, `frame-src 'none'` |
| **Forms** | the login form posts to a Server Action (same origin) | `form-action 'self'` |
| **Images** | no `images.remotePatterns`, no remote images | `img-src 'self' data:` |
| **Supabase** | `NEXT_PUBLIC_SUPABASE_URL` (`app/src/lib/env.ts`), used by the SSR client and `auth` calls | `connect-src 'self' <supabase-url>`; add `wss://` only if Realtime is used |

## The approach, and why it is not a one-liner

A nonce must be **per request**, so the CSP cannot live in `next.config.ts` `headers()` (static,
evaluated once per path). It has to be generated in `app/proxy.ts`, attached to the response header,
and **passed as a request header to the app** so Next can stamp its own inline scripts with it. Next
reads the nonce from the CSP header and applies it to the scripts it injects — that is the mechanism
the whole plan depends on.

Trap list, in order of how likely each is to waste a day:

1. **Two sources of headers.** The 5 static headers stay in `next.config.ts` while the CSP moves to
   `proxy.ts` — or all six move. Splitting them across two places invites drift; moving them means
   the CSP and the rest are in one place but the config file stops being the single inventory.
2. **`unsafe-inline` is silently useless next to a nonce.** Browsers ignore `'unsafe-inline'` when a
   nonce or hash is present — so a policy carrying both *looks* permissive and behaves strict. If the
   page still works, that tells you nothing about whether the nonce is doing the work.
3. **Dev vs prod diverge.** `next dev` needs `'unsafe-eval'` (and uses different inline scripts than
   `next start`). Tuning the policy against the dev server produces something that either breaks
   production or is looser than production needs. **Measure on `next start`.**
4. **Static optimization.** A per-request nonce forces affected routes to render dynamically; pages
   that were statically optimized can change behaviour or performance. Check which routes change
   rendering mode before enforcing.
5. **`next/font` style injection.** Self-hosted fonts are usually a `<link>` to `/_next/static/css`,
   but Next can also inline a small `<style>`; if it does, `style-src` needs the nonce too (or
   `'unsafe-inline'` for styles only, which is a weaker but common compromise).
6. **Report-only proves nothing on its own.** A report-only policy that no one reads is decoration.
   The stage-2 exit criterion must be "zero violations on the routes we exercise", not "header sent".
7. **`X-Frame-Options` alongside `frame-ancestors`.** Both are fine, but they must not contradict:
   modern browsers honour `frame-ancestors` and ignore the legacy header.

## Measurement plan (when the work is taken up)

1. `next build` + `next start` locally (never `next dev` for the policy).
2. Send `Content-Security-Policy-Report-Only` on responses **without changing source**: inject it at
   the browser layer and read the violations from the console.
3. Visit the routes a **non-authenticated visitor** can reach — the login page and the redirects.
   Authenticated routes cannot be covered here: the hosted E2E identities are banned (deliberate), so
   a local run has no session. **That gap must be closed by the E2E lane before enforcing**, or the
   policy ships unproven on the pages where the app actually lives.
4. Record the exact directives that triggered violations, then design the policy top-down from them —
   not from a template.

## Measurement (done 2026-11-05, `next build` + `next start -p 3100`, production mode)

**Reachable surface for an anonymous visitor is exactly ONE page.** `/` → 307 → `/login`, and
`/dashboard` → 307 → `/login`. So a local report-only run can only exercise `/login`; every other
route sits behind the auth gate and needs a session to be measured. That is the single biggest gap
in this inventory and the reason enforcement must wait for the E2E lane to cover authenticated pages
(the hosted E2E identities are banned by owner decision, so a new one is a prerequisite, not a
convenience).

What `/login` actually ships (11 KB document, `x-nextjs-prerender: 1`):

| what a CSP would police | measured |
|---|---|
| inline `<script>` blocks | **3**, all Next-generated: the Turbopack chunk-loader bootstrap, `self.__next_f` init, and the RSC flight payload. They need a **nonce**. |
| external script origins | **none** — every `<script src>` is `/_next/static/…` (same origin) |
| `<style>` tags | **0** |
| stylesheets | 1, same-origin `/_next/static/chunks/*.css` |
| inline event handlers (`on*=`) | **0** — no `'unsafe-hashes'` needed |
| absolute external URLs in the document | **none** — the document is entirely same-origin |
| response headers today | the 5 static ones; **no CSP of any kind** |

That means the policy can be written tight rather than copied from a template:

```
default-src 'self';
script-src 'self' 'nonce-<per-request>';
style-src  'self';              /* measured: no inline styles on /login */
img-src    'self' data:;
font-src   'self';              /* next/font self-hosts */
connect-src 'self' https://<project-ref>.supabase.co;   /* + wss:// only if Realtime is used */
frame-ancestors 'none';
frame-src  'none';
form-action 'self';
base-uri   'none';
object-src 'none';
```

**Caveat that must not be lost**: this was measured on a **statically prerendered** page. Dynamic
routes (`/dashboard`, `/venta`, `/reportes`, …) may inject styles or scripts at runtime that `/login`
never shows. `style-src 'self'` with no `'unsafe-inline'` is therefore a *hypothesis for the login
page*, not a decision — it must be re-measured on an authenticated page before enforce.

## Open decisions for the owner

- Where the six headers live (all in `proxy.ts` vs CSP alone there).
- Whether `style-src` may keep `'unsafe-inline'` (common, and much cheaper) or must be nonce-only.
- How long report-only runs before enforce, and which routes exercise it (needs the authenticated
  surface, i.e. an E2E identity — which the owner banned unless a new one is created).

---

## Specs (owner decisions, 2026-11-07 — quoted verbatim, do not paraphrase)

- **S1 (decision 1)** — owner answered "**1. yes**" to: "Where do the headers live? All six in `proxy.ts`, or only the CSP there and the other five where they are now. My recommendation is CSP alone in `proxy.ts`." → the CSP lives **alone** in `app/src/proxy.ts` (per-request nonce); the 5 static headers stay in `next.config.ts`, untouched.
- **S2 (decision 2)** — owner answered "**2. Go ahead.**" to: "Can styles keep `'unsafe-inline'`? ... I'd allow it for styles, since scripts are the real XSS risk." → `style-src 'self' 'unsafe-inline'`; **scripts are nonce-only**: no `'unsafe-inline'` and no `'unsafe-eval'` in `script-src` on a production build.
- **S3 (mode)** — "report-only first, then enforce": stage 2 ships **`Content-Security-Policy-Report-Only`** only. Nothing is blocked. Enforcing is a separate, later release (S5).
- **S4 (decision 3)** — owner chose "**Smoke check + a few days (recommended)**": "Ship report-only. The existing smoke Operador visits login and dashboard and fails on any CSP violation. After a few clean days I enforce in a second small release. No new account."
- **S5 (exit criterion, trap 6 of this file)** — "zero violations on the routes we exercise, not 'header sent'." Enforce only after the production smoke reports zero violations on `/login` and the authenticated dashboard for a few days.
- **S6 (do no harm)** — the 5 existing headers stay byte-identical, the auth gate behaviour in `proxy.ts` (307 to `/login`, deny-by-default) does not change, `connect-src` takes the Supabase origin from `NEXT_PUBLIC_SUPABASE_URL` (never hardcoded), and the local E2E suite and the production smoke stay green.

## Tasks

| ID | S# | Route | Status | Commit |
|----|----|-------|--------|--------|
| T1 pure policy builder + tests (nonce, directives, env-derived origin) | S2, S3, S6 | worker | pending | |
| T2 wire `proxy.ts`: nonce request header + report-only response header | S1, S3, S6 | worker | pending | |
| T3 smoke asserts zero CSP violations on `/login` + dashboard | S4, S5 | worker | pending | |
| T4 measure on `next build` + `next start`, record violations in this file | S5 | worker | pending | |
| T5 bump, PR, deploy approval, prod smoke | S4 | parent | pending | |
| T6 enforce (separate release, after clean days) | S5 | parent | not started | |

## Log

- L1 (2026-11-07): owner decisions, verbatim: "1. yes. 2. Go ahead. 3. wdym about the report only, i dont understand this." After the explanation of report-only mode (browser blocks nothing, only notes what would have been blocked), the owner picked "Smoke check + a few days (recommended)" for decision 3.
