# SystemFact

Invoicing ERP — Next.js 16 (App Router) + TypeScript + Prisma + Supabase. The application lives
in [`app/`](app/); the engineering standards that govern it are in [`AGENTS.md`](AGENTS.md).

## NON-PRODUCTION DEPLOYMENT

The deployed environment runs on the Supabase **free** plan and is explicitly **not production**:

- It **pauses after one week of inactivity** — no login, no database, no NCF. This already happened
  once (2026-11-03).
- It has **no automatic backups**. Recovery depends on a `pg_dump` that a human schedules and runs:
  see [`app/BACKUP-RESTORE.md`](app/BACKUP-RESTORE.md).

**Do not onboard a real tenant, and do not issue a real invoice, until the plan tier has been
revisited.** Fiscal documents are legally retained and never deleted, so a lost volume is not a
re-seed: it is unrecoverable.

## Local development

Postgres 17.6 in Docker, parity with the hosted engine, RLS enforced through the application role:
[`app/SETUP-LOCAL.md`](app/SETUP-LOCAL.md).
