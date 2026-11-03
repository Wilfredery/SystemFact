#!/usr/bin/env bash
# ============================================================
# provision-local-e2e.sh — prepares the ephemeral Supabase stack for the E2E lane.
#
# WHAT IT DOES (expects a FRESH stack; see "RE-RUNNING" below):
#   1. Reads the running stack's endpoints/keys from `supabase status`.
#   2. Applies the Prisma migrations as `supabase_admin` (the local superuser;
#      the plain `postgres` role is NOT superuser in Supabase's local stack and
#      the `disable_rls_bypass` migration would fail under it).
#   3. Gives the `systemfact_app` role a password (the migration creates it
#      WITHOUT one, out-of-band by design) so the app can connect under RLS.
#   4. Loads .github/ci/e2e-fixture.sql (empresa/sucursal/rol/usuario/producto).
#   5. Runs the business seeds the app needs (seed:venta, seed:ncf, seed:cliente)
#      and the configuration integrity check.
#   6. Creates/updates the GoTrue auth user for E2E_USER through the admin API and
#      VERIFIES the password grant, so a broken identity fails here with a clear
#      message instead of surfacing as a mystery login timeout in Playwright.
#   7. Writes the env file the app, the seeds and the specs read.
#
# WHY A SCRIPT AND NOT WORKFLOW STEPS: the same recipe has to be reproducible on a
# developer machine (app/SETUP-LOCAL.md) and must fail the same way in both places.
# The CI job only boots the stack and calls this file.
#
# Usage above assumes a stack that has just been started. RE-RUNNING: the steps
# themselves are re-runnable (migrations, seeds and the auth user are idempotent),
# but .github/ci/e2e-fixture.sql deliberately aborts on a database that already
# has the fixture empresa — it exists to make pointing it at a real database
# impossible. To provision again, wipe the stack first:
#   npx --yes supabase@3.0.0 stop --no-backup && npx --yes supabase@3.0.0 start
#
# USAGE (repo root, stack already started with `supabase start`):
#   bash .github/ci/provision-local-e2e.sh                     # → app/.env.e2e.stack
#   ENV_FILE=app/.env bash .github/ci/provision-local-e2e.sh   # → what CI does
#
# ENV:
#   ENV_FILE          where to write DATABASE_URL/DIRECT_URL/NEXT_PUBLIC_*/E2E_*
#                     (default: app/.env.e2e.stack — gitignored, never app/.env,
#                     so a local run cannot clobber a developer's cloud .env)
#   E2E_USER          nombreUsuario of the E2E identity (default: e2e-automation)
#   E2E_PRODUCT       product the POS smoke adds to the cart (default: Arroz)
#   E2E_PASSWORD      reuse a known password instead of generating one
#   APP_PASSWORD      reuse a known app-role password instead of generating one
#   PSQL              psql binary (default: psql)
#   SUPABASE_CLI      Supabase CLI invocation (default: npx --yes supabase@3.0.0)
#
# Passwords are generated with node:crypto when absent and are NEVER printed.
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$REPO_ROOT/app"
PSQL="${PSQL:-psql}"
# shellcheck disable=SC2086 # intentional word splitting: the default is a command with flags
SUPABASE_CLI="${SUPABASE_CLI:-npx --yes supabase@3.0.0}"

E2E_USER="${E2E_USER:-e2e-automation}"
E2E_PRODUCT="${E2E_PRODUCT:-Arroz}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env.e2e.stack}"

log() { printf '==> %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

# psql is a native binary; under MSYS/Git Bash on Windows a `/c/...` path must be
# translated or the fixture cannot be opened. No-op everywhere else.
as_native_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

# The Supabase local stack fixes this password for its superuser role; it is the
# same well-known local default as `postgres:postgres`, not a secret.
LOCAL_SUPERUSER_PASSWORD="postgres"

random_hex() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))'
}

# The nombreUsuario is interpolated into SQL below; keep it to a safe charset.
case "$E2E_USER" in
  *[!a-zA-Z0-9._-]*) fail "E2E_USER must match [a-zA-Z0-9._-]+ (got: $E2E_USER)" ;;
esac

[[ -f "$REPO_ROOT/supabase/config.toml" ]] ||
  fail "supabase/config.toml not found — run this from a checkout of the repository."

APP_PASSWORD="${APP_PASSWORD:-$(random_hex)}"
E2E_PASSWORD="${E2E_PASSWORD:-$(random_hex)}"

# ------------------------------------------------------------
# 1. Endpoints and keys of the running stack
# ------------------------------------------------------------
log "Reading the local stack endpoints (supabase status)"
# `status -o env` prints shell-assignable KEY="value" lines; its informational
# banner goes to stderr. Only the four keys we need are eval'd.
STATUS_ENV="$($SUPABASE_CLI status -o env 2>/dev/null | grep -E '^(API_URL|DB_URL|ANON_KEY|SERVICE_ROLE_KEY)=' || true)"
API_URL="$(printf '%s\n' "$STATUS_ENV" | sed -n 's/^API_URL="\(.*\)"$/\1/p')"
DB_URL="$(printf '%s\n' "$STATUS_ENV" | sed -n 's/^DB_URL="\(.*\)"$/\1/p')"
ANON_KEY="$(printf '%s\n' "$STATUS_ENV" | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')"
SERVICE_ROLE_KEY="$(printf '%s\n' "$STATUS_ENV" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')"

for required in API_URL DB_URL ANON_KEY SERVICE_ROLE_KEY; do
  [[ -n "${!required}" ]] ||
    fail "supabase status did not report $required — is the stack running? (npx supabase start)"
done

# The stack's host:port for Postgres, reused for every other role.
DB_HOST_PORT="$(printf '%s' "$DB_URL" | sed -E 's#^postgres(ql)?://[^@]*@([^/]+)/.*$#\2#')"
[[ -n "$DB_HOST_PORT" && "$DB_HOST_PORT" != "$DB_URL" ]] ||
  fail "could not parse host:port out of the stack DB_URL."
DB_NAME="postgres"

SUPER_URL="postgresql://supabase_admin:${LOCAL_SUPERUSER_PASSWORD}@${DB_HOST_PORT}/${DB_NAME}"
APP_URL="postgresql://systemfact_app:${APP_PASSWORD}@${DB_HOST_PORT}/${DB_NAME}"

log "Stack: $API_URL (db $DB_HOST_PORT/$DB_NAME)"

# ------------------------------------------------------------
# 2. Wait for Postgres, then apply the Prisma migrations as superuser
# ------------------------------------------------------------
log "Waiting for Postgres to accept connections"
for attempt in $(seq 1 60); do
  if "$PSQL" "$SUPER_URL" -tAc "select 1" >/dev/null 2>&1; then
    break
  fi
  [[ "$attempt" -eq 60 ]] && fail "Postgres never became reachable at $DB_HOST_PORT."
  sleep 1
done

log "Applying Prisma migrations as supabase_admin"
(
  cd "$APP_DIR"
  DATABASE_URL="$SUPER_URL" DIRECT_URL="$SUPER_URL" pnpm exec prisma migrate deploy
)

# ------------------------------------------------------------
# 3. Give the RLS-bound app role a password
# ------------------------------------------------------------
# `create_app_role` deliberately creates `systemfact_app` without a password
# (out-of-band by design). Each stack boot gets a throwaway one.
log "Setting a per-run password on systemfact_app"
"$PSQL" "$SUPER_URL" -v ON_ERROR_STOP=1 -q \
  -c "ALTER ROLE systemfact_app WITH PASSWORD '${APP_PASSWORD}'"
"$PSQL" "$SUPER_URL" -tAc \
  "select 1 from pg_roles where rolname = 'systemfact_app' and rolbypassrls = false" |
  grep -qx '1' || fail "systemfact_app is missing or not NOBYPASSRLS after the migrations."

# ------------------------------------------------------------
# 4. CI fixture (empresa, sucursal, rol, usuario, producto with stock, credit client)
# ------------------------------------------------------------
log "Loading .github/ci/e2e-fixture.sql"
"$PSQL" "$SUPER_URL" -v ON_ERROR_STOP=1 -q \
  -v e2e_user="$E2E_USER" \
  -v e2e_product="$E2E_PRODUCT" \
  -f "$(as_native_path "$REPO_ROOT/.github/ci/e2e-fixture.sql")"

# ------------------------------------------------------------
# 5. Business seeds + configuration integrity (same order as a dev machine)
# ------------------------------------------------------------
log "Running the business seeds"
(
  cd "$APP_DIR"
  export DATABASE_URL="$APP_URL"
  export DIRECT_URL="$SUPER_URL"
  export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
  export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
  pnpm seed:venta
  pnpm seed:ncf
  pnpm seed:cliente
  pnpm config:verify
)

# ------------------------------------------------------------
# 6. The acting identity: a GoTrue user bound to the fixture's USUARIO row
# ------------------------------------------------------------
log "Creating/updating the E2E auth user through the GoTrue admin API"
"$PSQL" "$SUPER_URL" -tAc \
  "select count(*) from \"USUARIO\" u where u.\"nombreUsuario\" = '${E2E_USER}' and u.activo" |
  grep -qx '1' || fail "the fixture did not produce an active USUARIO row for '${E2E_USER}'."

SUPABASE_URL="$API_URL" \
SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
ANON_KEY="$ANON_KEY" \
E2E_USER="$E2E_USER" \
E2E_AUTH_PASSWORD="$E2E_PASSWORD" \
  node "$REPO_ROOT/.github/ci/upsert-e2e-auth-user.mjs"

# ------------------------------------------------------------
# 7. Env file consumed by Next.js, the specs and `pnpm e2e`
# ------------------------------------------------------------
log "Writing $ENV_FILE"
mkdir -p "$(dirname "$ENV_FILE")"
umask 077
cat > "$ENV_FILE" <<EOF
# Generated by .github/ci/provision-local-e2e.sh — ephemeral local stack values.
# Do not commit (app/.gitignore covers .env*). Regenerated on every provisioning.
DATABASE_URL="$APP_URL"
DIRECT_URL="$SUPER_URL"
NEXT_PUBLIC_SUPABASE_URL="$API_URL"
NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
E2E_USER="$E2E_USER"
E2E_PASSWORD="$E2E_PASSWORD"
E2E_PRODUCT="$E2E_PRODUCT"
EOF

log "Local E2E stack ready: $E2E_USER against $API_URL"
log "Next: run the suite with that env file in the process environment."
