#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    detectImageType,
    downloadImage,
    materializeVerifiedMedia,
    selectOriginalImageCandidates,
} = require('./lib/media-materialization');
const {
    sha256,
    stableJson,
} = require('./lib/artifacts');
const {
    assertMediaOutputPath,
} = require('./materialize-media');

const JPEG_A = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x41]);
const JPEG_B = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x42]);
const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const NO_WAIT = async () => () => {};

function headers(values = {}) {
    const normalized = new Map(
        Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]),
    );
    return { get: name => normalized.get(String(name).toLowerCase()) ?? null };
}

function response(status, body, values = {}, chunks = null, onCancel = null) {
    const parts = chunks || [body];
    return {
        status,
        headers: headers(values),
        body: {
            async cancel() {
                onCancel?.();
            },
            async *[Symbol.asyncIterator]() {
                for (const part of parts) yield part;
            },
        },
    };
}

function fixture() {
    return {
        artifactBundle: {
            manifest: {
                artifactSha256: 'a'.repeat(64),
                itemCount: 2,
                snapshotId: 'snapshot-fixture',
                sourceId: 'zzctea',
            },
            artifact: {
                source: { id: 'zzctea' },
                items: [
                    {
                        externalId: '1',
                        localizedFields: { 'zh-CN': { name: 'Tea one' } },
                        images: [
                            {
                                role: 'primary-source-reference',
                                url:
                                    'https://oss.yf-gz.cn/file/a.jpg?' +
                                    'x-oss-process=style/square480',
                            },
                            {
                                role: 'source-reference',
                                url: 'https://oss.yf-gz.cn/file/a.jpg',
                            },
                        ],
                    },
                    {
                        externalId: '2',
                        localizedFields: { 'zh-CN': { name: 'Tea two' } },
                        images: [
                            {
                                role: 'source-reference',
                                url: 'https://oss.yf-gz.cn/file/b.jpg',
                            },
                        ],
                    },
                ],
            },
        },
        mappingsBundle: {
            manifest: { mappingSha256: 'b'.repeat(64) },
            mappings: [
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
            ],
        },
    };
}

function temporaryDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'zzctea-media-test-'));
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

async function expectReject(action, message) {
    await assert.rejects(action, error => error.message === message);
}

async function createPreviousImport(root) {
    const bundleRoot = path.join(root, 'current');
    const mediaRoot = path.join(bundleRoot, 'media');
    fs.mkdirSync(mediaRoot, { recursive: true });
    const data = fixture();
    await materializeVerifiedMedia({
        ...data,
        beforeAttempt: NO_WAIT,
        fetchImpl: async url => {
            const body = url.pathname.endsWith('/a.jpg') ? JPEG_A : JPEG_B;
            return response(200, body, {
                'content-length': body.length,
                'content-type': 'image/jpeg',
            });
        },
        maxFileBytes: 100,
        maxTotalBytes: 1000,
        minimumRequestIntervalMs: 1000,
        outputDirectory: mediaRoot,
    });
    const mediaManifestFile = path.join(mediaRoot, 'media-manifest.json');
    const mediaManifestBytes = fs.readFileSync(mediaManifestFile);
    fs.writeFileSync(path.join(bundleRoot, 'import-bundle-manifest.json'), stableJson({
        schemaVersion: 'catalog-source-import-bundle-v1',
        complete: true,
        sourceId: 'zzctea',
        snapshotId: data.artifactBundle.manifest.snapshotId,
        productionWrites: false,
        directories: {
            media: 'media',
        },
        files: {
            mediaManifest: {
                bytes: mediaManifestBytes.length,
                file: 'media/media-manifest.json',
                sha256: sha256(mediaManifestBytes),
            },
        },
    }));
    return { data, mediaRoot };
}

async function testMagicValidation() {
    assert.deepStrictEqual(detectImageType('image/jpeg; charset=binary', JPEG_A), {
        contentType: 'image/jpeg',
        extension: 'jpg',
    });
    assert.deepStrictEqual(detectImageType('image/png', PNG), {
        contentType: 'image/png',
        extension: 'png',
    });
    assert.throws(
        () => detectImageType('image/png', JPEG_A),
        /MEDIA_MAGIC_BYTES_MISMATCH/,
    );
    assert.throws(
        () => detectImageType('image/svg+xml', Buffer.from('<svg>')),
        /MEDIA_CONTENT_TYPE_NOT_ALLOWED/,
    );
}

async function testOriginalSelectionAndMappingGate() {
    const data = fixture();
    const candidates = selectOriginalImageCandidates(
        data.artifactBundle.artifact,
        data.mappingsBundle.mappings,
    );
    assert.strictEqual(candidates.length, 2);
    assert.strictEqual(candidates[0].url, 'https://oss.yf-gz.cn/file/a.jpg');
    assert.strictEqual(candidates[0].aliases.length, 2);
    const withDraft = fixture();
    withDraft.artifactBundle.artifact.items.push({
        externalId: '3',
        localizedFields: { 'zh-CN': { name: 'Draft tea' } },
        images: [{ url: 'https://oss.yf-gz.cn/file/c.jpg' }],
    });
    withDraft.mappingsBundle.mappings.push({
        externalId: '3',
        productCode: 'ZZC-3',
        published: false,
        status: 'missing-create-draft',
    });
    const draftCandidates = selectOriginalImageCandidates(
        withDraft.artifactBundle.artifact,
        withDraft.mappingsBundle.mappings,
    );
    assert.strictEqual(draftCandidates.length, 3);
    assert.strictEqual(draftCandidates[2].productCode, 'ZZC-3');
    assert.strictEqual(draftCandidates[2].productId, undefined);
    assert.throws(
        () => selectOriginalImageCandidates(
            withDraft.artifactBundle.artifact,
            withDraft.mappingsBundle.mappings.map(mapping =>
                mapping.externalId === '3'
                    ? { ...mapping, productId: '33333333-3333-4333-8333-333333333333' }
                    : mapping),
        ),
        /exact, unique matched or Draft/,
    );
    assert.throws(
        () => selectOriginalImageCandidates(
            data.artifactBundle.artifact,
            data.mappingsBundle.mappings.slice(1),
        ),
        /do not exactly cover/,
    );

    const large = fixture();
    large.artifactBundle.artifact.items = [
        {
            externalId: '9007199254740993',
            localizedFields: {},
            images: [{ url: 'https://oss.yf-gz.cn/file/large-b.jpg' }],
        },
        {
            externalId: '9007199254740992',
            localizedFields: {},
            images: [{ url: 'https://oss.yf-gz.cn/file/large-a.jpg' }],
        },
    ];
    large.mappingsBundle.mappings = [
        {
            externalId: '9007199254740993',
            productCode: 'ZZC-9007199254740993',
            productId: '33333333-3333-4333-8333-333333333333',
            status: 'matched-update',
        },
        {
            externalId: '9007199254740992',
            productCode: 'ZZC-9007199254740992',
            productId: '44444444-4444-4444-8444-444444444444',
            status: 'matched-update',
        },
    ];
    assert.deepStrictEqual(
        selectOriginalImageCandidates(
            large.artifactBundle.artifact,
            large.mappingsBundle.mappings,
        ).map(entry => entry.externalId),
        ['9007199254740992', '9007199254740993'],
    );
}

async function testOutputSymlinkGate() {
    const repositoryRoot = temporaryDirectory();
    const allowedRoot = path.join(
        repositoryRoot,
        'artifacts',
        'catalog-source-media',
    );
    fs.mkdirSync(allowedRoot, { recursive: true });
    const outside = temporaryDirectory();
    fs.symlinkSync(outside, path.join(allowedRoot, 'escape'));
    assert.throws(
        () => assertMediaOutputPath(
            repositoryRoot,
            allowedRoot,
            path.join(allowedRoot, 'escape', 'snapshot'),
        ),
        /symlink ancestors/,
    );
}

async function testRedirectAndLimits() {
    const root = temporaryDirectory();
    let calls = 0;
    let cancelled = 0;
    const result = await downloadImage(
        'https://oss.yf-gz.cn/file/a.jpg',
        root,
        {
            beforeAttempt: NO_WAIT,
            fetchImpl: async url => {
                calls += 1;
                if (url.pathname === '/file/a.jpg') {
                    return response(302, Buffer.alloc(0), {
                        location: '/file/final.jpg',
                    }, null, () => {
                        cancelled += 1;
                    });
                }
                return response(200, JPEG_A, {
                    'content-length': JPEG_A.length,
                    'content-type': 'image/jpeg',
                });
            },
            maxFileBytes: 100,
            remainingTotalBytes: 100,
        },
    );
    assert.strictEqual(calls, 2);
    assert.strictEqual(cancelled, 1);
    assert.strictEqual(result.sha256, sha256(JPEG_A));
    assert.ok(fs.existsSync(path.join(root, result.file)));

    await expectReject(
        () => downloadImage(
            'https://oss.yf-gz.cn/file/oversize.jpg',
            root,
            {
                beforeAttempt: NO_WAIT,
                fetchImpl: async () => response(200, JPEG_A, {
                    'content-length': 101,
                    'content-type': 'image/jpeg',
                }),
                maxFileBytes: 100,
                remainingTotalBytes: 100,
            },
        ),
        'MEDIA_RESPONSE_TOO_LARGE',
    );
    await expectReject(
        () => downloadImage(
            'https://oss.yf-gz.cn/file/chunked.jpg',
            root,
            {
                beforeAttempt: NO_WAIT,
                fetchImpl: async () => response(
                    200,
                    JPEG_A,
                    { 'content-type': 'image/jpeg' },
                    [JPEG_A, Buffer.alloc(100)],
                ),
                maxFileBytes: 100,
                remainingTotalBytes: 100,
            },
        ),
        'MEDIA_RESPONSE_TOO_LARGE',
    );
    await expectReject(
        () => downloadImage(
            'https://oss.yf-gz.cn/file/spoof.jpg',
            root,
            {
                beforeAttempt: NO_WAIT,
                fetchImpl: async () => response(200, JPEG_A, {
                    'content-type': 'image/png',
                }),
                maxFileBytes: 100,
                remainingTotalBytes: 100,
            },
        ),
        'MEDIA_MAGIC_BYTES_MISMATCH',
    );
    await assert.rejects(
        () => downloadImage(
            'https://oss.yf-gz.cn/file/escape.jpg',
            root,
            {
                beforeAttempt: NO_WAIT,
                fetchImpl: async () => response(302, Buffer.alloc(0), {
                    location: 'https://example.com/escape.jpg',
                }),
                maxFileBytes: 100,
                remainingTotalBytes: 100,
            },
        ),
        error => error.code === 'ZZCTEA_PUBLIC_IMAGE_URL_INVALID',
    );
}

async function testMaterializationDedupeResumeAndMismatch() {
    const root = temporaryDirectory();
    const data = fixture();
    let calls = 0;
    const fetchImpl = async url => {
        calls += 1;
        const body = url.pathname.endsWith('/a.jpg') ? JPEG_A : JPEG_A;
        return response(200, body, {
            'content-length': body.length,
            'content-type': 'image/jpeg',
        });
    };
    const first = await materializeVerifiedMedia({
        ...data,
        beforeAttempt: NO_WAIT,
        fetchImpl,
        maxFileBytes: 100,
        maxTotalBytes: 1000,
        minimumRequestIntervalMs: 1000,
        outputDirectory: root,
    });
    assert.strictEqual(calls, 2);
    assert.strictEqual(first.manifest.originalImageCount, 2);
    assert.strictEqual(first.manifest.uniqueBlobCount, 1);
    assert.strictEqual(first.manifest.mediaItemCount, 2);
    const items = JSON.parse(
        fs.readFileSync(path.join(root, 'media-items.json'), 'utf8'),
    );
    assert.deepStrictEqual(items.map(item => item.role), ['gallery', 'gallery']);
    assert.deepStrictEqual(items.map(item => item.file), [items[0].file, items[0].file]);
    assert.deepStrictEqual(items.map(item => item.sha256), [
        sha256(JPEG_A),
        sha256(JPEG_A),
    ]);
    assert.deepStrictEqual(items.map(item => item.bytes), [
        JPEG_A.length,
        JPEG_A.length,
    ]);
    assert.strictEqual(first.manifest.productionWrites, false);

    const resumed = await materializeVerifiedMedia({
        ...data,
        beforeAttempt: NO_WAIT,
        fetchImpl: async () => {
            throw new Error('complete resume must not fetch');
        },
        maxFileBytes: 100,
        maxTotalBytes: 1000,
        minimumRequestIntervalMs: 1000,
        outputDirectory: root,
    });
    assert.strictEqual(resumed.resumedComplete, true);

    fs.rmSync(path.join(root, 'media-manifest.json'));
    const checkpoint = JSON.parse(
        fs.readFileSync(path.join(root, 'media-checkpoint.json'), 'utf8'),
    );
    const firstEntry = Object.values(checkpoint.entries)[0];
    fs.writeFileSync(path.join(root, firstEntry.file), JPEG_B);
    await expectReject(
        () => materializeVerifiedMedia({
            ...data,
            beforeAttempt: NO_WAIT,
            fetchImpl,
            maxFileBytes: 100,
            maxTotalBytes: 1000,
            minimumRequestIntervalMs: 1000,
            outputDirectory: root,
        }),
        'MEDIA_RESUME_HASH_MISMATCH',
    );
}

async function testInterruptedResume() {
    const root = temporaryDirectory();
    const data = fixture();
    let failSecond = true;
    await assert.rejects(
        () => materializeVerifiedMedia({
            ...data,
            beforeAttempt: NO_WAIT,
            fetchImpl: async url => {
                if (url.pathname.endsWith('/b.jpg') && failSecond) {
                    throw new Error('fixture interruption');
                }
                return response(200, url.pathname.endsWith('/a.jpg') ? JPEG_A : JPEG_B, {
                    'content-type': 'image/jpeg',
                });
            },
            maxFileBytes: 100,
            maxTotalBytes: 1000,
            minimumRequestIntervalMs: 1000,
            outputDirectory: root,
        }),
        /fixture interruption/,
    );
    const partial = JSON.parse(
        fs.readFileSync(path.join(root, 'media-checkpoint.json'), 'utf8'),
    );
    assert.strictEqual(partial.completedCount, 1);
    let resumedCalls = 0;
    failSecond = false;
    const resumed = await materializeVerifiedMedia({
        ...data,
        beforeAttempt: NO_WAIT,
        fetchImpl: async url => {
            resumedCalls += 1;
            return response(200, url.pathname.endsWith('/a.jpg') ? JPEG_A : JPEG_B, {
                'content-type': 'image/jpeg',
            });
        },
        maxFileBytes: 100,
        maxTotalBytes: 1000,
        minimumRequestIntervalMs: 1000,
        outputDirectory: root,
    });
    assert.strictEqual(resumedCalls, 1);
    assert.strictEqual(resumed.manifest.uniqueBlobCount, 2);
}

async function testVerifiedPriorCacheReuse() {
    const prior = await createPreviousImport(temporaryDirectory());
    const outputRoot = temporaryDirectory();
    let calls = 0;
    const result = await materializeVerifiedMedia({
        ...prior.data,
        beforeAttempt: NO_WAIT,
        fetchImpl: async () => {
            calls += 1;
            throw new Error('unchanged cached URL must not fetch');
        },
        maxFileBytes: 100,
        maxTotalBytes: 1000,
        minimumRequestIntervalMs: 1000,
        outputDirectory: outputRoot,
        previousMediaDirectory: prior.mediaRoot,
    });
    assert.strictEqual(calls, 0);
    assert.strictEqual(result.manifest.originalImageCount, 2);
    const checkpoint = JSON.parse(
        fs.readFileSync(path.join(outputRoot, 'media-checkpoint.json'), 'utf8'),
    );
    assert.strictEqual(checkpoint.completedCount, 2);
    for (const entry of Object.values(checkpoint.entries)) {
        const cachedFile = path.join(prior.mediaRoot, entry.file);
        const copiedFile = path.join(outputRoot, entry.file);
        assert.strictEqual(fs.lstatSync(copiedFile).isFile(), true);
        assert.strictEqual(fs.lstatSync(copiedFile).isSymbolicLink(), false);
        assert.strictEqual(sha256(fs.readFileSync(copiedFile)), entry.sha256);
        assert.notStrictEqual(
            fs.statSync(copiedFile).ino,
            fs.statSync(cachedFile).ino,
            'Cache reuse must copy into the new artifact, not hard-link it.',
        );
    }
}

async function testChangedAndNewUrlsFetch() {
    const prior = await createPreviousImport(temporaryDirectory());
    const next = clone(prior.data);
    next.artifactBundle.manifest.artifactSha256 = 'd'.repeat(64);
    next.artifactBundle.manifest.snapshotId = 'snapshot-next';
    next.artifactBundle.artifact.items[1].images[0].url =
        'https://oss.yf-gz.cn/file/changed-b.jpg';
    next.artifactBundle.artifact.items.push({
        externalId: '3',
        localizedFields: { 'zh-CN': { name: 'Tea three' } },
        images: [{
            role: 'source-reference',
            url: 'https://oss.yf-gz.cn/file/new-c.jpg',
        }],
    });
    next.mappingsBundle.mappings.push({
        externalId: '3',
        productCode: 'ZZC-3',
        published: false,
        status: 'missing-create-draft',
    });
    const fetched = [];
    await materializeVerifiedMedia({
        ...next,
        beforeAttempt: NO_WAIT,
        fetchImpl: async url => {
            fetched.push(url.toString());
            return response(200, JPEG_B, {
                'content-type': 'image/jpeg',
            });
        },
        maxFileBytes: 100,
        maxTotalBytes: 1000,
        minimumRequestIntervalMs: 1000,
        outputDirectory: temporaryDirectory(),
        previousMediaDirectory: prior.mediaRoot,
    });
    assert.deepStrictEqual(fetched.sort(), [
        'https://oss.yf-gz.cn/file/changed-b.jpg',
        'https://oss.yf-gz.cn/file/new-c.jpg',
    ]);
}

async function testTamperedPriorCacheFailsClosed() {
    const prior = await createPreviousImport(temporaryDirectory());
    const receipt = JSON.parse(
        fs.readFileSync(path.join(prior.mediaRoot, 'media-receipt.json'), 'utf8'),
    );
    fs.writeFileSync(path.join(prior.mediaRoot, receipt.sources[0].file), JPEG_B);
    let calls = 0;
    await expectReject(
        () => materializeVerifiedMedia({
            ...prior.data,
            beforeAttempt: NO_WAIT,
            fetchImpl: async () => {
                calls += 1;
                return response(200, JPEG_A, {
                    'content-type': 'image/jpeg',
                });
            },
            maxFileBytes: 100,
            maxTotalBytes: 1000,
            minimumRequestIntervalMs: 1000,
            outputDirectory: temporaryDirectory(),
            previousMediaDirectory: prior.mediaRoot,
        }),
        'MEDIA_RESUME_HASH_MISMATCH',
    );
    assert.strictEqual(calls, 0);

    const symlinked = await createPreviousImport(temporaryDirectory());
    const symlinkReceipt = JSON.parse(
        fs.readFileSync(
            path.join(symlinked.mediaRoot, 'media-receipt.json'),
            'utf8',
        ),
    );
    const blobFile = path.join(
        symlinked.mediaRoot,
        symlinkReceipt.sources[0].file,
    );
    const outsideFile = path.join(temporaryDirectory(), 'outside.jpg');
    fs.copyFileSync(blobFile, outsideFile);
    fs.rmSync(blobFile);
    fs.symlinkSync(outsideFile, blobFile);
    await assert.rejects(
        () => materializeVerifiedMedia({
            ...symlinked.data,
            beforeAttempt: NO_WAIT,
            fetchImpl: async () => {
                throw new Error('symlinked cache must fail before fetch');
            },
            maxFileBytes: 100,
            maxTotalBytes: 1000,
            minimumRequestIntervalMs: 1000,
            outputDirectory: temporaryDirectory(),
            previousMediaDirectory: symlinked.mediaRoot,
        }),
        /must be a real file/,
    );
}

async function main() {
    await testMagicValidation();
    await testOriginalSelectionAndMappingGate();
    await testOutputSymlinkGate();
    await testRedirectAndLimits();
    await testMaterializationDedupeResumeAndMismatch();
    await testInterruptedResume();
    await testVerifiedPriorCacheReuse();
    await testChangedAndNewUrlsFetch();
    await testTamperedPriorCacheFailsClosed();
    console.log('media materialization tests passed');
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = {
    testInterruptedResume,
    testChangedAndNewUrlsFetch,
    testMagicValidation,
    testMaterializationDedupeResumeAndMismatch,
    testOriginalSelectionAndMappingGate,
    testOutputSymlinkGate,
    testRedirectAndLimits,
    testTamperedPriorCacheFailsClosed,
    testVerifiedPriorCacheReuse,
};
