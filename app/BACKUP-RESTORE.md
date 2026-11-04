# Backup & restore — SystemFact cloud database

The deployed project runs on the Supabase **FREE** plan, which:

- has **no automatic backups**, and
- **pauses after one week of inactivity** (this already happened on 2026-11-03, and a
  paused project answers nothing: no login, no database, no NCF).

Fiscal documents are legally retained and never deleted (`AGENTS.md`), so losing this
database is not a re-seed — it is unrecoverable. **The script below is the only recovery
path that exists.** Backups are therefore a delivery requirement, not an optional chore.

Plan of record: `docs/22-security-hardening-plan.md` T0 (local-only document; `docs/` is
gitignored by design).

## What an acceptable backup is

- A **verified** artifact: the dump must declare the same number of tables as the source
  catalog. The script fails the run if it does not. A file that merely exists and looks
  plausible is the failure mode this check exists to stop.
- **Off-platform**: not on the Supabase project, and not on the same disk as the only copy
  of the project. The default destination is your OneDrive folder
  (`OneDrive\SystemFactBackups`) precisely because a laptop-local dump dies with the laptop.
- **Proven restorable**: see [Restore rehearsal](#restore-rehearsal) and the evidence at the
  bottom of this file.

## Taking a backup

Manual (recommended; the password is typed hidden and never stored):

```powershell
powershell -ExecutionPolicy Bypass -File app/tools/scripts/backup-cloud-db.ps1
```

What it does: reads the password as hidden input, probes the Supabase session pooler,
counts the source tables, runs `pg_dump` inside the `postgres:17.6` image (same major as the
server, so Docker is the only dependency — a recovery tool must not need `pnpm install`),
verifies the artifact against that table count, writes a `.sha256` sidecar, and prunes
`*.dump` files older than `-RetentionDays` (default 30).

Options worth knowing:

| Option | When |
|---|---|
| `-OutDir <path>` | Destination other than the OneDrive default. It must be off-platform. |
| `-HostDirect` | Add `db.<ref>.supabase.co` to the candidates (needs the Direct Connection IPv4 add-on or local IPv6). |
| `-RetentionDays <n>` | Rotation window; `-WhatIf` previews the deletions. |
| `-PasswordFile <path>` | Unattended runs only, see below. |

### Scheduled (unattended) runs

A scheduled task cannot type a hidden password, so it needs the password in a file **outside
this repository** — the script refuses a path inside it, because a database password in a
working tree is one `git add .` away from a public repo.

```powershell
$f = "$env:USERPROFILE\.systemfact\db-password.txt"
New-Item -ItemType Directory -Force -Path (Split-Path $f) | Out-Null
icacls $f /inheritance:r /grant:r "$env:USERNAME:(R)"
# write the password into $f once, then:
schtasks /Create /SC DAILY /ST 02:00 /TN "SystemFact cloud DB backup" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\SystemFact\app\tools\scripts\backup-cloud-db.ps1 -PasswordFile %USERPROFILE%\.systemfact\db-password.txt"
```

This is a weaker secret store than the interactive prompt. Acceptable for a free-tier,
explicitly non-production project; revisit it together with the plan tier (see
[Before the first real invoice](#before-the-first-real-invoice)).

## Verifying an artifact by hand

```powershell
Get-FileHash <artifact>.dump -Algorithm SHA256   # must equal the .sha256 sidecar
docker run --rm --mount "type=bind,source=<dir>,target=/backup" postgres:17.6 `
  pg_restore --list "/backup/<artifact>.dump" | Select-String 'TABLE DATA public ' | Measure-Object
```

The count must match the source:

```powershell
docker run --rm -e PGPASSWORD -e PGSSLMODE=require postgres:17.6 `
  psql -h <host> -p 5432 -U postgres.<ref> -d postgres -tAc `
  "select count(*) from pg_tables where schemaname='public'"
```

## Restore rehearsal

Restoring into a **scratch** database is the only thing that proves the artifact is a backup.
It is non-destructive and takes seconds at this data size. Verified commands (local engine):

```bash
# 1. Scratch database, never the real one.
docker exec sf-postgres psql -U postgres -q \
  -c "DROP DATABASE IF EXISTS sf_restore_probe" \
  -c "CREATE DATABASE sf_restore_probe"

# 2. Timed restore (path conversion must be off when run from Git Bash).
docker run --rm -e PGPASSWORD=<pw> -e PGSSLMODE=disable \
  --mount "type=bind,source=<dir>,target=/backup" postgres:17.6 \
  pg_restore --no-owner --no-privileges -h host.docker.internal -p 5433 \
  -U postgres -d sf_restore_probe "/backup/<artifact>.dump"

# 3. Per-table row counts from the source and from the restored copy must be identical.
```

The comparison query (run against both databases and diff the output):

```sql
select format('%s=%s', tablename,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', tablename), false, true, '')))[1]::text)
from pg_tables where schemaname='public' order by tablename;
```

Then drop the scratch database.

## Restoring over the real project

**Destructive and irreversible.** Requires explicit owner approval, in this order:

1. Take a fresh backup first, even if the restore is meant to repair a bad state.
2. Record the current state (`select count(*) from pg_tables where schemaname='public'`, and
   the row counts from the query above) so the outcome is measurable.
3. Restore:

```powershell
docker run --rm -e PGPASSWORD=<pw> -e PGSSLMODE=require --mount "type=bind,source=<dir>,target=/backup" `
  postgres:17.6 pg_restore --clean --if-exists --no-owner --no-privileges `
  -h <host> -p 5432 -U postgres.<ref> -d postgres "/backup/<artifact>.dump"
```

4. Verify: row counts match the artifact, then
   `cd app && pnpm exec prisma migrate status` (the ledger must be intact and up to date) and
   `pnpm exec tsx tools/scripts/verify-rls.ts` (`sin_rls=0`, `sin_policy=0`).
5. Never restore into a database that is serving traffic without telling the users first.

## If the project is paused

A free-plan project answers nothing after a week of inactivity. Resume it in the Supabase
dashboard, confirm `ACTIVE_HEALTHY`, and take a backup **the same day** — the pause is the
warning that nothing is protecting this data.

## Before the first real invoice

Two things must have happened before a real tenant is onboarded onto this plan:

1. A **cloud** backup artifact produced by this script exists and has been restored once
   into a scratch database (the rehearsal below was run against the local engine, which
   proves the pipeline; the cloud artifact itself is one owner command with the hidden
   password).
2. The plan decision is revisited: Pro removes the auto-pause and adds 7-day automatic
   backups. Record the decision where the plan lives (`docs/22` T0), not in someone's memory.

## Evidence

| Date | Exercise | Result |
|---|---|---|
| 2026-11-03 | T0b cluster move, PostgreSQL 16 → 17.6 (plan-level restore) | 212 rows identical across all 26 tables; `migrate status` up to date; `rls:verify` OK |
| 2026-11-04 | This runbook's pipeline, end to end (local engine) | dump 26/26 tables verified, 0.16 MB, 2.6 s · SHA-256 sidecar matches · restore into `sf_restore_probe` 5.6 s · **26/26 tables, 452 rows, diff identical** · scratch database dropped |
