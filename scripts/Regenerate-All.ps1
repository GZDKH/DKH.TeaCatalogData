<#
.SYNOPSIS
    Regenerates all product JSON files with catalog assignments.
#>

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir

Set-Location $rootDir

$regions = Get-ChildItem -Path ".\docs\regions" -Directory | Select-Object -ExpandProperty Name

foreach ($region in $regions) {
    Write-Host "`n=== $region ===" -ForegroundColor Cyan
    & ".\scripts\Convert-MdToJson.ps1" -SourcePath ".\docs\regions\$region" -OutputPath ".\import\04-products" -RegionOverride $region
}

Write-Host "`n=== COMPLETE ===" -ForegroundColor Green
Write-Host "Regenerated products for $($regions.Count) regions"
