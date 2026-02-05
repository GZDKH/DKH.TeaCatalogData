<#
.SYNOPSIS
    Converts MD tea documentation files to JSON for ProductCatalogService import.
#>

param(
    [string]$SourcePath = ".\docs\regions",
    [string]$OutputPath = ".\import\04-products",
    [string]$SingleFile = "",
    [string]$RegionOverride = "",
    [string]$MappingPath = ".\scripts\mappings\catalog-mapping.json"
)

# Load catalog mapping
$catalogMapping = @{}
if (Test-Path $MappingPath) {
    $mappingContent = Get-Content $MappingPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $mappingContent.regionToCatalog.PSObject.Properties | ForEach-Object {
        $catalogMapping[$_.Name] = $_.Value
    }
    Write-Host "Loaded catalog mapping: $($catalogMapping.Count) regions"
}

function Get-CatalogForRegion {
    param([string]$region)
    $key = $region.ToLower()
    if ($catalogMapping.ContainsKey($key)) {
        return $catalogMapping[$key]
    }
    return "CATALOG-HERBAL"  # Default fallback
}

function Get-TeaTypeFromPath {
    param([string]$path)
    if ($path -match "green") { return "SPEC-TYPE-GREEN" }
    if ($path -match "white") { return "SPEC-TYPE-WHITE" }
    if ($path -match "yellow") { return "SPEC-TYPE-YELLOW" }
    if ($path -match "oolong") { return "SPEC-TYPE-OOLONG" }
    if ($path -match "red") { return "SPEC-TYPE-RED" }
    if ($path -match "dark") { return "SPEC-TYPE-DARK" }
    if ($path -match "puerh") { return "SPEC-TYPE-PUERH-SHENG" }
    if ($path -match "jasmine") { return "SPEC-TYPE-JASMINE" }
    return "SPEC-TYPE-GREEN"
}

function Convert-ToSeoName {
    param([string]$name)
    $seo = $name.ToLower()
    $seo = $seo -replace "[^a-z0-9\s-]", ""
    $seo = $seo -replace "\s+", "-"
    $seo = $seo -replace "-+", "-"
    return $seo.Trim("-")
}

function Generate-ProductCode {
    param([string]$name, [string]$region)
    $regionCode = $region.ToUpper()
    if ($regionCode.Length -gt 3) { $regionCode = $regionCode.Substring(0, 3) }
    $nameClean = $name -replace "[^a-zA-Z0-9]", ""
    if ($nameClean.Length -gt 12) { $nameClean = $nameClean.Substring(0, 12) }
    return "TEA-$regionCode-$($nameClean.ToUpper())"
}

function Extract-BrewingTemp {
    param([string]$content)
    if ($content -match "(\d{2,3})\s*[-]\s*(\d{2,3})\s*[C]") {
        return "$($Matches[1])-$($Matches[2])C"
    }
    return $null
}

function Parse-MdFile {
    param([string]$filePath, [string]$region)
    
    $content = Get-Content $filePath -Raw -Encoding UTF8
    $fileName = [System.IO.Path]::GetFileNameWithoutExtension($filePath)
    $title = $fileName -replace "^#\s*", ""
    
    $teaType = Get-TeaTypeFromPath $filePath.ToLower()
    
    $descContent = $content
    if ($descContent.Length -gt 500) { $descContent = $descContent.Substring(0, 500) }
    $descContent = $descContent -replace "`r`n", " " -replace "`n", " "
    
    $catalogCode = Get-CatalogForRegion $region

    $product = @{
        code = Generate-ProductCode $title $region
        sku = "SKU-" + (Get-Random -Maximum 999999).ToString("D6")
        catalog = $catalogCode
        order = 1
        published = $true
        translations = @(
            @{
                lang = "ru"
                name = $title
                description = $descContent
                seoName = Convert-ToSeoName $title
            }
        )
        specs = @(
            @{
                attribute = "SPEC-TEA-TYPE"
                option = $teaType
                type = "Option"
                showOnPage = $true
                order = 1
            }
        )
        tags = @()
        origins = @()
    }
    
    return $product
}

function Process-Directory {
    param([string]$path, [string]$outputPath, [string]$regionName)
    
    $mdFiles = Get-ChildItem -Path $path -Filter "*.md" -Recurse -ErrorAction SilentlyContinue
    $products = @()
    $count = 0
    
    foreach ($file in $mdFiles) {
        $count++
        Write-Host "[$count] $($file.Name)"
        try {
            $product = Parse-MdFile $file.FullName $regionName
            $products += $product
        }
        catch {
            Write-Warning "Error: $_"
        }
    }
    
    if ($products.Count -gt 0) {
        $outputFile = Join-Path $outputPath "products-$regionName.json"
        $products | ConvertTo-Json -Depth 10 | Out-File $outputFile -Encoding UTF8
        Write-Host "Created: $outputFile ($($products.Count) products)"
    }
    
    return $products
}

# Main
if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}

if ($SingleFile -and (Test-Path $SingleFile)) {
    $product = Parse-MdFile $SingleFile "other"
    $product | ConvertTo-Json -Depth 10
}
else {
    # Determine region name from path or override
    if ($RegionOverride) {
        $regionName = $RegionOverride
    } else {
        $regionName = Split-Path $SourcePath -Leaf
    }
    $products = Process-Directory -path $SourcePath -outputPath $OutputPath -regionName $regionName
    Write-Host "Total: $($products.Count) products"
}
