# Feature: ITBIS rate-list edit screen (Administracion)

Branch `feature/itbis-tasas-edit-screen` from master 9a56149 = v0.34.13 = production. Target **0.35.0** (first MINOR under the confirmed versioning rule: feat -> MINOR).

## Specs
- S1 (owner 2026-11-16): build the rate-list edit screen now; Administrador only.
- S2: location: existing Administracion -> Configuracion tab; shows the current TASA_ITBIS list + validity window; edit saves by CLOSING the current row's window and opening a new row (history preserved, nothing retroactive); one audit row per change.
- S3: the form validates the format (same parser as the feature list: well-formed, no duplicates, each 0..100) and refuses an empty list; the UI carries the caution that legality of a new rate must be confirmed with the accountant.
- S4: RLS: ONE migration splitting configempresa_isolation into SELECT (any tenant member) + INSERT/UPDATE/DELETE (es_admin only), modeled on usuario_writes_admin_only / sucursal_writes_admin_only; the OWNER applies it; agent verifies via Supabase MCP before deploy.
- S5: server-side authorization on every action; write path inside withTenantTransaction; no direct prisma from http.
- S6: tests: unit (use case authorization, parse refusal, window close/open), real-DB integration (edit as admin writes a new row and closes the old; non-admin refused; RLS blocks non-admin write at the DB level), UI test.
- S7: after deploy: smoke; rate change is fiscal-adjacent but demo lane only needed if owner asks.

## Tasks
- T1 (S4) migration + RLS tests: own commit, judgment-day review. Route: inline.
- T2 (S2,S3,S5,S6) backend use cases + actions: own commit. Route: inline.
- T3 (S2,S3,S6) UI (Configuracion tab edit card + RTL): own commit. Route: inline.
- T4 (S1,S7) parent: bump 0.35.0, PR, CI, owner-approved migration apply -> merge + deploy + smoke + release.

## Log
- L1 (2026-11-16): owner approved building the screen now and MINOR versioning going forward (feat -> MINOR per AGENTS.md). Exploration found CONFIGURACION_EMPRESA RLS is a plain tenant-isolation ALL policy (migration 20260902120000 lines 237-249): any tenant member can INSERT/UPDATE — split per S4 following the usuario/sucursal precedent. No existing app write path for the table (only seeds).
