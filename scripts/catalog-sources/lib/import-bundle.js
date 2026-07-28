'use strict';

const fs = require('fs');
const path = require('path');
const {
    readJson,
    sha256,
    stableJson,
    writeJsonAtomic,
} = require('./artifacts');
const {
    validateMediaOutputCoverage,
    validateMappingCoverage,
    verifyCompleteOutput,
} = require('./media-materialization');
const {
    REVIEWED_BRANDS,
    REVIEWED_BRAND_MANIFEST_SHA256,
} = require('../zzctea/connector');

const IMPORT_BUNDLE_SCHEMA = 'catalog-source-import-bundle-v1';
const IMPORT_PLAN_SCHEMA = 'catalog-source-import-plan-v1';
const DIGEST = /^[a-f0-9]{64}$/;

function assertRealDirectory(directory, label) {
    const resolved = path.resolve(directory);
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${label} must be a real directory.`);
    }
    return resolved;
}

function assertContainedFile(root, relativeFile, label) {
    if (!relativeFile || path.isAbsolute(relativeFile)) {
        throw new Error(`${label} must be a relative path.`);
    }
    const resolved = path.resolve(root, relativeFile);
    if (!resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`${label} escapes its input directory.`);
    }
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`${label} must be a real file.`);
    }
    const canonical = fs.realpathSync(resolved);
    if (!canonical.startsWith(`${fs.realpathSync(root)}${path.sep}`)) {
        throw new Error(`${label} resolves outside its input directory.`);
    }
    return resolved;
}

function ensureRealDirectory(directory) {
    if (fs.existsSync(directory)) {
        const stat = fs.lstatSync(directory);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new Error(`Import bundle path is not a real directory: ${directory}.`);
        }
        return;
    }
    fs.mkdirSync(directory);
}

function cloneFile(sourceFile, outputRoot, relativeOutput) {
    const destination = path.resolve(outputRoot, relativeOutput);
    if (!destination.startsWith(`${outputRoot}${path.sep}`)) {
        throw new Error('Import bundle output path escapes the staging directory.');
    }
    const sourceStat = fs.lstatSync(sourceFile);
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
        throw new Error(`Import bundle source must be a real file: ${sourceFile}.`);
    }
    const segments = path.dirname(relativeOutput).split(path.sep).filter(Boolean);
    let directory = outputRoot;
    for (const segment of segments) {
        directory = path.join(directory, segment);
        ensureRealDirectory(directory);
    }
    fs.copyFileSync(sourceFile, destination, fs.constants.COPYFILE_FICLONE);
    return {
        bytes: sourceStat.size,
        file: relativeOutput.replaceAll(path.sep, '/'),
        sha256: sha256(fs.readFileSync(destination)),
    };
}

function cloneContainedFile(inputRoot, relativeInput, outputRoot, relativeOutput, label) {
    const source = assertContainedFile(inputRoot, relativeInput, label);
    return cloneFile(source, outputRoot, relativeOutput);
}

function assertDigest(value, label) {
    if (!DIGEST.test(String(value || ''))) {
        throw new Error(`${label} must be a lowercase SHA-256 digest.`);
    }
}

function assertClaimedFileDigest(root, relativeFile, expectedSha256, label) {
    assertDigest(expectedSha256, `${label} SHA-256`);
    const file = assertContainedFile(root, relativeFile, label);
    const actualSha256 = sha256(fs.readFileSync(file));
    if (actualSha256 !== expectedSha256) {
        throw new Error(`${label} differs from its source manifest.`);
    }
    return file;
}

function compareNumericExternalIds(left, right) {
    return left.length - right.length || left.localeCompare(right, 'en');
}

function assertSeededWeeklyCheckpoint(context) {
    const { sourceBundle } = context;
    const checkpoint = readJson(assertClaimedFileDigest(
        sourceBundle.root,
        sourceBundle.manifest.checkpointFile,
        sourceBundle.manifest.checkpointSha256,
        'Source checkpoint',
    ));
    const seed = checkpoint.seed;
    const parameters = checkpoint.requestParameters?.seed;
    const artifactIds = sourceBundle.artifact.items
        .map(item => String(item?.externalId || ''))
        .sort(compareNumericExternalIds);
    if (checkpoint.status !== 'complete' ||
        checkpoint.connectorVersion !== 'zzctea-public-html-v7' ||
        sourceBundle.manifest.connectorVersion !== checkpoint.connectorVersion ||
        seed?.schemaVersion !== 'catalog-source-external-id-seed-v1' ||
        seed.mode !== 'external-ids' ||
        !Array.isArray(seed.externalIds) ||
        seed.itemCount !== sourceBundle.manifest.itemCount ||
        seed.externalIds.length !== seed.itemCount ||
        stableJson(seed.externalIds) !== stableJson(artifactIds) ||
        seed.externalIdsSha256 !== sha256(stableJson(seed.externalIds)) ||
        parameters?.schemaVersion !== seed.schemaVersion ||
        parameters?.mode !== seed.mode ||
        parameters?.itemCount !== seed.itemCount ||
        parameters?.externalIdsSha256 !== seed.externalIdsSha256 ||
        parameters?.sourceKind !==
            'complete-product-catalog-product-reference' ||
        typeof parameters.productReferencePath !== 'string' ||
        !parameters.productReferencePath.startsWith(
            'sources/prod/product-reference/',
        ) ||
        parameters.productReferencePath.split('/').includes('..') ||
        !DIGEST.test(String(parameters.productReferenceManifestSha256 || '')) ||
        !DIGEST.test(String(parameters.productsSha256 || '')) ||
        !DIGEST.test(String(parameters.productCodesSha256 || '')) ||
        parameters.brandManifest?.schemaVersion !==
            'zzctea-reviewed-brand-manifest-v1' ||
        !Array.isArray(parameters.brandManifest.brands) ||
        stableJson(parameters.brandManifest.brands) !==
            stableJson(REVIEWED_BRANDS) ||
        parameters.brandManifest.sha256 !==
            REVIEWED_BRAND_MANIFEST_SHA256 ||
        parameters.discovery?.schemaVersion !==
            'zzctea-brand-list-discovery-v1' ||
        !Number.isSafeInteger(parameters.discovery.itemCount) ||
        parameters.discovery.itemCount < 1 ||
        parameters.discovery.itemCount > seed.itemCount ||
        !DIGEST.test(String(parameters.discovery.externalIdsSha256 || '')) ||
        !Number.isSafeInteger(parameters.discovery.envelopeCount) ||
        parameters.discovery.envelopeCount < 13 ||
        !DIGEST.test(String(parameters.discovery.envelopesSha256 || ''))) {
        throw new Error(
            'Import bundle source is not a complete ProductCatalog-seeded weekly snapshot.',
        );
    }
    return checkpoint;
}

function validateProductPatchCoverage(mappings, products) {
    if (!Array.isArray(products)) {
        throw new Error('Product patches must be an array.');
    }
    const byCode = new Map();
    for (const product of products) {
        const code = String(product?.code || '');
        if (!/^ZZC-[1-9]\d*$/.test(code) || byCode.has(code)) {
            throw new Error('Product patches must have exact unique ZZCTea codes.');
        }
        byCode.set(code, product);
    }
    const counts = {
        matchedUpdates: 0,
        matchedNoops: 0,
        draftProducts: 0,
        productPatches: products.length,
    };
    for (const mapping of mappings) {
        const patch = byCode.get(mapping.productCode);
        if (mapping.status === 'matched-update') {
            if (!patch ||
                patch.id !== mapping.productId ||
                patch.code !== mapping.productCode) {
                throw new Error('Matched ZZCTea update has no exact ProductCatalog patch.');
            }
            counts.matchedUpdates += 1;
            byCode.delete(mapping.productCode);
        } else if (mapping.status === 'matched-noop') {
            if (patch) {
                throw new Error('Matched ZZCTea no-op must not have a product patch.');
            }
            counts.matchedNoops += 1;
        } else if (mapping.status === 'missing-create-draft') {
            if (!patch ||
                Object.hasOwn(patch, 'id') ||
                patch.code !== mapping.productCode ||
                patch.sku !== mapping.productCode ||
                patch.published !== false ||
                !Array.isArray(patch.catalogPrices) ||
                patch.catalogPrices.length !== 0 ||
                !Array.isArray(patch.tierPrices) ||
                patch.tierPrices.length !== 0 ||
                !Array.isArray(patch.storePriceOverrides) ||
                patch.storePriceOverrides.length !== 0 ||
                [
                    'price',
                    'prices',
                    'oldPrice',
                    'catalogPrice',
                    'productCost',
                    'enteredPrice',
                    'minEnteredPrice',
                    'maxEnteredPrice',
                ].some(field => Object.hasOwn(patch, field))) {
                throw new Error('New ZZCTea product patch must be a price-free Draft.');
            }
            counts.draftProducts += 1;
            byCode.delete(mapping.productCode);
        }
    }
    if (byCode.size !== 0 ||
        counts.productPatches !== counts.matchedUpdates + counts.draftProducts) {
        throw new Error('Product patches do not exactly match reconciliation mappings.');
    }
    return counts;
}

function assertBundleBindings(context) {
    const {
        mappingsBundle,
        mediaCheckpoint,
        mediaManifest,
        projectionBundle,
        sourceBundle,
    } = context;
    const sourceManifest = sourceBundle.manifest;
    const projectionManifest = projectionBundle.manifest;
    const reconciliationManifest = mappingsBundle.manifest;

    if (sourceManifest.sourceId !== 'zzctea' ||
        projectionManifest.sourceId !== sourceManifest.sourceId ||
        reconciliationManifest.sourceId !== sourceManifest.sourceId ||
        mediaManifest.sourceId !== sourceManifest.sourceId ||
        projectionManifest.snapshotId !== sourceManifest.snapshotId ||
        reconciliationManifest.snapshotId !== sourceManifest.snapshotId ||
        mediaManifest.snapshotId !== sourceManifest.snapshotId) {
        throw new Error('Import bundle components do not share one source snapshot.');
    }
    if (projectionManifest.inputArtifactSha256 !==
            sourceManifest.artifactSha256 ||
        reconciliationManifest.inputProjectionSha256 !==
            projectionManifest.projectionSha256 ||
        reconciliationManifest.inputProjectionManifestSha256 !==
            projectionBundle.manifestSha256 ||
        mediaManifest.inputArtifactSha256 !== sourceManifest.artifactSha256 ||
        mediaManifest.inputMappingSha256 !==
            reconciliationManifest.mappingSha256) {
        throw new Error('Import bundle component hash bindings do not match.');
    }
    if (projectionManifest.itemCount !== sourceManifest.itemCount ||
        reconciliationManifest.selection?.mode !== 'full-snapshot' ||
        reconciliationManifest.selectionComplete !== true ||
        reconciliationManifest.counts?.ambiguous !== 0 ||
        reconciliationManifest.counts?.matched +
            reconciliationManifest.counts?.missing !== sourceManifest.itemCount ||
        reconciliationManifest.productPatchCount !==
            context.mappingsBundle.mappings.filter(mapping =>
                mapping.status === 'matched-update' ||
                mapping.status === 'missing-create-draft').length ||
        mediaManifest.selection?.mode !== 'full-snapshot' ||
        mediaCheckpoint.binding?.onlyExternalId !== null) {
        throw new Error('Import bundle inputs do not cover one exact full snapshot.');
    }
    if (sourceManifest.complete !== true ||
        projectionManifest.complete !== true ||
        reconciliationManifest.complete !== true ||
        mediaManifest.complete !== true ||
        mediaCheckpoint.status !== 'complete' ||
        sourceManifest.authoritativeForDeletion !== false ||
        sourceBundle.artifact.source?.referencePricesAreRetailPrices !== false ||
        projectionManifest.productionWrites !== false ||
        reconciliationManifest.productionWrites !== false ||
        mediaManifest.productionWrites !== false ||
        mediaCheckpoint.productionWrites !== false) {
        throw new Error('Import bundle inputs are incomplete or unsafe.');
    }
    for (const [value, label] of [
        [sourceManifest.artifactSha256, 'Source artifact SHA-256'],
        [projectionManifest.projectionSha256, 'Projection SHA-256'],
        [reconciliationManifest.mappingSha256, 'Mapping SHA-256'],
        [reconciliationManifest.productPatchesSha256, 'Product patches SHA-256'],
        [reconciliationManifest.reportSha256, 'Reconciliation report SHA-256'],
        [reconciliationManifest.rollbackProductsSha256,
            'Rollback products SHA-256'],
        [mediaManifest.mediaItemsSha256, 'Media items SHA-256'],
        [mediaManifest.receiptSha256, 'Media receipt SHA-256'],
    ]) {
        assertDigest(value, label);
    }
    for (const [root, file, digest, label] of [
        [
            sourceBundle.root,
            sourceManifest.artifactFile,
            sourceManifest.artifactSha256,
            'Source artifact',
        ],
        [
            sourceBundle.root,
            sourceManifest.checkpointFile,
            sourceManifest.checkpointSha256,
            'Source checkpoint',
        ],
        [
            projectionBundle.root,
            projectionManifest.projectionFile,
            projectionManifest.projectionSha256,
            'Projection',
        ],
        [
            mappingsBundle.root,
            reconciliationManifest.reconciliationFile,
            reconciliationManifest.reconciliationSha256,
            'Reconciliation',
        ],
        [
            mappingsBundle.root,
            reconciliationManifest.mappingFile,
            reconciliationManifest.mappingSha256,
            'Source-product mappings',
        ],
        [
            mappingsBundle.root,
            reconciliationManifest.productPatchesFile,
            reconciliationManifest.productPatchesSha256,
            'Product patches',
        ],
        [
            mappingsBundle.root,
            reconciliationManifest.reportFile,
            reconciliationManifest.reportSha256,
            'Reconciliation report',
        ],
        [
            mappingsBundle.root,
            reconciliationManifest.rollbackProductsFile,
            reconciliationManifest.rollbackProductsSha256,
            'Rollback products',
        ],
        [
            context.mediaRoot,
            mediaManifest.mediaItemsFile,
            mediaManifest.mediaItemsSha256,
            'Media items',
        ],
        [
            context.mediaRoot,
            mediaManifest.receiptFile,
            mediaManifest.receiptSha256,
            'Media receipt',
        ],
    ]) {
        assertClaimedFileDigest(root, file, digest, label);
    }
    assertSeededWeeklyCheckpoint(context);
    validateMappingCoverage(
        sourceBundle.artifact,
        mappingsBundle.mappings,
        reconciliationManifest.counts,
    );
    const verifiedMedia = verifyCompleteOutput(context.mediaRoot, mediaManifest);
    validateMediaOutputCoverage(
        sourceBundle.artifact,
        mappingsBundle.mappings,
        verifiedMedia,
    );
}

function buildImportPlan(context) {
    return {
        schemaVersion: IMPORT_PLAN_SCHEMA,
        sourceId: context.sourceBundle.manifest.sourceId,
        snapshotId: context.sourceBundle.manifest.snapshotId,
        applyAllowed: false,
        blockers: [
            {
                code: 'setuptool-verified-media-artifact',
                issue:
                    'https://gitlab.xnata.com/gzdkh/workers/' +
                    'DKH.SetupTool/-/issues/2',
            },
            {
                code: 'one-product-canary-required',
            },
        ],
        dataExchange: [
            {
                profile: 'products',
                path: 'data/products.json',
                required: true,
            },
        ],
        commerceNetwork: {
            enabled: false,
            path: 'data/commerce-observations.json',
            source: 'normalized-observation-projection',
            productionWrites: false,
        },
        media: {
            scope: 'products',
            ownerKey: 'productCode',
            enabled: false,
            source: 'verified-manifest',
            path: 'media/media-items.json',
            manifest: 'media/media-manifest.json',
            checkpoint: '.setup-tool/media-checkpoint.json',
            galleryStrategy: 'reconcile-source-managed',
            thumbnailStrategy: 'preserve-existing',
        },
        productionWrites: false,
    };
}

function collectFileInventory(root, excluded = new Set()) {
    const inventory = [];
    const pending = [root];
    while (pending.length > 0) {
        const current = pending.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const target = path.join(current, entry.name);
            const relative = path.relative(root, target).replaceAll(path.sep, '/');
            if (entry.isSymbolicLink()) {
                throw new Error(`Import bundle contains a symlink: ${target}.`);
            }
            if (entry.isDirectory()) {
                pending.push(target);
                continue;
            }
            if (!entry.isFile()) {
                throw new Error(`Import bundle contains a non-file entry: ${target}.`);
            }
            if (excluded.has(relative)) continue;
            const bytes = fs.statSync(target).size;
            inventory.push({
                bytes,
                file: relative,
                sha256: sha256(fs.readFileSync(target)),
            });
        }
    }
    return inventory.sort((left, right) => left.file.localeCompare(right.file));
}

function inventoryEntry(inventory, file, label) {
    const entry = inventory.find(candidate => candidate.file === file);
    if (!entry) throw new Error(`${label} is absent from the import bundle inventory.`);
    return entry;
}

function buildBundleIdentity({
    counts,
    directories,
    inputEvidence,
    inventory,
    snapshotId,
    sourceId,
}) {
    return {
        schemaVersion: IMPORT_BUNDLE_SCHEMA,
        sourceId,
        snapshotId,
        inputEvidence,
        counts,
        directories,
        inventory,
    };
}

function buildBundleManifest(context, copied, inventory) {
    const sourceManifest = context.sourceBundle.manifest;
    const projectionManifest = context.projectionBundle.manifest;
    const reconciliationManifest = context.mappingsBundle.manifest;
    const mediaManifest = context.mediaManifest;
    const inputEvidence = {
        sourceArtifactSha256: sourceManifest.artifactSha256,
        sourceCheckpointSha256: sourceManifest.checkpointSha256,
        projectionSha256: projectionManifest.projectionSha256,
        projectionManifestSha256: context.projectionBundle.manifestSha256,
        reconciliationSha256: reconciliationManifest.reconciliationSha256,
        reconciliationReportSha256: reconciliationManifest.reportSha256,
        mappingSha256: reconciliationManifest.mappingSha256,
        productPatchesSha256: reconciliationManifest.productPatchesSha256,
        rollbackProductsSha256:
            reconciliationManifest.rollbackProductsSha256,
        mediaManifestSha256: copied.mediaManifest.sha256,
        mediaItemsSha256: mediaManifest.mediaItemsSha256,
        mediaReceiptSha256: mediaManifest.receiptSha256,
    };
    const counts = {
        sourceItems: sourceManifest.itemCount,
        commerceObservations: projectionManifest.itemCount,
        matchedProducts: reconciliationManifest.counts.matched,
        matchedUpdates: context.mappingsBundle.mappings.filter(
            mapping => mapping.status === 'matched-update',
        ).length,
        matchedNoops: context.mappingsBundle.mappings.filter(
            mapping => mapping.status === 'matched-noop',
        ).length,
        draftProducts: reconciliationManifest.counts.missing,
        productPatches: reconciliationManifest.productPatchCount,
        sourceProductMappings:
            reconciliationManifest.counts.matched +
            reconciliationManifest.counts.missing,
        mediaItems: mediaManifest.mediaItemCount,
        uniqueMediaBlobs: mediaManifest.uniqueBlobCount,
        mediaBytes: mediaManifest.totalBytes,
    };
    const directories = {
        sourceEvidence: 'evidence/source',
        projectionEvidence: 'evidence/projection',
        reconciliationEvidence: 'evidence/reconciliation',
        media: 'media',
    };
    const bundleId = sha256(stableJson(buildBundleIdentity({
        counts,
        directories,
        inputEvidence,
        inventory,
        snapshotId: sourceManifest.snapshotId,
        sourceId: sourceManifest.sourceId,
    })));
    return {
        schemaVersion: IMPORT_BUNDLE_SCHEMA,
        complete: true,
        sourceId: sourceManifest.sourceId,
        snapshotId: sourceManifest.snapshotId,
        bundleId,
        version: `${sourceManifest.snapshotId}.${bundleId.slice(0, 12)}`,
        inputEvidence,
        counts,
        inventory,
        files: {
            importPlan: inventoryEntry(inventory, 'import-plan.json', 'Import plan'),
            products: copied.products,
            sourceProductMappings: copied.mappings,
            commerceObservations: copied.commerceObservations,
            mediaManifest: copied.mediaManifest,
            mediaItems: copied.mediaItems,
            mediaReceipt: copied.mediaReceipt,
            mediaCheckpoint: copied.mediaCheckpoint,
        },
        directories,
        applyAllowed: false,
        productionWrites: false,
    };
}

function writeImportBundle(outputDirectory, context) {
    const outputRoot = assertRealDirectory(outputDirectory, 'Import bundle staging directory');
    assertBundleBindings(context);

    const copied = {};
    const sourceFiles = [
        ['artifact-manifest.json', 'artifact-manifest.json'],
        [context.sourceBundle.manifest.artifactFile,
            context.sourceBundle.manifest.artifactFile],
        [context.sourceBundle.manifest.checkpointFile,
            context.sourceBundle.manifest.checkpointFile],
    ];
    for (const [input, output] of sourceFiles) {
        cloneContainedFile(
            context.sourceBundle.root,
            input,
            outputRoot,
            `evidence/source/${output}`,
            'Source evidence',
        );
    }

    const projectionFiles = [
        ['projection-manifest.json', 'projection-manifest.json'],
        [context.projectionBundle.manifest.projectionFile,
            context.projectionBundle.manifest.projectionFile],
        [context.projectionBundle.manifest.reportFile,
            context.projectionBundle.manifest.reportFile],
    ];
    for (const [input, output] of projectionFiles) {
        cloneContainedFile(
            context.projectionBundle.root,
            input,
            outputRoot,
            `evidence/projection/${output}`,
            'Projection evidence',
        );
    }

    const reconciliationManifest = context.mappingsBundle.manifest;
    const reconciliationFiles = [
        'reconciliation-manifest.json',
        reconciliationManifest.reconciliationFile,
        reconciliationManifest.reportFile,
        reconciliationManifest.mappingFile,
        reconciliationManifest.productPatchesFile,
        reconciliationManifest.rollbackProductsFile,
    ];
    for (const input of reconciliationFiles) {
        cloneContainedFile(
            context.mappingsBundle.root,
            input,
            outputRoot,
            `evidence/reconciliation/${input}`,
            'Reconciliation evidence',
        );
    }

    copied.products = cloneContainedFile(
        context.mappingsBundle.root,
        reconciliationManifest.productPatchesFile,
        outputRoot,
        'data/products.json',
        'Product patches',
    );
    copied.mappings = cloneContainedFile(
        context.mappingsBundle.root,
        reconciliationManifest.mappingFile,
        outputRoot,
        'data/source-product-mappings.json',
        'Source-product mappings',
    );
    copied.commerceObservations = cloneContainedFile(
        context.projectionBundle.root,
        context.projectionBundle.manifest.projectionFile,
        outputRoot,
        'data/commerce-observations.json',
        'Commerce observations',
    );

    for (const [input, output, key] of [
        ['media-manifest.json', 'media/media-manifest.json', 'mediaManifest'],
        [context.mediaManifest.mediaItemsFile,
            'media/media-items.json', 'mediaItems'],
        [context.mediaManifest.receiptFile,
            'media/media-receipt.json', 'mediaReceipt'],
        ['media-checkpoint.json',
            'media/media-checkpoint.json', 'mediaCheckpoint'],
    ]) {
        copied[key] = cloneContainedFile(
            context.mediaRoot,
            input,
            outputRoot,
            output,
            'Media artifact',
        );
    }
    const blobFiles = [...new Set(
        context.mediaReceipt.sources.map(source => source.file),
    )].sort();
    for (const blobFile of blobFiles) {
        cloneContainedFile(
            context.mediaRoot,
            blobFile,
            outputRoot,
            `media/${blobFile}`,
            'Media blob',
        );
    }

    const importPlan = buildImportPlan(context);
    writeJsonAtomic(path.join(outputRoot, 'import-plan.json'), importPlan);
    const inventory = collectFileInventory(outputRoot);
    const manifest = buildBundleManifest(context, copied, inventory);
    writeJsonAtomic(path.join(outputRoot, 'import-bundle-manifest.json'), manifest);
    return { importPlan, manifest };
}

function assertNoSymlinks(root) {
    const pending = [root];
    while (pending.length > 0) {
        const current = pending.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const target = path.join(current, entry.name);
            if (entry.isSymbolicLink()) {
                throw new Error(`Import bundle contains a symlink: ${target}.`);
            }
            if (entry.isDirectory()) pending.push(target);
            else if (!entry.isFile()) {
                throw new Error(`Import bundle contains a non-file entry: ${target}.`);
            }
        }
    }
}

function verifyImportBundle(outputDirectory) {
    const root = assertRealDirectory(outputDirectory, 'ZZCTea import bundle');
    assertNoSymlinks(root);
    const manifest = readJson(path.join(root, 'import-bundle-manifest.json'));
    const plan = readJson(path.join(root, 'import-plan.json'));
    const actualInventory = collectFileInventory(
        root,
        new Set(['import-bundle-manifest.json']),
    );
    if (stableJson(actualInventory) !== stableJson(manifest.inventory)) {
        throw new Error('ZZCTea import bundle inventory differs from its manifest.');
    }
    if (manifest.schemaVersion !== IMPORT_BUNDLE_SCHEMA ||
        manifest.complete !== true ||
        manifest.sourceId !== 'zzctea' ||
        manifest.applyAllowed !== false ||
        manifest.productionWrites !== false ||
        plan.schemaVersion !== IMPORT_PLAN_SCHEMA ||
        plan.sourceId !== manifest.sourceId ||
        plan.snapshotId !== manifest.snapshotId ||
        plan.applyAllowed !== false ||
        plan.commerceNetwork?.enabled !== false ||
        plan.commerceNetwork?.productionWrites !== false ||
        plan.media?.enabled !== false ||
        plan.media?.galleryStrategy !== 'reconcile-source-managed' ||
        plan.media?.thumbnailStrategy !== 'preserve-existing' ||
        plan.productionWrites !== false ||
        stableJson(manifest.directories) !== stableJson({
            sourceEvidence: 'evidence/source',
            projectionEvidence: 'evidence/projection',
            reconciliationEvidence: 'evidence/reconciliation',
            media: 'media',
        })) {
        throw new Error('ZZCTea import bundle manifest or plan is unsafe.');
    }
    const expectedFiles = {
        importPlan: inventoryEntry(actualInventory, 'import-plan.json', 'Import plan'),
        products: inventoryEntry(actualInventory, 'data/products.json', 'Products'),
        sourceProductMappings: inventoryEntry(
            actualInventory,
            'data/source-product-mappings.json',
            'Source-product mappings',
        ),
        commerceObservations: inventoryEntry(
            actualInventory,
            'data/commerce-observations.json',
            'Commerce observations',
        ),
        mediaManifest: inventoryEntry(
            actualInventory,
            'media/media-manifest.json',
            'Media manifest',
        ),
        mediaItems: inventoryEntry(
            actualInventory,
            'media/media-items.json',
            'Media items',
        ),
        mediaReceipt: inventoryEntry(
            actualInventory,
            'media/media-receipt.json',
            'Media receipt',
        ),
        mediaCheckpoint: inventoryEntry(
            actualInventory,
            'media/media-checkpoint.json',
            'Media checkpoint',
        ),
    };
    if (stableJson(expectedFiles) !== stableJson(manifest.files)) {
        throw new Error('ZZCTea import bundle file roles differ from its inventory.');
    }
    const sourceManifest = readJson(path.join(
        root,
        manifest.directories.sourceEvidence,
        'artifact-manifest.json',
    ));
    const sourceEvidenceRoot = path.join(
        root,
        manifest.directories.sourceEvidence,
    );
    const sourceArtifact = readJson(path.join(
        sourceEvidenceRoot,
        sourceManifest.artifactFile,
    ));
    const projectionManifestFile = path.join(
        root,
        manifest.directories.projectionEvidence,
        'projection-manifest.json',
    );
    const projectionManifest = readJson(projectionManifestFile);
    const reconciliationManifest = readJson(path.join(
        root,
        manifest.directories.reconciliationEvidence,
        'reconciliation-manifest.json',
    ));
    const mediaRoot = path.join(root, manifest.directories.media);
    const mediaManifest = readJson(path.join(mediaRoot, 'media-manifest.json'));
    if (sourceManifest.sourceId !== manifest.sourceId ||
        projectionManifest.sourceId !== manifest.sourceId ||
        reconciliationManifest.sourceId !== manifest.sourceId ||
        mediaManifest.sourceId !== manifest.sourceId ||
        sourceManifest.snapshotId !== manifest.snapshotId ||
        projectionManifest.snapshotId !== manifest.snapshotId ||
        reconciliationManifest.snapshotId !== manifest.snapshotId ||
        mediaManifest.snapshotId !== manifest.snapshotId ||
        projectionManifest.inputArtifactSha256 !==
            sourceManifest.artifactSha256 ||
        reconciliationManifest.inputProjectionSha256 !==
            projectionManifest.projectionSha256 ||
        reconciliationManifest.inputProjectionManifestSha256 !==
            sha256(fs.readFileSync(projectionManifestFile)) ||
        mediaManifest.inputArtifactSha256 !== sourceManifest.artifactSha256 ||
        mediaManifest.inputMappingSha256 !==
            reconciliationManifest.mappingSha256) {
        throw new Error('ZZCTea import bundle component hash bindings do not match.');
    }
    const verifiedMedia = verifyCompleteOutput(mediaRoot, mediaManifest);

    for (const [relativeFile, digest, label] of [
        [
            `${manifest.directories.sourceEvidence}/${sourceManifest.artifactFile}`,
            sourceManifest.artifactSha256,
            'Source artifact',
        ],
        [
            `${manifest.directories.sourceEvidence}/${sourceManifest.checkpointFile}`,
            sourceManifest.checkpointSha256,
            'Source checkpoint',
        ],
        [
            `${manifest.directories.projectionEvidence}/${projectionManifest.projectionFile}`,
            projectionManifest.projectionSha256,
            'Projection',
        ],
        [
            'data/commerce-observations.json',
            projectionManifest.projectionSha256,
            'Commerce observations',
        ],
        [
            `${manifest.directories.reconciliationEvidence}/${reconciliationManifest.reconciliationFile}`,
            reconciliationManifest.reconciliationSha256,
            'Reconciliation',
        ],
        [
            'data/source-product-mappings.json',
            reconciliationManifest.mappingSha256,
            'Source-product mappings',
        ],
        [
            'data/products.json',
            reconciliationManifest.productPatchesSha256,
            'Product patches',
        ],
        [
            `${manifest.directories.reconciliationEvidence}/${reconciliationManifest.reportFile}`,
            reconciliationManifest.reportSha256,
            'Reconciliation report',
        ],
        [
            `${manifest.directories.reconciliationEvidence}/${reconciliationManifest.rollbackProductsFile}`,
            reconciliationManifest.rollbackProductsSha256,
            'Rollback products',
        ],
        [
            'media/media-items.json',
            mediaManifest.mediaItemsSha256,
            'Media items',
        ],
        [
            'media/media-receipt.json',
            mediaManifest.receiptSha256,
            'Media receipt',
        ],
    ]) {
        const entry = inventoryEntry(actualInventory, relativeFile, label);
        if (entry.sha256 !== digest) {
            throw new Error(`${label} differs from its evidence manifest.`);
        }
    }
    const inputEvidence = {
        sourceArtifactSha256: sourceManifest.artifactSha256,
        sourceCheckpointSha256: sourceManifest.checkpointSha256,
        projectionSha256: projectionManifest.projectionSha256,
        projectionManifestSha256: sha256(fs.readFileSync(projectionManifestFile)),
        reconciliationSha256: reconciliationManifest.reconciliationSha256,
        reconciliationReportSha256: reconciliationManifest.reportSha256,
        mappingSha256: reconciliationManifest.mappingSha256,
        productPatchesSha256: reconciliationManifest.productPatchesSha256,
        rollbackProductsSha256:
            reconciliationManifest.rollbackProductsSha256,
        mediaManifestSha256: expectedFiles.mediaManifest.sha256,
        mediaItemsSha256: mediaManifest.mediaItemsSha256,
        mediaReceiptSha256: mediaManifest.receiptSha256,
    };
    const products = readJson(path.join(root, expectedFiles.products.file));
    const mappings = readJson(path.join(
        root,
        expectedFiles.sourceProductMappings.file,
    ));
    validateMappingCoverage(
        sourceArtifact,
        mappings,
        reconciliationManifest.counts,
    );
    validateMediaOutputCoverage(sourceArtifact, mappings, verifiedMedia);
    assertSeededWeeklyCheckpoint({
        sourceBundle: {
            artifact: sourceArtifact,
            manifest: sourceManifest,
            root: sourceEvidenceRoot,
        },
    });
    const patchCounts = validateProductPatchCoverage(mappings, products);
    const rollbackProducts = readJson(path.join(
        root,
        manifest.directories.reconciliationEvidence,
        reconciliationManifest.rollbackProductsFile,
    ));
    const updateMappings = mappings
        .filter(mapping => mapping.status === 'matched-update')
        .map(mapping => [mapping.productId, mapping.productCode]);
    const expectedRollbacks = new Map(updateMappings);
    const actualRollbacks = new Map();
    const rollbackCodes = new Set();
    if (Array.isArray(rollbackProducts)) {
        for (const product of rollbackProducts) {
            if (!product?.id ||
                actualRollbacks.has(product.id) ||
                rollbackCodes.has(product.code)) {
                throw new Error(
                    'Rollback products do not exactly cover matched updates.',
                );
            }
            actualRollbacks.set(product.id, product.code);
            rollbackCodes.add(product.code);
        }
    }
    if (!Array.isArray(rollbackProducts) ||
        rollbackProducts.length !== patchCounts.matchedUpdates ||
        stableJson([...actualRollbacks].sort()) !==
            stableJson([...expectedRollbacks].sort())) {
        throw new Error('Rollback products do not exactly cover matched updates.');
    }
    const mappingCodes = new Set(mappings.map(mapping => mapping.productCode));
    const mediaItems = verifiedMedia.mediaItems;
    if (mediaItems.some(item => !mappingCodes.has(item.productCode))) {
        throw new Error('Media owners are not covered by reconciliation mappings.');
    }
    const counts = {
        sourceItems: sourceManifest.itemCount,
        commerceObservations: projectionManifest.itemCount,
        matchedProducts: reconciliationManifest.counts?.matched,
        matchedUpdates: patchCounts.matchedUpdates,
        matchedNoops: patchCounts.matchedNoops,
        draftProducts: reconciliationManifest.counts?.missing,
        productPatches: reconciliationManifest.productPatchCount,
        sourceProductMappings:
            reconciliationManifest.counts?.matched +
            reconciliationManifest.counts?.missing,
        mediaItems: mediaManifest.mediaItemCount,
        uniqueMediaBlobs: mediaManifest.uniqueBlobCount,
        mediaBytes: mediaManifest.totalBytes,
    };
    if (!Array.isArray(products) ||
        products.length !== counts.productPatches ||
        counts.productPatches !== patchCounts.productPatches ||
        counts.draftProducts !== patchCounts.draftProducts ||
        counts.matchedProducts !==
            patchCounts.matchedUpdates + patchCounts.matchedNoops ||
        counts.sourceProductMappings !== counts.sourceItems ||
        stableJson(inputEvidence) !== stableJson(manifest.inputEvidence) ||
        stableJson(counts) !== stableJson(manifest.counts)) {
        throw new Error('ZZCTea import bundle evidence or counts are inconsistent.');
    }
    const bundleId = sha256(stableJson(buildBundleIdentity({
        counts,
        directories: manifest.directories,
        inputEvidence,
        inventory: actualInventory,
        snapshotId: manifest.snapshotId,
        sourceId: manifest.sourceId,
    })));
    if (manifest.bundleId !== bundleId ||
        manifest.version !== `${manifest.snapshotId}.${bundleId.slice(0, 12)}`) {
        throw new Error('ZZCTea import bundle identity is invalid.');
    }
    return { manifest, plan, root };
}

module.exports = {
    IMPORT_BUNDLE_SCHEMA,
    IMPORT_PLAN_SCHEMA,
    assertBundleBindings,
    assertClaimedFileDigest,
    assertContainedFile,
    assertNoSymlinks,
    buildBundleManifest,
    buildBundleIdentity,
    buildImportPlan,
    collectFileInventory,
    cloneFile,
    verifyImportBundle,
    writeImportBundle,
};
