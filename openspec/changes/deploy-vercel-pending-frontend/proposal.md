# Proposal: Deploy to Vercel (deferred until frontend advances)

## Status: DEFERRED (user decision, 2026-10-10)

The user explicitly decided to **pause the Vercel deployment** and resume it when
frontend work is further along. Motivation: "when the frontend is more advanced,
let's try Vercel" — i.e., deploy when there is something meaningful to demonstrate.
Keep this change folder as the resume checklist; do NOT proceed to Vercel steps
until the user re-opens this.

## What is already CONFIRMED and DONE (as of 2026-10-10)

- **Supabase production `tcyxwkcrmontkrtbyxfm` is fully migrated and validated.**
  - 15 Prisma migrations finished (up to and including
    `20261009202000_ncf_secuencia_bigint`); `prisma migrate status` →
    "Database schema is up to date!".
  - Post-verify via MCP: NCF columns `bigint`, audit append-only trigger,
    `usuario_auth_user_id_uk` index + `trg_usuario_auth_user_id_no_null` trigger,
    role `systemfact_app` NOBYPASSRLS present, 25/25 user tables with
    `FORCE ROW LEVEL SECURITY` and 29 policies.
  - Registry-only recoveries applied (Option A, documented in `_prisma_migrations.logs`):
    - `20260902140000_disable_rls_bypass`: applied-with-note — hosted Supabase
      blocks `ALTER ROLE postgres NOBYPASSRLS` (supautils hook, err 42501;
      compensating controls: app runs only as `systemfact_app`, enforced by
      `src/lib/env.ts` at startup; `verify-rls` gates every PR in CI).
    - `20260918_define_audit_appendonly`: transient 40P01 deadlock vs a Supabase
      background session; marked rolled-back and retried OK.
  - Working session-pooler host for this tenant: **`aws-1-us-east-2.pooler.supabase.com`**
    (aws-0 replies `XX000 tenant/user not found`).
  - Runtime password for `systemfact_app` was set by the user with the
    hidden-input launcher (`app/tools/scripts/supabase-prod-migrate.ps1
    -SetRolPassword` → `tools/scripts/set-prod-app-role.ts`); it is stored in the
    user's password manager and NEVER in the repo.
  - Prod database is EMPTY of business data (seeds pending on resume).
- **Tooling landed on branch `chore/deployment` (commits 0f29b63, ee0c2b7,
  0ac183e, 86c78ac, c444392) — local only, NOT merged:**
  - `app/tools/scripts/supabase-prod-migrate.ps1` — operator launcher
    (hidden-input password, host auto-discovery via verbose probe).
  - `app/tools/scripts/prod-connection-diag.{ts,ps1}` — connection probe with
    failure classes AUTH/NET/DBS/OTHER.
  - (Earlier sibling work already merged on master: H4 NCF BigInt = PR #98,
    release v0.12.0.)

## Resume checklist for Vercel (when the user re-opens this)

1. **Merge `chore/deployment`** to master first (PR review; it is small).
2. **Import repo on Vercel** (vercel.com → Add New → Project → Import
   `Wilfredery/SystemFact`): Root Directory `app`, Framework Next.js.
3. **4 env vars** (validated at startup by `app/src/lib/env.ts`; Production env):
   - `DATABASE_URL` = `postgresql://systemfact_app.tcyxwkcrmontkrtbyxfm:<pw>`
     `@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true`
     (transaction pooler; role allowlist is "systemfact_app", dotted-pooler form).
   - `DIRECT_URL` = `postgresql://postgres.tcyxwkcrmontkrtbyxfm:<pw>`
     `@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true`
     (privileged role, deliberately exempt from the app-role check).
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://tcyxwkcrmontkrtbyxfm.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the public anon key (present in the repo's
     `app/.env`; also Supabase → Settings → API).
   Secrets are entered in the Vercel dashboard only — never in chat/repo.
4. **Vercel MCP is already configured** in opencode (`mcp.vercel`, remote,
   OAuth); after an opencode restart the user completes the one-time browser
   OAuth, then the orchestrator can read deployment status / build logs /
   runtime logs without asking for anything.
5. **Validation sequence once deployed**: seeds of business data (empresa,
   usuarios with roles, NCF ranges via `pnpm seed:ncf`, retenciones) →
   `pnpm config:verify` exit 0 → E2E Playwright specs (`cobros`,
   `confirm-venta`, `devolucion`) against the deployment with probe-user creds
   entered via hidden-input convention → Supabase advisors (security/perf) clean.
6. Optional fallback if the session pooler ever blocks Vercel serverless IPs:
   transaction pooler is the documented route for prod (`verify-rls` enforces it);
   direct host `db.<ref>.supabase.co:5432` requires the IPv4 Direct Connection
   add-on.

## Out of scope / honest limitations

- No Vercel CLI installed in this environment; deployment itself happens through
  the user's browser or a future `vercel` CLI login by the user.
- `20260902140000_disable_rls_bypass` remains a platform-level limitation on
  hosted Supabase (by design of this plan); revisit only if Supabase support
  removes the supautils restriction.
