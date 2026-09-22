#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');

const file = 'docs/tea-definition-migration-matrix.json';
const matrix = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.strictEqual(matrix.schemaVersion, 1);
assert.strictEqual(matrix.definitionCount, 75, 'the prepared tea definition set must remain complete');
assert.strictEqual(matrix.definitions.length, 75);

const fieldMatrix = JSON.parse(fs.readFileSync('templates/product-profiles/tea/field-matrix.json', 'utf8'));
assert.strictEqual(fieldMatrix.definitionInventory.count, matrix.definitionCount);
assert.strictEqual(fieldMatrix.definitionInventory.source, '../../../docs/tea-definition-migration-matrix.json');
assert.deepStrictEqual(Object.keys(fieldMatrix.definitionInventory.columns).sort(), [
    'allowedValuesOrScale', 'cardinality', 'editor', 'evidence', 'importExport',
    'requiredDefaultRule', 'runtimeType', 'sectionAndReview', 'targetTypedRepresentation', 'unit',
].sort());

const required = [
    'code', 'currentType', 'targetRepresentation', 'disposition', 'owner',
    'cardinality', 'unit', 'scaleOrAllowedDomain', 'rule', 'sourceEvidence',
    'localePolicy', 'templateEditor', 'exchange', 'sectionAndReviewSupport',
];
const codes = new Set();
for (const definition of matrix.definitions) {
    for (const key of required) assert.ok(Object.hasOwn(definition, key), `${definition.code || 'unknown'} lacks ${key}`);
    assert.ok(/^SPEC-/.test(definition.code), `invalid stable definition code: ${definition.code}`);
    assert.ok(!codes.has(definition.code), `duplicate definition code: ${definition.code}`);
    codes.add(definition.code);
    assert.strictEqual(definition.owner, 'ProductCatalogService');
    assert.match(definition.exchange, /existing ProductCatalog products import\/export/i);
    assert.match(definition.sectionAndReviewSupport, /Storefront sections read/);
    if (definition.currentType === 'CustomMarkdownText' && /CustomMarkdownText/i.test(definition.targetRepresentation)) {
        assert.strictEqual(definition.disposition, 'retain-narrative', `${definition.code} must stay narrative when its target is Markdown`);
    }
    if (definition.code.startsWith('SPEC-TT-SENSORY-DESCRIPTOR-')) {
        assert.strictEqual(definition.disposition, 'source-semantics-review');
        assert.match(definition.scaleOrAllowedDomain, /unresolved source dictionary/);
    }
}

assert.ok(matrix.invariants.some(value => /never create definitions/i.test(value)));
assert.ok(matrix.invariants.some(value => /ReviewService stores user observations/i.test(value)));
console.log('definition-migration-matrix tests: ok');
