# Copies fresh build artifacts into SolutionPack and produces a versioned zip.
# Called by: npm run pack  (also via npm run release)
#
# pcf-scripts v1.3+ writes to out/controls/{ControlName}/ (NOT out/{ControlName}/).
# {ControlName} is derived from Solution.xml schemaName by stripping the namespace prefix.

$Root       = Split-Path $PSScriptRoot -Parent
$PackFolder = Join-Path $Root "SolutionPack"

# ── Read solution metadata from Solution.xml ──────────────────────────────────

$solutionXml   = Join-Path $PackFolder "Other\Solution.xml"
$xml           = [xml](Get-Content $solutionXml)
$version       = $xml.ImportExportXml.SolutionManifest.Version
$controlSchema = $xml.ImportExportXml.SolutionManifest.RootComponents.RootComponent.schemaName
# schemaName = "MYNAMESPACE.MyPcfControl" — strip the namespace prefix to get the control name
$ControlName   = $controlSchema -replace '^[^.]+\.',''

$zipName     = "${ControlName}_$($version -replace '\.','_').zip"
$Zip         = Join-Path $Root $zipName
$OutDir      = Join-Path $Root "out\controls\$ControlName"
$ControlDest = Join-Path $PackFolder "Controls\$controlSchema"

# ── Remove any previously generated zips ─────────────────────────────────────

Get-ChildItem $Root -Filter "${ControlName}_*.zip" | Remove-Item -Force

# ── Copy fresh build artifacts ────────────────────────────────────────────────

if (-not (Test-Path $OutDir)) {
    Write-Host "ERROR: Build output not found at $OutDir" -ForegroundColor Red
    Write-Host "Run 'npm run rebuild' first." -ForegroundColor Yellow
    exit 1
}

New-Item -ItemType Directory -Force -Path $ControlDest | Out-Null

Copy-Item (Join-Path $OutDir "bundle.js")           (Join-Path $ControlDest "bundle.js")           -Force
Copy-Item (Join-Path $OutDir "ControlManifest.xml") (Join-Path $ControlDest "ControlManifest.xml") -Force

$cssSrc  = Join-Path $OutDir "css"
$cssDest = Join-Path $ControlDest "css"
if (Test-Path $cssSrc) {
    New-Item -ItemType Directory -Force -Path $cssDest | Out-Null
    Copy-Item (Join-Path $cssSrc "*") $cssDest -Force -Recurse
}

# ── Run pac solution pack ─────────────────────────────────────────────────────

pac solution pack --zipfile $Zip --folder $PackFolder --packagetype Unmanaged

if (Test-Path $Zip) {
    Write-Host "Packed: $zipName" -ForegroundColor Green
} else {
    Write-Host "Pack failed - zip not created" -ForegroundColor Red
    exit 1
}
