#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, parseArgs, requireArg } = require('../thetea/lib/env');
const {
    readJson,
    sha256,
    stableJson,
    writeJsonAtomic,
} = require('./lib/artifacts');
const {
    CommerceAdminRestClient,
    resolveAdminRestCatalogTarget,
} = require('./lib/commerce-admin-rest-client');
const { METHODS } = require('./lib/commerce-publication');

const RECEIPT_SCHEMA = 'catalog-source-admin-rest-bundle-apply-receipt-v1';

function valueFrom(args, argumentName, environment, environmentName, fallback) {
    const argument = args[argumentName];
    if (argument !== undefined && argument !== true && argument !== '') {
        return String(argument);
    }
    const configured = environment[environmentName];
    if (configured !== undefined && configured !== '') {
        return String(configured);
    }
    return fallback;
}

function requireConfigured(value, argumentName, environmentName) {
    if (!value) {
        throw new Error(
            `--${argumentName}=... or ${environmentName} is required.`,
        );
    }
    return value;
}

function modeFrom(args) {
    if (args.canary === true && args.full === true) {
        throw new Error('Use --canary or --full, not both.');
    }
    if (args.canary === true) return 'canary';
    if (args.full === true) return 'full';
    return requireArg(args, 'mode');
}

function requireMode(value) {
    if (!['canary', 'full'].includes(value)) {
        throw new Error('Mode must be canary or full.');
    }
    return value;
}

function requireSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new Error(`${label} must be a safe non-negative integer.`);
    }
    return number;
}

function requireDigest(value, label) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
        throw new Error(`${label} must be a lowercase SHA-256 digest.`);
    }
    return value;
}

function loadBundle(bundleDirectory) {
    const directory = path.resolve(bundleDirectory);
    const manifest = readJson(path.join(directory, 'manifest.json'));
    const begin = readJson(path.join(directory, 'begin.json'));
    if (manifest.productionWrites !== false ||
        manifest.remoteMutationAttempted !== false) {
        throw new Error('Import bundle must be a prepared non-applied bundle.');
    }
    if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0) {
        throw new Error('Import bundle manifest must list item chunks.');
    }
    const items = [];
    for (const chunk of manifest.chunks) {
        const file = path.join(directory, chunk.file);
        const bytes = fs.readFileSync(file);
        if (requireDigest(chunk.sha256, 'Chunk hash') !== sha256(bytes)) {
            throw new Error(`Chunk hash mismatch: ${chunk.file}`);
        }
        const parsed = JSON.parse(bytes.toString('utf8'));
        if (!Array.isArray(parsed.items)) {
            throw new Error(`Chunk ${chunk.file} must contain an items array.`);
        }
        if (parsed.items.length !== requireSafeInteger(chunk.count, 'Chunk count')) {
            throw new Error(`Chunk count mismatch: ${chunk.file}`);
        }
        items.push(...parsed.items);
    }
    const expectedItemCount = requireSafeInteger(
        manifest.expectedItemCount,
        'Expected item count',
    );
    if (items.length !== expectedItemCount) {
        throw new Error('Bundle item count does not match manifest expected count.');
    }
    return { begin, directory, items, manifest };
}

function selectedItems(items, mode) {
    return mode === 'canary' ? items.slice(0, 1) : items;
}

function beginBody(begin, mode, items) {
    const body = {
        ...begin,
        expectedItemCount: items.length,
    };
    if (mode === 'canary') {
        body.snapshotId = `${begin.snapshotId}-canary-${items[0].externalId}`;
        body.semanticDigest = sha256(stableJson({
            baseSemanticDigest: begin.semanticDigest,
            selectedExternalId: items[0].externalId,
        }));
    }
    return body;
}

function idempotency(stage, snapshotId, value) {
    return `catalog-source.bundle.${snapshotId}.${stage}.${sha256(value).slice(0, 48)}`;
}

function receiptFile(bundleDirectory, mode, body) {
    const directory = path.join(bundleDirectory, 'apply', 'admin-rest-attempts');
    fs.mkdirSync(directory, { recursive: true });
    return path.join(
        directory,
        `${mode}-${body.snapshotId}-${body.semanticDigest.slice(0, 12)}.json`,
    );
}

function initializeReceipt(file, metadata, mode, body, itemCount) {
    const receipt = {
        schemaVersion: RECEIPT_SCHEMA,
        mode,
        complete: false,
        readBackVerified: false,
        readBackRequired: true,
        startedAt: new Date().toISOString(),
        tokenStored: false,
        target: {
            endpoint: metadata.sanitizedTargetEndpoint,
            tlsMode: metadata.tlsMode,
            apiVersion: metadata.apiVersion,
            routeTemplate: metadata.routeTemplate,
        },
        source: {
            registeredSourceCode: body.registeredSourceCode,
            snapshotId: body.snapshotId,
            expectedItemCount: itemCount,
            semanticDigest: body.semanticDigest,
        },
        stages: [],
    };
    writeJsonAtomic(file, receipt);
    return receipt;
}

function updateReceipt(file, update) {
    const current = readJson(file);
    const patch = typeof update === 'function' ? update(current) : update;
    const next = {
        ...current,
        ...patch,
    };
    writeJsonAtomic(file, next);
    return next;
}

async function applyBundle(args, options = {}) {
    const environment = options.environment || process.env;
    const repositoryRoot = path.resolve(options.repositoryRoot || REPO_ROOT);
    const bundleDirectory = path.resolve(
        repositoryRoot,
        requireArg(args, 'bundle-dir'),
    );
    const mode = requireMode(modeFrom(args));
    if (args.yes !== true) {
        throw new Error('Bundle apply requires the separate --yes confirmation.');
    }
    const bundle = loadBundle(bundleDirectory);
    const items = selectedItems(bundle.items, mode);
    if (items.length === 0) {
        throw new Error('Selected bundle item set is empty.');
    }
    const begin = beginBody(bundle.begin, mode, items);
    const baseUrl = requireConfigured(
        valueFrom(
            args,
            'admin-url',
            environment,
            'ADMIN_GATEWAY_REST_BASE_URL',
        ),
        'admin-url',
        'ADMIN_GATEWAY_REST_BASE_URL',
    );
    const timeoutSeconds = requireSafeInteger(
        valueFrom(
            args,
            'timeout-seconds',
            environment,
            'ADMIN_GATEWAY_REST_TIMEOUT_SECONDS',
            '30',
        ),
        'AdminGateway REST timeout',
    );
    const configuredStorefrontId = valueFrom(
        args,
        'storefront-id',
        environment,
        'ADMIN_GATEWAY_CATALOG_SOURCE_STOREFRONT_ID',
    );
    const configuredCatalogId = valueFrom(
        args,
        'catalog-id',
        environment,
        'ADMIN_GATEWAY_CATALOG_SOURCE_CATALOG_ID',
    );
    const configuredStorefrontCode = valueFrom(
        args,
        'storefront-code',
        environment,
        'ADMIN_GATEWAY_CATALOG_SOURCE_STOREFRONT_CODE',
    );
    const configuredCatalogCode = valueFrom(
        args,
        'catalog-code',
        environment,
        'ADMIN_GATEWAY_CATALOG_SOURCE_CATALOG_CODE',
    );
    const hasIdScope = Boolean(configuredStorefrontId || configuredCatalogId);
    const hasCodeScope = Boolean(configuredStorefrontCode || configuredCatalogCode);
    if (hasIdScope && hasCodeScope) {
        throw new Error(
            'Use either storefront/catalog codes or storefront/catalog IDs, not both.',
        );
    }
    const target = hasIdScope
        ? {
            storefrontId: requireConfigured(
                configuredStorefrontId,
                'storefront-id',
                'ADMIN_GATEWAY_CATALOG_SOURCE_STOREFRONT_ID',
            ),
            catalogId: requireConfigured(
                configuredCatalogId,
                'catalog-id',
                'ADMIN_GATEWAY_CATALOG_SOURCE_CATALOG_ID',
            ),
        }
        : await (options.resolveTarget || resolveAdminRestCatalogTarget)({
            baseUrl,
            timeoutSeconds,
            environment,
            fetchImpl: options.fetchImpl,
            storefrontCode: requireConfigured(
                configuredStorefrontCode,
                'storefront-code',
                'ADMIN_GATEWAY_CATALOG_SOURCE_STOREFRONT_CODE',
            ),
            catalogCode: requireConfigured(
                configuredCatalogCode,
                'catalog-code',
                'ADMIN_GATEWAY_CATALOG_SOURCE_CATALOG_CODE',
            ),
        });
    const clientOptions = {
        baseUrl,
        storefrontId: target.storefrontId,
        catalogId: target.catalogId,
        timeoutSeconds,
        environment,
        fetchImpl: options.fetchImpl,
    };
    const client = options.createClient
        ? options.createClient(clientOptions)
        : new CommerceAdminRestClient(clientOptions);
    const file = receiptFile(bundle.directory, mode, begin);
    const receipt = initializeReceipt(
        file,
        client.getReceiptMetadata(),
        mode,
        begin,
        items.length,
    );
    try {
        const beginResult = await client.invoke(METHODS.begin, {
            ...begin,
            command: {
                idempotencyKey: idempotency(
                    'begin',
                    begin.snapshotId,
                    begin.semanticDigest,
                ),
            },
        });
        const importId = beginResult.importId.value;
        updateReceipt(file, current => ({
            stages: [
                ...current.stages,
                {
                    stage: 'begin',
                    importId,
                    state: beginResult.state,
                    acceptedItemCount: String(beginResult.acceptedItemCount || 0),
                },
            ],
        }));
        let accepted = 0;
        for (const item of items) {
            const result = await client.invoke(METHODS.importItem, {
                importId: { value: importId },
                item,
                command: {
                    idempotencyKey: idempotency(
                        'item',
                        begin.snapshotId,
                        item.externalId,
                    ),
                },
            });
            accepted += 1;
            updateReceipt(file, current => ({
                stages: [
                    ...current.stages,
                    {
                        stage: 'importItem',
                        externalId: item.externalId,
                        replayed: result.replayed === true,
                        accepted,
                    },
                ],
            }));
        }
        const commit = await client.invoke(METHODS.commit, {
            importId: { value: importId },
            semanticDigest: begin.semanticDigest,
            command: {
                idempotencyKey: idempotency(
                    'commit',
                    begin.snapshotId,
                    begin.semanticDigest,
                ),
            },
        });
        const completed = updateReceipt(file, current => ({
            complete: true,
            completedAt: new Date().toISOString(),
            result: 'committed',
            stages: [
                ...current.stages,
                {
                    stage: 'commit',
                    state: commit.state,
                    acceptedItemCount: String(commit.acceptedItemCount || accepted),
                    replayedItemCount: String(commit.replayedItemCount || 0),
                    quarantinedItemCount: String(commit.quarantinedItemCount || 0),
                },
            ],
        }));
        return {
            mode,
            importId,
            expectedItemCount: items.length,
            receipt,
            receiptFile: file,
            result: completed.result,
        };
    } catch (error) {
        updateReceipt(file, {
            complete: false,
            failedAt: new Date().toISOString(),
            failure: {
                redacted: true,
                message: 'Failure detail omitted from the durable receipt.',
            },
        });
        throw error;
    }
}

async function main() {
    const result = await applyBundle(parseArgs());
    console.log(JSON.stringify({
        result: result.result,
        mode: result.mode,
        importId: result.importId,
        expectedItemCount: result.expectedItemCount,
        receiptFile: result.receiptFile,
    }, null, 2));
}

if (require.main === module) {
    main().catch(error => {
        console.error(`${error.code || error.name}: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    RECEIPT_SCHEMA,
    applyBundle,
    beginBody,
    loadBundle,
};
