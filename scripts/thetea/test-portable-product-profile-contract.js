#!/usr/bin/env node
const assert = require('assert');

const profile = require('../../templates/product-profiles/tea/profile.json');
const descriptor = require('../../templates/product-profiles/tea/product-creation-template.json');
const fieldMatrix = require('../../templates/product-profiles/tea/field-matrix.json');
const examples = [
    require('../../templates/product-profiles/tea/examples/yueyang-huangcha.acceptance.json'),
    require('../../templates/product-profiles/tea/examples/xihu-longjing.from-post.json'),
];

function matchingDefinition(key) {
    const explicit = profile.attributes.find((attribute) => attribute.key === key);
    if (explicit) return explicit;
    return profile.attributePatterns.find((attribute) => new RegExp(attribute.keyPattern).test(key));
}

function assertImportableSpecification(specification) {
    const definition = matchingDefinition(specification.key);
    assert(definition, `unknown or review-gated source field: ${specification.key}`);
    assert.strictEqual(specification.group, definition.group);
    if (definition.targetCode) {
        assert.strictEqual(specification.attribute, definition.targetCode);
    } else {
        assert.match(specification.attribute, /^SPEC-TT-(?:RECIPE|HARVEST)-/);
    }
    assert.strictEqual(specification.type, definition.type);
    if (['Number', 'Duration', 'Range'].includes(specification.type)) {
        assert(definition.unit, `${specification.key} has no declared unit`);
    }
    if (specification.type === 'Option') assert.ok(specification.option, `${specification.key} must use an existing option code`);
}

assert.strictEqual(profile.rules.unknownAttribute, 'error');
assert.strictEqual(profile.rules.unmappedSourceField, 'review-required');
assert.strictEqual(descriptor.runtime.definitionCreation, 'disabled');
assert.strictEqual(descriptor.productAttributes.allowDefinitionCreation, false);
assert.strictEqual(descriptor.specifications.unknownDefinition, 'error');
assert.strictEqual(fieldMatrix.definitionInventory.definitionCreation, 'forbidden');
assert.strictEqual(fieldMatrix.executableMappings.explicitAttributeCount, profile.attributes.length);
assert.strictEqual(Object.hasOwn(descriptor, 'sections'), false);
assert.strictEqual(profile.groups.some((group) => Object.hasOwn(group, 'render')), false);
assert.strictEqual(descriptor.specifications.dynamicAttributes.some((attribute) => attribute.type === 'CustomMarkdownText'), false);

assert.throws(
    () => assertImportableSpecification({key: 'chemistry.caffeine_percent', group: 'chemistry', attribute: 'SPEC-TT-FIELD-CHEMISTRY-CAFFEINE-PERCENT', type: 'Number', value: '4.8'}),
    /unknown or review-gated source field/,
);
assert.throws(
    () => assertImportableSpecification({key: 'sensory.descriptor_l_intensity', group: 'sensory', attribute: 'SPEC-TT-SENSORY-DESCRIPTOR-L-INTENSITY', type: 'Number', value: '5'}),
    /unknown or review-gated source field/,
);

for (const envelope of examples) {
    const record = envelope.records[0];
    assert(record.source.system && record.source.externalId && record.source.revision);
    assert.strictEqual(record.product.published, false);
    for (const specification of record.specifications) assertImportableSpecification(specification);

    // This is the package boundary: the ordinary DataExchange caller receives
    // only stable product/specification values and can serialize them without
    // a Tea-specific envelope or a generated definition.
    const exchangeCandidate = {
        source: record.source,
        product: record.product,
        specifications: record.specifications,
    };
    assert.deepStrictEqual(JSON.parse(JSON.stringify(exchangeCandidate)), exchangeCandidate);
}

console.log('portable-product-profile contract: OK');
