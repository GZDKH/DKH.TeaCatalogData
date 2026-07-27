'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    buildArtifact,
    ingestSourceSnapshot,
    replaySourceSnapshot,
} = require('./lib/runtime');
const { readJson, sha256 } = require('./lib/artifacts');

function normalizedItem(externalId) {
    return {
        schemaVersion: 'catalog-source-item-v1',
        externalId: String(externalId),
        localizedFields: {
            'zh-CN': {
                name: `Tea ${externalId}`,
                description: `Source description ${externalId}`,
            },
        },
        facts: { year: 2025 },
        images: [],
        sourceLinks: {
            stableLookupUrl: `https://source.example/item/${externalId}`,
            observedCanonicalUrl: null,
        },
        package: {
            rawText: '357克/片',
            components: [{ quantity: '357', containedUnitCode: 'g', containerUnitCode: 'cake' }],
            isExact: true,
            diagnosticCode: null,
        },
        referencePrices: [{
            amount: '100.25',
            currencyCode: 'CNY',
            basisUnitCode: 'cake',
            kind: 'source-reference',
            retailPrice: false,
            roundingPolicy: { mode: 'none' },
        }],
        sourceUpdatedAt: '2026-07-20T00:00:00.000Z',
        diagnostics: [],
    };
}

function createFakeConnector(options = {}) {
    const ids = options.ids || ['1', '2', '3', '4', '5'];
    const state = {
        detailFetches: 0,
        listFetches: 0,
    };
    const connector = {
        id: options.id || 'fixture-source',
        connectorVersion: 'fixture-connector-v1',
        parserVersion: 'fixture-parser-v1',
        defaultPageSize: options.pageSize || 2,
        maximumPageSize: 10,
        requestParameters: () => ({
            endpoint: 'https://source.example/catalog',
            filters: { publicOnly: true },
        }),
        assertRawPayloadAllowed(raw) {
            const value = JSON.parse(raw);
            assert.ok(!JSON.stringify(value).includes('phone'));
        },
        async fetchListPage({ page, pageSize }) {
            state.listFetches += 1;
            if (options.loop) {
                return Buffer.from(JSON.stringify({ totalCount: 4, ids: ['1', '2'] }));
            }
            const start = (page - 1) * pageSize;
            return Buffer.from(JSON.stringify({
                totalCount: ids.length,
                ids: ids.slice(start, start + pageSize),
            }));
        },
        parseListPage(raw) {
            const page = JSON.parse(raw);
            return {
                totalCount: page.totalCount,
                items: page.ids.map(externalId => ({ externalId })),
            };
        },
        async fetchDetail({ externalId }) {
            state.detailFetches += 1;
            if (options.failDetail === externalId) {
                throw new Error('simulated detail failure');
            }
            return Buffer.from(JSON.stringify({ externalId, item: normalizedItem(externalId) }));
        },
        parseDetail(raw) {
            return JSON.parse(raw).item;
        },
        async resolveCanonicalUrl({ externalId }) {
            return `https://source.example/canonical/${externalId}`;
        },
    };
    return { connector, state };
}

function checkpoint(observedAt) {
    return {
        sourceId: 'fixture-source',
        snapshotId: 'stable-snapshot',
        connectorVersion: 'fixture-connector-v1',
        parserVersion: 'fixture-parser-v1',
        observedAt,
        diagnostics: [],
        pages: [{ page: 1, sha256: 'a' }],
        details: { '1': { sha256: 'b' } },
    };
}

async function main() {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tea-source-runtime-'));
    try {
        const first = createFakeConnector();
        const result = await ingestSourceSnapshot({
            connector: first.connector,
            repositoryRoot,
            snapshotId: 'fixture-1',
            concurrency: 2,
            pageSize: 2,
            now: () => new Date('2026-07-27T03:00:00Z'),
        });
        assert.strictEqual(result.manifest.itemCount, 5);
        assert.strictEqual(result.manifest.connectorVersion, 'fixture-connector-v1');
        assert.strictEqual(result.artifact.source.connectorVersion, 'fixture-connector-v1');
        assert.strictEqual(result.artifact.snapshot.complete, true);
        assert.strictEqual(result.artifact.snapshot.authoritativeForDeletion, false);
        assert.deepStrictEqual(result.artifact.deletions, []);
        assert.ok(result.artifact.items.every(item =>
            item.localizedFields['zh-CN'].description ===
                `Source description ${item.externalId}`));
        assert.ok(result.artifact.items.every(item =>
            item.referencePrices.every(price => price.retailPrice === false)));
        assert.strictEqual(first.state.listFetches, 3);
        assert.strictEqual(first.state.detailFetches, 5);
        assert.ok(fs.existsSync(result.artifactFile));

        const manifestPath = path.join(
            repositoryRoot,
            'artifacts/catalog-sources/fixture-source/fixture-1/artifact-manifest.json',
        );
        const manifest = readJson(manifestPath);
        const portableCheckpoint = path.join(path.dirname(manifestPath), manifest.checkpointFile);
        assert.strictEqual(sha256(fs.readFileSync(portableCheckpoint)), manifest.checkpointSha256);

        const newer = createFakeConnector();
        await ingestSourceSnapshot({
            connector: newer.connector,
            repositoryRoot,
            snapshotId: 'fixture-2',
            concurrency: 2,
            pageSize: 2,
            now: () => new Date('2026-07-27T04:00:00Z'),
        });
        const lastGoodBeforeReplay = fs.readFileSync(
            path.join(repositoryRoot, 'sources/catalog-sources/fixture-source/last-good.json'),
            'utf8',
        );
        const replay = await replaySourceSnapshot({
            connector: first.connector,
            repositoryRoot,
            snapshotId: 'fixture-1',
        });
        assert.strictEqual(replay.manifest.artifactSha256, result.manifest.artifactSha256);
        assert.strictEqual(first.state.listFetches, 3);
        assert.strictEqual(first.state.detailFetches, 5);
        assert.strictEqual(
            fs.readFileSync(
                path.join(repositoryRoot, 'sources/catalog-sources/fixture-source/last-good.json'),
                'utf8',
            ),
            lastGoodBeforeReplay,
        );

        const originalLastGood = fs.readFileSync(
            path.join(repositoryRoot, 'sources/catalog-sources/fixture-source/last-good.json'),
            'utf8',
        );
        const drift = createFakeConnector({ ids: ['1'] });
        await assert.rejects(
            ingestSourceSnapshot({
                connector: drift.connector,
                repositoryRoot,
                snapshotId: 'fixture-drift',
                pageSize: 2,
            }),
            error => error.code === 'SOURCE_TOTAL_COUNT_DRIFT',
        );
        assert.strictEqual(
            fs.readFileSync(
                path.join(repositoryRoot, 'sources/catalog-sources/fixture-source/last-good.json'),
                'utf8',
            ),
            originalLastGood,
        );
        assert.strictEqual(
            fs.existsSync(
                path.join(
                    repositoryRoot,
                    'artifacts/catalog-sources/fixture-source/fixture-drift/artifact-manifest.json',
                ),
            ),
            false,
        );

        const resumeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tea-source-resume-'));
        try {
            const interrupted = createFakeConnector({ failDetail: '3' });
            await assert.rejects(
                ingestSourceSnapshot({
                    connector: interrupted.connector,
                    repositoryRoot: resumeRoot,
                    snapshotId: 'resume',
                    pageSize: 2,
                    concurrency: 2,
                }),
                /simulated detail failure/,
            );
            assert.strictEqual(
                fs.existsSync(
                    path.join(
                        resumeRoot,
                        'artifacts/catalog-sources/fixture-source/resume/artifact-manifest.json',
                    ),
                ),
                false,
            );
            assert.strictEqual(
                fs.existsSync(
                    path.join(resumeRoot, 'sources/catalog-sources/fixture-source/last-good.json'),
                ),
                false,
            );
            const resumed = createFakeConnector();
            const resumedResult = await ingestSourceSnapshot({
                connector: resumed.connector,
                repositoryRoot: resumeRoot,
                snapshotId: 'resume',
                pageSize: 2,
                concurrency: 2,
                resume: true,
            });
            assert.strictEqual(resumedResult.manifest.itemCount, 5);
            assert.strictEqual(resumed.state.listFetches, 0);
            assert.strictEqual(resumed.state.detailFetches, 3);
        } finally {
            fs.rmSync(resumeRoot, { recursive: true, force: true });
        }

        const loopRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tea-source-loop-'));
        try {
            const loop = createFakeConnector({ loop: true });
            await assert.rejects(
                ingestSourceSnapshot({
                    connector: loop.connector,
                    repositoryRoot: loopRoot,
                    snapshotId: 'loop',
                    pageSize: 2,
                }),
                error => error.code === 'SOURCE_PAGINATION_LOOP',
            );
        } finally {
            fs.rmSync(loopRoot, { recursive: true, force: true });
        }

        const itemAtOne = {
            ...normalizedItem('1'),
            provenance: { observedAt: '2026-07-27T01:00:00.000Z' },
        };
        const itemAtTwo = {
            ...normalizedItem('1'),
            provenance: { observedAt: '2026-07-27T02:00:00.000Z' },
        };
        assert.strictEqual(
            buildArtifact(checkpoint('2026-07-27T01:00:00.000Z'), [itemAtOne]).semanticDigest,
            buildArtifact(checkpoint('2026-07-27T02:00:00.000Z'), [itemAtTwo]).semanticDigest,
        );
        const itemWithChangedDescription = {
            ...itemAtOne,
            localizedFields: {
                ...itemAtOne.localizedFields,
                'zh-CN': {
                    ...itemAtOne.localizedFields['zh-CN'],
                    description: 'Changed source description',
                },
            },
        };
        assert.notStrictEqual(
            buildArtifact(checkpoint('2026-07-27T01:00:00.000Z'), [itemAtOne]).semanticDigest,
            buildArtifact(
                checkpoint('2026-07-27T01:00:00.000Z'),
                [itemWithChangedDescription],
            ).semanticDigest,
        );
        assert.notStrictEqual(
            buildArtifact(checkpoint('2026-07-27T01:00:00.000Z'), [itemAtOne]).semanticDigest,
            buildArtifact(
                {
                    ...checkpoint('2026-07-27T01:00:00.000Z'),
                    connectorVersion: 'fixture-connector-v2',
                },
                [itemAtOne],
            ).semanticDigest,
        );
        const itemWithPiiDescription = {
            ...itemAtOne,
            localizedFields: {
                ...itemAtOne.localizedFields,
                'zh-CN': {
                    ...itemAtOne.localizedFields['zh-CN'],
                    description: 'Call 13800138000',
                },
            },
        };
        assert.throws(
            () => buildArtifact(
                checkpoint('2026-07-27T01:00:00.000Z'),
                [itemWithPiiDescription],
            ),
            error => error.code === 'SOURCE_ARTIFACT_PII_POLICY_VIOLATION',
        );

        console.log('test-catalog-source-runtime: OK');
    } finally {
        fs.rmSync(repositoryRoot, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
