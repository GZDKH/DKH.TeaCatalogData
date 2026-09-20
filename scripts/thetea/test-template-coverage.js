#!/usr/bin/env node
const assert = require('assert');
const profile = require('../../templates/tea.v1/profile.json');
const template = require('../../templates/tea.v1/product-template.json');

const explicitCounts = profile.attributes.reduce((counts, attribute) => {
    counts[attribute.type] = (counts[attribute.type] || 0) + 1;
    return counts;
}, {});

assert.strictEqual(profile.profile.id, 'tea');
assert.strictEqual(profile.profile.version, '1.0.0');
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

const narrativePattern = profile.attributePatterns.find(pattern => pattern.type === 'CustomMarkdownText');
assert(narrativePattern, 'narrative pattern must remain explicit');
assert.strictEqual(narrativePattern.filterable, false);
assert.strictEqual(profile.rules.unknownAttribute, 'error');
assert.strictEqual(profile.rules.unknownGroup, 'error');
assert.strictEqual(profile.rules.duplicateAttributePerProduct, 'error');
assert.strictEqual(profile.rules.sourceIdentity, 'required-and-idempotent');

assert.strictEqual(template.profile.id, 'tea');
assert.strictEqual(template.profile.version, '1.0.0');
const record = template.records[0];
assert(record.source.externalId.startsWith('REPLACE_WITH_'));
assert.strictEqual(record.product.published, false);
assert.deepStrictEqual(record.specifications, []);
assert.deepStrictEqual(record.product.packages, []);
assert.deepStrictEqual(record.product.origins, []);

console.log('test-template-coverage: OK');
