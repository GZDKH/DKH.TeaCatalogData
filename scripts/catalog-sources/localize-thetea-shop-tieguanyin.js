#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseArgs, REPO_ROOT } = require('../thetea/lib/env');
const { readJson, safeSegment, writeJsonAtomic } = require('./lib/artifacts');
const { normalizeTieguanyinSnapshot } = require('./thetea-shop/tieguanyin-normalizer');
const {
    applyGradeLocalization,
    buildGradeLocalizationPlan,
    rollbackGradeLocalization,
} = require('./thetea-shop/tieguanyin-localization');
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
const DEFAULT_TRANSLATIONS = path.join(
    __dirname,
    'thetea-shop/fixtures/tieguanyin-grade-label-translations-2026-08-01.json',
);
const OUTPUT_ROOT = path.join(REPO_ROOT, 'artifacts/tieguanyin-grade-localization');

function bool(value) {
    return value === true || String(value || '').toLowerCase() === 'true';
}

function outputDirectory(args) {
    const runId = safeSegment(
        args['run-id'] || new Date().toISOString().replace(/[:.]/g, '-'),
        'run id',
    );
    const directory = path.join(OUTPUT_ROOT, runId);
    const relative = path.relative(OUTPUT_ROOT, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('TGY_LOCALIZATION_OUTPUT_INVALID');
    }
    fs.mkdirSync(directory, { recursive: true });
    return directory;
}

function createClient(args) {
    const workspaceId = args['workspace-id'] || process.env.DKH_WORKSPACE_ID;
    const rest = new AdminGatewayClient({
        baseUrl: args['admin-url'] || process.env.ADMIN_GATEWAY_URL,
        workspaceId,
        token: process.env.ADMIN_GATEWAY_ACCESS_TOKEN,
    });
    const grpc = new ProductCatalogGrpcClient({
        endpoint: args['product-catalog-endpoint'] || process.env.PRODUCT_CATALOG_GRPC_ENDPOINT,
        protoRoot: args['product-catalog-proto-root'] || process.env.PRODUCT_CATALOG_PROTO_ROOT,
        platformProtoRoot: args['platform-proto-root'] || process.env.PLATFORM_PROTO_ROOT,
        workspaceId,
        token: process.env.PRODUCT_CATALOG_ADMIN_TOKEN,
        plaintext: bool(args.plaintext),
    });
    return new TieguanyinProductionClient(rest, grpc);
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const client = createClient(args);
    if (args.rollback) {
        if (args.rollback === true) throw new Error('TGY_LOCALIZATION_ROLLBACK_FILE_REQUIRED');
        if (!bool(args.yes)) throw new Error('TGY_LOCALIZATION_ROLLBACK_REQUIRES_YES');
        const result = await rollbackGradeLocalization(client, readJson(path.resolve(String(args.rollback))));
        process.stdout.write(JSON.stringify(result) + '\n');
        return;
    }

    const fixture = readJson(args.fixture ? path.resolve(String(args.fixture)) : DEFAULT_FIXTURE);
    const translationBundle = readJson(
        args.translations ? path.resolve(String(args.translations)) : DEFAULT_TRANSLATIONS,
    );
    const manifest = normalizeTieguanyinSnapshot(fixture);
    const translations = translationBundle.labels;
    const directory = outputDirectory(args);
    const rawState = await client.fetchState(
        manifest.target.productCode,
        manifest.target.catalogCode,
    );
    const plan = buildGradeLocalizationPlan(manifest, rawState, translations);
    writeJsonAtomic(path.join(directory, 'plan.json'), plan);
    if (!bool(args.apply)) {
        process.stdout.write(JSON.stringify(plan) + '\n');
        return;
    }
    if (!bool(args.yes)) throw new Error('TGY_LOCALIZATION_APPLY_REQUIRES_YES');
    const rollbackFile = path.join(directory, 'rollback.json');
    try {
        const result = await applyGradeLocalization(
            client,
            manifest,
            rawState,
            translations,
            rollbackFile,
        );
        writeJsonAtomic(path.join(directory, 'receipt.json'), result.receipt);
        process.stdout.write(JSON.stringify(result.receipt) + '\n');
    } catch (error) {
        if (fs.existsSync(rollbackFile)) {
            try {
                const rollbackResult = await rollbackGradeLocalization(
                    client,
                    readJson(rollbackFile),
                );
                writeJsonAtomic(path.join(directory, 'automatic-rollback.json'), rollbackResult);
            } catch (rollbackError) {
                throw new Error(
                    `TGY_LOCALIZATION_APPLY_AND_ROLLBACK_FAILED: ${redact(error.message)}; ` +
                    redact(rollbackError.message),
                );
            }
        }
        throw error;
    }
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${redact(error?.message)}\n`);
        process.exitCode = 1;
    });
}

module.exports = { main };
