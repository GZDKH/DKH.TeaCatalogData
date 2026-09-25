#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    buildReconciliation,
    definitionDisposition,
} = require('./reconcile-source-definitions');

const repoRoot = path.resolve(__dirname, '../..');
const mappingPath = path.join(repoRoot, 'docs/thetea-definition-reconciliation.json');
const categoryMappingPath = path.join(repoRoot, 'docs/thetea-category-reconciliation.json');
const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
const categoryMapping = JSON.parse(fs.readFileSync(categoryMappingPath, 'utf8'));

assert.strictEqual(mapping.sectionFields.length, 284);
assert.strictEqual(mapping.outsideSectionLeaves.length, 83);
assert.strictEqual(mapping.definitionCodeMigration.rows.length, 89);
assert.strictEqual(categoryMapping.categoryInventory.length, 210);
assert.strictEqual(categoryMapping.directMappings.length, 62);

const noReference = buildReconciliation({
    mapping,
    categoryMapping,
    mappingPath,
    categoryMappingPath,
});
assert.strictEqual(noReference.eligible, false);
assert.strictEqual(noReference.applyAllowed, false);
assert.strictEqual(noReference.sourceEvidence.sectionFieldCount, 284);
assert.strictEqual(noReference.sourceEvidence.outsideSectionLeafCount, 83);
assert.strictEqual(noReference.summary.categoryAxes, 13);
assert(noReference.definitionMigration.some(item => item.disposition === 'conflict'));
assert(noReference.definitionMigration.some(item => item.disposition === 'route-content'));
assert(noReference.sectionFields.some(item => item.disposition === 'typed-definition'));
assert(noReference.outsideSectionLeaves.some(item => item.disposition === 'route-content'));

const oxidation = {
    ...mapping.existingExecutableProfileAttributes.find(item => item.targetCode === 'SPEC-TT-ATOMIC-OXIDATION'),
    ...mapping.definitionCodeMigration.rows.find(item => item.legacyCode === 'SPEC-TT-ATOMIC-OXIDATION'),
};
oxidation.currentType = oxidation.currentType || oxidation.type;
assert.strictEqual(definitionDisposition(oxidation, {
    specificationAttributes: [{ id: 'attr-1', code: oxidation.legacyCode, type: oxidation.currentType }],
}).disposition, 'rename-review');
assert.strictEqual(definitionDisposition(oxidation, {
    specificationAttributes: [{ id: 'attr-1', code: oxidation.legacyCode, type: 'Option' }],
}).disposition, 'conflict');
assert.strictEqual(definitionDisposition(oxidation, {
    specificationAttributes: [{ id: 'attr-1', code: oxidation.legacyCode, type: 'Boolean' }],
}).disposition, 'conflict');

const category = categoryMapping.categoryInventory[0];
const withReference = buildReconciliation({
    mapping,
    categoryMapping,
    reference: {
        specificationAttributes: [{ id: 'attr-1', code: oxidation.legacyCode, type: oxidation.currentType }],
        categories: [{ id: 'cat-1', code: category.code }],
    },
    mappingPath,
    categoryMappingPath,
    catalogReferencePath: mappingPath,
});
assert.strictEqual(withReference.reference.supplied, true);
assert.strictEqual(withReference.reference.sha256.length, 64);
assert.strictEqual(withReference.categories.definitions.find(item => item.code === category.code).disposition, 'reuse-existing-id');
assert.strictEqual(withReference.applyAllowed, false);

console.log('test-reconcile-source-definitions: OK');
