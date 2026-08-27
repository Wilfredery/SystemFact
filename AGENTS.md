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
- `main` protected: advances only via reviewed, green PR.
- Branches `feature/<phase>-<module>` aligned to roadmap phases.
- Conventional commits; one work unit per commit.
- Prisma migrations always in their own reviewable commit, never mixed with feature changes.

## Definition of Done
A feature is done when it: (1) meets the requirement + acceptance criteria;
(2) respects business rules; (3) has tests per priority; (4) is documented;
(5) was reviewed (human PR or another AI session with these directives).
