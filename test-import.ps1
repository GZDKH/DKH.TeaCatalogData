# Test 1: English only with CATALOG-CHINA code
Write-Host "=== Test 1: English only, code CATALOG-CHINA ==="
$test1 = '[{"code":"CATALOG-CHINA","order":1,"published":true,"translations":[{"lang":"en-US","name":"China Tea","description":"test","seo":"china-tea"}]}]'
$b641 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($test1))
$req1 = (@{profile="catalogs";format="json";content=$b641;options=@{update_existing=$true;skip_errors=$true}} | ConvertTo-Json -Compress)
$r1 = $req1 | docker run --rm -i --network dkh-network fullstorydev/grpcurl -plaintext -d '@' product-catalog:5003 proto.product_catalog.api.data_exchange.v1.DataExchangeService/Import
Write-Host "Result: $r1"
Write-Host ""

# Test 2: English + Russian (no Chinese)
Write-Host "=== Test 2: English + Russian ==="
$test2 = '[{"code":"CATALOG-CHINA2","order":1,"published":true,"translations":[{"lang":"en-US","name":"China Tea","description":"test","seo":"china-tea"},{"lang":"ru-RU","name":"Kitay","description":"test ru","seo":"kitajskij-chaj"}]}]'
$b642 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($test2))
$req2 = (@{profile="catalogs";format="json";content=$b642;options=@{update_existing=$true;skip_errors=$true}} | ConvertTo-Json -Compress)
$r2 = $req2 | docker run --rm -i --network dkh-network fullstorydev/grpcurl -plaintext -d '@' product-catalog:5003 proto.product_catalog.api.data_exchange.v1.DataExchangeService/Import
Write-Host "Result: $r2"
Write-Host ""

# Test 3: English + Russian (with Cyrillic chars)
Write-Host "=== Test 3: English + Cyrillic ==="
$ruName = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::UTF8.GetBytes("Kitayskiy chay"))
$test3Json = @(
    @{
        code = "CATALOG-CHINA3"
        order = 1
        published = $true
        translations = @(
            @{ lang = "en-US"; name = "China Tea"; description = "test"; seo = "china-tea" }
            @{ lang = "ru-RU"; name = "Kitayskiy chay"; description = "test"; seo = "kit" }
        )
    }
) | ConvertTo-Json -Depth 10 -Compress
$b643 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($test3Json))
$req3 = (@{profile="catalogs";format="json";content=$b643;options=@{update_existing=$true;skip_errors=$true}} | ConvertTo-Json -Compress)
$r3 = $req3 | docker run --rm -i --network dkh-network fullstorydev/grpcurl -plaintext -d '@' product-catalog:5003 proto.product_catalog.api.data_exchange.v1.DataExchangeService/Import
Write-Host "Result: $r3"
Write-Host ""

# Test 4: Two items, English only
Write-Host "=== Test 4: Two items, English only ==="
$test4 = '[{"code":"CATALOG-TEST-A","order":1,"published":true,"translations":[{"lang":"en-US","name":"A","seo":"a"}]},{"code":"CATALOG-TEST-B","order":2,"published":true,"translations":[{"lang":"en-US","name":"B","seo":"b"}]}]'
$b644 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($test4))
$req4 = (@{profile="catalogs";format="json";content=$b644;options=@{update_existing=$true;skip_errors=$true}} | ConvertTo-Json -Compress)
$r4 = $req4 | docker run --rm -i --network dkh-network fullstorydev/grpcurl -plaintext -d '@' product-catalog:5003 proto.product_catalog.api.data_exchange.v1.DataExchangeService/Import
Write-Host "Result: $r4"
