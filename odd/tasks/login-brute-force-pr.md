## What this is

docs/22 **T3** — the app-side login brute-force throttle, exactly as decided (Option B: a
Postgres-backed counter keyed by `(ip, nombreUsuario)`, exponential delay, never a permanent
lockout). 21 commits, +1860/−18 across 21 files, version **0.19.0**.

`docs/` is gitignored by design, so the decision record for this slice lives in
**`odd/tasks/login-brute-force.md`** (specs S1–S7, 22 log entries) and in **ADR-020** on the
maintainer's disk; the committed traceability is the migration docblock plus that tracker.

## Why a throttle at all

Supabase's password rate limit is keyed on the IP of whoever calls it, and this app calls it
from a Server Action — so the provider sees the **server's** IP for every user. That limit
protects Supabase, hands a single attacker an app-wide lockout lever (one 429 bucket shared by
everybody) and cannot tell one attacker from one user. The pair is the smallest unit that can.

## What changed

- **`LOGIN_INTENTO`** (`20261105120000_login_intento_throttle`): non-tenant ops table, RLS on
  with a deny-all RESTRICTIVE policy (so `anon`/`authenticated` can reach neither rows nor
  PostgREST surface), `FORCE` deliberately not set — same posture as `_prisma_migrations`.
  Indexed on `(ip, nombreUsuarioNormalizado, creadoEn)` **and** on `creadoEn` alone, because
  the sweep's predicate constrains only that column.
- **`domain/login-throttle.ts`**: 15-minute sliding window, 5 attempts, exponential delay
  30 s → 15 min capped, **enforced by elapsed time** and reporting only the remaining wait.
  IPv4/IPv6-safe parsing; the counter key folds case and spacing while the ADR-014 row lookup
  stays byte-exact.
- **`application/verificar-throttle-login.ts`**: the storage port lives here (so the layer
  never imports Prisma), the attempt is written **before** the guess reaches the provider, the
  row id is returned independently of the sweep, and the check **fails open** — loudly, via
  stderr — because a broken counter must not become a login outage.
- **`infrastructure/login-attempt-repository.ts`**: newest-first read (so truncation can never
  hide the latest attempt), indexed sweep, undo by id. Has its own query-shape test suite.
- **`http/actions.login.ts`**: prefers the single-value `x-real-ip` header, records only a
  rejected **password**, undoes the row for an inactive/policy/unavailable refusal or a throw,
  and clears the pair on success.
- **`auth-service.ts`** `codigoDeRechazoDeAuth`: 429 / 5xx / transport failures → 
  `AUTH_AUTENTICACION_NO_DISPONIBLE`; `weak_password` → `AUTH_PASSWORD_POLICY`;
  `email_not_confirmed` → `AUTH_CREDENCIAL_NO_CONFIRMADA`; `user_banned` →
  `AUTH_USUARIO_INACTIVO`; everything else → the uniform credential rejection.

## Gates

**Verified locally on real Postgres 17.6** (`systemfact_test`, migrations applied by `prisma migrate deploy`):

- `prisma migrate deploy` applied both pending migrations without error — the hand-written SQL executes.
- Catalogs: one policy, `polpermissive = true`, `TO systemfact_app`, `USING (true)`; the role holds
  DELETE/INSERT/SELECT/UPDATE.
- `src/integration/login-throttle-rls.integration.test.ts` — **3/3**, driving the repository through
  the app role.
- Full integration suite — **54 suites / 248 tests** green.
- `pnpm rls:verify` — "all 27 tables have RLS enabled and a permissive policy for the app role",
  `systemfact_app` with `rolbypassrls=false`.
- **Negative controls** (reverted immediately): the old RESTRICTIVE policy makes the three
  integration tests fail, and makes `rls:verify` fail with
  `only RESTRICTIVE policies on: LOGIN_INTENTO`. Neither the test nor the guard is vacuous.

Unit gate on the final tip: `tsc` clean, ESLint 3 pre-existing warnings, **144 suites / 1379
tests**, `prisma validate` valid.

Test-first: RED was observed for the throttle wiring, the 429/transport/email mappings, the
elapsed-delay rule, the IPv6 rule, the repository query shape and the sweep/id separation.
It was **not** observed for the last three pins (`b1bc811`) — those are regression pins, not
reproduced-failure evidence, and the tracker says so.

## Verification found a BLOCKER after every local gate was green

Independent verification (declared `Risk: item 1` / `Risk: item 2`) found that the migration created
a **RESTRICTIVE** `USING (false)` policy as the table's only policy. Restrictive policies are ANDed
with every permissive one, so it denied `systemfact_app` as well — and the runtime really does
connect as `systemfact_app` (NOSUPERUSER, NOBYPASSRLS, not the owner). Reads returned zero rows,
inserts raised an RLS violation, the fail-open path swallowed it, and **the throttle never throttled
anything**, while `tsc`, lint, 1377 tests and `rls:verify` were all green. My own migration comment
asserted the opposite.

Fixed in `2135ee6` — permissive policy scoped to the app role, `verify-rls` now demands a
permissive policy per table, and an integration test drives the repository through the app role —
and re-verified as closed. `73c35f4` removes the underlying class: `AuthResult` now carries
`cuentaComoIntento`, decided where the provider's answer is known, instead of inferring "was this a
guess?" from a message code that several distinct refusals deliberately share.

## Review history — read this before approving

Five native review lineages ran on this branch and **twelve real defects were found, eleven
fixed**. Six of them were created by my own fixes, which is the honest headline:

1. counted attempts without comparing elapsed time → 15-minute block from five typos (BLOCKER)
2. check-then-insert left the provider round-trip as a race window
3. bare IPv6 truncated at the first colon → one bucket per hextet
4. per-attempt sweep deleted on an unindexed column → table scan per attempt
5. `take: 500` without `orderBy desc` could drop the **newest** rows → delay collapses
6. insert and sweep shared a `try` → a committed row's id was lost
7. transport failures and 5xx reported as bad credentials → an **outage** counted as a guess
8. the key took the **leftmost** `x-forwarded-for` hop → the attacker chose the bucket
9. last hop only correct with exactly one appending proxy → now prefers `x-real-ip`
10. `AUTH_CREDENCIALES_INVALIDAS` as catch-all → an unconfirmed account with the right password was throttled
11. a throw between the committed attempt and the verdict left a row counted forever
12. **open by decision — `R4-002`**: the decision and the counter write are two statements, so a
    concurrent burst can pass before any row commits. The atomic fix is a transaction with an
    advisory lock per pair (a port restructure), deliberately not rushed; the provider's
    per-IP bucket is the backstop meanwhile.

**Round 5's findings are unknown.** All four reviewers and the refuter ran, the refuter
confirmed severe candidate-caused findings, and then the review authority degraded to
`corrupted_or_unverifiable_authority`. Diagnosis afterwards: the authority store is valid
(`inspect-authority` → complete, 0 diagnostics), `repair --preflight` has nothing eligible, and
the cause is version skew — the Pi extension (gentle-pi 4.6.0) is ahead of the gentle-ai CLI
(4.3.1), so the targeted-validator slot could never be submitted. RDD is now disabled
clone-locally (`gentle-ai review mode disable --scope clone`), which is why this PR ships on CI
plus human review. **Treat the last commit as a review gap, not a clean bill.**

## Deployment

Merging is not shipping: this touches `app/src/**`, `app/prisma/**` and `app/package.json`, so it
needs a manual `vercel deploy --prod` and a `prod-smoke` run afterwards, with counts reported.

## Needs the owner

- **S1** of the spec is still open: the project's real rate-limit values must be read from
  `GET /v1/projects/{ref}/config/auth` with a personal access token ("read, not assumed"). No
  PAT exists on disk and the values are not readable from SQL.
- `R4-002` (above): advisory-lock atomicity, or accept with the provider bucket as backstop.
