#!/usr/bin/env node
const http = require('http');
const https = require('https');
const path = require('path');
const { REPO_ROOT, loadDotEnv, parseArgs } = require('./lib/env');
const { assertScopedPath, withStagedOutput } = require('./lib/generated-output');
const {
    catalogWorkspaceHeader,
    resolveCatalogWorkspaceId,
} = require('./lib/catalog-workspace');
const { validateProductArray, writeProductReference } = require('./lib/product-reference');

loadDotEnv();

function usage() {
    console.log(`Usage:
  node scripts/thetea/fetch-prod-products.js --snapshot=prod-products-2026-07-17 --workspace-id=<uuid>

Options:
  --snapshot=<id>       Writes sources/prod/product-reference/<id>/
  --out=<directory>     Writes an explicit reference directory
  --workspace-id=<uuid> ProductCatalog workspace; or PRODUCT_CATALOG_WORKSPACE_ID`);
}

function resolveOut(args) {
    if (args.out) {
        return path.isAbsolute(String(args.out))
            ? String(args.out)
            : path.join(REPO_ROOT, String(args.out));
    }
    if (!args.snapshot || args.snapshot === true) {
        throw new Error('--snapshot=... or --out=... is required');
    }
    return path.join(
        REPO_ROOT,
        'sources',
        'prod',
        'product-reference',
        String(args.snapshot));
}

function requestProductExport(gatewayUrl, token, workspaceId) {
    const url = new URL('/api/v1/data-exchange/export/stream', gatewayUrl);
    const body = Buffer.from(JSON.stringify({ profile: 'products', format: 'json' }));
    const transport = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const req = transport.request(url, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': body.length,
                ...catalogWorkspaceHeader(workspaceId),
            },
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(Buffer.from(chunk)));
            res.on('end', () => {
                const response = Buffer.concat(chunks);
                if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
                    reject(new Error(
                        `HTTP ${res.statusCode} for ${url.pathname}: ${response.toString('utf8', 0, 240)}`));
                    return;
                }
                if (res.statusCode === 204 || response.length === 0) {
                    reject(new Error('Product DataExchange export returned no content.'));
                    return;
                }
                resolve(response);
            });
        });
        req.on('error', reject);
        req.end(body);
    });
}

async function main() {
    const args = parseArgs();
    if (args.help || args.h) {
        usage();
        return;
    }
    const out = assertScopedPath(resolveOut(args), {
        repoRoot: REPO_ROOT,
        allowedRoot: path.join(REPO_ROOT, 'sources', 'prod', 'product-reference'),
        allowedDescription: 'sources/prod/product-reference/',
        label: 'Product reference output',
    });
    const workspaceId = resolveCatalogWorkspaceId(args);
    const { GATEWAY_URL, getToken } = require('../lib/config');

    console.log('Fetching complete prod ProductCatalog products export through AdminGateway...');
    console.log(`Gateway: ${GATEWAY_URL}`);
    console.log(`Output: ${out}`);
    const token = await getToken();
    const response = await requestProductExport(GATEWAY_URL, token, workspaceId);
    let products;
    try {
        products = validateProductArray(JSON.parse(response.toString('utf8').replace(/^\uFEFF/, '')));
    } catch (error) {
        throw new Error(`Invalid products DataExchange export: ${error.message}`);
    }

    const manifest = withStagedOutput(out, stagingRoot =>
        writeProductReference(stagingRoot, products, { workspaceId }));
    console.log(`Products: ${manifest.productCount}`);
    console.log(`SHA-256: ${manifest.productsSha256}`);
    return manifest;
}

if (require.main === module) {
    main().catch(error => {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    main,
    requestProductExport,
    resolveOut,
};
