<#
.SYNOPSIS
    Validates JSON files for ProductCatalogService import.
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [string]$Profile = "products"
)

function Validate-JsonFile {
    param([string]$FilePath)
    
    Write-Host "Validating: $(Split-Path $FilePath -Leaf)"
    
    try {
        $content = Get-Content $FilePath -Raw -Encoding UTF8
        $json = $content | ConvertFrom-Json
        $count = if ($json -is [array]) { $json.Count } else { 1 }
        Write-Host "  [OK] Valid JSON ($count records)" -ForegroundColor Green
        return @{ valid = $true; count = $count }
    }
    catch {
        Write-Host "  [FAILED] $($_.Exception.Message)" -ForegroundColor Red
        return @{ valid = $false; count = 0 }
    }
}

# Main
$files = @()

if (Test-Path $Path -PathType Leaf) {
    $files = @(Get-Item $Path)
}
elseif (Test-Path $Path -PathType Container) {
    $files = Get-ChildItem -Path $Path -Filter "*.json" -File
}
else {
    Write-Error "Path not found: $Path"
    exit 1
}

Write-Host "`n=== JSON Validation ===" -ForegroundColor Cyan
Write-Host "Files: $($files.Count)"
Write-Host ""

$valid = 0
$invalid = 0
$totalRecords = 0

foreach ($file in $files) {
    $result = Validate-JsonFile $file.FullName
    if ($result.valid) {
        $valid++
        $totalRecords += $result.count
    } else {
        $invalid++
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Valid: $valid files ($totalRecords records)" -ForegroundColor Green
Write-Host "Invalid: $invalid files" -ForegroundColor $(if ($invalid -gt 0) { "Red" } else { "Green" })

exit $(if ($invalid -gt 0) { 1 } else { 0 })
