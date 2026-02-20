/**
 * Tea Shop Storefront Setup Script
 *
 * Creates a storefront with localhost domain, tea-themed branding,
 * enabled features, and linked catalogs via AdminGateway REST API.
 * Idempotent — safe to run multiple times.
 *
 * Usage: node scripts/setup-storefront.js
 */

const http = require('http');

// ---------- Configuration ----------

const KEYCLOAK_URL = 'http://localhost:8080';
const GATEWAY_URL = 'http://localhost:5005';
const STOREFRONT_GATEWAY_URL = 'http://localhost:5006';
const REALM = 'dkh';
const CLIENT_ID = 'dkh-admin-gateway';
const CLIENT_SECRET = 'admin-gateway-secret-change-me';
const USERNAME = 'superadmin';
const PASSWORD = 'superadmin123';

const STOREFRONT_CODE = 'tea-shop';
const DOMAIN = 'localhost';

// ---------- HTTP helpers ----------

function httpRequest(url, options, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
                let json = null;
                try {
                    json = JSON.parse(data);
                } catch {}
                resolve({ status: res.statusCode, body: data, json });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function adminGet(path, token) {
    return httpRequest(`${GATEWAY_URL}${path}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
        },
    });
}

function adminPost(path, token, body) {
    const payload = body ? JSON.stringify(body) : undefined;
    return httpRequest(
        `${GATEWAY_URL}${path}`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            },
        },
        payload,
    );
}

function adminPut(path, token, body) {
    const payload = body ? JSON.stringify(body) : undefined;
    return httpRequest(
        `${GATEWAY_URL}${path}`,
        {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            },
        },
        payload,
    );
}

// ---------- Auth ----------

async function getToken() {
    const body = new URLSearchParams({
        grant_type: 'password',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        username: USERNAME,
        password: PASSWORD,
    }).toString();

    const res = await httpRequest(
        `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
        body,
    );

    if (res.json && res.json.access_token) return res.json.access_token;
    throw new Error('Token error: ' + res.body.substring(0, 300));
}

function decodeJwtPayload(token) {
    const parts = token.split('.');
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4 !== 0) payload += '=';
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
}

// ---------- Helpers ----------

function extractGuid(id) {
    if (!id) return id;
    if (typeof id === 'object' && id.value) return id.value;
    if (typeof id === 'string' && id.startsWith('{')) {
        try {
            const parsed = JSON.parse(id);
            if (parsed.value) return parsed.value;
        } catch {}
    }
    return id;
}

// ---------- Setup steps ----------

async function findOrCreateStorefront(token) {
    const listRes = await adminGet('/api/v1/storefronts?pageSize=100', token);
    if (listRes.status === 200 && listRes.json) {
        const items = listRes.json.items || [];
        const existing = items.find((s) => s.code === STOREFRONT_CODE);
        if (existing) {
            existing.id = extractGuid(existing.id);
            console.log(`  Already exists: ${existing.id} (${existing.status})`);
            return existing;
        }
    }

    console.log('  Creating...');
    const jwt = decodeJwtPayload(token);
    const body = {
        code: STOREFRONT_CODE,
        name: 'Tea Shop',
        description: 'Магазин чая — тестовая витрина для локальной разработки',
        ownerId: jwt.sub,
        features: {
            cartEnabled: true,
            ordersEnabled: true,
            paymentsEnabled: false,
            reviewsEnabled: true,
            wishlistEnabled: true,
        },
    };

    const res = await adminPost('/api/v1/storefronts', token, body);

    // Re-fetch via list — AdminGateway may return 500 due to CreatedAtAction bug
    if (res.status === 200 || res.status === 201 || res.status === 500) {
        const refetch = await adminGet('/api/v1/storefronts?pageSize=100', token);
        if (refetch.status === 200 && refetch.json) {
            const created = (refetch.json.items || []).find((s) => s.code === STOREFRONT_CODE);
            if (created) {
                created.id = extractGuid(created.id);
                console.log(`  Created: ${created.id}`);
                return created;
            }
        }
    }

    throw new Error(
        `Failed to create storefront: HTTP ${res.status} — ${res.body.substring(0, 300)}`,
    );
}

async function ensureDomain(token, storefrontId) {
    const existing = await adminGet(`/api/v1/storefronts/${storefrontId}/domains`, token);
    if (existing.status === 200 && existing.json) {
        const domains = existing.json.domains || existing.json.items || [];
        const found = domains.find((d) => d.domain === DOMAIN);
        if (found) {
            const domainId = extractGuid(found.id);
            console.log(`  Domain '${DOMAIN}' already linked (verified: ${found.isVerified})`);
            if (!found.isVerified) {
                await verifyDomain(token, storefrontId, domainId);
            }
            return true;
        }
    }

    console.log(`  Adding domain '${DOMAIN}'...`);
    const res = await adminPost(`/api/v1/storefronts/${storefrontId}/domains`, token, {
        domain: DOMAIN,
        isPrimary: true,
    });

    if (res.status >= 200 && res.status < 300) {
        const isVerified = res.json && res.json.domain && res.json.domain.isVerified;
        console.log(`  Domain added (verified: ${isVerified})`);
        return true;
    }

    console.log(`  FAILED: HTTP ${res.status} — ${res.body.substring(0, 200)}`);
    return false;
}

async function verifyDomain(token, storefrontId, domainId) {
    console.log('  Verifying domain...');
    const res = await adminPost(
        `/api/v1/storefronts/${storefrontId}/domains/${domainId}/verify`,
        token,
    );
    if (res.status === 200 && res.json) {
        console.log(`  Verification result: ${res.json.isVerified}`);
        if (!res.json.isVerified) {
            console.log('  Note: DNS verification failed (expected for localhost).');
            console.log('  Loopback domains are auto-verified by StorefrontService on creation.');
        }
    } else {
        console.log(`  Verify returned HTTP ${res.status}`);
    }
}

async function updateBranding(token, storefrontId) {
    const body = {
        colors: {
            primary: '#B45309', // amber-700 — warm tea brown
            secondary: '#92400E', // amber-800
            accent: '#D97706', // amber-500
            background: '#FFFBEB', // amber-50
            surface: '#FFFFFF',
            text: '#1C1917', // stone-900
            textMuted: '#78716C', // stone-500
            border: '#E7E5E4', // stone-200
            error: '#DC2626', // red-600
            success: '#16A34A', // green-600
        },
        typography: {
            fontFamily: 'Inter, sans-serif',
            fontFamilyHeading: 'Playfair Display, serif',
            baseFontSize: 16,
        },
        layout: {
            headerStyle: 'classic',
            productCardStyle: 'elegant',
            gridColumns: 4,
            borderRadius: '0.75rem',
        },
    };

    const res = await adminPut(`/api/v1/storefronts/${storefrontId}/branding`, token, body);
    if (res.status === 200) {
        console.log('  Branding updated');
        return true;
    }
    console.log(`  FAILED: HTTP ${res.status} — ${res.body.substring(0, 200)}`);
    return false;
}

async function linkCatalogs(token, storefrontId) {
    const existing = await adminGet(`/api/v1/storefronts/${storefrontId}/catalogs`, token);
    const linkedIds = new Set();
    if (existing.status === 200 && existing.json) {
        const items = existing.json.items || (existing.json.data && existing.json.data.items) || [];
        for (const c of items) {
            linkedIds.add(String(extractGuid(c.catalogId)));
        }
    }

    const catalogsRes = await adminGet('/api/v1/catalogs?pageSize=100', token);
    if (catalogsRes.status !== 200 || !catalogsRes.json) {
        console.log('  Could not fetch catalogs — skipping');
        return false;
    }

    const catalogs = catalogsRes.json.items || [];
    if (catalogs.length === 0) {
        console.log('  No catalogs found — run import-all.js first');
        return false;
    }

    let linked = 0;
    let failed = 0;
    for (let i = 0; i < catalogs.length; i++) {
        const catalogId = String(extractGuid(catalogs[i].id));
        if (linkedIds.has(catalogId)) continue;

        const res = await adminPost(`/api/v1/storefronts/${storefrontId}/catalogs`, token, {
            catalogId,
            displayOrder: i + 1,
            isDefault: i === 0,
            isVisible: true,
        });

        if (res.status >= 200 && res.status < 300) linked++;
        else failed++;
    }

    console.log(
        `  ${linked} linked, ${linkedIds.size} already linked, ${failed} failed (${catalogs.length} total)`,
    );
    return failed === 0;
}

async function publishStorefront(token, storefrontId, currentStatus) {
    if (currentStatus === 'Active' || currentStatus === 'Published') {
        console.log(`  Already published (status: ${currentStatus})`);
        return true;
    }

    const res = await adminPost(`/api/v1/storefronts/${storefrontId}/publish`, token);
    if (res.status === 200) {
        console.log('  Published');
        return true;
    }
    console.log(`  FAILED: HTTP ${res.status} — ${res.body.substring(0, 200)}`);
    return false;
}

async function testStorefrontConfig() {
    try {
        return await httpRequest(`${STOREFRONT_GATEWAY_URL}/api/v1/storefront/config`, {
            method: 'GET',
            headers: { Host: DOMAIN, Accept: 'application/json' },
        });
    } catch {
        return { status: 0, body: 'StorefrontGateway not reachable' };
    }
}

// ---------- Main ----------

async function main() {
    console.log('=== Tea Shop Storefront Setup ===\n');

    console.log('[auth] Getting token...');
    const token = await getToken();
    console.log('[auth] OK\n');

    console.log(`[storefront] Find or create (code: ${STOREFRONT_CODE})...`);
    const storefront = await findOrCreateStorefront(token);
    const storefrontId = storefront.id;
    console.log();

    const steps = [
        {
            name: 'domain',
            label: `Ensure domain '${DOMAIN}'`,
            action: () => ensureDomain(token, storefrontId),
        },
        {
            name: 'branding',
            label: 'Configure tea theme branding',
            action: () => updateBranding(token, storefrontId),
        },
        {
            name: 'catalogs',
            label: 'Link available catalogs',
            action: () => linkCatalogs(token, storefrontId),
        },
        {
            name: 'publish',
            label: 'Publish storefront',
            action: () => publishStorefront(token, storefrontId, storefront.status),
        },
    ];

    const results = {};
    for (const step of steps) {
        console.log(`[${step.name}] ${step.label}...`);
        try {
            results[step.name] = await step.action();
        } catch (e) {
            console.log(`  ERROR: ${e.message}`);
            results[step.name] = false;
        }
        console.log();
    }

    // Verify via StorefrontGateway
    console.log('[verify] Checking StorefrontGateway...');
    const verify = await testStorefrontConfig();
    if (verify.status === 200) {
        console.log('  StorefrontGateway returns 200 — ready!\n');
    } else if (verify.status === 404) {
        console.log('  StorefrontGateway returns 404 — domain not yet resolved.');
        console.log('  Cache TTL is 5 min. Restart StorefrontService to clear cache.\n');
    } else {
        console.log(`  HTTP ${verify.status} — ${(verify.body || '').substring(0, 200)}\n`);
    }

    // Summary
    const hasFailures = Object.values(results).some((ok) => !ok);

    console.log('=== Summary ===');
    console.log(`Storefront: ${STOREFRONT_CODE} (${storefrontId})`);
    console.log(`Status:     ${storefront.status}`);
    for (const key of ['domain', 'branding', 'catalogs', 'publish']) {
        const mark = results[key] ? 'OK' : 'FAIL';
        console.log(`  ${mark}  ${key}`);
    }

    if (hasFailures) {
        console.log('\nSome steps failed. Check StorefrontService logs for errors.');
        console.log('After fixing, re-run: node scripts/setup-storefront.js');
        process.exit(1);
    } else {
        console.log('\nOpen http://localhost:3000 to see the tea shop');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
