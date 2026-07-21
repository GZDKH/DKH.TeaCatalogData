#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { REPO_ROOT, loadDotEnv, parseArgs } = require('./lib/env');
const { assertScopedPath } = require('./lib/generated-output');
const {
    catalogWorkspaceHeader,
    resolveCatalogWorkspaceId,
} = require('./lib/catalog-workspace');

loadDotEnv();

function usage() {
    console.log(`Usage:
  node scripts/thetea/fetch-prod-reference.js --snapshot=prod-2026-06-01

Options:
  --snapshot=<id>       Writes sources/prod/catalog-reference/<id>.json
  --out=<path>          Writes an explicit JSON file path
  --workspace-id=<uuid> ProductCatalog workspace; or PRODUCT_CATALOG_WORKSPACE_ID
  --page-size=<n>       Page size for AdminGateway reads, default 500`);
}

function requestJson(url, token, workspaceId) {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const req = lib.request(parsed, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
                ...catalogWorkspaceHeader(workspaceId),
            },
        }, res => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
                    reject(new Error(`HTTP ${res.statusCode} for ${parsed.pathname}: ${data.slice(0, 240)}`));
                    return;
                }

                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(new Error(`Invalid JSON for ${parsed.pathname}: ${error.message}`));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function extractPage(payload) {
    const body = payload.data || payload;
    const items = body.items || body.Items || body.data || [];
    const totalCount = body.totalCount || body.TotalCount || items.length;
    const page = body.page || body.Page || 1;
    const pageSize = body.pageSize || body.PageSize || items.length || 1;
    return { items, totalCount, page, pageSize };
}

async function fetchPaged(gatewayUrl, token, workspaceId, endpoint, pageSize) {
    const all = [];
    for (let page = 1; ; page++) {
        const separator = endpoint.includes('?') ? '&' : '?';
        const payload = await requestJson(
            `${gatewayUrl}${endpoint}${separator}page=${page}&pageSize=${pageSize}`,
            token,
            workspaceId);
        const current = extractPage(payload);
        all.push(...current.items);

        if (all.length >= current.totalCount || current.items.length === 0) break;
    }
    return all;
}

function unwrapCollection(payload, key) {
    const body = payload?.data || payload || {};
    const value = body[key] || body[key[0].toUpperCase() + key.slice(1)] || [];
    if (!Array.isArray(value)) throw new Error(`Reference response '${key}' must be an array.`);
    return value;
}

async function fetchGeography(gatewayUrl, token, workspaceId, countryCode = 'CN') {
    const statePayload = await requestJson(
        `${gatewayUrl}/api/v1/management/state-provinces/countries/${countryCode}?languageCode=en-US`,
        token,
        workspaceId);
    const states = unwrapCollection(statePayload, 'stateProvinces');
    const result = [];
    for (const state of states) {
        const code = String(state.code || state.Code || '').trim();
        const name = String(state.name || state.Name || '').trim();
        if (!code || !name) throw new Error('State/province reference must contain code and name.');
        const cityPayload = await requestJson(
            `${gatewayUrl}/api/v1/management/cities/countries/${countryCode}/states/${encodeURIComponent(code)}?languageCode=en-US`,
            token,
            workspaceId);
        const cities = unwrapCollection(cityPayload, 'cities').map(city => ({
            code: String(city.code || city.Code || '').trim(),
            name: String(city.name || city.Name || '').trim(),
        })).filter(city => city.code && city.name);
        result.push({ code, name, cities });
    }
    return { countryCode, states: result };
}

function resolveOut(args) {
    if (args.out) {
        return path.isAbsolute(String(args.out)) ? String(args.out) : path.join(REPO_ROOT, String(args.out));
    }

    if (!args.snapshot || args.snapshot === true) {
        throw new Error('--snapshot=... or --out=... is required');
    }

    return path.join(REPO_ROOT, 'sources', 'prod', 'catalog-reference', `${args.snapshot}.json`);
}

function writeFileAtomic(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = path.join(
        path.dirname(file),
        `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}`);
    try {
        fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

async function main() {
    const args = parseArgs();
    if (args.help || args.h) {
        usage();
        return;
    }

    const pageSize = args['page-size'] ? Number(args['page-size']) : 500;
    const out = assertScopedPath(resolveOut(args), {
        repoRoot: REPO_ROOT,
        allowedRoot: path.join(REPO_ROOT, 'sources', 'prod', 'catalog-reference'),
        allowedDescription: 'sources/prod/catalog-reference/',
        label: 'Catalog reference output',
    });
    const workspaceId = resolveCatalogWorkspaceId(args);
    const { GATEWAY_URL, getToken } = require('../lib/config');

    console.log('Fetching prod ProductCatalog references through AdminGateway...');
    console.log(`Gateway: ${GATEWAY_URL}`);
    console.log(`Output: ${out}`);

    const token = await getToken();
    const catalogs = await fetchPaged(
        GATEWAY_URL,
        token,
        workspaceId,
        '/api/v1/catalogs?deletedFilter=active',
        pageSize);
    const categories = await fetchPaged(
        GATEWAY_URL,
        token,
        workspaceId,
        '/api/v1/categories?deletedFilter=active',
        pageSize);
    const geography = await fetchGeography(GATEWAY_URL, token, workspaceId);

    const reference = {
        source: 'AdminGateway ProductCatalog',
        gatewayUrl: GATEWAY_URL,
        workspaceId,
        fetchedAt: new Date().toISOString(),
        catalogs,
        categories,
        geography,
    };

    writeFileAtomic(out, reference);

    console.log(`Catalogs: ${catalogs.length}`);
    console.log(`Categories: ${categories.length}`);
    console.log(`States/provinces: ${geography.states.length}`);
    console.log(`Cities: ${geography.states.reduce((sum, state) => sum + state.cities.length, 0)}`);
}

main().catch(error => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
});
