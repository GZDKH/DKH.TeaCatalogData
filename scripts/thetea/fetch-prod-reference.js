#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { REPO_ROOT, parseArgs } = require('./lib/env');

function usage() {
    console.log(`Usage:
  node scripts/thetea/fetch-prod-reference.js --snapshot=prod-2026-06-01

Options:
  --snapshot=<id>       Writes sources/prod/catalog-reference/<id>.json
  --out=<path>          Writes an explicit JSON file path
  --page-size=<n>       Page size for AdminGateway reads, default 500`);
}

function requestJson(url, token) {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const req = lib.request(parsed, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
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

async function fetchPaged(gatewayUrl, token, endpoint, pageSize) {
    const all = [];
    for (let page = 1; ; page++) {
        const separator = endpoint.includes('?') ? '&' : '?';
        const payload = await requestJson(`${gatewayUrl}${endpoint}${separator}page=${page}&pageSize=${pageSize}`, token);
        const current = extractPage(payload);
        all.push(...current.items);

        if (all.length >= current.totalCount || current.items.length === 0) break;
    }
    return all;
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

async function main() {
    const args = parseArgs();
    if (args.help || args.h) {
        usage();
        return;
    }

    const pageSize = args['page-size'] ? Number(args['page-size']) : 500;
    const out = resolveOut(args);
    const { GATEWAY_URL, getToken } = require('../lib/config');

    console.log('Fetching prod ProductCatalog references through AdminGateway...');
    console.log(`Gateway: ${GATEWAY_URL}`);
    console.log(`Output: ${out}`);

    const token = await getToken();
    const catalogs = await fetchPaged(GATEWAY_URL, token, '/api/v1/catalogs?deletedFilter=active', pageSize);
    const categories = await fetchPaged(GATEWAY_URL, token, '/api/v1/categories?deletedFilter=active', pageSize);

    const reference = {
        source: 'AdminGateway ProductCatalog',
        gatewayUrl: GATEWAY_URL,
        fetchedAt: new Date().toISOString(),
        catalogs,
        categories,
    };

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(reference, null, 2));

    console.log(`Catalogs: ${catalogs.length}`);
    console.log(`Categories: ${categories.length}`);
}

main().catch(error => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
});
