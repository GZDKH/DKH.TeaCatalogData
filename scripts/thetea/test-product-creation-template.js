#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../templates/tea.v1');
const descriptor = JSON.parse(fs.readFileSync(path.join(root, 'product-creation-template.json'), 'utf8'));
const profile = JSON.parse(fs.readFileSync(path.join(root, 'profile.json'), 'utf8'));
const examples = [
    JSON.parse(fs.readFileSync(path.join(root, 'examples/yueyang-huangcha.from-post.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(root, 'examples/xihu-longjing.from-post.json'), 'utf8')),
];

assert.strictEqual(descriptor.kind, 'product-creation-template');
assert.strictEqual(descriptor.template.id, 'tea-product');
assert.strictEqual(descriptor.template.version, '1.0.0');
assert.deepStrictEqual(descriptor.template.labels, {'en-US': 'Tea', 'ru-RU': 'Чай'});
assert.strictEqual(descriptor.template.repositoryOnly, true);
assert.strictEqual(descriptor.runtime.runtimeType, null);
assert.strictEqual(descriptor.runtime.definitionCreation, 'disabled');
assert.strictEqual(descriptor.runtime.referenceResolution, 'existing-code-only');
assert.strictEqual(descriptor.catalog.catalogCode, 'CATALOG-CHINESE-TEA');
assert.strictEqual(descriptor.catalog.categoryCode, null);
assert.strictEqual(descriptor.catalog.categoryResolution, 'select-existing-code');
assert.deepStrictEqual(descriptor.specifications.requiredKeys, []);
assert.deepStrictEqual(descriptor.specifications.defaults, []);
assert.strictEqual(descriptor.specifications.unknownDefinition, 'error');
assert.strictEqual(descriptor.specifications.sectionActivation, 'only-when-selected-fields-have-values');
assert.strictEqual(descriptor.productAttributes.definitions.length, 1);
assert.strictEqual(descriptor.productAttributes.definitions[0].code, null);
assert.strictEqual(descriptor.productAttributes.options.length, 1);
assert.strictEqual(descriptor.productAttributes.options[0].code, null);
assert.strictEqual(descriptor.productAttributes.allowDefinitionCreation, false);
assert.strictEqual(descriptor.variants.axes.length, 1);
assert.strictEqual(descriptor.variants.axes[0].attributeSlot, 'variant-axis');
assert.strictEqual(descriptor.variants.generateCombinations, false);
assert.strictEqual(descriptor.variants.generateSellables, false);
assert.strictEqual(descriptor.apply.applyAllowed, false);
assert.deepStrictEqual(descriptor.apply.idempotencyKey, ['source.system', 'source.externalId']);

const profileGroups = new Set(profile.groups.map((group) => group.key));
const profileAttrs = new Map(profile.attributes.map((attribute) => [attribute.key, attribute]));
const explicit = new Map(descriptor.specifications.explicitAttributes.map((attribute) => [attribute.key, attribute]));
assert.strictEqual(explicit.size, profile.attributes.length);
for (const attribute of profile.attributes) {
    const configured = explicit.get(attribute.key);
    assert(configured, `missing template attribute ${attribute.key}`);
    assert.strictEqual(configured.attributeCode, attribute.targetCode);
    assert.strictEqual(configured.type, attribute.type);
    assert.strictEqual(configured.required, false);
    assert.strictEqual(configured.default, null);
    assert(profileGroups.has(configured.group));
}
assert.strictEqual(descriptor.specifications.dynamicAttributes.length, profile.attributePatterns.length);
for (const pattern of descriptor.specifications.dynamicAttributes) {
    assert.strictEqual(pattern.required, false);
    assert.strictEqual(pattern.default, null);
}

const safeProductFields = new Map(descriptor.productFields.map((field) => [field.path, field]));
assert.strictEqual(safeProductFields.get('product.published').default, false);
assert.strictEqual(safeProductFields.get('product.order').default, 0);
for (const forbidden of ['product.price', 'product.oldPrice', 'product.brand', 'product.manufacturer']) {
    if (safeProductFields.has(forbidden)) assert.strictEqual(safeProductFields.get(forbidden).default, null);
}
assert.strictEqual(descriptor.packages.defaultCode, null);

function patternMatches(pattern, key) {
    return new RegExp(pattern).test(key);
}
function knownDefinition(key) {
    if (profileAttrs.has(key)) return profileAttrs.get(key);
    return profile.attributePatterns.find((pattern) => pattern.keyPattern && patternMatches(pattern.keyPattern, key));
}
function validateExample(envelope) {
    assert.strictEqual(envelope.profile.id, 'tea');
    assert.strictEqual(envelope.profile.version, '1.0.0');
    assert.strictEqual(envelope.records.length, 1);
    const record = envelope.records[0];
    assert(record.source.system && record.source.externalId && record.source.revision);
    assert(/^TEA-[A-Z0-9-]+$/.test(record.product.code));
    assert.strictEqual(record.product.published, false);
    const keys = new Set();
    for (const specification of record.specifications) {
        assert(!keys.has(specification.key), `duplicate example key ${specification.key}`);
        keys.add(specification.key);
        const definition = knownDefinition(specification.key);
        assert(definition, `unknown example key ${specification.key}`);
        assert.strictEqual(specification.group, definition.group || specification.group);
        if (definition.type) assert.strictEqual(specification.type, definition.type);
        if (specification.type === 'Option') assert(specification.option);
        if (specification.type === 'Range') assert(Number.isFinite(specification.valueMin) && Number.isFinite(specification.valueMax));
        if (['Number', 'Duration'].includes(specification.type)) assert(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(specification.value));
        if (specification.type === 'Boolean') assert(/^(true|false)$/.test(specification.value));
    }
}
examples.forEach(validateExample);

const yueyang = examples[0].records[0];
assert.strictEqual(yueyang.product.code, 'TEA-CN-YUEYANG-HUANGCHA');
assert.strictEqual(yueyang.source.url, 'https://tea.community/ru-RU/products/yueyang-huangcha');
assert.deepStrictEqual(yueyang.product.origins[0], {country: 'CN', state: 'Hunan', city: 'Yueyang'});
assert(!yueyang.product.manufacturer);
assert(!yueyang.product.year);
const yueyangSpecs = new Map(yueyang.specifications.map((specification) => [specification.key, specification]));
assert.strictEqual(yueyangSpecs.get('recipe.gongfu_water_temp').value, '78');
assert.strictEqual(yueyangSpecs.get('recipe.gongfu_max_steeps').value, '4');
assert.strictEqual(yueyangSpecs.get('recipe.western_water_temp').value, '72');
assert.strictEqual(yueyangSpecs.get('recipe.western_steep_sec').value, '180');
assert(yueyangSpecs.get('brewing.source_recipe_note').value.includes('80–85'));
assert.deepStrictEqual(JSON.parse(yueyangSpecs.get('harvest.main_months').value), ['March', 'April']);
assert.deepStrictEqual(JSON.parse(yueyangSpecs.get('harvest.peak_months').value), ['April']);
assert.strictEqual(yueyangSpecs.get('classification_origin.tea_type').option, 'SPEC-TT-OPT-CLASSIFICATION-ORIGIN-TEA-TYPE-YELLOW');

const xihu = examples[1].records[0];
assert.notStrictEqual(xihu.product.code, yueyang.product.code);
assert.notStrictEqual(xihu.specifications.find((specification) => specification.key === 'classification_origin.tea_type').option, yueyangSpecs.get('classification_origin.tea_type').option);
assert.deepStrictEqual(descriptor.examples.map((example) => example.code).sort(), [xihu.product.code, yueyang.product.code].sort());

console.log('test-product-creation-template: OK');
