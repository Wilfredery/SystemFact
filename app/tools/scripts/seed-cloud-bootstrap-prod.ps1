<#
.SYNOPSIS
    Runs `pnpm seed:bootstrap` (seed-cloud-bootstrap.ts) against the Supabase
    PRODUCTION database with a locally-entered (never persisted) password pair.

.DESCRIPTION
    Operator launcher mirroring supabase-prod-migrate.ps1's security stance:

      - BOTH secrets are read with Read-Host -AsSecureString (hidden input)
        and live ONLY in the current process environment: the database
        password builds PROD_PRIVILEGED_URL (operator `postgres` role), and
        the bootstrap admin password is exported as ADMIN_PASSWORD for
        seed-cloud-bootstrap.ts. Nothing is written to disk, echoed, or logged.
      - dotenv's .env does not override already-set process envs, so the
        PROD_PRIVILEGED_URL set here wins over any app/.env value.
      - app/.env is untouched.
      - Host discovery is done with the READ-ONLY prod-connection-diag.ts
        probe (SELECT 1) over the known session-pooler candidates; only the
        winning connection string is used for the writing step.

    The bootstrap itself is idempotent: safe to re-run; a second run changes
    nothing (see seed-cloud-bootstrap.ts header). auth.users rows are NEVER
    modified by a re-run.

.USAGE
    From repo root:
      powershell -ExecutionPolicy Bypass -File app/tools/scripts/seed-cloud-bootstrap-prod.ps1
    Optional:
      -HostDirect   prepend db.<ref>.supabase.co:5432 (needs the Direct
                    Connection IPv4 add-on or local IPv6)
      -ProjectRef   override the default project ref
#>
param(
  [string]$ProjectRef = "tcyxwkcrmontkrtbyxfm",
  [switch]$HostDirect
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
  # DB password — read hidden.
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

  # Admin password for the bootstrap Auth user — read hidden too.
  $adminSecure = Read-Host "ADMIN_PASSWORD (initial password for the admin user in Supabase Auth)" -AsSecureString
  $adminBstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminSecure)
  $adminPlain  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($adminBstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminBstr)
  if ([string]::IsNullOrWhiteSpace($adminPlain) -or $adminPlain.Length -lt 8) {
    throw "ADMIN_PASSWORD is empty or shorter than 8 chars - aborted."
  }
  Write-Host "Password accepted (never shown, never persisted)." -ForegroundColor Yellow

  $env:PROD_PRIVILEGED_URL = $chosen
  $env:ADMIN_PASSWORD      = $adminPlain
  Write-Host "-- pnpm seed:bootstrap --" -ForegroundColor Cyan
  pnpm exec tsx tools/scripts/seed-cloud-bootstrap.ts
  if ($LASTEXITCODE -ne 0) { throw "seed-cloud-bootstrap.ts exited with $LASTEXITCODE." }

  Write-Host "Structural bootstrap done. NEXT (operator, same privileged connection):" -ForegroundColor Green
  Write-Host "  pnpm seed:ncf; pnpm seed:retencion; pnpm seed:venta; pnpm seed:cliente; pnpm config:verify"
}
finally {
  Remove-Item Env:PROD_PRIVILEGED_URL,Env:DIRECT_URL,Env:ADMIN_PASSWORD,Env:PGPASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
