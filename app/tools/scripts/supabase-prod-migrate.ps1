<#
.SYNOPSIS
    Runs `prisma migrate deploy` against the Supabase PRODUCTION database with
    a locally-entered (never persisted) database password.

.DESCRIPTION
    One-off operator launcher for the SystemFact deployment cycle
    (branch chore/deployment, Option A plan agreed 2026-10-09).

    Security:
      - The prod password is read with Read-Host -AsSecureString (hidden
        input) and kept ONLY in the current process environment. It is never
        written to disk, never echoed, never part of a log.
      - dotenv's .env does not override already-set process envs, so the
        overridden DIRECT_URL here wins over app/.env (local docker).
      - app/.env is untouched; Vercel secrets are configured separately.

    Host discovery: Supabase pooler/region hostnames are not exposed via
    tooling APIs, so the launcher tries the known candidates with
    `prisma migrate status` (READ-ONLY) first and uses the first that
    connects. Only then does it run `prisma migrate deploy` (the writing
    step) on the winner.

.USAGE
    From repo root:
      powershell -ExecutionPolicy Bypass -File app/tools/scripts/supabase-prod-migrate.ps1
    Optional:
      -HostDirect        add the direct host db.<ref>.supabase.co:5432 to
                         the candidates (works only if the project has the
                         Direct Connection IPv4 add-on or IPv6 locally)
      -SetRolPassword    after a successful deploy, also set the runtime
                         password for role systemfact_app (hidden input,
                         via tools/scripts/set-prod-app-role.ts - enforced
                         charset policy, min 12 chars)

.EXAMPLE
    Recommended for this project (us-east-2 project tcyxwkcrmontkrtbyxfm):
      powershell ...\supabase-prod-migrate.ps1 -SetRolPassword
#>
param(
  [string]$ProjectRef = "tcyxwkcrmontkrtbyxfm",
  [switch]$HostDirect,
  [switch]$SetRolPassword
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
  $branch = git -C $repoRoot branch --show-current
  Write-Host "== SystemFact prod migration deploy ==" -ForegroundColor Cyan
  Write-Host "Project ref : $ProjectRef   (branch: $branch)"
  Write-Host "Password is read as HIDDEN input and used only for this process." -ForegroundColor Yellow

  $secure = Read-Host "Postgres password (project $ProjectRef)" -AsSecureString
  $bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $plain  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($plain)) { throw "Empty password - aborted." }

  $env:PGPASSWORD = $plain
  $pwEnc = [uri]::EscapeDataString($plain)   # safe password-in-URL encoding

  # Supabase session pooler (IPv4, session mode): hostname pattern aws-{N}-{region}.
  $candidates = @(
    "postgresql://postgres.$ProjectRef`:$pwEnc@aws-0-us-east-2.pooler.supabase.com:5432/postgres",
    "postgresql://postgres.$ProjectRef`:$pwEnc@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
  )
  if ($HostDirect) {
    $candidates = @("postgresql://postgres`:$pwEnc@db.$ProjectRef.supabase.co:5432/postgres") + $candidates
  }

  # Dry discovery: reuses the verbose connection probe (SELECT 1, exit 0 only
  # on a working connection) so every candidate's result is VISIBLE on screen.
  $chosen = $null
  foreach ($c in $candidates) {
    $masked = $c -replace ":[^:@]+@", ":***@"
    Write-Host "Testing: $masked" -ForegroundColor DarkGray
    $env:DIRECT_URL = $c
    pnpm exec tsx tools/scripts/prod-connection-diag.ts
    if ($LASTEXITCODE -eq 0) { $chosen = $c; break }
  }
  if (-not $chosen) {
    throw "No candidate host could connect. Verify the password and that pool connectivity is enabled (or pass -HostDirect if the project has the Direct Connection IPv4 add-on)."
  }

  $env:DIRECT_URL = $chosen
  Write-Host "Connected via: $(($chosen -replace ':[^:@]+@', ':***@'))" -ForegroundColor Green

  Write-Host "-- prisma migrate deploy --" -ForegroundColor Cyan
  pnpm exec prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy failed (exit $LASTEXITCODE). Registry state preserved; no rollback performed by Prisma." }

  Write-Host "-- prisma migrate status (post-deploy) --" -ForegroundColor Cyan
  pnpm exec prisma migrate status

  if ($SetRolPassword) {
    Write-Host "-- Runtime password for systemfact_app (out-of-band, hidden input) --" -ForegroundColor Cyan
    $appSecure = Read-Host "Password for role systemfact_app (prod)" -AsSecureString
    $appPlain  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                   [Runtime.InteropServices.Marshal]::SecureStringToBSTR($appSecure))
    $env:APP_ROLE_PASSWORD = $appPlain
    pnpm exec tsx tools/scripts/set-prod-app-role.ts
    if ($LASTEXITCODE -ne 0) { throw "set-prod-app-role.ts exited with $LASTEXITCODE." }
    Write-Host "Password set. Store it in a password manager - it will NOT be retried or persisted here." -ForegroundColor Yellow
  }
}
finally {
  Remove-Item Env:SUPABASE_DB_URL,Env:DIRECT_URL,Env:APP_ROLE_PASSWORD,Env:PGPASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
