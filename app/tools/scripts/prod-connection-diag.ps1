<#
.SYNOPSIS
    Verboso connection diagnostic for the Supabase prod candidates.
    Prints EVERY candidate's failure class (AUTH/NET/DBS/OTHER) so a failed
    discovery is debuggable instead of silently swallowed (the production
    launcher `supabase-prod-migrate.ps1` keeps its terse behaviour).

.USAGE
    From repo root:
      powershell -ExecutionPolicy Bypass -File app/tools/scripts/prod-connection-diag.ps1

    Optional:
      -DirectHost   also test the direct host db.<ref>.supabase.co:5432
      -Port6543     also test the transaction pooler port 6543 (pgbouncer)
#>
param(
  [string]$ProjectRef = "tcyxwkcrmontkrtbyxfm",
  [switch]$DirectHost,
  [switch]$Port6543
)
$ErrorActionPreference = "Stop"
if ($ProjectRef -notmatch '^[a-z0-9]{20}$') { throw "ProjectRef no parece un ref de Supabase (20 alfanumerico): '$ProjectRef'" }

$appDir = $PSScriptRoot
Push-Location (Resolve-Path $appDir)
try {
  Write-Host "== Supabase prod connection diagnostic ==" -ForegroundColor Cyan
  Write-Host "Password de entrada oculta: NO se persiste ni se muestra." -ForegroundColor Yellow

  $secure = Read-Host "Postgres password (project $ProjectRef)" -AsSecureString
  $bstr  = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($plain)) { throw "Password vacio - abortado." }
  $pwEnc = [uri]::EscapeDataString($plain)

  $candidates = @(
    @{ Label = "Session pooler  aws-0 (5432)"; Url = "postgresql://postgres.$ProjectRef`:$pwEnc@aws-0-us-east-2.pooler.supabase.com:5432/postgres" },
    @{ Label = "Session pooler  aws-1 (5432)"; Url = "postgresql://postgres.$ProjectRef`:$pwEnc@aws-1-us-east-2.pooler.supabase.com:5432/postgres" },
    @{ Label = "Transaction pooler aws-0 (6543)"; Url = "postgresql://postgres.$ProjectRef`:$pwEnc@aws-0-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true" },
    @{ Label = "Direct host  db.<ref>.supabase.co (5432)"; Url = "postgresql://postgres`:$pwEnc@db.$ProjectRef.supabase.co:5432/postgres" }
  )

  $ok = $false
  foreach ($c in $candidates) {
    if (($c.Label -match "Direct" -and -not $DirectHost) -or ($c.Label -match "6543" -and -not $Port6543)) { continue }
    Write-Host ("-- {0} --" -f $c.Label) -ForegroundColor DarkCyan
    $env:DIRECT_URL = $c.Url
    pnpm exec tsx tools/scripts/prod-connection-diag.ts
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  }
  if ($ok) { Write-Host "AL MENOS UN CANDIDATO FUNCIONA - lleve ese label al deploy." -ForegroundColor Green }
  else { Write-Host "NINGUN CANDIDATO CONECTO - pegue el bloque de arriba tal cual en el chat." -ForegroundColor Red }
}
finally {
  Remove-Item Env:DIRECT_URL, Env:PGPASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
