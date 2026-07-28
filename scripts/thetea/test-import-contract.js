#!/usr/bin/env node
const assert = require('assert');
const {
    normalizeAltitudeValue,
    normalizeProductForImport,
} = require('./lib/import-contract');

assert.strictEqual(normalizeAltitudeValue(5), 5);
assert.strictEqual(normalizeAltitudeValue('5.4'), 5);
assert.strictEqual(normalizeAltitudeValue(0), 0);
assert.throws(() => normalizeAltitudeValue('not-a-number'), /finite number/);

const product = {
    code: 'TEA-CN-ONE',
    sku: 'ONE',
    translations: [{ lang: 'en-US', name: 'Tea' }],
    origins: [{ country: 'CN', altitude: { min: 5, max: 5.8, unit: 'm' } }],
    specifications: [
        { attribute: 'SPEC-ONE', type: 'List', value: '["a","b"]' },
        { attribute: 'SPEC-TWO', type: 'Boolean', value: 'false' },
    ],
    tags: [{ code: { code: 'TAG-ONE' } }],
    catalogs: [{
        catalog: { code: 'CATALOG-CHINESE-TEA', currency: 'cny' },
        category: { code: 'CAT-GREEN' },
    }],
    packages: [{ package: { code: 'PKG-50G' } }],
    related: [{ product: { code: 'TEA-CN-TWO' }, catalog: { code: 'CATALOG-CHINESE-TEA' } }],
};
normalizeProductForImport(product);
assert.deepStrictEqual(product.origins[0].altitude, { min: 5, max: 6, unit: 'm' });
assert.deepStrictEqual(product.catalogs[0], {
    catalog: 'CATALOG-CHINESE-TEA',
    category: 'CAT-GREEN',
    catalogCurrency: 'CNY',
});
assert.strictEqual(product.tags[0].code, 'TAG-ONE');
assert.strictEqual(product.packages[0].package, 'PKG-50G');
assert.deepStrictEqual(product.related[0], {
    product: 'TEA-CN-TWO',
    catalog: 'CATALOG-CHINESE-TEA',
});

assert.throws(() => normalizeProductForImport({
    ...product,
    specifications: [
        { attribute: 'SPEC-ONE', value: 'a' },
        { attribute: 'spec-one', value: 'b' },
    ],
}), /occurs more than once/);

assert.throws(() => normalizeProductForImport({
    ...product,
    specifications: [{ attribute: 'SPEC-LONG', value: 'x'.repeat(4001) }],
}), /data was not truncated/);

assert.throws(() => normalizeProductForImport({
    ...product,
    catalogs: [{ catalog: {}, category: { code: 'CAT-GREEN' } }],
}), /has no reference code/);

console.log('test-import-contract: OK');
