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
        probeFetches: 0,
    };
    const connector = {
        id: options.id || 'fixture-source',
        connectorVersion: 'fixture-connector-v1',
        parserVersion: 'fixture-parser-v1',
        defaultPageSize: options.pageSize || 2,
        maximumPageSize: 10,
        requestParameters: () => options.requestParameters || ({
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
            if (options.paginationMode === 'totalPages') {
                return Buffer.from(JSON.stringify({
                    page,
                    pageSize,
                    totalPages: options.reportedTotalPages ??
                        Math.ceil(ids.length / pageSize),
                    ids: ids.slice(start, start + pageSize),
                }));
            }
            return Buffer.from(JSON.stringify({
                totalCount: ids.length,
                ids: ids.slice(start, start + pageSize),
            }));
        },
        parseListPage(raw) {
            const page = JSON.parse(raw);
            if (options.paginationMode === 'totalPages') {
                return {
                    page: page.page,
                    pageSize: page.pageSize,
                    totalCount: null,
                    totalPages: page.totalPages,
                    items: page.ids.map(externalId => ({ externalId })),
                };
            }
            return {
                totalCount: page.totalCount,
                items: page.ids.map(externalId => ({ externalId })),
            };
        },
        async fetchTerminalProbe({ page, pageSize, totalPages }) {
            state.probeFetches += 1;
            const probeIds = options.repeatProbe
                ? ids.slice((totalPages - 1) * pageSize, totalPages * pageSize)
                : ids.slice((page - 1) * pageSize, page * pageSize);
            return Buffer.from(JSON.stringify({
                ids: probeIds,
                page,
                pageSize,
                totalPages,
            }));
        },
        assertTerminalProbe({ lastPageRaw, raw, requestedPage, totalPages }) {
            const probe = JSON.parse(raw);
            const lastPage = JSON.parse(lastPageRaw);
            if (probe.page !== requestedPage ||
                probe.totalPages !== totalPages ||
                (probe.ids.length > 0 &&
                    JSON.stringify(probe.ids) !== JSON.stringify(lastPage.ids))) {
                const error = new Error('terminal probe found another page');
                error.code = 'SOURCE_TERMINAL_PROBE_NOT_TERMINAL';
                throw error;
            }
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

        const pagesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tea-source-pages-'));
        try {
            const paged = createFakeConnector({
                id: 'fixture-pages',
                paginationMode: 'totalPages',
            });
            const pagedResult = await ingestSourceSnapshot({
                connector: paged.connector,
                repositoryRoot: pagesRoot,
                snapshotId: 'pages-1',
                concurrency: 2,
                pageSize: 2,
            });
            assert.strictEqual(pagedResult.manifest.itemCount, 5);
            assert.strictEqual(paged.state.listFetches, 3);
            assert.strictEqual(paged.state.probeFetches, 1);
            assert.strictEqual(
                readJson(path.join(
                    pagesRoot,
                    'sources/catalog-sources/fixture-pages/snapshots/pages-1/checkpoint.json',
                )).totalPages,
                3,
            );
            const pagedDrift = createFakeConnector({
                id: 'fixture-pages',
                ids: ['1'],
                paginationMode: 'totalPages',
            });
            await assert.rejects(
                ingestSourceSnapshot({
                    connector: pagedDrift.connector,
                    repositoryRoot: pagesRoot,
                    snapshotId: 'pages-drift',
                    pageSize: 2,
                }),
                error => error.code === 'SOURCE_TOTAL_COUNT_DRIFT',
            );

            for (const [id, repeatProbe] of [
                ['fixture-full-terminal-empty', false],
                ['fixture-full-terminal-repeat', true],
            ]) {
                const full = createFakeConnector({
                    id,
                    ids: ['1', '2', '3', '4'],
                    paginationMode: 'totalPages',
                    repeatProbe,
                });
                const fullResult = await ingestSourceSnapshot({
                    connector: full.connector,
                    repositoryRoot: pagesRoot,
                    snapshotId: 'full',
                    pageSize: 2,
                });
                assert.strictEqual(fullResult.manifest.itemCount, 4);
                assert.strictEqual(full.state.probeFetches, 1);
            }

            const underreported = createFakeConnector({
                id: 'fixture-underreported',
                ids: ['1', '2', '3', '4', '5'],
                paginationMode: 'totalPages',
                reportedTotalPages: 2,
            });
            await assert.rejects(
                ingestSourceSnapshot({
                    connector: underreported.connector,
                    repositoryRoot: pagesRoot,
                    snapshotId: 'underreported',
                    pageSize: 2,
                }),
                error => error.code === 'SOURCE_TERMINAL_PROBE_NOT_TERMINAL',
            );
        } finally {
            fs.rmSync(pagesRoot, { recursive: true, force: true });
        }

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
            const changedRate = createFakeConnector({
                requestParameters: {
                    endpoint: 'https://source.example/catalog',
                    filters: { publicOnly: true },
                    requestPacing: { minimumIntervalMs: 2_000 },
                },
            });
            await assert.rejects(
                ingestSourceSnapshot({
                    connector: changedRate.connector,
                    repositoryRoot: resumeRoot,
                    snapshotId: 'resume',
                    pageSize: 2,
                    concurrency: 2,
                    resume: true,
                }),
                error => error.code === 'SOURCE_CHECKPOINT_INCOMPATIBLE',
            );
            assert.strictEqual(changedRate.state.listFetches, 0);
            assert.strictEqual(changedRate.state.detailFetches, 0);
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
        const itemWithOpaqueImageIdentifier = {
            ...itemAtOne,
            images: [{
                role: 'source-reference',
                url: 'https://oss.yf-gz.cn/file/asset_13800138000.jpg' +
                    '?x-oss-process=style/square300',
            }],
        };
        const checkpointWithPublicImagePolicy = {
            ...checkpoint('2026-07-27T01:00:00.000Z'),
            requestParameters: {
                publicImagePolicy: {
                    schemaVersion:
                        'catalog-source-image-reference-policy-v1',
                    allowedHosts: ['oss.yf-gz.cn'],
                    pathPrefix: '/file/',
                    queryRules: {
                        'x-oss-process': 'style-name',
                    },
                    sourcePolicyVersion:
                        'zzctea-public-image-url-v1',
                },
            },
        };
        assert.strictEqual(
            buildArtifact(
                checkpointWithPublicImagePolicy,
                [
                    itemWithOpaqueImageIdentifier,
                    {
                        ...itemAtOne,
                        externalId: '2',
                        images: [{
                            role: 'source-reference',
                            url: 'https://oss.yf-gz.cn/file/' +
                                'asset_01012345678.jpg',
                        }],
                    },
                    {
                        ...itemAtOne,
                        externalId: '3',
                        images: [{
                            role: 'source-reference',
                            url: 'https://oss.yf-gz.cn/file/' +
                                'line-artwork.jpg',
                        }],
                    },
                    {
                        ...itemAtOne,
                        externalId: '4',
                        images: [{
                            role: 'source-reference',
                            url: 'https://oss.yf-gz.cn/file/' +
                                'contact-sheet.jpg',
                        }],
                    },
                ],
            ).itemCount,
            4,
        );
        const itemWithImageContactHandle = {
            ...itemAtOne,
            images: [{
                role: 'source-reference',
                url: 'https://oss.yf-gz.cn/file/wxid_abcd1234.jpg',
            }],
        };
        assert.throws(
            () => buildArtifact(
                checkpointWithPublicImagePolicy,
                [itemWithImageContactHandle],
            ),
            error => error.code === 'SOURCE_ARTIFACT_PII_POLICY_VIOLATION',
        );
        for (const unsafeImageReference of [
            '13800138000',
            'https://evil.example/file/asset_13800138000.jpg',
            'http://127.0.0.1/file/asset_13800138000.jpg',
            'https://oss.yf-gz.cn/file/asset.jpg' +
                '?x-oss-process=style/13800138000',
            'https://evil.example/file/asset.jpg',
            'http://127.0.0.1/file/asset.jpg',
            'not-a-url',
            'https://oss.yf-gz.cn/profile/asset.jpg',
            'https://oss.yf-gz.cn/file/phone-01012345678.jpg',
            'https://oss.yf-gz.cn/file/contact-8001234567.jpg',
            'https://oss.yf-gz.cn/file/wechat-abcdef.jpg',
            'https://oss.yf-gz.cn/file/qq-12345678.jpg',
            'https://oss.yf-gz.cn/file/telegram-1234567.jpg',
            'https://oss.yf-gz.cn/file/line-1234567.jpg',
        ]) {
            assert.throws(
                () => buildArtifact(
                    checkpointWithPublicImagePolicy,
                    [{
                        ...itemAtOne,
                        images: [{
                            role: 'source-reference',
                            url: unsafeImageReference,
                        }],
                    }],
                ),
                error => error.code ===
                    'SOURCE_ARTIFACT_PII_POLICY_VIOLATION',
            );
        }

        console.log('test-catalog-source-runtime: OK');
    } finally {
        fs.rmSync(repositoryRoot, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
