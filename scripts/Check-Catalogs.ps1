<#
.SYNOPSIS
    Check catalog assignments in product files.
#>

$productsPath = "D:\projects\GZDKH\DKH.TeaCatalogData\import\04-products"
$files = Get-ChildItem $productsPath -Filter "*.json"

Write-Host "=== Catalog Assignments ===" -ForegroundColor Cyan

foreach ($f in $files) {
    $json = Get-Content $f.FullName -Raw | ConvertFrom-Json
    $catalog = $json[0].catalog
    $count = $json.Count
    Write-Host "$($f.Name): $catalog ($count products)"
}
