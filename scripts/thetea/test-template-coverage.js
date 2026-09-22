#!/usr/bin/env node
const assert = require('assert');
const profile = require('../../templates/product-profiles/tea/profile.json');
const template = require('../../templates/product-profiles/tea/product-template.json');
const fieldMatrix = require('../../templates/product-profiles/tea/field-matrix.json');

const explicitCounts = profile.attributes.reduce((counts, attribute) => {
    counts[attribute.type] = (counts[attribute.type] || 0) + 1;
    return counts;
}, {});

assert.strictEqual(profile.profile.id, 'tea');
assert.strictEqual(profile.profile.version, '1.0.0');
assert.strictEqual(Object.hasOwn(profile.profile, 'sourceSystem'), false);
assert.strictEqual(profile.groups.length, 21);
assert.strictEqual(profile.attributes.length, 25);
assert.deepStrictEqual(explicitCounts, {
    Option: 8,
    CustomText: 8,
    Range: 2,
    Boolean: 1,
    List: 4,
    Number: 1,
    Date: 1,
});

const typedMachineKeys = new Set([
    'atomic.oxidation',
    'brewing.brew_temp',
    'brewing.water_temp',
    'source.last_updated',
]);
for (const attribute of profile.attributes) {
    if (typedMachineKeys.has(attribute.key)) {
        assert.notStrictEqual(attribute.type, 'CustomMarkdownText');
        assert(attribute.unit || attribute.type === 'Date');
    }
}

assert.strictEqual(profile.attributePatterns.length, 7);
for (const pattern of profile.attributePatterns) {
    assert.notStrictEqual(pattern.type, 'CustomMarkdownText');
    assert.strictEqual(pattern.filterable, false);
}
for (const pattern of profile.attributePatterns.filter((pattern) => pattern.type === 'Number')) {
    assert.ok(pattern.unit, `${pattern.keyPattern} must declare a numeric unit`);
}
assert.strictEqual(
    profile.attributePatterns.some((pattern) => /sensory/.test(pattern.keyPattern)),
    false,
    'sensory intensity is not executable without a source-backed scale',
);
assert.strictEqual(profile.rules.unknownAttribute, 'error');
assert.strictEqual(profile.rules.unknownGroup, 'error');
assert.strictEqual(profile.rules.duplicateAttributePerProduct, 'error');
assert.strictEqual(profile.rules.sourceIdentity, 'required-and-idempotent');
assert.strictEqual(profile.rules.unmappedSourceField, 'review-required');
assert.strictEqual(profile.rules.markdownMapping, 'explicit-narrative-field-only');

assert.strictEqual(fieldMatrix.definitionInventory.count, 75);
assert.strictEqual(fieldMatrix.definitionInventory.unknownDefinition, 'review-required');
assert.strictEqual(fieldMatrix.valuePolicy.inferredDefaults, 'forbidden');
assert.strictEqual(fieldMatrix.valuePolicy.unknownOptionOrUnit, 'review-required');
assert.strictEqual(fieldMatrix.sectionEligibility.machineReadableValue, 'eligible-when-present');
assert.strictEqual(fieldMatrix.sectionEligibility.narrativeValue, 'explicit-field-only');
assert.strictEqual(fieldMatrix.executableMappings.sensoryIntensity, 'disabled-until-a-source-backed-scale-contract-exists');

assert.strictEqual(template.profile.id, 'tea');
assert.strictEqual(template.profile.version, '1.0.0');
assert.strictEqual(Object.hasOwn(template.profile, 'sourceSystem'), false);
const record = template.records[0];
assert.strictEqual(record.source.system, 'REPLACE_WITH_SOURCE_SYSTEM');
assert(record.source.externalId.startsWith('REPLACE_WITH_'));
assert.strictEqual(record.product.published, false);
assert.deepStrictEqual(record.specifications, []);
assert.deepStrictEqual(record.product.packages, []);
assert.deepStrictEqual(record.product.origins, []);

console.log('test-template-coverage: OK');
