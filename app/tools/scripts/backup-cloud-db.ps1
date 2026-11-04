<#
.SYNOPSIS
    Logical backup (pg_dump) of the SystemFact cloud database to off-platform
    storage, with a verified restorable artifact.

.DESCRIPTION
    docs/22 T0 deliverable. The cloud project runs on the Supabase FREE plan, which
    has NO automatic backups and pauses after one week of inactivity (it happened on
    2026-11-03). Fiscal documents are legally retained and never deleted, so losing
    this database is not a re-seed: it is unrecoverable. This script is the only
    recovery path that exists.

    Design rules (do not weaken them):

      1. The database password is read as HIDDEN input (or from an out-of-repo file
         for unattended runs) and lives only in this process environment. It is
         never written to disk by this script, never echoed, and never placed in a
         command line that another process can read: `docker run -e PGPASSWORD`
         forwards the value from the client environment, so the argv carries only
         the variable name.

      2. pg_dump runs inside the `postgres:17.6` image, the same major as the cloud
         server. A recovery tool must not depend on a build step: this script needs
         Docker and nothing else - no host psql, no pnpm install, no node_modules.

      3. The artifact is VERIFIED, not assumed. The number of tables with data in
         the dump's table of contents must equal the number of tables in the source
         catalog. A dump that silently dumped nothing (wrong database, wrong role,
         empty catalog) fails here instead of looking like a backup. "Produces an
         artifact that looks right" is the failure mode this check exists to stop.

      4. Restore is documented and rehearsed: see app/BACKUP-RESTORE.md.

.PARAMETER ProjectRef
    Supabase project ref. Defaults to this project. Validated as 20 lowercase
    alphanumeric characters.

.PARAMETER OutDir
    Destination directory. Defaults to `$env:OneDrive\SystemFactBackups` when a
    OneDrive folder exists (that is the off-platform part), otherwise
    `%USERPROFILE%\SystemFactBackups` with a loud warning that a dump on the same
    disk as the developer machine is not off-platform storage.

.PARAMETER HostName
    Explicit host(s) to try, in order. Overrides the built-in candidate list. Use
    `host.docker.internal` to rehearse against a locally running Postgres.

.PARAMETER Port
    Postgres port. Default 5432 (session mode). The transaction pooler on 6543 does
    NOT support pg_dump and is never a candidate.

.PARAMETER DbUser
    Role to connect as. Defaults to `postgres.<ref>` for a Supabase pooler host and
    `postgres` for anything else.

.PARAMETER Database
    Database name. Default `postgres`.

.PARAMETER RetentionDays
    Delete `*.dump` artifacts older than this many days from OutDir. Default 30.
    Honours -WhatIf.

.PARAMETER SslMode
    libpq sslmode for the connection. Default `require` (the Supabase pooler refuses
    plaintext). A locally running Postgres without TLS needs `disable`.

.PARAMETER PasswordFile
    Path to a file holding the password, for UNATTENDED (scheduled) runs only. It
    must live outside this repository - the script refuses a path inside the repo,
    because a fiscal database password in a git working tree is one `git add .` away
    from being published. Prefer the hidden prompt for manual runs, and restrict the
    file to the current user:
        icacls "<path>" /inheritance:r /grant:r "$env:USERNAME:(R)"

.PARAMETER HostDirect
    Also try the direct host `db.<ref>.supabase.co`, which only resolves when the
    project has the Direct Connection IPv4 add-on or IPv6 is available locally.

.EXAMPLE
    Manual backup, hidden password prompt:
      powershell -ExecutionPolicy Bypass -File app/tools/scripts/backup-cloud-db.ps1

.EXAMPLE
    Scheduled backup from a task, password in an out-of-repo file:
      powershell -ExecutionPolicy Bypass -File app/tools/scripts/backup-cloud-db.ps1 `
        -PasswordFile "$env:USERPROFILE\.systemfact\db-password.txt"

.EXAMPLE
    Rehearse the whole pipeline against the local Supabase stack (no cloud access):
      powershell -ExecutionPolicy Bypass -File app/tools/scripts/backup-cloud-db.ps1 `
        -HostName host.docker.internal -Port 54322 -DbUser postgres -OutDir "$env:TEMP\sf-rehearsal"
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$ProjectRef = "tcyxwkcrmontkrtbyxfm",
  [string]$OutDir,
  [string[]]$HostName,
  [int]$Port = 5432,
  [string]$DbUser,
  [string]$Database = "postgres",
  [ValidateSet("require", "disable", "verify-ca", "verify-full")]
  [string]$SslMode = "require",
  [int]$RetentionDays = 30,
  [string]$PasswordFile,
  [switch]$HostDirect
)

$ErrorActionPreference = "Stop"
$image = "postgres:17.6"

if ($ProjectRef -notmatch '^[a-z0-9]{20}$') {
  throw "ProjectRef '$ProjectRef' does not look like a Supabase project ref (20 lowercase alphanumeric chars)."
}

# --- Output directory: prefer something that is actually off-platform ----------

if ([string]::IsNullOrWhiteSpace($OutDir)) {
  if ($env:OneDrive -and (Test-Path -LiteralPath $env:OneDrive)) {
    $OutDir = Join-Path $env:OneDrive "SystemFactBackups"
  } else {
    $OutDir = Join-Path $env:USERPROFILE "SystemFactBackups"
    Write-Warning "No OneDrive folder found. Writing to '$OutDir', which is on THIS machine only. Set -OutDir to a synced or external location: a dump that dies with the laptop is not a backup."
  }
}
if (-not (Test-Path -LiteralPath $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path

# --- Preconditions -------------------------------------------------------------

& docker version --format '{{.Server.Version}}' 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Docker is not reachable. This script runs pg_dump inside the $image image on purpose (see design rule 2). Start Docker Desktop and retry."
}

# --- Credential handling -------------------------------------------------------

# Never inherit a stale value from the caller: this process sets it explicitly below.
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
$plain = $null

if ($PasswordFile) {
  $full = (Resolve-Path -LiteralPath $PasswordFile).Path
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
  if ($full.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to read a database password from inside the repository ('$full'). Move it outside the repo and restrict it with icacls."
  }
  $plain = (Get-Content -LiteralPath $full -Raw).Trim()
  if ([string]::IsNullOrWhiteSpace($plain)) { throw "Password file '$full' is empty." }
  Write-Host "Password read from an out-of-repo file. Restrict it with icacls and treat it as a secret." -ForegroundColor Yellow
} else {
  $secure = Read-Host "Postgres password (project $ProjectRef)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ([string]::IsNullOrWhiteSpace($plain)) { throw "Empty password - aborted." }
}

$env:PGPASSWORD = $plain

try {
  Write-Host "== SystemFact cloud backup ==" -ForegroundColor Cyan
  Write-Host "Project : $ProjectRef"
  Write-Host "Output  : $OutDir"
  Write-Host "Engine  : $image (pg_dump runs inside the image)"
  Write-Host ""

  # --- Host discovery: session pooler supports pg_dump, transaction pooler does not
  # Supavisor tenant placement is NOT stable. On 2026-11-04 `aws-0-us-east-2` answered
  # `FATAL: (ENOTFOUND) tenant/user postgres.<ref> not found` while `aws-1-us-east-2`
  # accepted the same user, so aws-1 is probed first. Treat this list as a hint, never
  # as a fact: the probe below decides which host actually hosts the tenant.
  $candidates = if ($HostName -and $HostName.Count -gt 0) {
    $HostName
  } elseif ($HostDirect) {
    @("db.$ProjectRef.supabase.co", "aws-1-us-east-2.pooler.supabase.com", "aws-0-us-east-2.pooler.supabase.com")
  } else {
    @("aws-1-us-east-2.pooler.supabase.com", "aws-0-us-east-2.pooler.supabase.com")
  }

  function Resolve-User([string]$host_) {
    if ($DbUser) { return $DbUser }
    if ($host_ -like "*.supabase.co" -or $host_ -like "*.pooler.supabase.com") { return "postgres.$ProjectRef" }
    return "postgres"
  }

  # Native stderr must NEVER terminate this script. With $ErrorActionPreference = 'Stop'
  # a failed `docker run` raises NativeCommandError, and the operator sees a stack trace
  # instead of the diagnosis (that is exactly what happened on 2026-11-04: the first
  # candidate's "tenant/user not found" aborted the run before the second was tried).
  # Every docker call goes through here and returns its text AND exit code.
  function Invoke-DockerNative {
    param([string[]]$DockerArgs)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $raw = & docker @DockerArgs 2>&1
      $code = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previous
    }
    $joined = (@($raw) | ForEach-Object { "$_" }) -join "`n"
    return [pscustomobject]@{ Exit = $code; Text = $joined }
  }

  function Invoke-Probe([string]$targetHost, [string]$user_) {
    return (Invoke-DockerNative @(
        "run", "--rm", "-e", "PGPASSWORD", "-e", "PGSSLMODE=$SslMode", $image,
        "psql", "-h", $targetHost, "-p", "$Port", "-U", $user_, "-d", $Database, "-tAc", "select 1"
      ))
  }

  # Order matters: Supavisor reports a unknown tenant as `(ENOTFOUND) tenant/user ...`,
  # so the TENANT test must run before the generic network test.
  function Get-FailureClass([string]$text) {
    if ($text -match 'tenant/user .* not found') { return 'TENANT' }
    if ($text -match 'password authentication failed|28P01|28000') { return 'AUTH' }
    if ($text -match 'could not translate host name|Name or service not known|ECONNREFUSED|ETIMEDOUT|no route to host') { return 'NET' }
    return 'OTHER'
  }

  $chosenHost = $null
  $chosenUser = $null
  $failures = @()
  foreach ($candidate in $candidates) {
    $u = Resolve-User $candidate
    $masked = "{0}@{1}:{2}/{3}" -f $u, $candidate, $Port, $Database
    Write-Host "Probing $masked ..." -ForegroundColor DarkGray -NoNewline
    $probe = Invoke-Probe $candidate $u
    if ($probe.Exit -eq 0) {
      Write-Host " OK" -ForegroundColor Green
      $chosenHost = $candidate
      $chosenUser = $u
      break
    }
    $class = Get-FailureClass $probe.Text
    Write-Host " $class" -ForegroundColor Red
    $failures += ("{0} -> {1}" -f $masked, $class)
    if ($class -eq 'AUTH') {
      # This host HAS the tenant; the credentials are wrong. Falling through to another
      # host would hide the real problem behind a misleading 'no candidate worked'.
      throw "Password rejected by $candidate. That host is the right one (the tenant exists there), so the problem is the password, not the network. Nothing was dumped."
    }
  }
  if (-not $chosenHost) {
    $detail = if ($failures.Count -gt 0) { $failures -join '; ' } else { 'no candidate was tried' }
    throw "No candidate host accepted the connection. Tried: $detail. TENANT means that pooler does not host this project any more (Supavisor moved it - try the other aws-N host); NET means it is unreachable from here (the direct host needs the IPv4 add-on). A paused free-plan project answers nothing at all."
  }

  # --- Independent expectation: how many tables does the source actually have? ---
  $countProbe = Invoke-DockerNative @(
    "run", "--rm", "-e", "PGPASSWORD", "-e", "PGSSLMODE=$SslMode", $image,
    "psql", "-h", $chosenHost, "-p", "$Port", "-U", $chosenUser, "-d", $Database, "-tAc",
    "select count(*) from pg_tables where schemaname = 'public'"
  )
  $sourceTables = $countProbe.Text.Trim()
  if ($countProbe.Exit -ne 0 -or $sourceTables -notmatch '^\d+$') {
    throw "Could not count source tables (exit $($countProbe.Exit)): $sourceTables. Refusing to produce an unverified artifact."
  }
  $sourceTables = [int]$sourceTables
  if ($sourceTables -eq 0) {
    throw "The source reports ZERO tables in schema 'public'. That is the wrong database or the wrong role, not a backup."
  }
  Write-Host "Source tables (public): $sourceTables" -ForegroundColor DarkGray

  # --- Dump ---------------------------------------------------------------------
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $name = "systemfact-cloud-$ProjectRef-$stamp.dump"
  $artifact = Join-Path $OutDir $name
  $mountArg = "type=bind,source=$OutDir,target=/backup"

  Write-Host "Dumping (custom format, this is the slow part) ..." -ForegroundColor Cyan
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $dumpRun = Invoke-DockerNative @(
    "run", "--rm", "-e", "PGPASSWORD", "-e", "PGSSLMODE=$SslMode", "--mount", $mountArg, $image,
    "pg_dump", "-h", $chosenHost, "-p", "$Port", "-U", $chosenUser, "-d", $Database,
    "--format=custom", "--compress=6", "--no-password", "--file=/backup/$name"
  )
  $sw.Stop()
  if ($dumpRun.Exit -ne 0) {
    throw "pg_dump failed with exit code $($dumpRun.Exit): $($dumpRun.Text.Trim()). No artifact was recorded."
  }
  if (-not (Test-Path -LiteralPath $artifact)) {
    throw "pg_dump reported success but '$artifact' does not exist. Investigate before trusting any backup."
  }

  # --- Verify the artifact: real archive, and every source table carries data ---
  Write-Host "Verifying the artifact ..." -ForegroundColor Cyan
  $tocRun = Invoke-DockerNative @("run", "--rm", "--mount", $mountArg, $image, "pg_restore", "--list", "/backup/$name")
  if ($tocRun.Exit -ne 0) {
    throw "pg_restore cannot read the artifact back ('$artifact'): $($tocRun.Text.Trim()). An unreadable dump is not a backup."
  }
  $dumpedTables = @($tocRun.Text -split "`n" | Select-String -Pattern 'TABLE DATA public ').Count
  if ($dumpedTables -ne $sourceTables) {
    throw ("Artifact declares {0} tables with data but the source has {1}. Treat '$artifact' as INVALID: inspect before deleting it, and restore from a different artifact if one exists." -f $dumpedTables, $sourceTables)
  }

  $sizeMb = [math]::Round((Get-Item -LiteralPath $artifact).Length / 1MB, 2)
  $hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
  $sidecar = "$artifact.sha256"
  $manifestLine = (("{0}  {1}" -f $hash, $name) + [Environment]::NewLine)
  [IO.File]::WriteAllText($sidecar, $manifestLine, (New-Object Text.UTF8Encoding($false)))

  Write-Host ""
  Write-Host "Backup OK" -ForegroundColor Green
  Write-Host "  artifact : $artifact"
  Write-Host "  size     : $sizeMb MB"
  Write-Host "  tables   : $dumpedTables (source $sourceTables)"
  Write-Host "  sha256   : $hash"
  Write-Host "  dump time: $([math]::Round($sw.Elapsed.TotalSeconds,1)) s"
  Write-Host ""
  Write-Host "Restore (destructive, see app/BACKUP-RESTORE.md):" -ForegroundColor Yellow
  Write-Host "  pg_restore --clean --if-exists --no-owner --no-privileges -h <host> -U <user> -d <db> `"$artifact`""

  # --- Retention ----------------------------------------------------------------
  $cutoff = (Get-Date).AddDays(-$RetentionDays)
  $stale = Get-ChildItem -LiteralPath $OutDir -Filter "systemfact-cloud-*.dump" -File |
    Where-Object { $_.LastWriteTime -lt $cutoff -and $_.FullName -ne $artifact }
  foreach ($old in $stale) {
    if ($PSCmdlet.ShouldProcess($old.FullName, "Delete backup older than $RetentionDays days")) {
      Remove-Item -LiteralPath $old.FullName -Force
      if (Test-Path -LiteralPath "$($old.FullName).sha256") {
        Remove-Item -LiteralPath "$($old.FullName).sha256" -Force
      }
      Write-Host "  pruned: $($old.Name)" -ForegroundColor DarkGray
    }
  }
}
catch {
  # Expected failures (wrong host, wrong password, unverifiable artifact) are answers,
  # not crashes: print the diagnosis as one line and exit non-zero so a scheduled task
  # records a real failure without a PowerShell error record dumped over the reason.
  Write-Host ""
  Write-Host "BACKUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
}
