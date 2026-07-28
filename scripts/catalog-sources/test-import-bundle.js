#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    sha256,
    stableJson,
    writeJsonAtomic,
} = require('./lib/artifacts');
const {
    assertBundleBindings,
    cloneFile,
    verifyImportBundle,
    writeImportBundle,
} = require('./lib/import-bundle');
const {
    buildOutputDocuments,
} = require('./lib/media-materialization');
const {
    assertOutputPath,
} = require('./build-import-bundle');
const {
    REVIEWED_BRANDS,
    REVIEWED_BRAND_MANIFEST_SHA256,
} = require('./zzctea/connector');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x41]);

function temporaryDirectory(prefix = 'zzctea-import-bundle-test-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeStable(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, stableJson(value));
    return sha256(fs.readFileSync(file));
}

function writeText(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
    return sha256(fs.readFileSync(file));
}

function createContext() {
    const inputRoot = temporaryDirectory();
    const sourceRoot = path.join(inputRoot, 'source');
    const projectionRoot = path.join(inputRoot, 'projection');
    const reconciliationRoot = path.join(inputRoot, 'reconciliation');
    const mediaRoot = path.join(inputRoot, 'media');
    for (const directory of [
        sourceRoot,
        projectionRoot,
        reconciliationRoot,
        mediaRoot,
    ]) {
        fs.mkdirSync(directory, { recursive: true });
    }

    const sourceArtifact = {
        source: {
            id: 'zzctea',
            referencePricesAreRetailPrices: false,
        },
        items: [
            { externalId: '1', images: [] },
            { externalId: '2', images: [] },
            { externalId: '3', images: [] },
        ],
    };
    const sourceArtifactSha = writeStable(
        path.join(sourceRoot, 'catalog-source-artifact-v1.source.json'),
        sourceArtifact,
    );
    const seedExternalIds = ['1', '2', '3'];
    const brands = REVIEWED_BRANDS;
    const sourceCheckpointSha = writeStable(
        path.join(sourceRoot, 'source-checkpoint.json'),
        {
            status: 'complete',
            connectorVersion: 'zzctea-public-html-v7',
            requestParameters: {
                seed: {
                    schemaVersion: 'catalog-source-external-id-seed-v1',
                    mode: 'external-ids',
                    itemCount: 3,
                    externalIdsSha256: sha256(stableJson(seedExternalIds)),
                    sourceKind: 'complete-product-catalog-product-reference',
                    productReferencePath:
                        'sources/prod/product-reference/products',
                    productReferenceManifestSha256: '1'.repeat(64),
                    productsSha256: '2'.repeat(64),
                    productCodesSha256: '3'.repeat(64),
                    brandManifest: {
                        schemaVersion: 'zzctea-reviewed-brand-manifest-v1',
                        brands,
                        sha256: REVIEWED_BRAND_MANIFEST_SHA256,
                    },
                    discovery: {
                        schemaVersion: 'zzctea-brand-list-discovery-v1',
                        itemCount: 3,
                        externalIdsSha256: '4'.repeat(64),
                        envelopeCount: 13,
                        envelopesSha256: '5'.repeat(64),
                    },
                },
            },
            seed: {
                schemaVersion: 'catalog-source-external-id-seed-v1',
                mode: 'external-ids',
                itemCount: 3,
                externalIdsSha256: sha256(stableJson(seedExternalIds)),
                externalIds: seedExternalIds,
            },
        },
    );
    const sourceManifest = {
        schemaVersion: 'catalog-source-artifact-manifest-v1',
        complete: true,
        sourceId: 'zzctea',
        connectorVersion: 'zzctea-public-html-v7',
        snapshotId: 'snapshot-test',
        itemCount: 3,
        artifactFile: 'catalog-source-artifact-v1.source.json',
        artifactSha256: sourceArtifactSha,
        checkpointFile: 'source-checkpoint.json',
        checkpointSha256: sourceCheckpointSha,
        authoritativeForDeletion: false,
    };
    writeJsonAtomic(path.join(sourceRoot, 'artifact-manifest.json'), sourceManifest);

    const projectionSha = writeText(
        path.join(projectionRoot, 'projection.json'),
        'projection\n',
    );
    const projectionReportSha = writeText(
        path.join(projectionRoot, 'projection-report.json'),
        'report\n',
    );
    const projectionManifest = {
        complete: true,
        sourceId: 'zzctea',
        snapshotId: 'snapshot-test',
        itemCount: 3,
        projectionFile: 'projection.json',
        projectionSha256: projectionSha,
        reportFile: 'projection-report.json',
        reportSha256: projectionReportSha,
        inputArtifactSha256: sourceArtifactSha,
        productionWrites: false,
    };
    writeJsonAtomic(
        path.join(projectionRoot, 'projection-manifest.json'),
        projectionManifest,
    );
    const projectionManifestSha = sha256(
        fs.readFileSync(path.join(projectionRoot, 'projection-manifest.json')),
    );

    const mappings = [
        {
            externalId: '1',
            productCode: 'ZZC-1',
            productId: '11111111-1111-4111-8111-111111111111',
            status: 'matched-update',
        },
        {
            externalId: '2',
            productCode: 'ZZC-2',
            productId: '22222222-2222-4222-8222-222222222222',
            status: 'matched-noop',
        },
        {
            externalId: '3',
            productCode: 'ZZC-3',
            published: false,
            status: 'missing-create-draft',
        },
    ];
    const mappingsSha = writeStable(
        path.join(reconciliationRoot, 'mappings.json'),
        mappings,
    );
    const productsSha = writeStable(
        path.join(reconciliationRoot, 'products.json'),
        [
            {
                code: 'ZZC-1',
                id: '11111111-1111-4111-8111-111111111111',
            },
            {
                catalogPrices: [],
                code: 'ZZC-3',
                sku: 'ZZC-3',
                published: false,
                storePriceOverrides: [],
                tierPrices: [],
            },
        ],
    );
    const reconciliationSha = writeText(
        path.join(reconciliationRoot, 'reconciliation.json'),
        'reconciliation\n',
    );
    const reportSha = writeStable(
        path.join(reconciliationRoot, 'report.json'),
        { productPatchCount: 2 },
    );
    const rollbackSha = writeStable(
        path.join(reconciliationRoot, 'rollback.json'),
        [{
            code: 'ZZC-1',
            id: '11111111-1111-4111-8111-111111111111',
        }],
    );
    const reconciliationManifest = {
        complete: true,
        sourceId: 'zzctea',
        snapshotId: 'snapshot-test',
        selection: { mode: 'full-snapshot' },
        selectionComplete: true,
        counts: { matched: 2, missing: 1, ambiguous: 0 },
        inputProjectionSha256: projectionSha,
        inputProjectionManifestSha256: projectionManifestSha,
        reconciliationFile: 'reconciliation.json',
        reconciliationSha256: reconciliationSha,
        reportFile: 'report.json',
        reportSha256: reportSha,
        mappingFile: 'mappings.json',
        mappingSha256: mappingsSha,
        productPatchesFile: 'products.json',
        productPatchesSha256: productsSha,
        productPatchCount: 2,
        rollbackProductsFile: 'rollback.json',
        rollbackProductsSha256: rollbackSha,
        productionWrites: false,
    };
    writeJsonAtomic(
        path.join(reconciliationRoot, 'reconciliation-manifest.json'),
        reconciliationManifest,
    );

    const blobSha = sha256(JPEG);
    const blobFile = `blobs/${blobSha.slice(0, 2)}/${blobSha}.jpg`;
    fs.mkdirSync(path.join(mediaRoot, path.dirname(blobFile)), { recursive: true });
    fs.writeFileSync(path.join(mediaRoot, blobFile), JPEG);
    const mediaBinding = {
        artifactSha256: sourceArtifactSha,
        mappingSha256: mappingsSha,
        maxFileBytes: 100,
        maxTotalBytes: 1000,
        minimumRequestIntervalMs: 1000,
        onlyExternalId: null,
        snapshotId: 'snapshot-test',
        sourceId: 'zzctea',
    };
    const mediaCheckpoint = {
        schemaVersion: 'catalog-source-media-checkpoint-v1',
        status: 'complete',
        binding: mediaBinding,
        networkUrlCount: 1,
        entries: {
            'https://oss.yf-gz.cn/file/a.jpg': {
                bytes: JPEG.length,
                contentType: 'image/jpeg',
                file: blobFile,
                finalUrl: 'https://oss.yf-gz.cn/file/a.jpg',
                sha256: blobSha,
            },
        },
        totalBytes: JPEG.length,
        completedCount: 1,
        productionWrites: false,
    };
    const mediaDocuments = buildOutputDocuments({
        artifact: {
            source: { id: 'zzctea' },
            items: [{ images: [{ url: 'https://oss.yf-gz.cn/file/a.jpg' }] }],
        },
        binding: mediaBinding,
        candidates: [{
            aliases: ['https://oss.yf-gz.cn/file/a.jpg'],
            externalId: '1',
            localizedName: 'Tea',
            productCode: 'ZZC-1',
            productId: '11111111-1111-4111-8111-111111111111',
            sourceOrder: 0,
            url: 'https://oss.yf-gz.cn/file/a.jpg',
        }],
        checkpoint: mediaCheckpoint,
    });
    fs.writeFileSync(
        path.join(mediaRoot, 'media-items.json'),
        mediaDocuments.mediaJson,
    );
    fs.writeFileSync(
        path.join(mediaRoot, 'media-receipt.json'),
        mediaDocuments.receiptJson,
    );
    writeJsonAtomic(
        path.join(mediaRoot, 'media-checkpoint.json'),
        mediaCheckpoint,
    );
    writeJsonAtomic(
        path.join(mediaRoot, 'media-manifest.json'),
        mediaDocuments.manifest,
    );

    return {
        mappingsBundle: {
            manifest: reconciliationManifest,
            mappings,
            root: reconciliationRoot,
        },
        mediaCheckpoint,
        mediaManifest: mediaDocuments.manifest,
        mediaReceipt: mediaDocuments.receipt,
        mediaRoot,
        projectionBundle: {
            manifest: projectionManifest,
            manifestSha256: projectionManifestSha,
            root: projectionRoot,
        },
        sourceBundle: {
            artifact: sourceArtifact,
            manifest: sourceManifest,
            root: sourceRoot,
        },
    };
}

function testDeterministicBundle() {
    const context = createContext();
    const first = temporaryDirectory();
    const second = temporaryDirectory();
    const firstDocuments = writeImportBundle(first, context);
    const secondDocuments = writeImportBundle(second, context);
    assert.strictEqual(
        stableJson(firstDocuments.manifest),
        stableJson(secondDocuments.manifest),
    );
    assert.strictEqual(firstDocuments.manifest.applyAllowed, false);
    assert.strictEqual(firstDocuments.importPlan.media.enabled, false);
    assert.strictEqual(firstDocuments.importPlan.commerceNetwork.enabled, false);
    assert.strictEqual(
        firstDocuments.importPlan.media.galleryStrategy,
        'reconcile-source-managed',
    );
    assert.strictEqual(firstDocuments.importPlan.media.thumbnailStrategy,
        'preserve-existing');
    const verified = verifyImportBundle(first);
    assert.strictEqual(verified.manifest.counts.mediaItems, 1);
    assert.ok(fs.existsSync(path.join(first, 'data', 'products.json')));
    assert.ok(fs.existsSync(
        path.join(first, 'data', 'commerce-observations.json'),
    ));
    assert.ok(fs.existsSync(path.join(first, 'media', 'blobs')));

    fs.writeFileSync(path.join(first, 'data', 'products.json'), 'tampered\n');
    assert.throws(
        () => verifyImportBundle(first),
        /inventory differs from its manifest/,
    );
}

function testBindingFailure() {
    const context = createContext();
    context.mediaManifest = {
        ...context.mediaManifest,
        inputArtifactSha256: 'f'.repeat(64),
    };
    assert.throws(
        () => assertBundleBindings(context),
        /component hash bindings do not match/,
    );

    const tamperedProducts = createContext();
    fs.writeFileSync(
        path.join(
            tamperedProducts.mappingsBundle.root,
            tamperedProducts.mappingsBundle.manifest.productPatchesFile,
        ),
        '[]\n',
    );
    assert.throws(
        () => assertBundleBindings(tamperedProducts),
        /Product patches differs from its source manifest/,
    );

    const tamperedSeed = createContext();
    const checkpointFile = path.join(
        tamperedSeed.sourceBundle.root,
        tamperedSeed.sourceBundle.manifest.checkpointFile,
    );
    const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
    checkpoint.requestParameters.seed.brandManifest.brands[0] = {
        externalId: '999',
        name: 'Unreviewed',
    };
    checkpoint.requestParameters.seed.brandManifest.sha256 = sha256(stableJson(
        checkpoint.requestParameters.seed.brandManifest.brands,
    ));
    tamperedSeed.sourceBundle.manifest.checkpointSha256 = writeStable(
        checkpointFile,
        checkpoint,
    );
    assert.throws(
        () => assertBundleBindings(tamperedSeed),
        /not a complete ProductCatalog-seeded weekly snapshot/,
    );
}

function testInventoryAndIdentityGates() {
    const context = createContext();
    const output = temporaryDirectory();
    writeImportBundle(output, context);
    const extra = path.join(output, 'evidence', 'source', 'untracked.json');
    fs.writeFileSync(extra, '{}\n');
    assert.throws(
        () => verifyImportBundle(output),
        /inventory differs from its manifest/,
    );

    const identityOutput = temporaryDirectory();
    writeImportBundle(identityOutput, context);
    const manifestFile = path.join(
        identityOutput,
        'import-bundle-manifest.json',
    );
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const validBundleId = manifest.bundleId;
    manifest.bundleId = 'f'.repeat(64);
    writeJsonAtomic(manifestFile, manifest);
    assert.throws(
        () => verifyImportBundle(identityOutput),
        /identity is invalid/,
    );

    manifest.bundleId = validBundleId;
    manifest.counts.matchedProducts = 3;
    writeJsonAtomic(manifestFile, manifest);
    assert.throws(
        () => verifyImportBundle(identityOutput),
        /evidence or counts are inconsistent/,
    );
}

function testSymlinkGates() {
    const output = temporaryDirectory();
    const source = path.join(temporaryDirectory(), 'source.txt');
    fs.writeFileSync(source, 'source\n');
    const link = path.join(path.dirname(source), 'link.txt');
    fs.symlinkSync(source, link);
    assert.throws(
        () => cloneFile(link, output, 'copied.txt'),
        /source must be a real file/,
    );

    const repositoryRoot = temporaryDirectory();
    const allowed = path.join(repositoryRoot, 'import', 'zzctea');
    fs.mkdirSync(allowed, { recursive: true });
    const outside = temporaryDirectory();
    fs.symlinkSync(outside, path.join(allowed, 'escape'));
    assert.throws(
        () => assertOutputPath(
            repositoryRoot,
            path.join(allowed, 'escape', 'current'),
        ),
        /symlink ancestors|resolve inside/,
    );

    const linkedRootRepository = temporaryDirectory();
    fs.mkdirSync(path.join(linkedRootRepository, 'import'));
    fs.symlinkSync(
        temporaryDirectory(),
        path.join(linkedRootRepository, 'import', 'zzctea'),
    );
    assert.throws(
        () => assertOutputPath(
            linkedRootRepository,
            path.join(linkedRootRepository, 'import', 'zzctea', 'current'),
        ),
        /root cannot contain symlink ancestors/,
    );
}

function main() {
    testDeterministicBundle();
    testBindingFailure();
    testInventoryAndIdentityGates();
    testSymlinkGates();
    console.log('import bundle tests passed');
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}

module.exports = {
    createContext,
    testBindingFailure,
    testDeterministicBundle,
    testInventoryAndIdentityGates,
    testSymlinkGates,
};
