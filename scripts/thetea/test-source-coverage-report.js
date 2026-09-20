#!/usr/bin/env node
const assert = require('assert');
const { productCoverage, reconcile } = require('./build-source-coverage-report');

const products = [
    {
        code: 'TEA-A',
        translations: [{ seo: 'tea-a' }],
        specifications: [
            { group: 'G', attribute: 'SPEC-ONE', type: 'Number' },
            { group: 'G', attribute: 'SPEC-TWO', type: 'Option', option: 'OPT-A' },
        ],
    },
];
const report = productCoverage(products, [{ a: '', b: '' }]);
assert.strictEqual(report.productCount, 1);
assert.strictEqual(report.distinctSpecificationAttributes, 2);
assert.strictEqual(report.distinctSpecificationOptions, 1);
assert.strictEqual(report.templateColumnCount, 2);
assert.ok(report.productCodeHash);

const reconciliation = reconcile(report, {
    targetSlugs: ['tea-a', 'source-only'],
}, {
    specificationDefinitions: [{ code: 'SPEC-ONE' }],
    productAttributeCount: 2,
    catalogTemplate: { specifications: 'empty', variantAttributes: 'empty' },
});
assert.strictEqual(reconciliation.exactProductSourceSlugMatches, 1);
assert.deepStrictEqual(reconciliation.productOnlySlugs, []);
assert.deepStrictEqual(reconciliation.sourceOnlySlugs, ['source-only']);
assert.deepStrictEqual(reconciliation.productAttributesWithLiveDefinitionCodes, ['SPEC-ONE']);
assert.deepStrictEqual(reconciliation.productAttributesWithoutLiveDefinition, ['SPEC-TWO']);

console.log('source-coverage-report tests: ok');
