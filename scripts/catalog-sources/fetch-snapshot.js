#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, parseArgs, requireArg } = require('../thetea/lib/env');
const {
    PRODUCT_REFERENCE_MANIFEST_FILE,
    loadVerifiedProductReference,
} = require('../thetea/lib/product-reference');
const {
    readJsonIfExists,
    safeSegment,
    sha256,
    stableJson,
} = require('./lib/artifacts');
const {
    ingestSourceSnapshot,
    replaySourceSnapshot,
} = require('./lib/runtime');
const { createZzcTeaConnector } = require('./zzctea/connector');

const CONNECTORS = Object.freeze({
    zzctea: createZzcTeaConnector,
});

function compareNumericExternalIds(left, right) {
    return left.length - right.length || left.localeCompare(right, 'en');
}

function createProductReferenceSeed({
    connector,
    inputPath,
    repositoryRoot = REPO_ROOT,
}) {
    if (typeof connector?.externalIdFromProductCode !== 'function') {
        throw new Error(
            `Source '${connector?.id || 'unknown'}' does not support ProductCatalog code seeds.`,
        );
    }
    const root = path.resolve(repositoryRoot);
    const resolvedInput = path.resolve(root, inputPath);
    const relativePath = path.relative(root, resolvedInput);
    if (!relativePath ||
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)) {
        throw new Error('Product reference seed must be contained in the repository.');
    }
    const reference = loadVerifiedProductReference(resolvedInput);
    const externalIds = [];
    const seen = new Set();
    for (const product of reference.products) {
        const externalId = connector.externalIdFromProductCode(product.code);
        if (externalId === null) continue;
        if (!seen.has(externalId)) {
            seen.add(externalId);
            externalIds.push(externalId);
        }
    }
    if (externalIds.length === 0) {
        throw new Error(
            `Complete ProductCatalog reference contains no ${connector.id} product IDs.`,
        );
    }
    externalIds.sort(compareNumericExternalIds);
    const manifestFile = path.join(
        reference.root,
        PRODUCT_REFERENCE_MANIFEST_FILE,
    );
    return {
        externalIds,
        requestParameters: {
            sourceKind: 'complete-product-catalog-product-reference',
            productReferencePath: relativePath.split(path.sep).join('/'),
            productReferenceManifestSha256: sha256(
                fs.readFileSync(manifestFile),
            ),
            productsSha256: reference.manifest.productsSha256,
            productCodesSha256: reference.manifest.productCodesSha256,
        },
    };
}

function snapshotCheckpointFile({
    connector,
    repositoryRoot,
    snapshotId,
}) {
    return path.join(
        repositoryRoot,
        'sources',
        'catalog-sources',
        safeSegment(connector.id, 'source ID'),
        'snapshots',
        safeSegment(snapshotId, 'snapshot ID'),
        'checkpoint.json',
    );
}

function seedFromCheckpoint({
    baseSeed,
    checkpoint,
}) {
    const checkpointParameters = checkpoint?.requestParameters?.seed;
    if (!checkpoint?.seed ||
        !Array.isArray(checkpoint.seed.externalIds) ||
        !checkpointParameters ||
        typeof checkpointParameters !== 'object') {
        throw new Error(
            'Existing snapshot is not a ProductCatalog-seeded snapshot.',
        );
    }
    for (const [key, expected] of Object.entries(baseSeed.requestParameters)) {
        if (stableJson(checkpointParameters[key]) !== stableJson(expected)) {
            const error = new Error(
                `Existing snapshot ProductCatalog seed ${key} changed.`,
            );
            error.code = 'SOURCE_CHECKPOINT_INCOMPATIBLE';
            throw error;
        }
    }
    const requestParameters = { ...checkpointParameters };
    for (const reserved of [
        'schemaVersion',
        'mode',
        'itemCount',
        'externalIdsSha256',
    ]) {
        delete requestParameters[reserved];
    }
    return {
        externalIds: [...checkpoint.seed.externalIds],
        requestParameters,
    };
}

async function createWeeklyProductReferenceSeed({
    baseSeed,
    connector,
    repositoryRoot = REPO_ROOT,
    replay = false,
    snapshotId,
}) {
    const checkpoint = readJsonIfExists(snapshotCheckpointFile({
        connector,
        repositoryRoot,
        snapshotId,
    }));
    if (checkpoint) {
        return seedFromCheckpoint({ baseSeed, checkpoint });
    }
    if (replay) {
        throw new Error(
            `Snapshot '${snapshotId}' has no checkpoint to replay.`,
        );
    }
    if (typeof connector.discoverExternalIds !== 'function') {
        throw new Error(
            `Source '${connector.id}' does not support public seed discovery.`,
        );
    }
    const discovery = await connector.discoverExternalIds();
    if (!discovery ||
        !Array.isArray(discovery.externalIds) ||
        !discovery.requestParameters ||
        typeof discovery.requestParameters !== 'object') {
        throw new Error(`Source '${connector.id}' returned an invalid discovery seed.`);
    }
    const externalIds = [...new Set([
        ...baseSeed.externalIds,
        ...discovery.externalIds,
    ])].sort(compareNumericExternalIds);
    return {
        externalIds,
        requestParameters: {
            ...baseSeed.requestParameters,
            ...discovery.requestParameters,
        },
    };
}

async function main() {
    const args = parseArgs();
    const source = requireArg(args, 'source');
    const snapshotId = requireArg(args, 'snapshot');
    const connectorFactory = CONNECTORS[source];
    if (!connectorFactory) {
        throw new Error(`Unsupported source '${source}'. Available: ${Object.keys(CONNECTORS).join(', ')}`);
    }
    const connector = connectorFactory({
        minimumRequestIntervalMs: args['minimum-request-interval-ms'] === undefined
            ? undefined
            : Number(args['minimum-request-interval-ms']),
    });
    const baseSeed = args['product-ref']
        ? createProductReferenceSeed({
            connector,
            inputPath: String(args['product-ref']),
            repositoryRoot: REPO_ROOT,
        })
        : null;
    const seed = baseSeed
        ? await createWeeklyProductReferenceSeed({
            baseSeed,
            connector,
            repositoryRoot: REPO_ROOT,
            replay: args.replay === true,
            snapshotId,
        })
        : null;
    const common = {
        connector,
        repositoryRoot: REPO_ROOT,
        seed,
        snapshotId,
    };
    const result = args.replay === true
        ? await replaySourceSnapshot(common)
        : await ingestSourceSnapshot({
            ...common,
            concurrency: Number(args.concurrency || 4),
            maximumDropRatio: Number(args['maximum-drop-ratio'] || 0.25),
            maximumGrowthRatio: Number(args['maximum-growth-ratio'] || 2),
            pageSize: Number(args['page-size'] || connector.defaultPageSize),
            resume: args.resume === true,
        });

    console.log(`Source: ${source}`);
    console.log(`Snapshot: ${snapshotId}`);
    console.log(`Items: ${result.manifest.itemCount}`);
    console.log(`Raw payload digest: ${result.manifest.rawPayloadDigest}`);
    console.log(`Semantic digest: ${result.manifest.semanticDigest}`);
    console.log(`Artifact: ${result.artifactFile}`);
    console.log('Production writes: none');
}

if (require.main === module) {
    main().catch(error => {
        console.error(`${error.code || error.name}: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    CONNECTORS,
    createProductReferenceSeed,
    createWeeklyProductReferenceSeed,
    main,
    seedFromCheckpoint,
    snapshotCheckpointFile,
};
