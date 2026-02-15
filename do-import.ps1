param(
    [Parameter(Mandatory=$true)]
    [string]$Profile,

    [Parameter(Mandatory=$true)]
    [string]$FilePath,

    [string]$GrpcHost = "product-catalog:5003",
    [string]$Network = "dkh-network"
)

$fileBytes = [System.IO.File]::ReadAllBytes($FilePath)
$base64 = [Convert]::ToBase64String($fileBytes)

$req = @{
    profile = $Profile
    format = "json"
    content = $base64
    options = @{
        update_existing = $true
        skip_errors = $true
    }
} | ConvertTo-Json -Compress

Write-Host "Importing '$Profile' from $(Split-Path $FilePath -Leaf) ..." -ForegroundColor Cyan

$result = $req | docker run --rm -i --network $Network fullstorydev/grpcurl -plaintext -d '@' $GrpcHost proto.product_catalog.api.data_exchange.v1.DataExchangeService/Import

Write-Host $result
Write-Host ""
