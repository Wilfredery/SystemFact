# sdd-archive-compose.ps1 — deterministic local reimplementation of the native
# `gentle-ai sdd-archive-compose` semantics (skill v2.0 contract), while the
# upstream binary has not shipped the SDD command suite yet.
#
# Semantics (byte-deterministic, no model mediation at runtime):
#   - MODIFIED delta blocks (under "## MODIFIED Requirements") REPLACE the
#     canonical requirement block with the EXACT same "### Requirement: <title>"
#     id line. Exit 1 if the id is not found (loud failure, no silent drop).
#   - ADDED delta blocks (under "## ADDED Requirements") are APPENDED at the end
#     of the canonical file. Exit 1 if a "Requirement" with the same id already
#     exists there.
#   - Output is written to <output> atomically; caller moves it over the
#     canonical path after reviewing (native contract: .compose-tmp + mv).
#
# Usage:
#   .\app\tools\scripts\sdd-archive-compose.ps1 `
#     -Canonical "openspec/specs/producto/spec.md" `
#     -Delta "openspec/changes/optimizacion-baseline/specs/producto/spec.md" `
#     -Output "openspec/specs/producto/spec.md.compose-tmp"

param(
  [Parameter(Mandatory = $true)][string]$Canonical,
  [Parameter(Mandatory = $true)][string]$Delta,
  [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = 'Stop'

# UTF8 no-BOM only — never PowerShell default encodings (repo rule for any
# machine-consumed text).
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

if (-not (Test-Path -LiteralPath $Canonical)) { Write-Error "Canonical not found: $Canonical"; exit 1 }
if (-not (Test-Path -LiteralPath $Delta)) { Write-Error "Delta not found: $Delta"; exit 1 }

$canonicalText = [System.IO.File]::ReadAllText((Resolve-Path $Canonical).Path)
$deltaText = [System.IO.File]::ReadAllText((Resolve-Path $Delta).Path)

function Get-RequirementBlocks([string]$sectionText) {
  # Yields blocks starting at "### Requirement: ..." up to the next
  # requirement heading or the next top-level "## " heading or EOF.
  $starts = New-Object System.Collections.Generic.List[int]
  $idx = 0
  while ($true) {
    $idx = $sectionText.IndexOf('### Requirement: ', $idx)
    if ($idx -lt 0) { break }
    $starts.Add($idx)
    $idx++
  }
  $blocks = @()
  for ($i = 0; $i -lt $starts.Count; $i++) {
    $start = $starts[$i]
    $lineEnd = $sectionText.IndexOf("`n", $start)
    if ($lineEnd -lt 0) { $lineEnd = $sectionText.Length - 1 }
    $title = $sectionText.Substring($start, $lineEnd - $start).Trim()
    # find section end: next "### Requirement:" or "\n## " after this heading
    $endCandidates = @()
    $nextReq = $sectionText.IndexOf("`n### Requirement: ", $lineEnd)
    if ($nextReq -ge 0) { $endCandidates += $nextReq }
    $nextH2 = $sectionText.IndexOf("`n## ", $lineEnd)
    if ($nextH2 -ge 0) { $endCandidates += $nextH2 }
    $end = $sectionText.Length
    if ($endCandidates.Count -gt 0) { $end = ($endCandidates | Measure-Object -Minimum).Minimum }
    $blocks += [pscustomobject]@{ Title = $title; Start = $start; End = $end }
  }
  return $blocks
}

function Get-SectionText([string]$text, [string]$header) {
  $h = $text.IndexOf($header)
  if ($h -lt 0) { return [string]::Empty }
  $afterHeader = $text.IndexOf("`n", $h)
  if ($afterHeader -lt 0) { return [string]::Empty }
  # section runs until the next top-level "## " heading or EOF
  $end = $text.IndexOf("`n## ", $afterHeader)
  if ($end -lt 0) { $end = $text.Length }
  return $text.Substring($afterHeader, $end - $afterHeader)
}

$modifiedSection = Get-SectionText $deltaText '## MODIFIED Requirements'
$addedSection = Get-SectionText $deltaText '## ADDED Requirements'

$modifiedBlocks = Get-RequirementBlocks $modifiedSection
$addedBlocks = Get-RequirementBlocks $addedSection

if ($modifiedBlocks.Count -eq 0 -and $addedBlocks.Count -eq 0) {
  Write-Error "Delta has no MODIFIED/ADDED requirement blocks: $Delta"
  exit 1
}

$result = $canonicalText
$failed = $false

foreach ($block in $modifiedBlocks) {
  $blockText = $modifiedSection.Substring($block.Start, $block.End - $block.Start)
  $titleLine = $block.Title
  $targetStart = $result.IndexOf($titleLine)
  if ($targetStart -lt 0) {
    Write-Error "MODIFIED target not found in canonical: '$titleLine' ($Delta)"
    $failed = $true
    continue
  }
  # find the end of the TARGET block inside the canonical text
  $targetLineEnd = $result.IndexOf("`n", $targetStart)
  if ($targetLineEnd -lt 0) { $targetLineEnd = $result.Length - 1 }
  $endCandidates = @()
  $nextReq = $result.IndexOf("`n### Requirement: ", $targetLineEnd)
  if ($nextReq -ge 0) { $endCandidates += $nextReq }
  $nextH2 = $result.IndexOf("`n## ", $targetLineEnd)
  if ($nextH2 -ge 0) { $endCandidates += $nextH2 }
  $targetEnd = $result.Length
  if ($endCandidates.Count -gt 0) { $targetEnd = ($endCandidates | Measure-Object -Minimum).Minimum }
  if ($targetEnd -lt $targetStart) {
    Write-Error "Computed block end before start for '$titleLine' in $Delta (targetStart=$targetStart targetEnd=$targetEnd)"
    $failed = $true
    continue
  }
  $head = if ($targetStart -gt 0) { $result.Substring(0, $targetStart) } else { '' }
  $tail = if ($targetEnd -lt $result.Length) { $result.Substring($targetEnd).TrimStart("`r", "`n") } else { '' }
  $result = $head + $blockText.TrimEnd() + "`n" + $tail
}

foreach ($block in $addedBlocks) {
  $blockText = $addedSection.Substring($block.Start, $block.End - $block.Start)
  $titleLine = $block.Title
  if ($result.IndexOf($titleLine) -ge 0) {
    Write-Error "ADDED id already present in canonical: '$titleLine' ($Delta)"
    $failed = $true
    continue
  }
  $result = $result.TrimEnd("`r", "`n") + "`n" + $blockText.TrimEnd() + "`n"
}

if ($failed) { exit 1 }

# tidy separator used between appended ADDED blocks: drop the placeholder "## "
if ($result.Contains("`n## `n")) { $result = $result.Replace("`n## `n", "`n") }
$result = $result.TrimEnd() + "`n"

[System.IO.File]::WriteAllText((Join-Path $PWD $Output), $result, $Utf8NoBom)
Write-Output "COMPOSED: $Delta -> $Output (modified=$($modifiedBlocks.Count), added=$($addedBlocks.Count))"
