#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    createArtifactManifest,
    readArtifactBundle,
    verifyArtifactManifest,
    writeJson,
} = require('./lib/artifact-bundle');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thetea-artifact-bundle-'));
try {
    writeJson(path.join(root, '02-specifications', 'specification_groups.json'), []);
    writeJson(path.join(root, '02-specifications', 'specification_attributes.json'), []);
    writeJson(path.join(root, '02-specifications', 'specification_attribute_options.json'), []);
    writeJson(path.join(root, '06-routed-content', 'articles', 'index.json'), []);
    writeJson(path.join(root, '06-routed-content', 'metaobjects', 'index.json'), []);
    writeJson(path.join(root, '04-products', 'GREEN', 'one.json'), [{ code: 'TEA-CN-ONE' }]);
    createArtifactManifest(root, {
        snapshotId: 'snapshot-one',
        sourceManifestSha256: 'abc123',
        requiredLocales: ['ru-RU', 'en-US', 'en-US'],
        productCodes: ['TEA-CN-ONE'],
        products: [{ code: 'TEA-CN-ONE', path: '04-products/GREEN/one.json' }],
        lossEvents: [],
        generatedAt: '2026-07-17T00:00:00.000Z',
    });

    const valid = verifyArtifactManifest(root);
    assert.strictEqual(valid.valid, true, valid.errors.join('\n'));
    assert.deepStrictEqual(valid.manifest.requiredLocales, ['en-US', 'ru-RU']);
    const bundle = readArtifactBundle(root);
    assert.strictEqual(bundle.valid, true, bundle.errors.join('\n'));
    assert.strictEqual(bundle.products.length, 1);

    fs.writeFileSync(path.join(root, '04-products', 'GREEN', 'one.json'), '[]\n');
    const changed = verifyArtifactManifest(root);
    assert.strictEqual(changed.valid, false);
    assert(changed.errors.some(error => error.includes('hash differs')));

    writeJson(path.join(root, 'stale.json'), []);
    const stale = verifyArtifactManifest(root);
    assert(stale.errors.some(error => error.includes('Stale or untracked')));
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('test-artifact-bundle: OK');
