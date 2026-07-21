#!/usr/bin/env node
const assert = require('assert');
const {
    buildReconciliation,
    canonicalCollectionItem,
    canonicalTypedValue,
    collectionDiff,
    diffProduct,
    sha256,
} = require('./reconcile-generated');

function product(code, overrides = {}) {
    return {
        id: `${code}-id`,
        code,
        nativeName: code,
        translations: [],
        specifications: [],
        tags: [],
        tierPrices: [],
        catalogPrices: [],
        storePriceOverrides: [],
        packages: [],
        catalogs: [],
        origins: [],
        related: [],
        crossSells: [],
        ...overrides,
    };
}

const baseline = [
    product('TEA-A', {
        nativeName: 'Before',
        translations: [{ lang: 'en-US', name: 'Before' }],
        specifications: [
            { group: 'SPEC-TT-GROUP-OLD', attribute: 'SPEC-TT-OLD', type: 'Option' },
            { group: null, attribute: 'LEGACY-KEEP', type: 'CustomText', value: 'keep' },
        ],
        tags: [{ code: 'KEEP' }],
    }),
    product('TEA-B'),
];
const desired = [
    product('TEA-A', {
        nativeName: 'After',
        translations: [{ lang: 'en-US', name: 'After' }],
        specifications: [
            { group: null, attribute: 'LEGACY-KEEP', type: 'CustomText', value: 'keep' },
            { group: 'SPEC-TT-GROUP-NEW', attribute: 'SPEC-TT-NEW', type: 'Number', value: '1' },
        ],
        tags: [{ code: 'KEEP' }, { code: 'NEW' }],
    }),
    product('TEA-B'),
];

const result = buildReconciliation(desired, baseline);
assert.deepStrictEqual(result.counts, { create: 0, update: 1, noop: 1, conflict: 0 });
assert.strictEqual(result.eligible, true);
assert.strictEqual(result.desiredPayload.length, 1);
assert.strictEqual(result.rollbackPayload.length, 1);
assert.strictEqual(result.rollbackPayload[0].nativeName, 'Before');
assert.deepStrictEqual(result.fieldChangeCounts, {
    nativeName: 1,
    specifications: 1,
    tags: 1,
    translations: 1,
});

const operation = result.operations.find(item => item.code === 'TEA-A');
assert.deepStrictEqual(operation.fields.specifications, {
    added: ['SPEC-TT-NEW'],
    removed: ['SPEC-TT-OLD'],
    changed: [],
});
assert.deepStrictEqual(operation.fields.tags, { added: ['NEW'], removed: [], changed: [] });
assert.notStrictEqual(operation.beforeSha256, operation.desiredSha256);
assert.strictEqual(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }));

const create = buildReconciliation([product('TEA-C')], baseline);
assert.deepStrictEqual(create.counts, { create: 1, update: 0, noop: 0, conflict: 0 });
assert.strictEqual(create.eligible, false);

const conflict = buildReconciliation([{ ...product('TEA-A'), id: 'different' }], baseline);
assert.deepStrictEqual(conflict.counts, { create: 0, update: 0, noop: 0, conflict: 1 });
assert.strictEqual(conflict.eligible, false);

const removal = buildReconciliation([
    product('TEA-A', {
        specifications: [{ group: 'SPEC-TT-GROUP-NEW', attribute: 'SPEC-TT-NEW' }],
        tags: [{ code: 'KEEP' }],
    }),
], baseline);
assert.strictEqual(removal.eligible, false);
assert(removal.preservationErrors.some(error => error.includes('LEGACY-KEEP')));

assert.deepStrictEqual(
    collectionDiff([{ code: 'A', value: 1 }], [{ code: 'A', value: 2 }, { code: 'B' }], item => item.code),
    { added: ['B'], removed: [], changed: ['A'] });
assert.doesNotThrow(() => buildReconciliation([
    product('TEA-A', { catalogs: [{ catalog: { code: 'CAT' }, category: { code: 'A' } }] }),
], [
    product('TEA-A', { catalogs: [{ catalog: { code: 'CAT' }, category: { code: 'A' } }] }),
]));
assert.deepStrictEqual(diffProduct({
    catalogs: [{ catalog: { code: 'CAT', currency: 'CNY' }, category: { code: 'A' }, order: 1 }],
    origins: [{
        country: { code: 'CN' },
        state: { code: 'ZJ' },
        city: { code: 'Hangzhou' },
        altitude: { min: '100.000000', max: '800.000000', unit: { code: 'm' } },
        coordinates: { lat: '30.220000', lng: '120.130000' },
    }],
    specifications: [{
        group: { code: 'GROUP' },
        attribute: { code: 'ATTR' },
        type: 'Number',
        value: '80.000000',
        order: 1,
    }],
}, {
    catalogs: [{ catalog: 'CAT', catalogCurrency: 'CNY', category: 'A', order: 1 }],
    origins: [{
        country: 'CN',
        state: 'ZJ',
        city: 'Hangzhou',
        altitude: { min: 100, max: 800, unit: 'm' },
        coordinates: { lat: 30.22, lng: 120.13 },
    }],
    specifications: [{ group: 'GROUP', attribute: 'ATTR', type: 'Number', value: '80', order: 1 }],
}), {});
assert.strictEqual(canonicalTypedValue('Boolean', '0'), false);
assert.deepStrictEqual(canonicalTypedValue('List', '["spring"]'), ['spring']);
assert.deepStrictEqual(canonicalCollectionItem('tags', { code: { code: 'TAG-A' }, ignored: true }), {
    code: 'TAG-A',
});
assert.deepStrictEqual(diffProduct({ a: 1, origins: [] }, { a: 2, origins: [{ country: 'CN' }] }), {
    a: { before: 1, after: 2 },
    origins: { added: 1, removed: 0, changed: 0 },
});

console.log('test-reconcile-generated: OK');
