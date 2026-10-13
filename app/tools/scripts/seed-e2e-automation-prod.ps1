<#
.SYNOPSIS
    Runs `pnpm seed:e2e-automation` (seed-e2e-automation.ts) against the Supabase
    PRODUCTION database with a locally-entered (never persisted) DB password.

.DESCRIPTION
    Operator launcher mirroring seed-cloud-bootstrap-prod.ps1's security stance:

      - The DB password is read with Read-Host -AsSecureString (hidden input)
        and lives ONLY in the current process environment, building
        PROD_PRIVILEGED_URL (operator `postgres` role). Nothing is written to
        disk, echoed, or logged.
      - The automation password is NOT typed: seed-e2e-automation.ts mints a
        crypto-random 40-char value itself and stores it ONLY in
        app/.env.e2e.local (gitignored, BOM-free). It is never printed.
      - dotenv's .env does not override already-set process envs, so the
        PROD_PRIVILEGED_URL and E2E_AUTH_DB_URL set here win over any app/.env
        value. app/.env is untouched.
      - Host discovery is done with the READ-ONLY prod-connection-diag.ts probe
        (SELECT 1) over the known session-pooler candidates; only the winning
        connection string is used for the writing step.
      - The script itself is idempotent (find-or-create; re-run changes
        nothing). Existing auth.users rows are NEVER modified. With -Rotate the
        automation password is rotated, touching only auth row's
        encrypted_password and rewriting app/.env.e2e.local.

.USAGE
    From repo root:
      powershell -ExecutionPolicy Bypass -File app/tools/scripts/seed-e2e-automation-prod.ps1
    Optional:
      -Rotate      rotate the automation password (rewrites .env.e2e.local)
      -HostDirect  prepend db.<ref>.supabase.co:5432 (needs the Direct
                   Connection IPv4 add-on or local IPv6)
      -ProjectRef  override the default project ref
#>
param(
  [string]$ProjectRef = "tcyxwkcrmontkrtbyxfm",
  [switch]$HostDirect,
  [switch]$Rotate
)
$ErrorActionPreference = "Stop"

if ($ProjectRef -notmatch '^[a-z0-9]{20}$') {
  throw "ProjectRef '$ProjectRef' does not look like a Supabase project ref (20 lowercase alphanumeric chars)."
}

$appDir   = $PSScriptRoot
while ((Split-Path $appDir -Leaf) -ne "app") { $appDir = Split-Path $appDir }
$repoRoot = (Resolve-Path (Join-Path $appDir "..")).Path
Push-Location (Resolve-Path $appDir)
try {
  # DB password — read hidden; never shown, never persisted.
  $secure = Read-Host "Postgres password (project $ProjectRef)" -AsSecureString
  $bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $plain  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($plain)) { throw "Empty DB password - aborted." }

  $pwEnc = [uri]::EscapeDataString($plain)
  $candidates = @(
    "postgresql://postgres.$ProjectRef`:$pwEnc@aws-0-us-east-2.pooler.supabase.com:5432/postgres",
    "postgresql://postgres.$ProjectRef`:$pwEnc@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
  )
  if ($HostDirect) {
    $candidates = @("postgresql://postgres`:$pwEnc@db.$ProjectRef.supabase.co:5432/postgres") + $candidates
  }

  $chosen = $null
  foreach ($c in $candidates) {
    $masked = $c -replace ":[^:@]+@", ":***@"
    Write-Host "Testing: $masked" -ForegroundColor DarkGray
    $env:DIRECT_URL = $c
    pnpm exec tsx tools/scripts/prod-connection-diag.ts
    if ($LASTEXITCODE -eq 0) { $chosen = $c; break }
  }
  if (-not $chosen) {
    throw "No candidate host could connect. Verify the password and pool connectivity (or pass -HostDirect)."
  }

  Write-Host "Password accepted (never shown, never persisted)." -ForegroundColor Yellow

  # Point the automation seed at the Supabase connection carrying auth.users.
  $env:PROD_PRIVILEGED_URL = $chosen
  $env:E2E_AUTH_DB_URL     = $chosen

  $argList = @()
  if ($Rotate) { $argList += "--rotate" }

  Write-Host "-- pnpm seed:e2e-automation --" -ForegroundColor Cyan
  pnpm exec tsx tools/scripts/seed-e2e-automation.ts @argList
  if ($LASTEXITCODE -ne 0) { throw "seed-e2e-automation.ts exited with $LASTEXITCODE." }

  Write-Host "e2e automation principal ready. Credential file: app/.env.e2e.local (gitignored)." -ForegroundColor Green
  Write-Host "Next: playwright with E2E_USER/E2E_PASSWORD sourced from that file (agent-run: variables are set from it, never echoed)."
}
finally {
  Remove-Item Env:PROD_PRIVILEGED_URL,Env:E2E_AUTH_DB_URL,Env:DIRECT_URL,Env:PGPASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
