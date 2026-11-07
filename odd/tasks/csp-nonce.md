# csp-nonce — docs/22 T1 stage 2 (inventory)

Objective: take the app from "5 static security headers" to a **nonce-based Content-Security-Policy**,
report-only first, then enforce. This file is the inventory and the trap list; specs and tasks land
here when the work is actually taken up.

Status: **report-only SHIPPED 2026-11-07 (v0.19.4, production smoke 6 passed / 0 failed / 0 skipped); enforcing implemented and proven locally on this branch (0.19.5, Measurements 6 and 7); PR, CI, owner-approved manual deploy and production smoke (T6d) pending.** Inventory prepared 2026-11-05 so the implementation starts from
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

- **S7 (decision 4, owner 2026-11-07)** — verbatim: "So its a good idea if u active the CSP, check it through local first and if everythings correct process to the production." → enforce the CSP, but only after the logged-in pages are measured clean locally (Docker/local Supabase), then production through the normal flow (PR, CI, owner-approved manual deploy, smoke). Rollback is one word: `Content-Security-Policy` back to `Content-Security-Policy-Report-Only`.

## Tasks

| ID | S# | Route | Status | Commit |
|----|----|-------|--------|--------|
| T1 pure policy builder + tests (nonce, directives, env-derived origin) | S2, S3, S6 | worker | done | d59c2d9 |
| T2 wire `proxy.ts`: nonce request header + report-only response header | S1, S3, S6 | worker | done | 95a04e8 |
| T3 smoke asserts zero CSP violations on `/login` + dashboard | S4, S5 | worker | done (not run against production: no PROD_USER/PROD_PASSWORD) | 611eec9 |
| T4 measure on `next build` + `next start`, record violations in this file | S5 | worker | done, found a blocker (T4b) | this commit |
| T4b make `/login` render dynamically so Next stamps the nonce on its inline scripts (trap 4) | S3, S5 | worker | done (owner: include in 0.19.4); see Measurement 3 | the `fix(login)` commit of this branch |
| T5 bump, PR, deploy approval, prod smoke | S4 | parent | done: PR #178 (squash `efe9346`), owner-approved manual deploy, prod smoke run 42405218222 = 6 passed, 0 CSP violations on `/login` and login -> dashboard | `efe9346` |
| T6a local E2E guard: log in with the seeded local users and visit the authenticated pages (dashboard, venta, cobros, reportes, ...) failing on any CSP violation | S7, S5 | worker | done (`app/e2e/csp-authenticated.spec.ts`); RED seen on `next dev` and red on the production build until F1 (Measurement 4) | 8e51ef5 |
| T6b run it under report-only against the local Supabase stack; fix the policy only from measured violations | S7, S5 | worker | done: found 3 violations (zod eval probe, Measurement 4); no policy fix possible (S2), so F1 below; clean after it (Measurement 6) | 5de5a21 (F1) |
| F1 `src/lib/zod.ts` wrapper (`z.config({ jitless: true })`), the 14 imports switched, guard test `tools/config/zod-wrapper.test.ts` + unit test `src/lib/zod.test.ts` | S2, S6, S7 | worker (parent decision) | done, RED then GREEN | 5de5a21 |
| T6c flip to enforcing `Content-Security-Policy` in `proxy.ts` and the tests; full local E2E suite must stay green under enforcement | S7 | worker | done: 19 passed, 0 skipped (Measurement 7) | d455d69 |
| T6d PR, native review, CI, owner-approved manual deploy, prod smoke | S7 | parent | pending | |

## Measurement 2 (report-only wired) — 2026-11-07

Setup: `pnpm build` then `pnpm exec next start -p 3100` (Next 16.4.5, Turbopack, production mode), env from the
developer `.env.local` (hosted Supabase project; nothing printed, nothing written). Authenticated routes were NOT
measured: Docker is not running, so there is no local session. **That gap stands**; the production smoke (T3) covers
the dashboard after the deploy.

What the bundled Next 16 CSP guide says, and what the code follows: the proxy sets `x-nonce` and the CSP on the
REQUEST headers; Next parses the nonce from the request CSP (it accepts `content-security-policy-report-only` too, see
`next/dist/server/app-render/get-script-nonce-from-header.js`) and stamps its inline scripts during server-side
rendering; the guide recommends `'strict-dynamic'` next to the nonce (so the policy carries it), and says plainly that
**a nonce only works on dynamically rendered pages**.

Exact header measured on `GET /login` (the nonce changes on every request):

```
content-security-policy-report-only: default-src 'self'; script-src 'self' 'nonce-xhCtcVoub0zfEXx4A8ewMQ==' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://tcyxwkcrmontkrtbyxfm.supabase.co; frame-ancestors 'none'; frame-src 'none'; form-action 'self'; base-uri 'none'; object-src 'none'
```

| check | measured |
|---|---|
| the 5 static headers on `/login` | present and unchanged |
| `content-security-policy` (enforcing) | absent — report-only only |
| header on the auth-gate redirects (`/`, `/dashboard` → 307 `/login`) | present, `location: /login` unchanged |
| nonce differs between requests | yes (header level) |
| inline `<script>` blocks in the `/login` HTML | 3 (same as Measurement 1) |
| inline scripts carrying `nonce="…"` | **0 of 3** |
| `x-nextjs-prerender` / `x-nextjs-cache` / `cache-control` on `/login` | `1` / `HIT` / `s-maxage=31536000` — **still statically prerendered** |
| `next build` route table | `/login` and `/` are `○ (Static)`; every other route is already `ƒ (Dynamic)` |
| Chromium `securitypolicyviolation` events on `/login` (`next start`, headless) | **13**, all `script-src-elem`, disposition `report`: 10 same-origin `/_next/static/chunks/*.js` loads (9 distinct files, one loaded twice) + 3 `inline` scripts |
| violations of any other directive | 0 (no style, img, font, connect, frame or form violation) |
| `e2e/security-headers.spec.ts` against that server | 7/7 passed (4 existing + 3 new) |
| `e2e-prod/public-smoke.spec.ts` pointed at that local server (`PROD_BASE_URL=http://localhost:3100`) | 3 passed; **the new CSP check failed with 13 violations** (directives and hosts listed, no URLs) — the gate works |

**Finding (trap 4 confirmed, blocks enforce): the nonce never reaches the page.** `/login` is prerendered at build
time, so Next cannot stamp the nonce on its scripts: the header carries a fresh nonce, the inline scripts carry none.
Because the policy has `'strict-dynamic'`, the same-origin chunk loads are reported too (`'self'` is ignored when
`'strict-dynamic'` is present, and the chunks are only trusted through a nonced bootstrap). Enforcing today would
break the login page entirely. The fix is to render `/login` dynamically (the guide's way: `await connection()` from
`next/server` in the page, or an equivalent dynamic opt-in). That edit lives in `app/src/app/login/`, outside the
surface this task was allowed to touch, so it is recorded as T4b and NOT done here. Expected cost, per the guide:
`/login` loses its static `s-maxage` cache and renders per request. After T4b, re-run this measurement; the expected
result is 3/3 nonced inline scripts and 0 violations.

The production smoke will report the same violations on `/login` until T4b ships. That is correct: S5 says "zero
violations on the routes we exercise, not 'header sent'".

## Measurement 3 (login dynamic) — 2026-11-07

Change (T4b): `app/src/app/login/layout.tsx` is now an async server component that does `await connection()` from
`next/server`, the guide's own way to opt a route into per-request rendering. The login page, its Server Action, the
form and the auth gate are untouched (the page is a client component and cannot await; the layout is the server
boundary above it). Same method as Measurement 2: `pnpm exec next build`, `next start -p 3100`, env from `.env.local`.

| check | Measurement 2 (before) | Measurement 3 (after) |
|---|---|---|
| `next build` route table, `/login` | `○ (Static)` | `ƒ (Dynamic)` |
| `x-nextjs-prerender` / `x-nextjs-cache` on `/login` | `1` / `HIT` | both absent |
| `cache-control` on `/login` | `s-maxage=31536000` | `private, no-cache, no-store, max-age=0, must-revalidate` |
| inline `<script>` blocks | 3 | 3 |
| inline scripts carrying the nonce | **0 of 3** | **3 of 3**, equal to the nonce in that response's header |
| Chromium `securitypolicyviolation` events on `/login` | 13 | **0** |
| `e2e/security-headers.spec.ts` against the local server | 7/7 | 8/8 (new guard: not prerendered, not cached, every inline script has the request's nonce) |
| `e2e-prod/public-smoke.spec.ts` against the local server | CSP check failed (13) | 4/4 passed, CSP check green |

Guard test: RED observed first against the previous build (`x-nextjs-prerender` received `"1, 1"`), GREEN after the
layout change. It is an e2e assertion because the prerender header only exists on a built server.

Trade-off (per the guide, accepted by the owner): `/login` no longer has a static, cacheable response. It renders on
every request and answers with `no-store`, so it costs one server render per visit. The page is small and the app has
no CDN caching to lose; `/` stays static only because the proxy redirects it before it renders.

Still NOT measured, same gap as before: authenticated routes (no local session; Docker off). They were already dynamic
(`ƒ`), so Next stamps their nonce, but only the production smoke (login → dashboard) can prove zero violations there.

## Measurement 4 (authenticated pages, report-only) — 2026-11-07

Setup: local Supabase stack (containers `supabase_*_SystemFact`, DB on `127.0.0.1:54322`), env from the gitignored
`app/.env.e2e.stack` (nothing printed), `pnpm exec next build` + `pnpm exec next start -p 3000` (production mode,
Next 16.4.5; never `next dev`), policy = the shipped report-only one (`connect-src 'self' http://127.0.0.1:54321`
locally). Spec: `app/e2e/csp-authenticated.spec.ts` (commit 8e51ef5). It logs in as the seeded `e2e-automation`
admin (Administrador, single branch "Principal"; the local seed has **no** Operador, so none was measured) and
visits every `page.tsx` under `src/app/(app)/**`, derived from the filesystem. Dynamic segments use seeded ids
(read-only SELECT): cliente 1 and receipt correlativo 1 exist, so those pages render their real UI. Navigation only:
no sale, payment or void.

Pages visited (8): `/auditoria`, `/cobros/cxc-board`, `/cobros/estado-cuenta/1`, `/cobros/recibo/1`, `/dashboard`,
`/reportes`, `/selector-empresa-sucursal`, `/venta`. `/login` is visited by the login step itself (0 violations).
Not page routes, not visited: `/reportes/exportar`, `/reportes/exportar-txt` (route handlers, they download files).

RED: the same spec against `next dev` (the playwright default webServer) fails at the login with a long list of
`script-src (blocked: eval, source: localhost:3000)`: dev needs `'unsafe-eval'`, which is trap 3. That proves the
guard fails on a violation and that it must be measured on the production build.

Violations on the production build, report-only (3, one root cause):

| page | directive | blocked | source host |
|---|---|---|---|
| `/cobros/cxc-board` | `script-src` | `eval` | `localhost:3000` (own origin) |
| `/cobros/estado-cuenta/1` | `script-src` | `eval` | `localhost:3000` |
| `/venta` | `script-src` | `eval` | `localhost:3000` |

The other five pages and the login: 0 violations. No `style-src`, `img-src`, `font-src`, `connect-src`,
`frame-src`, `form-action` violation anywhere, and no inline-script violation (the nonce works on every page).

Root cause (diagnosed with a throwaway Playwright probe, deleted): the event comes from the same chunk on all three
pages, `/_next/static/chunks/392-*.js`, which bundles zod 4. Its `allowsEval` probe runs `new Function("")` inside a
`try/catch` to decide whether it may JIT-compile schemas. The throw is swallowed and zod falls back to its normal
path, so nothing breaks, but a strict CSP still **reports** the attempt as a `securitypolicyviolation`. Zod's own
source says so: "Skip the probe under `jitless`: strict CSPs report the caught `new Function` as a
`securitypolicyviolation` even though the throw is swallowed." (`node_modules/zod/v4/core/util.js`). Client
components of venta and cobros import the `http/validations.ts` schemas, which is why those three pages load it.

Why the POLICY cannot fix it narrowly: the only way to allow `new Function` is `'unsafe-eval'` in `script-src`, which
S2 forbids ("no `'unsafe-eval'` in `script-src` on a production build") and which would also weaken the XSS
protection the nonce gives. No scoped alternative exists (no hash or nonce can authorise `eval`). The narrow fix is
in the APP, outside the T6 surfaces: `z.config({ jitless: true })` (zod's documented switch, it skips the probe) in a
module that every client bundle loads. That is a code change, not a policy change, so it is **not done here and
needs the parent's decision**. T6c was NOT committed because T6b is not clean (S7).

## Measurement 5 (throwaway experiment under enforcement, NOT shipped) — 2026-11-07

To know whether the zod finding is cosmetic or breaks sales, `Content-Security-Policy-Report-Only` was temporarily
renamed to `Content-Security-Policy` in the working tree of `app/src/proxy.ts` only (no commit; reverted, `git diff`
on that file is empty), rebuilt, `next start -p 3000`, and the whole local E2E suite was run. Measured header on
`/login` (enforcing):

```
content-security-policy: default-src 'self'; script-src 'self' 'nonce-0FmI+inRmyw2CWR+6gm9Hg==' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' http://127.0.0.1:54321; frame-ancestors 'none'; frame-src 'none'; form-action 'self'; base-uri 'none'; object-src 'none'
```

Result: **14 passed, 5 failed, 0 skipped**. The sales flows all passed under enforcement: confirm-venta (2),
cobros (2), devolucion (1), selector-sucursal (3), auth-gate (2), the 4 static-header tests. The 5 failures: the
guard spec (the 3 zod `eval` violations above; under enforcement the page still renders, the probe is blocked and
caught) and the 4 `security-headers.spec.ts` assertions that name the report-only header (expected: T6c would update
them). Conclusion: the zod probe is cosmetic for behaviour (a console "Refused to
evaluate a string as JavaScript" and an event) but the spec stays red until zod stops probing or the owner accepts
`'unsafe-eval'`, which S2 rules out.

## Measurement 6 (authenticated pages after zod jitless) — 2026-11-07

Fix (F1, commit 5de5a21): `app/src/lib/zod.ts` imports `z`, calls `z.config({ jitless: true })` and re-exports zod; the 14
non-test modules that imported "zod" (`src/lib/env.ts`, `src/modules/auth/http/actions.login.ts` and 12
`http/validation(s).ts`) now import from `@/lib/zod`. `tools/config/zod-wrapper.test.ts` fails if any other file under
`src/` imports a runtime value from "zod" (`import type` is allowed). Zod only skips its speed shortcut: results are
identical, and `S2` stands (no `'unsafe-eval'` anywhere).

TDD: the guard test was RED first, listing all 14 files plus a missing wrapper; `src/lib/zod.test.ts` was RED
(`Cannot find module './zod'`); both GREEN after the wrapper and the import switch. The unit test spies on
`globalThis.Function` with a `Proxy`: parsing a `z.object` after importing the wrapper makes **0** `new Function`
calls; the same spy against a plain `import { z } from "zod"` counted **2** (checked in a throwaway test, so the spy
is reliable in this jest environment).

Same method as Measurement 4: `pnpm exec next build`, `next start -p 3000`, stack env from `app/.env.e2e.stack`, the
policy still **report-only** at this point (`content-security-policy-report-only` on `/login`).
`pnpm exec playwright test csp-authenticated`: **1 passed, 0 violations** on the same 8 pages (`/auditoria`,
`/cobros/cxc-board`, `/cobros/estado-cuenta/1`, `/cobros/recibo/1`, `/dashboard`, `/reportes`,
`/selector-empresa-sucursal`, `/venta`) plus the login step. Before: 3 (`script-src` blocked `eval`).

## Measurement 7 (enforcing) — 2026-11-07

Change (T6c, commit d455d69): `app/src/proxy.ts` sends `Content-Security-Policy` instead of
`Content-Security-Policy-Report-Only` on the request headers (so Next still reads the nonce), on the pass-through
response and on both redirects; `x-nonce` kept. `e2e/security-headers.spec.ts` now asserts the enforcing header
(nonce, no `'unsafe-eval'`, no `'unsafe-inline'` in `script-src`, per-request nonce, inline scripts carry the
request's nonce, the gate redirect carries it) and that **no** `content-security-policy-report-only` header remains;
`e2e-prod/public-smoke.spec.ts` gets the same pair of assertions (it fails against a deployment older than 0.19.5, by
design) and its comments, and `e2e-prod/csp-violations.ts`, `e2e/utils/csp-violations.ts`, `src/lib/security/csp.ts`
and `proxy.ts` comments are updated. RED: the new header assertions failed (4 of 4) against the report-only build
before the rebuild.

Exact header measured with `curl -I http://localhost:3000/login` on `next build` + `next start` (the nonce changes on
every request):

```
content-security-policy: default-src 'self'; script-src 'self' 'nonce-ax1cSGCl1C212FZxWqhtTA==' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' http://127.0.0.1:54321; frame-ancestors 'none'; frame-src 'none'; form-action 'self'; base-uri 'none'; object-src 'none'
```

`content-security-policy-report-only` on `/login`: **absent** (0 matches). `/dashboard` without a session: 307 to `/login`
with the enforcing header.

Full local E2E under enforcement, `pnpm exec playwright test --reporter=list,json` against that server:
**19 passed, 0 failed, 0 skipped**, and `node e2e/assert-no-skips.mjs` says "19 test(s) ejecutados, 0 salteados".
By spec: auth-gate 2, cobros 2 (double-click payment, estado de cuenta), confirm-venta 2 (cash and credit sale with the
whole DB chain), csp-authenticated 1 (8 pages, 0 violations), devolucion 1 (B04 return), security-headers 8,
selector-sucursal 3. Sales, collections and returns all work under the enforcing policy.
`e2e-prod/public-smoke.spec.ts` pointed at the same local server (`PROD_BASE_URL=http://localhost:3000`): 5 passed
(enforcing header present, report-only absent, `/login` loads with 0 violations in a real browser). The production
session smoke needs credentials and was not run.

Process note (honest): the first full run after the rebuild was INVALID. A stale `next start` still held port 3000
(the new one died with `EADDRINUSE`), so the suite ran against a half-swapped `.next` and the guard failed. It was
discarded; the numbers above come from a clean restart whose log shows `Ready` and whose `/login` header was curled
before the run.

## Log

- L1 (2026-11-07): owner decisions, verbatim: "1. yes. 2. Go ahead. 3. wdym about the report only, i dont understand this." After the explanation of report-only mode (browser blocks nothing, only notes what would have been blocked), the owner picked "Smoke check + a few days (recommended)" for decision 3.
- L2 (2026-11-07): **shipped and proven in production.** Owner chose "Merge, deploy, run smoke (recommended)" for PR #178. Merged as `efe9346`, deployed by hand (`vercel deploy --prod`), then the production smoke (run 42405218222) reported **6 passed / 0 failed / 0 skipped**: `/login` loads in a real browser with **zero CSP violations**, the logged-in Operador journey login -> dashboard also reports none (the session smoke watches `securitypolicyviolation` from before the login), and the `sb-*` cookie flags from 0.19.3 still hold. The live `/login` carries `content-security-policy-report-only` with a per-request nonce, the five static headers unchanged, `cache-control: private, no-cache, no-store` (dynamic). Native review of the branch: approved, 5 non-blocking advisories (no reporting endpoint: real-user violations are not collected, only the smoke sees them; a throw in the builder would fail every request, mitigated by startup env validation; one redirect branch covered only by e2e; two test-hygiene suggestions). **Next (T6, separate release):** enforce after a few clean days, S5. Pages the smoke does not visit (venta, cobros, reportes, ...) are NOT proven violation-free yet: widen the smoke's journey, or browse them with the console open on the report-only build, before flipping to enforce.
- L3 (2026-11-07): owner, verbatim: "So its a good idea if u active the CSP, check it through local first and if everythings correct process to the production. As i see, we're doing a great job focus and have an aggresive security to get the less bugs and vulnerabilities possible ... the most important part for me its to have an solid system for sales to ppl." Docker was opened by the owner (local Supabase containers running). Sales must keep working under enforcement: T6c's full local E2E, which includes the sales flows, is the gate. This is spec S7.
- L4 (2026-11-07): T6 worker run. Spec `app/e2e/csp-authenticated.spec.ts` (8e51ef5) visits the 8 authenticated pages under report-only on the local stack: **3 violations, one root cause** (zod 4's `new Function("")` probe, `script-src` blocked `eval`, on `/cobros/cxc-board`, `/cobros/estado-cuenta/[clienteId]` and `/venta`). The policy cannot absorb it without `'unsafe-eval'` (forbidden by S2), so T6b is NOT clean and T6c was **not committed**. A throwaway enforcing build passed every sales, cobros, devolucion and selector flow (Measurement 5), so the finding is cosmetic for behaviour, but the guard stays red. Decision needed: `z.config({ jitless: true })` in the app (outside the T6 surfaces). No release bump: nothing in `app/src` changed.
- L5 (2026-11-07): parent decision on the L4 blocker: apply the narrow app-side fix and continue. F1 (5de5a21): `src/lib/zod.ts` runs zod with `jitless`, the 14 imports go through it, two guard tests. Measurement 6: 0 violations on all 8 authenticated pages under report-only. T6c (d455d69): `proxy.ts` now sends the enforcing `Content-Security-Policy` (request, response, both redirects), tests and comments updated, no report-only header remains. Measurement 7: full local E2E 19 passed / 0 skipped under enforcement, `/login` curled with the enforcing header and no report-only one. Release 0.19.5 prepared; **T6d (PR, native review, CI, owner-approved manual deploy, production smoke) is the parent's and still pending.** Rollback stays one word in `proxy.ts`: `CSP_HEADER` back to `"Content-Security-Policy-Report-Only"`. Residual gaps: no local Operador exists (only the single-branch admin was measured), and with enforcement the real users' blocked resources are only visible in the browser console (there is still no reporting endpoint, L2 advisory 1).
