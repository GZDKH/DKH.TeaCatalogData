param(
    [Parameter(Mandatory=$true)]
    [string]$Profile,

    [Parameter(Mandatory=$true)]
    [string]$FilePath,

    [string]$GrpcHost = "product-catalog:5003",
    [string]$Network = "dkh-network"
)

# Read and parse JSON
$jsonRaw = Get-Content $FilePath -Raw -Encoding UTF8
$items = $jsonRaw | ConvertFrom-Json

# Transform field names to match DTO expectations
function Convert-Item {
    param($item, [string]$profileName)

    $result = [ordered]@{}

    # Common fields
    if ($item.PSObject.Properties["code"]) { $result["code"] = $item.code }
    if ($item.PSObject.Properties["id"])   { $result["id"] = $item.id }

    # Profile-specific fields
    switch ($profileName) {
        "catalogs" {
            if ($item.PSObject.Properties["order"])     { $result["displayOrder"] = $item.order }
            if ($item.PSObject.Properties["published"]) { $result["published"] = $item.published }
            $result["currencyCode"] = "USD"
        }
        "brands" {
            if ($item.PSObject.Properties["order"])     { $result["displayOrder"] = $item.order }
            if ($item.PSObject.Properties["published"]) { $result["published"] = $item.published }
        }
        "packages" {
            if ($item.PSObject.Properties["name"]) { $result["name"] = $item.name }
            if ($item.PSObject.Properties["unit"]) { $result["quantityUnitCode"] = $item.unit }
        }
        "specification_groups" {
            if ($item.PSObject.Properties["icon"])        { $result["iconName"] = $item.icon }
            if ($item.PSObject.Properties["order"])       { $result["displayOrder"] = $item.order }
            if ($item.PSObject.Properties["published"])   { $result["published"] = $item.published }
            if ($item.PSObject.Properties["collapsible"]) { $result["isCollapsible"] = $item.collapsible }
            if ($item.PSObject.Properties["expanded"])    { $result["isExpandedByDefault"] = $item.expanded }
        }
        "specification_attributes" {
            if ($item.PSObject.Properties["group"])      { $result["groupCode"] = $item.group }
            if ($item.PSObject.Properties["unit"])       { $result["unitCode"] = $item.unit }
            if ($item.PSObject.Properties["order"])      { $result["displayOrder"] = $item.order }
            if ($item.PSObject.Properties["published"])  { $result["published"] = $item.published }
            if ($item.PSObject.Properties["filterable"]) { $result["isFilterable"] = $item.filterable }
            if ($item.PSObject.Properties["comparable"]) { $result["isComparable"] = $item.comparable }
        }
        "specification_attribute_options" {
            if ($item.PSObject.Properties["attribute"])  { $result["specificationAttributeCode"] = $item.attribute }
            if ($item.PSObject.Properties["order"])      { $result["displayOrder"] = $item.order }
            if ($item.PSObject.Properties["published"])  { $result["published"] = $item.published }
        }
        "categories" {
            if ($item.PSObject.Properties["parent"])    { $result["parentCode"] = $item.parent }
            if ($item.PSObject.Properties["order"])     { $result["displayOrder"] = $item.order }
            if ($item.PSObject.Properties["published"]) { $result["published"] = $item.published }
        }
    }

    # Transform translations
    if ($item.PSObject.Properties["translations"]) {
        $result["translations"] = @(
            $item.translations | ForEach-Object {
                $t = [ordered]@{}
                if ($_.PSObject.Properties["lang"]) { $t["languageCode"] = $_.lang }
                if ($_.PSObject.Properties["name"]) { $t["name"] = $_.name }
                if ($_.PSObject.Properties["description"]) { $t["description"] = $_.description }
                if ($_.PSObject.Properties["seo"]) { $t["seoName"] = $_.seo }
                $t
            }
        )
    }

    return $result
}

# Transform all items
$transformedItems = @($items | ForEach-Object { Convert-Item $_ $Profile })

# Convert to JSON
$transformedJson = $transformedItems | ConvertTo-Json -Depth 10 -Compress
$base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($transformedJson))

$req = @{
    profile = $Profile
    format = "json"
    content = $base64
    options = @{
        update_existing = $true
        skip_errors = $true
    }
} | ConvertTo-Json -Compress

Write-Host "Importing '$Profile' from $FilePath ($($transformedItems.Count) items) ..." -ForegroundColor Cyan

$result = $req | docker run --rm -i --network $Network fullstorydev/grpcurl -plaintext -d '@' $GrpcHost proto.product_catalog.api.data_exchange.v1.DataExchangeService/Import

Write-Host $result
Write-Host ""
