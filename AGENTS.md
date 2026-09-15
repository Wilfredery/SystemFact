# AGENTS.md — SystemFact Engineering Standards

Coding standards and engineering rules for agents and reviewers working on the SystemFact codebase.
These rules derive from the canonical engineering constitution in the project documentation
(`docs/19-directivas_desarrollo.md`), which remains the full source of truth.

## Stack
- **Next.js 16** (App Router) fullstack monolith, **TypeScript** strict, **Tailwind CSS 4**, **pnpm**.
- **Supabase** (PostgreSQL + Auth). **Prisma ORM** as the only data access layer.
- Node LTS + pnpm declared in `package.json` (`engines`) + committed lockfile. No lockfile, no PR.

## Architecture (modular monolith — ADR-013)
- One deployment. Per-module structure is mandatory:
  ```
  src/modules/<domain>/
    domain/           # pure TS entities, business rules, fiscal calculations
    application/      # use cases, orchestration
    infrastructure/   # Prisma, repositories, external services
    http/             # Server Actions / API Routes — thin adapters
  ```
- `domain/` is PURE: no imports of Next.js, React, Prisma or Supabase. All fiscal math
  (ITBIS per product, NCF sequences, retentions, invoice state transitions) lives here as testable functions.
- Server Actions / API Routes are thin adapters: validate input, check authorization, delegate to a use case. Zero business logic.
- Data access ONLY via Prisma from `infrastructure/`. Never call `prisma.*` from `application/`, `http/`, or components.
- React: server components by default; `"use client"` only for real interactivity. UI consumes use cases, never the ORM.

## Security (non-negotiable)
- **Multi-tenancy ALWAYS**: every context-aware query filters by `empresaId` (+ `sucursalId` where applicable). A query without that filter is a critical bug. #1 risk is cross-tenant data leakage.
- **Server Actions MUST wrap DB access in `withTenantTransaction(ctx, fn)`**: the wrapper opens a Prisma transaction, sets the RLS GUCs (`app.current_empresa_id`, `app.current_sucursal_id`, `app.current_usuario_id`, `app.current_es_admin`) with `set_config(..., true)` as the first statement, and delegates to the callback. See `docs/19-directivas_desarrollo.md` §3.1 for the full convention. Enforced defense-in-depth by the project-local ESLint rule `systemfact/server-action-must-wrap-tenant` (wired in `app/eslint.config.mjs`, scoped to `src/**/actions.ts(x)`).
- **Server-side authorization on every action**: verify role + company + assigned branch on the server. Hiding UI buttons is NOT security.
- **Access identifier = `nombreUsuario`/unique code** (ADR-014): email is NEVER a credential. Supabase Auth uses internal synthetic emails (`<nombreUsuario>@users.systemfact.internal`), never exposed in UI.
- **Granular authorization** against the role/permission matrix; default is deny-by-default.
- **Audit log is append-only**: no UPDATE/DELETE on audit, ever.
- Secrets ONLY in `.env` (never hardcoded, never in repo). `.env.example` committed with all keys (no secrets).

## Data integrity
- **Money = Decimal**: amounts `Decimal(12,2)`, quantities `Decimal(12,3)` (ERD v4.7). Use `prisma.Decimal` in TS. **NEVER `number`/float for money.**
- **Inventory never edited directly**: every stock change produces a `MovimientoInventario` (sale, purchase, adjustment with reason, return). Inventory is PER BRANCH.
- **Insufficient stock blocks the sale** (no negatives). Stock is debited when CONFIRMING.
- **NCF**: consumed on document confirmation (not draft); independent sequences per type+company; warning at 90% of range; block when exhausted/expired.
- **Fiscal documents are NEVER deleted**: `Cancelada` (no fiscal effect, not in 607) vs `Anulada` (fiscal effect, reported in 608).
- **Balances/payment state are DERIVED**: always computed from the single canonical query over valid documents
  (total − Σreceipts − Σcredit notes + Σdebit notes). NEVER materialized or cached (ADR-017).
- **Discount = structured data** (`descuentoTipo` PORCENTAJE/MONTO + `descuentoAutorizadoPor`) frozen at confirm; applied BEFORE ITBIS (ADR-018).
- **State enums frozen**: fiscal doc `VIGENTE/CANCELADA/ANULADA`; sale `BORRADOR/CONFIRMADA/CANCELADA`; payment `COBRO/REEMBOLSO`. No free strings.
- **Atomic NCF assignment**: row-lock consumption inside the transaction.
- Master entities with history (client, supplier, product, user) are NEVER deleted: `activo=false`.

## Code practices
- **Strict TypeScript**: zero `any`; types derived from the Prisma schema, never hand-duplicated models.
- **Explicit errors**: use cases return typed results (success/business error); no try/catch that swallows errors.
- **Conventional commits**; one commit = one coherent work unit (code + its tests + its docs). No AI attribution in commits.
- Small functions named by business intent (e.g. `calcularRetencionISR`, `consumirSecuenciaNcf`), not generic (`process`, `handle`).
- **Parameters from DB, never hardcoded constants**: ITBIS rate (with validity), max discount %, returns term, credit term, ISR/ITBIS retentions, mora threshold.
- **Strict YAGNI**: outside reserved extension seams, no speculative flexibility.

## Dates & time
- Always store UTC (`timestamptz`). `America/Santo_Domingo` is ONLY presentation/business-calculation layer.
- "Today", mora, NCF/ITBIS validity and daily cash close are computed in `America/Santo_Domingo`.
- Conversions via a dedicated library (date-fns-tz or equivalent); no manual hour arithmetic.

## Performance (measure before optimizing)
- Lists ALWAYS paginated (default 25/page, max 100). No `findMany` without limit on list views.
- Explicit `select` on heavy lists; full `include` only on detail views.
- **No N+1**: no queries inside loops.
- Reports/KPIs via SQL aggregation (`aggregate`/`groupBy`).
- Multi-table writes ALWAYS in `$transaction` (sale → invoice + inventory + movement; received purchase → inventory + avg cost; annulment → full reversal).
- Fiscal operations NEVER optimistic: definitive state shown only after real server confirmation.

## Errors
- Use cases return typed success/error results. Every business error carries a **stable code**, user message, and minimal context.
- Single error-code catalog, versioned with the domain. No ad-hoc codes in adapters/components.
- Never expose stack traces or internal Prisma errors to the client.

## Concurrency & idempotency
- Every action that CONFIRMS or mutates money/inventory/NCF is **idempotent**: retrying does not duplicate effects.
- Confirmation buttons disabled on first click AND the server revalidates everything.
- Optimistic locking (`version` column) for concurrent edits; conflicts reload data and ask for explicit retry.
- Critical contention (NCF sequence, stock on confirm, balance on parallel payments) resolved INSIDE the transaction with row locks or verified `UPDATE ... WHERE`.

## Testing
- **Jest** (unit/integration) + **Playwright** (E2E). TDD not mandatory.
- Coverage priority: (1) fiscal domain (ITBIS 18/16/0 mixed, NCF sequences, ISR/ITBIS retentions, invoice state transitions incl. Cancelada vs Anulada);
  (2) critical integration (sale confirm → inventory + movement; partial payment → Parcial/Pagada; received purchase → avg cost);
  (3) E2E (cash sale, credit sale → collection, return with B04, daily close); (4) UI.
- Domain tests run with no database (domain is pure).

## Git workflow
- `master` protected: advances only via reviewed, green PR.
- Branches `feature/<phase>-<module>` aligned to roadmap phases.
- Conventional commits; one work unit per commit.
- Prisma migrations always in their own reviewable commit, never mixed with feature changes.

## CI/CD (GitHub Actions)
- `.github/workflows/ci.yml` — runs on every PR targeting `master` and again on `master`
  after the merge: ESLint, strict typecheck, `prisma validate`, unit tests, integration tests
  against a real Postgres 16 (RLS enforced via the `systemfact_app` role), production build and
  a Conventional Commits guard. The aggregate job **CI gate** is the single required status check.
- `.github/workflows/release-please.yml` — on every merge to `master` it refreshes ONE release
  PR with the next version (`app/package.json`) and `app/CHANGELOG.md`; merging that PR creates
  the `vX.Y.Z` tag and publishes the GitHub Release. It never pushes to `master` directly.
  Config: `release-please-config.json` + `.release-please-manifest.json`.
- **MANDATORY: merge release PRs (`release-please--branches--*`) with "Squash and merge", NEVER
  "Create a merge commit".** release-please detects the merged release PR by the message of the
  pushed commit; a merge commit ("Merge pull request #N...") breaks that detection, so the run
  ends green but silently creates NO tag and NO release (happened on v0.2.0, PR #27 — tag had to
  be created manually). With squash, the commit message is the PR title ("chore(master): release
  systemfact X.Y.Z") and the tag is created automatically.
- **Silent runs without a release PR (diagnose in this order):** if a brand-new `feat` commit
  landed on `master` but release-please shows "success" with NO output ("release_created",
  "tag_name", "pr" all empty), suspect a stuck state machine, not a missing commit:
  1. Check open PRs: is there a `chore: release master` PR? If not present, then:
  2. Labels on PAST release PRs (closed, `release-please--branches--*` base): label
     `autorelease: pending` on any MERGED release PR makes every future run abort with
     "There are untagged, merged release PRs outstanding - aborting". Happened after PR #27
     (v0.2.0 was tagged manually, so the bot's own pending state could never resolve).
  3. Unstick (documented escape hatch): if the tag/release exists manually, replace the label
     with `autorelease: tagged` ("already processed"), then `workflow_dispatch` the Release
     workflow and verify the new release PR appears (v0.3.0 via PR #31 after this fix).
  Always report a stalled release run back to the user explicitly — silence is not success.
- **Root cause fixed (PR #39): `component: systemfact` was REMOVED from `release-please-config.json`**
  and the title pattern is now `chore: release ${version}`. With the component key present and
  `include-component-in-tag: false`, release-please failed BOTH ways: the bot titled its release
  PR `chore: release master` (legacy default, component token missing on empty component), and
  after merging, the workflow's re-parse produced `component: undefined` ≠ configured
  `systemfact` → tag never created → "untagged, merged release PRs outstanding" → every run
  aborted (v0.2.0 #27, v0.3.0 #31, v0.4.0-adjacent #35, v0.4.1 #37 — all needed manual tags).
  From #39 onward: release PR title `chore: release X.Y.Z` round-trips through the parser and
  the tag + GitHub Release are created automatically right after the squash merge. Tags only
  need manual creation for release PRs merged with the legacy title (immutable once merged).
- Commit subjects are the release input: `feat` → MINOR, `fix`/`perf` → PATCH, `!`/BREAKING
  CHANGE → MINOR while pre-1.0 (`bump-minor-pre-major`). Validate locally:
  `pnpm lint:commits --from origin/master --to HEAD`.
- E2E (Playwright) runs only when the repo secrets `E2E_USER`, `E2E_PASSWORD`,
  `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` exist; otherwise the job skips
  with a notice instead of failing. Optional repo variable `E2E_PRODUCT` (default `Arroz`).
- One-time repo setting: Settings → Actions → General → allow GitHub Actions to create and approve
  pull requests, so release-please can open its PR. Optional secret `RELEASE_PLEASE_TOKEN` (PAT)
  if you also want CI to run on the release PR.

## Definition of Done
A feature is done when it: (1) meets the requirement + acceptance criteria;
(2) respects business rules; (3) has tests per priority; (4) is documented;
(5) was reviewed (human PR or another AI session with these directives).
