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
    ARTIFACT_SCHEMA,
    CHECKPOINT_SCHEMA,
    MANIFEST_SCHEMA,
    buildArtifact,
} = require('./lib/runtime');
const { loadVerifiedCatalogSourceBundle } = require('./lib/projection-bundle');
const { projectArtifact } = require('./project-artifact');

const OBSERVED_AT = '2026-07-28T03:00:00.000Z';

function item() {
    return {
        schemaVersion: 'catalog-source-item-v1',
        externalId: '17627',
        localizedFields: {
            'zh-CN': {
                name: 'Fixture Tea',
                description: 'Safe source description retained only in the normalized artifact.',
            },
        },
        facts: {
            year: 2025,
            batch: '春',
            productionTechnology: '熟茶',
            shape: '饼',
            brand: { externalId: '88', name: 'Fixture Brand' },
        },
        images: [{ url: 'https://oss.yf-gz.cn/fixture/17627.jpg' }],
        sourceLinks: {
            stableLookupUrl: 'https://zzctea.com/teaDetail/17627.html',
            observedCanonicalUrl: 'https://zzctea.com/tea/fixture-17627.html',
        },
        package: {
            rawText: '357克/片 7片/提 6提/件',
            components: [
                { quantity: '357', containedUnitCode: 'g', containerUnitCode: 'cake' },
                { quantity: '7', containedUnitCode: 'cake', containerUnitCode: 'bundle' },
                { quantity: '6', containedUnitCode: 'bundle', containerUnitCode: 'case' },
            ],
            isExact: true,
            diagnosticCode: null,
        },
        referencePrices: [{
            amount: '8700',
            currencyCode: 'CNY',
            basisUnitCode: 'case',
            observedSourceUpdatedAt: '2026-07-20T00:00:00.000Z',
            kind: 'source-reference',
            retailPrice: false,
            roundingPolicy: { mode: 'none' },
        }],
        sourceUpdatedAt: '2026-07-20T00:00:00.000Z',
        diagnostics: ['constructor'],
        provenance: {
            parserVersion: 'zzctea-public-catalog-js-v2',
            listPayloadDigest: sha256('list'),
            detailPayloadDigest: sha256('detail'),
            observedAt: OBSERVED_AT,
        },
    };
}

function writeFixtureBundle(root) {
    fs.mkdirSync(root, { recursive: true });
    const checkpoint = {
        schemaVersion: CHECKPOINT_SCHEMA,
        status: 'complete',
        sourceId: 'zzctea',
        snapshotId: 'zzctea-fixture',
        connectorVersion: 'zzctea-connector-v2',
        parserVersion: 'zzctea-public-catalog-js-v2',
        artifactSchemaVersion: ARTIFACT_SCHEMA,
        observedAt: OBSERVED_AT,
        diagnostics: [],
        pages: [{ page: 1, sha256: sha256('page') }],
        details: { '17627': { sha256: sha256('detail') } },
        totalCount: 1,
    };
    const artifact = buildArtifact(checkpoint, [item()]);
    const artifactJson = stableJson(artifact);
    const artifactSha256 = sha256(artifactJson);
    const artifactFile = `${ARTIFACT_SCHEMA}.${artifactSha256}.json`;
    checkpoint.artifactSha256 = artifactSha256;
    const checkpointJson = stableJson(checkpoint);
    fs.writeFileSync(path.join(root, artifactFile), artifactJson);
    fs.writeFileSync(path.join(root, 'source-checkpoint.json'), checkpointJson);
    writeJsonAtomic(path.join(root, 'artifact-manifest.json'), {
        schemaVersion: MANIFEST_SCHEMA,
        sourceId: checkpoint.sourceId,
        connectorVersion: checkpoint.connectorVersion,
        snapshotId: checkpoint.snapshotId,
        parserVersion: checkpoint.parserVersion,
        observedAt: checkpoint.observedAt,
        itemCount: artifact.itemCount,
        rawPayloadDigest: artifact.snapshot.rawPayloadDigest,
        semanticDigest: artifact.semanticDigest,
        artifactFile,
        artifactSha256,
        checkpointFile: 'source-checkpoint.json',
        checkpointSha256: sha256(checkpointJson),
        complete: true,
        authoritativeForDeletion: false,
    });
    return { artifactFile };
}

function main() {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-source-projection-'));
    try {
        const artifactDirectory = path.join(temporaryRoot, 'input');
        const outputDirectory = path.join(
            temporaryRoot,
            'artifacts',
            'catalog-source-projections',
            'zzctea',
            'zzctea-fixture',
        );
        const { artifactFile } = writeFixtureBundle(artifactDirectory);
        const verified = loadVerifiedCatalogSourceBundle(artifactDirectory);
        assert.strictEqual(verified.manifest.itemCount, 1);

        const first = projectArtifact({
            'artifact-dir': artifactDirectory,
            out: outputDirectory,
        }, {
            repositoryRoot: temporaryRoot,
        });
        const firstFiles = fs.readdirSync(outputDirectory).sort();
        assert.deepStrictEqual(firstFiles, [
            first.documents.projectionFile,
            'projection-manifest.json',
            'projection-report.json',
        ].sort());
        assert.strictEqual(first.documents.projection.productionWrites, false);
        assert.strictEqual(first.documents.projection.reconciliationComplete, false);
        assert.strictEqual(first.documents.outputManifest.scope, 'commerce-observation-dry-run');
        assert.strictEqual(first.documents.report.productionWriteCount, 0);
        assert.strictEqual(first.documents.report.diagnosticCounts.constructor, 1);
        assert.strictEqual(first.documents.projection.deletionCount, 0);
        assert.ok(first.documents.projection.items[0].observation.localizedText.every(text =>
            !/zzctea(?:\.com)?/i.test(text.description)));

        const firstContents = Object.fromEntries(firstFiles.map(file => [
            file,
            fs.readFileSync(path.join(outputDirectory, file), 'utf8'),
        ]));
        const second = projectArtifact({
            'artifact-dir': artifactDirectory,
            out: outputDirectory,
        }, {
            repositoryRoot: temporaryRoot,
        });
        assert.strictEqual(
            second.documents.outputManifest.projectionSha256,
            first.documents.outputManifest.projectionSha256,
        );
        for (const file of firstFiles) {
            assert.strictEqual(
                fs.readFileSync(path.join(outputDirectory, file), 'utf8'),
                firstContents[file],
            );
        }
        assert.throws(
            () => projectArtifact({
                'artifact-dir': artifactDirectory,
                out: path.join(temporaryRoot, 'unrelated-directory'),
            }, {
                repositoryRoot: temporaryRoot,
            }),
            /must be a child of/,
        );
        const outsideRepository = path.join(
            path.dirname(temporaryRoot),
            `${path.basename(temporaryRoot)}-outside`,
        );
        assert.throws(
            () => projectArtifact({
                'artifact-dir': artifactDirectory,
                out: outsideRepository,
            }, {
                repositoryRoot: temporaryRoot,
            }),
            /must be a child of/,
        );
        assert.strictEqual(fs.existsSync(outsideRepository), false);

        fs.appendFileSync(path.join(artifactDirectory, artifactFile), '\n');
        assert.throws(
            () => loadVerifiedCatalogSourceBundle(artifactDirectory),
            /hash differs from the manifest/,
        );
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
    console.log('test-projection-cli: OK');
}

main();
