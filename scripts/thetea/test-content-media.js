#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    collectContentMedia,
    readContentMediaDirectory,
} = require('./lib/content-media');

const articles = [{
    code: 'ARTICLE-ONE',
    slug: 'one',
    translations: [{
        lang: 'en-US',
        narratives: { overview: 'Dry leaf detail: {{media:leaf-closeup}}' },
    }],
}];
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.alloc(4),
    Buffer.from('WEBP', 'ascii'),
]);

const roots = [];
try {
    const validRoot = createCase([record({
        cover: 'cover.png',
        inline: [{
            token: '{{media:leaf-closeup}}',
            file: 'leaf-closeup.webp',
            alt: { 'en-US': 'Dry tea leaf close-up', 'ru-RU': 'Крупный план чайного листа' },
        }],
    })], {
        'articles/one/cover.png': png,
        'articles/one/leaf-closeup.webp': webp,
    });
    const valid = collectContentMedia(validRoot, articles);
    assert.deepStrictEqual(valid.errors, []);
    assert.strictEqual(valid.records.length, 1);
    assert.deepStrictEqual(valid.records[0], record({
        cover: 'cover.png',
        inline: [{
            token: '{{media:leaf-closeup}}',
            file: 'leaf-closeup.webp',
            alt: { 'en-US': 'Dry tea leaf close-up', 'ru-RU': 'Крупный план чайного листа' },
        }],
    }));
    assert.deepStrictEqual(valid.assets.map(asset => asset.relativePath), [
        '07-media/content/articles/one/cover.png',
        '07-media/content/articles/one/leaf-closeup.webp',
    ]);

    const duplicateArticle = validateCase([
        record({ cover: 'cover.png' }),
        record({ cover: 'other.png' }),
    ], {
        'articles/one/cover.png': png,
        'articles/one/other.png': png,
    });
    assertHasError(duplicateArticle, 'Duplicate content media article entry');

    const duplicateToken = validateCase([record({
        inline: [
            { token: '{{media:leaf}}', file: 'leaf.png' },
            { token: '{{media:leaf}}', file: 'leaf-detail.png' },
        ],
    })], {
        'articles/one/leaf.png': png,
        'articles/one/leaf-detail.png': png,
    });
    assertHasError(duplicateToken, 'Duplicate inline media token');

    const absentToken = validateCase([record({
        inline: [{ token: '{{media:not-in-article}}', file: 'leaf.png' }],
    })], {
        'articles/one/leaf.png': png,
    });
    assertHasError(absentToken, 'is not present in routed article');

    const missing = validateCase([record({ cover: 'missing.png' })], {});
    assertHasError(missing, 'Missing content media file');

    const unsupported = validateCase([record({ cover: 'cover.gif' })], {
        'articles/one/cover.gif': Buffer.from('GIF89a', 'ascii'),
    });
    assertHasError(unsupported, 'PNG, JPEG, or WebP filename');

    const unsafe = validateCase([{
        article: 'ARTICLE-ONE',
        slug: '../one',
        path: '07-media/content/articles/../one',
        replace: true,
        cover: 'cover.png',
    }], {});
    assertHasError(unsafe, 'lowercase slug');

    const oversizedRoot = createCase([record({ cover: 'cover.png' })], {
        'articles/one/cover.png': png,
    });
    const oversized = readContentMediaDirectory(
        oversizedRoot,
        articles,
        { maxFileBytes: png.length - 1 });
    assertHasError(oversized, 'exceeds');

    const wrongSignature = validateCase([record({ cover: 'cover.png' })], {
        'articles/one/cover.png': Buffer.from('not-a-png', 'ascii'),
    });
    assertHasError(wrongSignature, 'signature does not match image/png');

    const orphan = validateCase([record({ cover: 'cover.png' })], {
        'articles/one/cover.png': png,
        'articles/one/orphan.png': png,
    });
    assertHasError(orphan, 'Unreferenced content media file');
} finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}

console.log('test-content-media: OK');

function record(overrides = {}) {
    return {
        article: 'ARTICLE-ONE',
        slug: 'one',
        path: '07-media/content/articles/one',
        replace: true,
        ...overrides,
    };
}

function validateCase(manifest, files) {
    return readContentMediaDirectory(createCase(manifest, files), articles);
}

function createCase(manifest, files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thetea-content-media-'));
    roots.push(root);
    writeJson(path.join(root, 'media.json'), manifest);
    for (const [relativePath, content] of Object.entries(files)) {
        const file = path.join(root, ...relativePath.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
    return root;
}

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function assertHasError(result, expected) {
    assert(
        result.errors.some(error => error.includes(expected)),
        `Expected an error containing '${expected}', got:\n${result.errors.join('\n')}`,
    );
}
