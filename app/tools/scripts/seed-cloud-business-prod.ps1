<#
.SYNOPSIS
    Runs the business seeds (ncf, retencion, venta, cliente) + config:verify on the
    Supabase PRODUCTION database with a locally-entered, never-persisted password.

.DESCRIPTION
    Companion launcher to seed-cloud-bootstrap-prod.ps1. The bootstrap launcher
    clears its env on exit, so this one re-establishes the privileged connection
    itself (same probe/host-discovery dance, hidden input) and then serially runs
    the follow-up seeds documented in seed-cloud-bootstrap.ts's header, in the
    mandated order:

        pnpm seed:ncf, pnpm seed:retencion, pnpm seed:venta, pnpm seed:cliente,
        pnpm config:verify

    Every business seed prefers DIRECT_URL (operator/superuser) over DATABASE_URL,
    exactly as verified in each script's header. Nothing is written to disk,
    echoed, or logged; app/.env is untouched.

.USAGE
    From repo root:
      powershell -ExecutionPolicy Bypass -File app/tools/scripts/seed-cloud-business-prod.ps1
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
  # DB password - read hidden.
  $secure = Read-Host "Postgres password (project $ProjectRef)" -AsSecureString
  $bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $plain  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($plain)) { throw "Empty DB password - aborted." }

  $pwEnc = [uri]::EscapeDataString($plain)
  $candidates = @(
    "postgresql://postgres.$ProjectRef`:$pwEnc@aws-1-us-east-2.pooler.supabase.com:5432/postgres",
    "postgresql://postgres.$ProjectRef`:$pwEnc@aws-0-us-east-2.pooler.supabase.com:5432/postgres"
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
  Write-Host "Connection OK." -ForegroundColor Yellow

  $env:DIRECT_URL = $chosen
  foreach ($script in @("seed:ncf", "seed:retencion", "seed:venta", "seed:cliente")) {
    Write-Host "-- pnpm $script --" -ForegroundColor Cyan
    pnpm run $script
    if ($LASTEXITCODE -ne 0) { throw "pnpm $script exited with $LASTEXITCODE." }
  }

  Write-Host "-- pnpm config:verify --" -ForegroundColor Cyan
  pnpm run config:verify
  if ($LASTEXITCODE -ne 0) { throw "config:verify exited with $LASTEXITCODE - every provisioned key must read back OK." }
  Write-Host "Business seeds done. Next: E2E against the Vercel preview via e2e-cloud-prod.ps1." -ForegroundColor Green
}
finally {
  Remove-Item Env:DIRECT_URL, Env:PGPASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
