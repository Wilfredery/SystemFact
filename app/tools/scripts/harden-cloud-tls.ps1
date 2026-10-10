<#
.SYNOPSIS
    Harden-cloud-tls: scrubs sslmode/uselibpqcompat params from the Vercel
    DATABASE_URL/DIRECT_URL values so the app's explicit ssl config (pinned
    Supabase Root 2021 CA, full verification) applies.

.DESCRIPTION
    Backlog item 2 (TLS hardening). app/src/lib/supabase-ssl.ts now returns an
    explicit ssl object for *.pooler.supabase.com DSNs. BUT pg 8.23's
    connection-parameters.js merges parse(connectionString) LAST, so any
    ?sslmode=...&uselibpqcompat=true parameter on the DSN OVERRIDES the object
    and keeps verification disabled. The env values must therefore be the
    plain DSN (no TLS query params); TLS behavior is fully code-owned.

    Read-back verification asserts the scrubbed marker: both values contain
    "sslmode=" -> FALSE (the inverse marker check of fix-cloud-ssl.ps1).

    The systemfact_app role password is REUSED from app/.env (adoption of the
    documented fix-cloud-ssl.ps1 pattern). The plaintext never prints, never
    configures a file, and never enters a command-line parameter visible in
    the transcript. Only masked confirmations go to stdout.

.USAGE
    From repo root:
      powershell -ExecutionPolicy Bypass -File app/tools/scripts/harden-cloud-tls.ps1
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
  $m = [regex]::Match($localDatabaseUrl, '^[a-z]+://[^:/]+:([^@]+)@')
  if (-not $m.Success) { throw "Could not extract the password segment from local DATABASE_URL." }
  $pwSeg = $m.Groups[1].Value

  # Rebuild both cloud URLs WITHOUT any sslmode/uselibpqcompat params
  # (aws-1 session pooler documented as the working host).
  $newDatabaseUrl = "postgresql://systemfact_app.$ProjectRef`:$pwSeg@aws-1-us-east-2.pooler.supabase.com:6543/postgres"
  $newDirectUrl   = "postgresql://systemfact_app.$ProjectRef`:$pwSeg@aws-1-us-east-2.pooler.supabase.com:5432/postgres"

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
  Write-Host "Scrubbed env pushed. Redeploy production, then re-run e2e-cloud-prod.ps1." -ForegroundColor Green
  # Read-back verification WITHOUT printing secrets: pull production env to a
  # temp file, assert the sslmode marker is GONE, delete the file.
  $pullFile = Join-Path ([IO.Path]::GetTempPath()) "vf-check-tls.env"
  vercel env pull --yes --environment production $pullFile *> $null
  if ($LASTEXITCODE -ne 0) { Remove-Item $pullFile -ErrorAction SilentlyContinue; throw "env pull verification failed (exit $LASTEXITCODE)." }
  $checkOk = $true
  foreach ($key in @("DATABASE_URL", "DIRECT_URL")) {
    $line = Select-String -Path $pullFile -Pattern ("^$key=") | Select-Object -First 1
    $stillHasMarker = $line -and ($line.Line -match "sslmode=|uselibpqcompat=")
    if ($stillHasMarker) { Write-Host "VERIFY $key free of sslmode/uselibpqcompat: FALSE" -ForegroundColor Red; $checkOk = $false }
    else { Write-Host "VERIFY $key free of sslmode/uselibpqcompat: TRUE" -ForegroundColor Green }
  }
  Remove-Item $pullFile -ErrorAction SilentlyContinue
  if (-not $checkOk) { throw "Read-back verification FAILED - a pushed value still carries TLS params." }
}
finally {
  Pop-Location
}
