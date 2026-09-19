#!/usr/bin/env node
const assert = require('assert');
const {
    compareBaseline,
    groupCoverage,
} = require('./audit-sensory-readiness');

function product(code, specifications) {
    return { code, specifications };
}

function spec(group, attribute, value, type = 'CustomText') {
    return {
        lang: 'en-US',
        group,
        attribute,
        type,
        value,
    };
}

const generated = [product('TEA-A', [
    spec('SPEC-TT-GROUP-SENSORY', 'AROMA', '0', 'Number'),
    spec('SPEC-TT-GROUP-RECIPE', 'TEMP', 'false', 'Boolean'),
])];
const coverage = groupCoverage(generated.map(item => ({
    ...item,
    specifications: item.specifications.map(itemSpec => ({ ...itemSpec, _productCode: item.code })),
})));
assert.strictEqual(coverage.sensory.productsWithData, 1, 'zero-valued sensory data is populated');
assert.strictEqual(coverage.recipe.productsWithData, 1, 'false-valued recipe data is populated');
assert.strictEqual(coverage.organoleptic.productsWithData, 0);

const unchanged = compareBaseline(generated, [product('TEA-A', generated[0].specifications)]);
assert.strictEqual(unchanged.changedProductCount, 0, 'identical managed specs do not conflict');

const changed = compareBaseline(generated, [product('TEA-A', [
    spec('SPEC-TT-GROUP-SENSORY', 'AROMA', '3', 'Number'),
])]);
assert.strictEqual(changed.changedProductCount, 1, 'managed spec changes are reported');

const added = compareBaseline([...generated, product('TEA-B', [])], [product('TEA-A', generated[0].specifications)]);
assert.deepStrictEqual(added.generatedOnly, ['TEA-B']);

console.log('audit-sensory-readiness tests: ok');
