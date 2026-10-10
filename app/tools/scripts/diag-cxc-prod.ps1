<#
.SYNOPSIS
    READ-ONLY CxC derived diagnostic against the Supabase PRODUCTION database:
    prints every FACTURA (all tenants) with its derived pending balance plus a
    summary count, so cobros-board / estado-de-cuenta / E2E precondition
    disagreements can be reconciled against the raw derived rows (ADR-017).

.DESCRIPTION
    Hidden-input Postgres password (never persisted). Host discovery probes aws-1
    first via the repo's prod-connection-diag.ts (aws-0 rejects this tenant as
    documented). The script body performs EXACTLY ONE read-only select.
#>
param(
  [string]$ProjectRef = "tcyxwkcrmontkrtbyxfm"
)
$ErrorActionPreference = "Stop"

$appDir   = $PSScriptRoot
while ((Split-Path $appDir -Leaf) -ne "app") { $appDir = Split-Path $appDir }
Push-Location (Resolve-Path $appDir)
try {
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
  $chosen = $null
  foreach ($c in $candidates) {
    $env:DIRECT_URL = $c
    pnpm exec tsx tools/scripts/prod-connection-diag.ts
    if ($LASTEXITCODE -eq 0) { $chosen = $c; break }
  }
  if (-not $chosen) { throw "No candidate host could connect. Verify the password (or connectivity)." }

  $env:DIRECT_URL = $chosen
  Write-Host "-- READ-ONLY CxC derived diagnostic --" -ForegroundColor Cyan
  pnpm exec tsx tools/scripts/diag-cxc-prod.ts
  if ($LASTEXITCODE -ne 0) { throw "diag-cxc-prod.ts exited $LASTEXITCODE." }
}
finally {
  Remove-Item Env:DIRECT_URL -ErrorAction SilentlyContinue
  Pop-Location
}
