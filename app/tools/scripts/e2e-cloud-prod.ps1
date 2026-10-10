<#
.SYNOPSIS
    Runs the Playwright E2E specs against the private Vercel preview with
    locally-entered, never-persisted credentials.

.DESCRIPTION
    Companion launcher for the deploy-vercel-pending-frontend checklist step
    "Playwright E2E against https://systemfact.vercel.app". The operator types
    the probe-user password (hidden input); the credentials BECOME the E2E
    defaults written down in app/playwright.config.ts and the E2E specs
    (E2E_USER/E2E_PASSWORD). The specs' assertion pool also needs the operator
    Postgres password (hidden input, exported as DIRECT_URL; aws-1 session
    pooler) so preconditions/assertions run against PROD instead of the local
    dev DB that app/.env would otherwise surface. If Vercel Authentication is
    ON for the alias, an optional automation-bypass token (Project -> Settings
    -> Deployment Protection) is read hidden too and forwarded as the
    x-vercel-protection-bypass header that playwright.config.ts already wires.

    Serial execution is enforced by the config itself (workers=1 - E2E mutates
    the shared prod data and NCF sequences).

.USAGE
    From repo root:
      powershell -ExecutionPolicy Bypass -File app/tools/scripts/e2e-cloud-prod.ps1
    Optional:
      -BaseUrl      override https://systemfact.vercel.app
      -E2EUser      override the 'admin' probe user
      -Test         pass a Playwright test filter (e.g. "cobros", "confirm-venta")
#>
param(
  [string]$BaseUrl    = "https://systemfact.vercel.app",
  [string]$E2EUser    = "admin",
  [string]$ProjectRef = "tcyxwkcrmontkrtbyxfm",
  [string]$Test       = ""
)
$ErrorActionPreference = "Stop"

$appDir   = $PSScriptRoot
while ((Split-Path $appDir -Leaf) -ne "app") { $appDir = Split-Path $appDir }
Push-Location (Resolve-Path $appDir)
try {
  $secure = Read-Host "E2E password for user '$E2EUser'" -AsSecureString
  $bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $e2ePw  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($e2ePw)) { throw "Empty E2E password - aborted." }

  $secureByp  = Read-Host "x-vercel-protection-bypass token (press Enter to skip)" -AsSecureString
  $bStrByp    = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureByp)
  $bypassToken = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bStrByp)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bStrByp)

  # Postgres (operator) password - read hidden. The specs' ASSERTION pool connects
  # via DIRECT_URL ?? DATABASE_URL; without this override dotenv loads app/.env's
  # localhost dev DB and every precondition fails with "user not found".
  $secureDb = Read-Host "Postgres password (project $ProjectRef)" -AsSecureString
  $bstrDb   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureDb)
  $dbPw     = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstrDb)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstrDb)
  if ([string]::IsNullOrWhiteSpace($dbPw)) { throw "Empty Postgres password - aborted." }
  $pwEnc    = [uri]::EscapeDataString($dbPw)
  $directUrl = "postgresql://postgres.$ProjectRef`:$pwEnc@aws-1-us-east-2.pooler.supabase.com:5432/postgres"

  $env:E2E_BASE_URL  = $BaseUrl
  $env:E2E_USER      = $E2EUser
  $env:E2E_PASSWORD  = $e2ePw
  $env:DIRECT_URL    = $directUrl
  if ($bypassToken) { $env:E2E_PROTECTION_BYPASS = $bypassToken }


  Write-Host ("E2E_BASE_URL = {0}" -f $BaseUrl) -ForegroundColor DarkGray
  Write-Host ("E2E_USER     = {0}" -f $E2EUser) -ForegroundColor DarkGray
  Write-Host "E2E_PASSWORD = *** (never shown)" -ForegroundColor DarkGray
  if ($bypassToken) {
    Write-Host "E2E_PROTECTION_BYPASS = set" -ForegroundColor DarkGray
  } else {
    Write-Host "E2E_PROTECTION_BYPASS = skipped" -ForegroundColor DarkGray
  }
  Write-Host "-- pnpm e2e (playwright test) against $BaseUrl --" -ForegroundColor Cyan

  if ($Test) {
    pnpm exec playwright test $Test
  } else {
    pnpm exec playwright test
  }
  if ($LASTEXITCODE -ne 0) { Write-Host "E2E suite reported failures (exit $LASTEXITCODE)" -ForegroundColor Red }
}
finally {
  Remove-Item Env:E2E_BASE_URL, Env:E2E_USER, Env:E2E_PASSWORD, Env:E2E_PROTECTION_BYPASS, Env:DIRECT_URL, Env:PGPASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
