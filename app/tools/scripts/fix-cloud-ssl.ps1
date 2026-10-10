<#
.SYNOPSIS
    Fix-cloud-ssl: rebuilds the Vercel DATABASE_URL/DIRECT_URL strings with
    uselibpqcompat=true and pushes them to the Vercel Production + Preview env.

.DESCRIPTION
    Root cause (pg-connection-string@2.14.0): cloud connection strings carrying
    sslmode=require are parsed with rejectUnauthorized=true (deprecated default)
    instead of libpq's "encrypt, don't verify" - the Supabase pooler's own CA
    fails the chain check -> Prisma P1011 "self-signed certificate in
    certificate chain" -> every Server Action touching the DB 500s.

    Fix: append uselibpqcompat=true so sslmode=require maps to rejectUnauthorized
    =false (TLS stays ON; site/host verification skipped, identical to every
    libpq client already in the toolchain). The library documents this mapping
    explicitly as the libpq-compatible behavior.

    The systemfact_app role password is REUSED from app/.env (synced to prod -
    documented in deploy-vercel-pending-frontend). The plaintext never prints,
    never configures a file, and never enters a command-line parameter visible
    to this transcript. Only masked confirmations go to stdout.

.USAGE
    From repo root:
      powershell -ExecutionPolicy Bypass -File app/tools/scripts/fix-cloud-ssl.ps1
#>
param(
  [string]$ProjectRef = "tcyxwkcrmontkrtbyxfm",
  [string]$Scope      = "team_kKgF8qPdR6XPLzl5etxpsvpA"
)
$ErrorActionPreference = "Stop"

$appDir   = $PSScriptRoot
while ((Split-Path $appDir -Leaf) -ne "app") { $appDir = Split-Path $appDir }
$appDir   = (Resolve-Path $appDir).Path
Push-Location $appDir
try {
  # Read the local .env silently; only the password segment is used, never shown.
  $envFile = Join-Path $appDir ".env"
  if (-not (Test-Path $envFile)) { throw "app/.env not found." }
  $lines = Get-Content $envFile -Encoding UTF8
  $databaseUrlLine = ($lines | Where-Object { $_ -match '^DATABASE_URL=' })
  if (-not $databaseUrlLine) { throw "DATABASE_URL not found in app/.env." }
  $localDatabaseUrl = $databaseUrlLine -replace '^DATABASE_URL=', ''
  # .env values are quoted; strip surrounding quotes before parsing.
  $localDatabaseUrl = $localDatabaseUrl.Trim('"', "'").Trim()
  if ([string]::IsNullOrWhiteSpace($localDatabaseUrl)) { throw "DATABASE_URL not found in app/.env." }

  # Extract the password segment verbatim (it is URL-encoded in the local URL;
  # reuse the exact segment, do not re-encode).
  # Reuse verbatim. The password in the local URL may already need URL encoding;
  # copy without modification.
  $m = [regex]::Match($localDatabaseUrl, '^[a-z]+://[^:/]+:([^@]+)@')
  if (-not $m.Success) { throw "Could not extract the password segment from local DATABASE_URL." }
  $pwSeg = $m.Groups[1].Value

  # Rebuild both cloud URLs (aws-1 session pooler documented as the working host).
  $newDatabaseUrl = "postgresql://systemfact_app.$ProjectRef`:$pwSeg@aws-1-us-east-2.pooler.supabase.com:6543/postgres?sslmode=require&uselibpqcompat=true"
  $newDirectUrl   = "postgresql://systemfact_app.$ProjectRef`:$pwSeg@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true"

  # Masked sanity print (never the password).
  function Show([string]$label, [string]$url) {
    $masked = $url -replace "://[^:/@]+:[^@/]+@", "://***:***@"
    Write-Host ("{0} -> {1}" -f $label, $masked) -ForegroundColor DarkCyan
  }
  Show "NEW DATABASE_URL" $newDatabaseUrl
  Show "NEW DIRECT_URL"   $newDirectUrl

  # Push to Vercel: Production + Preview for both keys, using the documented
  # non-interactive recipe. --force overwrites the existing secret value.
  # NOTE: EAP must be Continue here - the CLI writes banners to stderr and PS 5.1
  # turns redirected native stderr into a TERMINATING error under Stop. The
  # authoritative verdict is $LASTEXITCODE, checked below.
  $ErrorActionPreference = "Continue"
  foreach ($key in @("DATABASE_URL", "DIRECT_URL")) {
    foreach ($target in @("production", "preview")) {
      $value = if ($key -eq "DATABASE_URL") { $newDatabaseUrl } else { $newDirectUrl }
      Write-Host "-- vercel env add $key $target --force --yes --" -ForegroundColor Cyan
      $result = vercel env add $key $target --value $value --type secret --force --yes 2>&1
      $code = $LASTEXITCODE
      $msg  = ($result | Out-String).Trim()
      if ($msg) { Write-Host $msg -ForegroundColor DarkGray }
      if ($code -ne 0) { throw "vercel env add $key $target exited $code." }
    }
  }
  Write-Host "Env pushed. Redeploy production to pick up new env, then re-run e2e-cloud-prod.ps1." -ForegroundColor Green
  # Read-back verification WITHOUT printing secrets: pull production env to a
  # temp file, boolean-check the marker, delete the file.
  $pullFile = Join-Path ([IO.Path]::GetTempPath()) "vf-check.env"
  vercel env pull --yes --environment production $pullFile *> $null
  if ($LASTEXITCODE -ne 0) { Remove-Item $pullFile -ErrorAction SilentlyContinue; throw "env pull verification failed (exit $LASTEXITCODE)." }
  $checkOk = $true
  foreach ($key in @("DATABASE_URL", "DIRECT_URL")) {
    $line = Select-String -Path $pullFile -Pattern ("^$key=") | Select-Object -First 1
    $hasMarker = $line -and ($line.Line -like "*uselibpqcompat=true*")
    if ($hasMarker) { Write-Host "VERIFY $key contains uselibpqcompat=true: TRUE" -ForegroundColor Green }
    else { Write-Host "VERIFY $key contains uselibpqcompat=true: FALSE" -ForegroundColor Red; $checkOk = $false }
  }
  Remove-Item $pullFile -ErrorAction SilentlyContinue
  if (-not $checkOk) { throw "Read-back verification FAILED - the pushed value is missing the marker." }
}
finally {
  Pop-Location
}
