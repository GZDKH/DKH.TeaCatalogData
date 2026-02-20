<#
.SYNOPSIS
    Sets up a tea shop storefront for local development.

.DESCRIPTION
    Creates a storefront with localhost domain, tea-themed branding,
    enabled features, and linked catalogs via AdminGateway REST API.
    Idempotent — safe to run multiple times.

.PARAMETER KeycloakUrl
    Keycloak base URL (default: http://localhost:8080).

.PARAMETER GatewayUrl
    AdminGateway base URL (default: http://localhost:5005).

.PARAMETER StorefrontGatewayUrl
    StorefrontGateway base URL (default: http://localhost:5006).

.PARAMETER StorefrontCode
    Storefront code (default: tea-shop).

.PARAMETER Domain
    Domain to bind (default: localhost).

.EXAMPLE
    .\Setup-Storefront.ps1

.EXAMPLE
    .\Setup-Storefront.ps1 -GatewayUrl http://localhost:5005 -Domain localhost
#>

param(
    [string]$KeycloakUrl = "http://localhost:8080",
    [string]$GatewayUrl = "http://localhost:5005",
    [string]$StorefrontGatewayUrl = "http://localhost:5006",
    [string]$Realm = "dkh",
    [string]$ClientId = "dkh-admin-gateway",
    [string]$ClientSecret = "admin-gateway-secret-change-me",
    [string]$Username = "superadmin",
    [string]$Password = "superadmin123",
    [string]$StorefrontCode = "tea-shop",
    [string]$Domain = "localhost"
)

$ErrorActionPreference = "Stop"

# ---------- HTTP helpers ----------

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Url,
        [string]$Token,
        [object]$Body
    )

    $headers = @{
        Accept = "application/json"
    }
    if ($Token) {
        $headers["Authorization"] = "Bearer $Token"
    }

    $splat = @{
        Method             = $Method
        Uri                = $Url
        Headers            = $headers
        ContentType        = "application/json"
        UseBasicParsing    = $true
        ErrorAction        = "Stop"
    }

    if ($Body) {
        $splat["Body"] = ($Body | ConvertTo-Json -Depth 10 -Compress)
    }

    try {
        $response = Invoke-WebRequest @splat
        $json = $null
        try { $json = $response.Content | ConvertFrom-Json } catch {}
        return @{
            Status = [int]$response.StatusCode
            Body   = $response.Content
            Json   = $json
        }
    }
    catch {
        $ex = $_.Exception
        $statusCode = 0
        $responseBody = ""
        if ($ex.Response) {
            $statusCode = [int]$ex.Response.StatusCode
            try {
                $stream = $ex.Response.GetResponseStream()
                $reader = [System.IO.StreamReader]::new($stream)
                $responseBody = $reader.ReadToEnd()
                $reader.Close()
            }
            catch {
                $responseBody = $ex.Message
            }
        }
        else {
            $responseBody = $ex.Message
        }

        $json = $null
        try { $json = $responseBody | ConvertFrom-Json } catch {}
        return @{
            Status = $statusCode
            Body   = $responseBody
            Json   = $json
        }
    }
}

function AdminGet([string]$Path, [string]$Token) {
    Invoke-Api -Method GET -Url "$GatewayUrl$Path" -Token $Token
}

function AdminPost([string]$Path, [string]$Token, [object]$Body) {
    Invoke-Api -Method POST -Url "$GatewayUrl$Path" -Token $Token -Body $Body
}

function AdminPut([string]$Path, [string]$Token, [object]$Body) {
    Invoke-Api -Method PUT -Url "$GatewayUrl$Path" -Token $Token -Body $Body
}

# ---------- Auth ----------

function Get-KeycloakToken {
    $tokenUrl = "$KeycloakUrl/realms/$Realm/protocol/openid-connect/token"
    $body = @{
        grant_type    = "password"
        client_id     = $ClientId
        client_secret = $ClientSecret
        username      = $Username
        password      = $Password
    }

    $response = Invoke-RestMethod -Method POST -Uri $tokenUrl `
        -ContentType "application/x-www-form-urlencoded" `
        -Body $body -UseBasicParsing

    if (-not $response.access_token) {
        throw "Failed to get Keycloak token"
    }
    return $response.access_token
}

function Get-JwtPayload([string]$Token) {
    $parts = $Token.Split(".")
    $payload = $parts[1]
    # Add padding
    switch ($payload.Length % 4) {
        2 { $payload += "==" }
        3 { $payload += "=" }
    }
    $payload = $payload.Replace("-", "+").Replace("_", "/")
    $bytes = [Convert]::FromBase64String($payload)
    $json = [System.Text.Encoding]::UTF8.GetString($bytes)
    return $json | ConvertFrom-Json
}

# ---------- Helpers ----------

function Extract-Guid($Id) {
    if (-not $Id) { return $Id }
    if ($Id -is [PSCustomObject] -and $Id.value) { return $Id.value }
    if ($Id -is [string] -and $Id.StartsWith("{")) {
        try {
            $parsed = $Id | ConvertFrom-Json
            if ($parsed.value) { return $parsed.value }
        }
        catch {}
    }
    return $Id
}

# ---------- Setup steps ----------

function Find-OrCreateStorefront([string]$Token) {
    # Search via list endpoint
    $listRes = AdminGet "/api/v1/storefronts?pageSize=100" $Token
    if ($listRes.Status -eq 200 -and $listRes.Json) {
        $items = @($listRes.Json.items)
        $existing = $items | Where-Object { $_.code -eq $StorefrontCode } | Select-Object -First 1
        if ($existing) {
            $existing.id = Extract-Guid $existing.id
            Write-Host "  Already exists: $($existing.id) ($($existing.status))"
            return $existing
        }
    }

    # Create new storefront
    Write-Host "  Creating..."
    $jwt = Get-JwtPayload $Token
    $body = @{
        code        = $StorefrontCode
        name        = "Tea Shop"
        description = "Магазин чая — тестовая витрина для локальной разработки"
        ownerId     = $jwt.sub
        features    = @{
            cartEnabled     = $true
            ordersEnabled   = $true
            paymentsEnabled = $false
            reviewsEnabled  = $true
            wishlistEnabled = $true
        }
    }

    $res = AdminPost "/api/v1/storefronts" $Token $body

    # Re-fetch via list — AdminGateway may return 500 due to CreatedAtAction bug
    if ($res.Status -eq 200 -or $res.Status -eq 201 -or $res.Status -eq 500) {
        $refetch = AdminGet "/api/v1/storefronts?pageSize=100" $Token
        if ($refetch.Status -eq 200 -and $refetch.Json) {
            $created = @($refetch.Json.items) | Where-Object { $_.code -eq $StorefrontCode } | Select-Object -First 1
            if ($created) {
                $created.id = Extract-Guid $created.id
                Write-Host "  Created: $($created.id)"
                return $created
            }
        }
    }

    throw "Failed to create storefront: HTTP $($res.Status) — $($res.Body.Substring(0, [Math]::Min(300, $res.Body.Length)))"
}

function Ensure-Domain([string]$Token, [string]$StorefrontId) {
    # Check existing domains
    $existing = AdminGet "/api/v1/storefronts/$StorefrontId/domains" $Token
    if ($existing.Status -eq 200 -and $existing.Json) {
        $domains = @()
        if ($existing.Json.domains) { $domains = @($existing.Json.domains) }
        elseif ($existing.Json.items) { $domains = @($existing.Json.items) }

        $found = $domains | Where-Object { $_.domain -eq $Domain } | Select-Object -First 1
        if ($found) {
            $domainId = Extract-Guid $found.id
            $verified = $found.isVerified
            Write-Host "  Domain '$Domain' already linked (verified: $verified)"
            if (-not $verified) {
                Invoke-DomainVerify $Token $StorefrontId $domainId
            }
            return @{ ok = $true }
        }
    }

    # Add domain (loopback domains are auto-verified by StorefrontService)
    Write-Host "  Adding domain '$Domain'..."
    $res = AdminPost "/api/v1/storefronts/$StorefrontId/domains" $Token @{
        domain    = $Domain
        isPrimary = $true
    }

    if ($res.Status -ge 200 -and $res.Status -lt 300) {
        $isVerified = $res.Json.domain.isVerified
        Write-Host "  Domain added (verified: $isVerified)"
        return @{ ok = $true }
    }

    Write-Host "  FAILED: HTTP $($res.Status) — $($res.Body.Substring(0, [Math]::Min(200, $res.Body.Length)))"
    return @{ ok = $false; status = $res.Status }
}

function Invoke-DomainVerify([string]$Token, [string]$StorefrontId, [string]$DomainId) {
    Write-Host "  Verifying domain..."
    $res = AdminPost "/api/v1/storefronts/$StorefrontId/domains/$DomainId/verify" $Token
    if ($res.Status -eq 200 -and $res.Json) {
        $verified = $res.Json.isVerified
        Write-Host "  Verification result: $verified"
        if (-not $verified) {
            Write-Host "  Note: DNS verification failed (expected for localhost)."
            Write-Host "  Loopback domains are auto-verified by StorefrontService on creation."
        }
    }
    else {
        Write-Host "  Verify returned HTTP $($res.Status)"
    }
}

function Update-Branding([string]$Token, [string]$StorefrontId) {
    $body = @{
        colors     = @{
            primary    = "#B45309"   # amber-700 — warm tea brown
            secondary  = "#92400E"   # amber-800
            accent     = "#D97706"   # amber-500
            background = "#FFFBEB"   # amber-50
            surface    = "#FFFFFF"
            text       = "#1C1917"   # stone-900
            textMuted  = "#78716C"   # stone-500
            border     = "#E7E5E4"   # stone-200
            error      = "#DC2626"   # red-600
            success    = "#16A34A"   # green-600
        }
        typography = @{
            fontFamily        = "Inter, sans-serif"
            fontFamilyHeading = "Playfair Display, serif"
            baseFontSize      = 16
        }
        layout     = @{
            headerStyle      = "classic"
            productCardStyle = "elegant"
            gridColumns      = 4
            borderRadius     = "0.75rem"
        }
    }

    $res = AdminPut "/api/v1/storefronts/$StorefrontId/branding" $Token $body
    if ($res.Status -eq 200) {
        Write-Host "  Branding updated"
        return @{ ok = $true }
    }
    Write-Host "  FAILED: HTTP $($res.Status) — $($res.Body.Substring(0, [Math]::Min(200, $res.Body.Length)))"
    return @{ ok = $false; status = $res.Status }
}

function Link-Catalogs([string]$Token, [string]$StorefrontId) {
    # Get existing catalog links
    $existing = AdminGet "/api/v1/storefronts/$StorefrontId/catalogs" $Token
    $linkedIds = [System.Collections.Generic.HashSet[string]]::new()
    if ($existing.Status -eq 200 -and $existing.Json) {
        $items = @()
        if ($existing.Json.items) { $items = @($existing.Json.items) }
        elseif ($existing.Json.data -and $existing.Json.data.items) { $items = @($existing.Json.data.items) }
        foreach ($c in $items) {
            # catalogId may be a wrapped GuidValue — normalize it
            $normalizedId = Extract-Guid $c.catalogId
            [void]$linkedIds.Add([string]$normalizedId)
        }
    }

    # Get all available catalogs
    $catalogsRes = AdminGet "/api/v1/catalogs?pageSize=100" $Token
    if ($catalogsRes.Status -ne 200 -or -not $catalogsRes.Json) {
        Write-Host "  Could not fetch catalogs — skipping"
        return @{ ok = $false }
    }

    $catalogs = @($catalogsRes.Json.items)
    if ($catalogs.Count -eq 0) {
        Write-Host "  No catalogs found — run Import-Data.ps1 -Batch first"
        return @{ ok = $false }
    }

    $linked = 0
    $failed = 0
    for ($i = 0; $i -lt $catalogs.Count; $i++) {
        $catalog = $catalogs[$i]
        $catalogId = [string](Extract-Guid $catalog.id)
        if ($linkedIds.Contains($catalogId)) { continue }

        $res = AdminPost "/api/v1/storefronts/$StorefrontId/catalogs" $Token @{
            catalogId    = $catalogId
            displayOrder = $i + 1
            isDefault    = ($i -eq 0)
            isVisible    = $true
        }

        if ($res.Status -ge 200 -and $res.Status -lt 300) { $linked++ }
        else { $failed++ }
    }

    Write-Host "  $linked linked, $($linkedIds.Count) already linked, $failed failed ($($catalogs.Count) total)"
    return @{ ok = ($failed -eq 0) }
}

function Publish-Storefront([string]$Token, [string]$StorefrontId, [string]$CurrentStatus) {
    if ($CurrentStatus -eq "Active" -or $CurrentStatus -eq "Published") {
        Write-Host "  Already published (status: $CurrentStatus)"
        return @{ ok = $true }
    }

    $res = AdminPost "/api/v1/storefronts/$StorefrontId/publish" $Token
    if ($res.Status -eq 200) {
        Write-Host "  Published"
        return @{ ok = $true }
    }
    Write-Host "  FAILED: HTTP $($res.Status) — $($res.Body.Substring(0, [Math]::Min(200, $res.Body.Length)))"
    return @{ ok = $false; status = $res.Status }
}

function Test-StorefrontConfig {
    try {
        $response = Invoke-WebRequest -Method GET -Uri "$StorefrontGatewayUrl/api/v1/storefront/config" `
            -Headers @{ Host = $Domain; Accept = "application/json" } `
            -UseBasicParsing -ErrorAction Stop
        return @{ Status = [int]$response.StatusCode; Body = $response.Content }
    }
    catch {
        $ex = $_.Exception
        if ($ex.Response) {
            $code = [int]$ex.Response.StatusCode
            try {
                $stream = $ex.Response.GetResponseStream()
                $reader = [System.IO.StreamReader]::new($stream)
                $body = $reader.ReadToEnd()
                $reader.Close()
            }
            catch { $body = $ex.Message }
            return @{ Status = $code; Body = $body }
        }
        return @{ Status = 0; Body = "StorefrontGateway not reachable" }
    }
}

# ---------- Main ----------

Write-Host "=== Tea Shop Storefront Setup ===`n"

Write-Host "[auth] Getting token..."
$token = Get-KeycloakToken
Write-Host "[auth] OK`n"

Write-Host "[storefront] Find or create (code: $StorefrontCode)..."
$storefront = Find-OrCreateStorefront $token
$storefrontId = $storefront.id
Write-Host ""

$steps = @(
    @{ Name = "domain";   Label = "Ensure domain '$Domain'";      Action = { Ensure-Domain $token $storefrontId } }
    @{ Name = "branding"; Label = "Configure tea theme branding";  Action = { Update-Branding $token $storefrontId } }
    @{ Name = "catalogs"; Label = "Link available catalogs";       Action = { Link-Catalogs $token $storefrontId } }
    @{ Name = "publish";  Label = "Publish storefront";            Action = { Publish-Storefront $token $storefrontId $storefront.status } }
)

$results = @{}
foreach ($step in $steps) {
    Write-Host "[$($step.Name)] $($step.Label)..."
    try {
        $results[$step.Name] = & $step.Action
    }
    catch {
        Write-Host "  ERROR: $($_.Exception.Message)"
        $results[$step.Name] = @{ ok = $false; error = $_.Exception.Message }
    }
    Write-Host ""
}

# Verify via StorefrontGateway
Write-Host "[verify] Checking StorefrontGateway..."
$verify = Test-StorefrontConfig
if ($verify.Status -eq 200) {
    Write-Host "  StorefrontGateway returns 200 — ready!`n"
}
elseif ($verify.Status -eq 404) {
    Write-Host "  StorefrontGateway returns 404 — domain not yet resolved."
    Write-Host "  Cache TTL is 5 min. Restart StorefrontService to clear cache.`n"
}
else {
    $snippet = $verify.Body.Substring(0, [Math]::Min(200, $verify.Body.Length))
    Write-Host "  HTTP $($verify.Status) — $snippet`n"
}

# Summary
$hasFailures = ($results.Values | Where-Object { -not $_.ok }).Count -gt 0

Write-Host "=== Summary ==="
Write-Host "Storefront: $StorefrontCode ($storefrontId)"
Write-Host "Status:     $($storefront.status)"
foreach ($key in @("domain", "branding", "catalogs", "publish")) {
    $r = $results[$key]
    $mark = if ($r.ok) { "OK" } else { "FAIL" }
    Write-Host "  $mark  $key"
}

if ($hasFailures) {
    Write-Host "`nSome steps failed. Check StorefrontService logs for errors."
    Write-Host "After fixing, re-run: .\scripts\Setup-Storefront.ps1"
    exit 1
}
else {
    Write-Host "`nOpen http://localhost:3000 to see the tea shop"
}
