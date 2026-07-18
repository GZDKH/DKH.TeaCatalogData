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
};
normalizeProductForImport(product);
assert.deepStrictEqual(product.origins[0].altitude, { min: 5, max: 6, unit: 'm' });

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

console.log('test-import-contract: OK');
