$json = Get-Content 'D:\projects\GZDKH\DKH.TeaCatalogData\import\02-specifications\specification_attribute_options.json' -Raw | ConvertFrom-Json
$flat = @()
foreach ($group in $json) {
    foreach ($opt in $group.options) {
        $flat += [PSCustomObject]@{
            code = $opt.code
            attribute = $group.attribute
            order = $opt.order
            published = $opt.published
            translations = $opt.translations
        }
    }
}
$flat | ConvertTo-Json -Depth 10 | Out-File 'D:\projects\GZDKH\DKH.TeaCatalogData\import\02-specifications\specification_attribute_options.json' -Encoding UTF8
Write-Host "Flattened: $($flat.Count) options"
