#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildInventory, collectLeaves, dispositionFor } = require('./build-source-inventory');

assert.deepStrictEqual(collectLeaves({ meta: { tea_type: 'green' }, tags: ['green'] }).map(item => item.sourcePath), [
    'meta.tea_type',
    'tags[]',
]);
assert.strictEqual(dispositionFor('meta.tea_type', [{ sourcePath: 'meta.tea_type', targetCode: 'SPEC-TEA-TYPE' }]).disposition, 'typed-definition');
assert.strictEqual(dispositionFor('sections.organoleptic.taste', []).disposition, 'routed-content-and-raw-source');
assert.strictEqual(dispositionFor('new.future.path', []).disposition, 'review-required');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thetea-inventory-'));
fs.mkdirSync(path.join(root, 'raw', 'cards', 'en'), { recursive: true });
fs.mkdirSync(path.join(root, 'raw', 'source'), { recursive: true });
fs.writeFileSync(path.join(root, 'raw', 'cards', 'en', 'green-tea.json'), JSON.stringify({
    slug: 'green-tea',
    kind: 'tea',
    lang: 'en',
    meta: { tea_type: 'green' },
    sections: { organoleptic: { taste: { value: 'fresh' } } },
    seo: { title: 'Green tea' },
}));
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
    snapshotId: 'fixture',
    createdAt: '2026-09-25T00:00:00Z',
    completedAt: '2026-09-25T00:01:00Z',
    requestedLangs: ['all'],
    langs: ['en'],
    availableLocales: ['en'],
    files: ['raw/cards/en/green-tea.json'],
    entityInventory: [{ slug: 'green-tea', entityKind: 'tea', endpoint: 'teas' }],
    entityObservations: [{ slug: 'green-tea', lang: 'en', actualKind: 'tea', language: 'en' }],
    fieldCoverage: [{ slug: 'green-tea', lang: 'en', entityKind: 'tea', expected: [], fetched: [], missing: [] }],
    errors: [],
    warnings: [],
}));
const report = buildInventory(root, path.join(__dirname, '../../templates/product-profiles/tea/profile.json'));
assert.strictEqual(report.entities.length, 1);
assert(report.leafDisposition.some(item => item.sourcePath === 'meta.tea_type' && item.disposition === 'typed-definition'));
assert(report.leafDisposition.some(item => item.sourcePath === 'sections.organoleptic.taste' && item.disposition === 'typed-definition'));
assert.strictEqual(report.gaps.unexplainedLossCount, 0);
assert.strictEqual(report.eligibleForImport, true);

console.log('test-build-source-inventory: OK');
