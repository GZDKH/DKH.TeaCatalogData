#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseArgs, REPO_ROOT } = require('../thetea/lib/env');
const { readJson, safeSegment, writeJsonAtomic } = require('./lib/artifacts');
const { normalizeTieguanyinSnapshot } = require('./thetea-shop/tieguanyin-normalizer');
const { buildPlan } = require('./thetea-shop/tieguanyin-importer');
const { applyImport, rollbackImport } = require('./thetea-shop/tieguanyin-operator');
const {
    AdminGatewayClient,
    ProductCatalogGrpcClient,
    TieguanyinProductionClient,
    redact,
} = require('./thetea-shop/tieguanyin-production-client');

const DEFAULT_FIXTURE = path.join(
    __dirname,
    'thetea-shop/fixtures/tieguanyin-price-base-2026-08-01.json',
);
const OUTPUT_ROOT = path.join(REPO_ROOT, 'artifacts/tieguanyin-grade-imports');

function bool(value) {
    return value === true || String(value || '').toLowerCase() === 'true';
}

function outputDirectory(args) {
    const runId = safeSegment(args['run-id'] || new Date().toISOString().replace(/[:.]/g, '-'), 'run id');
    const directory = path.join(OUTPUT_ROOT, runId);
    const relative = path.relative(OUTPUT_ROOT, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('TGY_IMPORT_OUTPUT_INVALID');
    }
    fs.mkdirSync(directory, { recursive: true });
    return directory;
}

function createClient(args) {
    const workspaceId = args['workspace-id'] || process.env.DKH_WORKSPACE_ID;
    const adminToken = process.env.ADMIN_GATEWAY_ACCESS_TOKEN;
    const productCatalogToken = process.env.PRODUCT_CATALOG_ADMIN_TOKEN;
    const rest = new AdminGatewayClient({
        baseUrl: args['admin-url'] || process.env.ADMIN_GATEWAY_URL,
        workspaceId,
        token: adminToken,
    });
    const grpc = new ProductCatalogGrpcClient({
        endpoint: args['product-catalog-endpoint'] || process.env.PRODUCT_CATALOG_GRPC_ENDPOINT,
        protoRoot: args['product-catalog-proto-root'] || process.env.PRODUCT_CATALOG_PROTO_ROOT,
        platformProtoRoot: args['platform-proto-root'] || process.env.PLATFORM_PROTO_ROOT,
        workspaceId,
        token: productCatalogToken,
        plaintext: bool(args.plaintext),
    });
    return new TieguanyinProductionClient(rest, grpc);
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const client = createClient(args);
    if (args.rollback) {
        if (args.rollback === true) throw new Error('TGY_IMPORT_ROLLBACK_FILE_REQUIRED');
        if (!bool(args.yes)) throw new Error('TGY_IMPORT_ROLLBACK_REQUIRES_YES');
        const rollbackFile = path.resolve(String(args.rollback));
        const result = await rollbackImport(client, readJson(rollbackFile));
        process.stdout.write(JSON.stringify(result) + '\n');
        return;
    }

    const fixture = readJson(args.fixture ? path.resolve(String(args.fixture)) : DEFAULT_FIXTURE);
    const manifest = normalizeTieguanyinSnapshot(fixture);
    const directory = outputDirectory(args);
    const rawState = await client.fetchState(
        manifest.target.productCode,
        manifest.target.catalogCode,
    );
    const plan = buildPlan(manifest, rawState);
    writeJsonAtomic(path.join(directory, 'plan.json'), plan);
    if (!bool(args.apply)) {
        process.stdout.write(JSON.stringify(plan) + '\n');
        return;
    }
    if (!bool(args.yes)) throw new Error('TGY_IMPORT_APPLY_REQUIRES_YES');
    const rollbackFile = path.join(directory, 'rollback.json');
    let result;
    try {
        result = await applyImport(client, manifest, rawState, rollbackFile);
    } catch (error) {
        if (fs.existsSync(rollbackFile)) {
            try {
                const rollbackResult = await rollbackImport(client, readJson(rollbackFile));
                writeJsonAtomic(path.join(directory, 'automatic-rollback.json'), rollbackResult);
            } catch (rollbackError) {
                throw new Error(
                    `TGY_IMPORT_APPLY_AND_ROLLBACK_FAILED: ${redact(error.message)}; ` +
                    redact(rollbackError.message),
                );
            }
        }
        throw error;
    }
    writeJsonAtomic(path.join(directory, 'receipt.json'), result.receipt);
    process.stdout.write(JSON.stringify(result.receipt) + '\n');
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${redact(error?.message)}\n`);
        process.exitCode = 1;
    });
}

module.exports = { main };
