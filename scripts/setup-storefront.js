/**
 * Setup tea shop storefront for local development.
 *
 * Creates a storefront with localhost domain, tea-themed branding,
 * enabled features, and linked catalogs. Idempotent — safe to run
 * multiple times.
 *
 * Usage:
 *   node scripts/setup-storefront.js
 *
 * Prerequisites:
 *   - Keycloak running on localhost:8080
 *   - AdminGateway running on localhost:5005
 *   - StorefrontService running
 *   - Catalogs already imported (run import-reference.js first)
 */

const http = require('http');

const KEYCLOAK_URL = 'http://localhost:8080';
const GATEWAY_URL = 'http://localhost:5005';
const STOREFRONT_GATEWAY_URL = 'http://localhost:5006';
const REALM = 'dkh';
const CLIENT_ID = 'dkh-admin-gateway';
const CLIENT_SECRET = 'admin-gateway-secret-change-me';
const USERNAME = 'superadmin';
const PASSWORD = 'superadmin123';

const STOREFRONT_CODE = 'tea-shop';
const STOREFRONT_DOMAIN = 'localhost';

// --- HTTP helpers ---

function request(method, baseUrl, urlPath, token, body) {
  const url = new URL(urlPath, baseUrl);
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: data, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function adminGet(path, token) { return request('GET', GATEWAY_URL, path, token); }
function adminPost(path, token, body) { return request('POST', GATEWAY_URL, path, token, body); }
function adminPut(path, token, body) { return request('PUT', GATEWAY_URL, path, token, body); }

// --- Auth ---

async function getToken() {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    username: USERNAME,
    password: PASSWORD,
  }).toString();

  return new Promise((resolve, reject) => {
    const req = http.request(`${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.access_token) resolve(json.access_token);
        else reject(new Error('Token error: ' + data));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// --- Helpers ---

function parseJwtPayload(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString());
}

/**
 * Extract clean GUID from various API response formats:
 * - Plain string: "3c90e710-0f4a-..."
 * - Wrapped object: { "value": "3c90e710-0f4a-..." }
 * - JSON string of object: '{ "value": "3c90e710-0f4a-..." }'
 */
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

// --- Storefront setup steps ---

async function findOrCreateStorefront(token) {
  // Search via list endpoint (GET by code endpoint has a known bug)
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

  // Create new storefront
  console.log('  Creating...');
  const res = await adminPost('/api/v1/storefronts', token, {
    code: STOREFRONT_CODE,
    name: 'Tea Shop',
    description: 'Магазин чая — тестовая витрина для локальной разработки',
    ownerId: parseJwtPayload(token).sub,
    features: {
      cartEnabled: true,
      ordersEnabled: true,
      paymentsEnabled: false,
      reviewsEnabled: true,
      wishlistEnabled: true,
    },
  });

  // Re-fetch via list — AdminGateway may return 500 due to CreatedAtAction bug
  // even when the storefront was actually created in the backend
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

  throw new Error(`Failed to create storefront: HTTP ${res.status} — ${res.body.substring(0, 300)}`);
}

async function ensureDomain(token, storefrontId) {
  // Check existing domains
  const existing = await adminGet(`/api/v1/storefronts/${storefrontId}/domains`, token);
  if (existing.status === 200 && existing.json) {
    const domains = existing.json.domains || existing.json.items || [];
    const found = domains.find((d) => d.domain === STOREFRONT_DOMAIN);
    if (found) {
      const domainId = extractGuid(found.id);
      const verified = found.isVerified;
      console.log(`  Domain '${STOREFRONT_DOMAIN}' already linked (verified: ${verified})`);
      if (!verified) {
        await verifyDomain(token, storefrontId, domainId);
      }
      return { ok: true };
    }
  }

  // Add domain (loopback domains are auto-verified by StorefrontService)
  console.log(`  Adding domain '${STOREFRONT_DOMAIN}'...`);
  const res = await adminPost(`/api/v1/storefronts/${storefrontId}/domains`, token, {
    domain: STOREFRONT_DOMAIN,
    isPrimary: true,
  });

  if (res.status >= 200 && res.status < 300) {
    const isVerified = res.json?.domain?.isVerified;
    console.log(`  Domain added (verified: ${isVerified})`);
    return { ok: true };
  }

  console.log(`  FAILED: HTTP ${res.status} — ${res.body.substring(0, 200)}`);
  return { ok: false, status: res.status };
}

async function verifyDomain(token, storefrontId, domainId) {
  console.log(`  Verifying domain...`);
  const res = await adminPost(`/api/v1/storefronts/${storefrontId}/domains/${domainId}/verify`, token);
  if (res.status === 200 && res.json) {
    const verified = res.json.isVerified;
    console.log(`  Verification result: ${verified}`);
    if (!verified) {
      console.log('  Note: DNS verification failed (expected for localhost).');
      console.log('  Loopback domains are auto-verified by StorefrontService on creation.');
    }
  } else {
    console.log(`  Verify returned HTTP ${res.status}`);
  }
}

async function updateBranding(token, storefrontId) {
  const res = await adminPut(`/api/v1/storefronts/${storefrontId}/branding`, token, {
    colors: {
      primary: '#B45309',       // amber-700 — warm tea brown
      secondary: '#92400E',     // amber-800
      accent: '#D97706',        // amber-500
      background: '#FFFBEB',    // amber-50
      surface: '#FFFFFF',
      text: '#1C1917',          // stone-900
      textMuted: '#78716C',     // stone-500
      border: '#E7E5E4',        // stone-200
      error: '#DC2626',         // red-600
      success: '#16A34A',       // green-600
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
  });

  if (res.status === 200) {
    console.log('  Branding updated');
    return { ok: true };
  }
  console.log(`  FAILED: HTTP ${res.status} — ${res.body.substring(0, 200)}`);
  return { ok: false, status: res.status };
}

async function linkCatalogs(token, storefrontId) {
  // Get existing catalog links
  const existing = await adminGet(`/api/v1/storefronts/${storefrontId}/catalogs`, token);
  const linkedIds = new Set();
  if (existing.status === 200 && existing.json) {
    const items = existing.json.items || existing.json.data?.items || [];
    items.forEach((c) => linkedIds.add(c.catalogId));
  }

  // Get all available catalogs
  const catalogsRes = await adminGet('/api/v1/catalogs?pageSize=100', token);
  if (catalogsRes.status !== 200 || !catalogsRes.json) {
    console.log('  Could not fetch catalogs — skipping');
    return { ok: false };
  }

  const catalogs = catalogsRes.json.items || [];
  if (catalogs.length === 0) {
    console.log('  No catalogs found — run import-reference.js first');
    return { ok: false };
  }

  let linked = 0;
  let failed = 0;
  for (let i = 0; i < catalogs.length; i++) {
    const catalog = catalogs[i];
    if (linkedIds.has(catalog.id)) continue;

    const res = await adminPost(`/api/v1/storefronts/${storefrontId}/catalogs`, token, {
      catalogId: catalog.id,
      displayOrder: i + 1,
      isDefault: i === 0,
      isVisible: true,
    });

    if (res.status >= 200 && res.status < 300) linked++;
    else failed++;
  }

  console.log(`  ${linked} linked, ${linkedIds.size} already linked, ${failed} failed (${catalogs.length} total)`);
  return { ok: failed === 0 };
}

async function publishStorefront(token, storefrontId, currentStatus) {
  if (currentStatus === 'Active' || currentStatus === 'Published') {
    console.log(`  Already published (status: ${currentStatus})`);
    return { ok: true };
  }

  const res = await adminPost(`/api/v1/storefronts/${storefrontId}/publish`, token);
  if (res.status === 200) {
    console.log('  Published');
    return { ok: true };
  }
  console.log(`  FAILED: HTTP ${res.status} — ${res.body.substring(0, 200)}`);
  return { ok: false, status: res.status };
}

async function verifyStorefrontConfig() {
  return new Promise((resolve) => {
    const req = http.request(`${STOREFRONT_GATEWAY_URL}/api/v1/storefront/config`, {
      method: 'GET',
      headers: { Host: STOREFRONT_DOMAIN, Accept: 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', () => resolve({ status: 0, body: 'StorefrontGateway not reachable' }));
    req.end();
  });
}

// --- Main ---

async function main() {
  console.log('=== Tea Shop Storefront Setup ===\n');

  console.log('[auth] Getting token...');
  const token = await getToken();
  console.log('[auth] OK\n');

  console.log(`[storefront] Find or create (code: ${STOREFRONT_CODE})...`);
  const storefront = await findOrCreateStorefront(token);
  const storefrontId = storefront.id;
  console.log('');

  const steps = [
    { name: 'domain', label: `Ensure domain '${STOREFRONT_DOMAIN}'`, fn: () => ensureDomain(token, storefrontId) },
    { name: 'branding', label: 'Configure tea theme branding', fn: () => updateBranding(token, storefrontId) },
    { name: 'catalogs', label: 'Link available catalogs', fn: () => linkCatalogs(token, storefrontId) },
    { name: 'publish', label: 'Publish storefront', fn: () => publishStorefront(token, storefrontId, storefront.status) },
  ];

  const results = {};
  for (const step of steps) {
    console.log(`[${step.name}] ${step.label}...`);
    try {
      results[step.name] = await step.fn();
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
      results[step.name] = { ok: false, error: e.message };
    }
    console.log('');
  }

  // Verify via StorefrontGateway
  console.log('[verify] Checking StorefrontGateway...');
  const verify = await verifyStorefrontConfig();
  if (verify.status === 200) {
    console.log('  StorefrontGateway returns 200 — ready!\n');
  } else if (verify.status === 404) {
    console.log('  StorefrontGateway returns 404 — domain not yet resolved.');
    console.log('  Redis cache TTL is 5 min. Restart StorefrontGateway to clear cache.\n');
  } else {
    console.log(`  HTTP ${verify.status} — ${verify.body.substring(0, 200)}\n`);
  }

  // Summary
  const hasFailures = Object.values(results).some((r) => !r.ok);
  console.log('=== Summary ===');
  console.log(`Storefront: ${STOREFRONT_CODE} (${storefrontId})`);
  console.log(`Status:     ${storefront.status}`);
  for (const [name, result] of Object.entries(results)) {
    console.log(`  ${result.ok ? 'OK' : 'FAIL'}  ${name}`);
  }

  if (hasFailures) {
    console.log('\nSome steps failed. This may indicate a backend bug in StorefrontService.');
    console.log('Check StorefrontService logs for gRPC errors (GuidValue serialization).');
    console.log('After fixing, re-run: node scripts/setup-storefront.js');
    process.exit(1);
  } else {
    console.log('\nOpen http://localhost:3000 to see the tea shop');
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
