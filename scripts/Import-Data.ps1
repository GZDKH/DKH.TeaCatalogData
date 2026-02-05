<#
.SYNOPSIS
    Imports JSON data into ProductCatalogService via gRPC DataExchangeService.

.DESCRIPTION
    Uses the DataExchangeService.Import gRPC endpoint to import JSON files.
    Supports all 12 import profiles.

.PARAMETER Profile
    Import profile: catalogs, categories, products, brands, manufacturers, tags, packages,
    specification_attributes, specification_attribute_options, specification_attribute_groups,
    product_attributes, product_attribute_options

.PARAMETER File
    Path to JSON file to import.

.PARAMETER ServiceUrl
    gRPC service URL (default: http://localhost:5003)

.PARAMETER DryRun
    Validate only, don't actually import.

.PARAMETER Batch
    Import all files from import/ directory in correct order.

.EXAMPLE
    .\Import-Data.ps1 -Profile tags -File .\import\01-reference\tags.json

.EXAMPLE
    .\Import-Data.ps1 -Batch
#>

param(
    [Parameter(Mandatory = $false)]
    [ValidateSet("catalogs", "categories", "products", "brands", "manufacturers", "tags", "packages",
                 "specification_attributes", "specification_attribute_options", "specification_attribute_groups",
                 "product_attributes", "product_attribute_options")]
    [string]$Profile = "products",

    [Parameter(Mandatory = $false)]
    [string]$File = "",

    [Parameter(Mandatory = $false)]
    [string]$ServiceUrl = "http://localhost:5003",

    [Parameter(Mandatory = $false)]
    [switch]$DryRun,

    [Parameter(Mandatory = $false)]
    [switch]$Batch
)

# Check if grpcurl is available
$grpcurl = Get-Command grpcurl -ErrorAction SilentlyContinue
if (-not $grpcurl) {
    Write-Warning "grpcurl not found. Please install it."
    Write-Host "Download: https://github.com/fullstorydev/grpcurl/releases"
    exit 1
}

# Import order
$importOrder = @(
    @{ profile = "catalogs"; path = "01-reference\catalogs.json" },
    @{ profile = "tags"; path = "01-reference\tags.json" },
    @{ profile = "brands"; path = "01-reference\brands.json" },
    @{ profile = "packages"; path = "01-reference\packages.json" },
    @{ profile = "specification_attribute_groups"; path = "02-specifications\specification_groups.json" },
    @{ profile = "specification_attributes"; path = "02-specifications\specification_attributes.json" },
    @{ profile = "specification_attribute_options"; path = "02-specifications\specification_attribute_options.json" },
    @{ profile = "categories"; path = "03-categories\categories.json" }
)

function Import-JsonFile {
    param(
        [string]$FilePath,
        [string]$ImportProfile,
        [string]$GrpcUrl,
        [bool]$Validate
    )

    $fileName = Split-Path $FilePath -Leaf
    Write-Host "Importing: $fileName"
    Write-Host "  Profile: $ImportProfile"

    if (-not (Test-Path $FilePath)) {
        Write-Host "  [ERROR] File not found: $FilePath" -ForegroundColor Red
        return $false
    }

    # Read and convert JSON to base64 for gRPC
    $jsonContent = Get-Content $FilePath -Raw -Encoding UTF8
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonContent)
    $base64 = [System.Convert]::ToBase64String($bytes)

    # Build gRPC request
    $request = @{
        profile = $ImportProfile
        format = "JSON"
        data = $base64
        updateExisting = $true
    } | ConvertTo-Json -Compress

    $method = if ($Validate) { "ValidateImport" } else { "Import" }

    try {
        $result = $request | grpcurl -plaintext -d @ $GrpcUrl "dkh.product_catalog.api.v1.DataExchangeService/$method" 2>&1

        if ($LASTEXITCODE -eq 0) {
            $response = $result | ConvertFrom-Json

            if ($Validate) {
                if ($response.isValid) {
                    Write-Host "  [OK] Validation passed" -ForegroundColor Green
                    return $true
                }
                else {
                    Write-Host "  [FAILED] Validation errors" -ForegroundColor Red
                    foreach ($error in $response.errors) {
                        Write-Host "    - $($error.message)" -ForegroundColor Yellow
                    }
                    return $false
                }
            }
            else {
                Write-Host "  [OK] Imported successfully" -ForegroundColor Green
                if ($response.importedCount) {
                    Write-Host "    Created: $($response.createdCount)"
                    Write-Host "    Updated: $($response.updatedCount)"
                    Write-Host "    Skipped: $($response.skippedCount)"
                }
                return $true
            }
        }
        else {
            Write-Host "  [ERROR] gRPC call failed" -ForegroundColor Red
            Write-Host "    $result" -ForegroundColor Yellow
            return $false
        }
    }
    catch {
        Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

function Run-BatchImport {
    param(
        [string]$BasePath,
        [string]$GrpcUrl,
        [bool]$ValidateOnly
    )

    Write-Host "`n=== Batch Import ===" -ForegroundColor Cyan
    Write-Host "Base path: $BasePath"
    Write-Host "Service URL: $GrpcUrl"
    Write-Host "Mode: $(if ($ValidateOnly) { 'Validate Only' } else { 'Import' })"
    Write-Host ""

    $results = @{
        total = 0
        success = 0
        failed = 0
    }

    # First import reference data and specifications
    foreach ($item in $importOrder) {
        $filePath = Join-Path $BasePath "import\$($item.path)"

        if (Test-Path $filePath) {
            $results.total++
            if (Import-JsonFile -FilePath $filePath -ImportProfile $item.profile -GrpcUrl $GrpcUrl -Validate $ValidateOnly) {
                $results.success++
            }
            else {
                $results.failed++
                if (-not $ValidateOnly) {
                    Write-Host "Stopping batch import due to error." -ForegroundColor Red
                    break
                }
            }
            Write-Host ""
        }
    }

    # Then import products
    $productsPath = Join-Path $BasePath "import\04-products"
    if (Test-Path $productsPath) {
        $productFiles = Get-ChildItem -Path $productsPath -Filter "products-*.json" -File

        foreach ($file in $productFiles) {
            $results.total++
            if (Import-JsonFile -FilePath $file.FullName -ImportProfile "products" -GrpcUrl $GrpcUrl -Validate $ValidateOnly) {
                $results.success++
            }
            else {
                $results.failed++
            }
            Write-Host ""
        }
    }

    Write-Host "=== Summary ===" -ForegroundColor Cyan
    Write-Host "Total: $($results.total)"
    Write-Host "Success: $($results.success)" -ForegroundColor Green
    Write-Host "Failed: $($results.failed)" -ForegroundColor $(if ($results.failed -gt 0) { "Red" } else { "Green" })

    return $results.failed -eq 0
}

# Main execution
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$basePath = Split-Path -Parent $scriptDir

# Check service availability
Write-Host "Checking service availability..."
$pingResult = Test-NetConnection -ComputerName "localhost" -Port 5003 -WarningAction SilentlyContinue
if (-not $pingResult.TcpTestSucceeded) {
    Write-Error "ProductCatalogService not available at $ServiceUrl"
    Write-Host "Please start the service first:"
    Write-Host "  cd D:\projects\GZDKH\services\DKH.ProductCatalogService"
    Write-Host "  dotnet run --project DKH.ProductCatalogService.Api"
    exit 1
}
Write-Host "Service is available." -ForegroundColor Green

if ($Batch) {
    $success = Run-BatchImport -BasePath $basePath -GrpcUrl $ServiceUrl -ValidateOnly $DryRun
    exit $(if ($success) { 0 } else { 1 })
}
elseif ($File) {
    if (Import-JsonFile -FilePath $File -ImportProfile $Profile -GrpcUrl $ServiceUrl -Validate $DryRun) {
        exit 0
    }
    else {
        exit 1
    }
}
else {
    Write-Host "Usage:"
    Write-Host "  .\Import-Data.ps1 -Profile <profile> -File <path>"
    Write-Host "  .\Import-Data.ps1 -Batch [-DryRun]"
    Write-Host ""
    Write-Host "Profiles: catalogs, categories, products, brands, manufacturers, tags, packages,"
    Write-Host "          specification_attributes, specification_attribute_options, specification_attribute_groups"
    exit 1
}
