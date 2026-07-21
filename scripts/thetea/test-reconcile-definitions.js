#!/usr/bin/env node
const assert = require('assert');
const {
    buildDefinitionReconciliation,
    canonicalDefinition,
} = require('./reconcile-definitions');

const desired = {
    groups: [
        { code: 'SPEC-TT-GROUP-A', order: 1, translations: [{ lang: 'ru-RU', name: 'A' }, { lang: 'en-US', name: 'A' }] },
    ],
    attributes: [
        { code: 'SPEC-TT-ATTR-A', group: 'SPEC-TT-GROUP-A', type: 'Number' },
    ],
    options: [],
};
const current = {
    specificationGroups: [
        { id: 'ignored', code: 'SPEC-TT-GROUP-A', order: 1, translations: [{ lang: 'en-US', name: 'A' }, { lang: 'ru-RU', name: 'A' }] },
        { code: 'SPEC-TT-GROUP-OLD' },
        { code: 'UNMANAGED-GROUP' },
    ],
    specificationAttributes: [
        { code: 'SPEC-TT-ATTR-A', group: { code: 'SPEC-TT-GROUP-A' }, type: 'Option' },
        { code: 'SPEC-TT-ATTR-OLD', group: 'SPEC-TT-GROUP-OLD', type: 'CustomText' },
    ],
    specificationAttributeOptions: [
        { code: 'SPEC-TT-OPT-OLD', attribute: 'SPEC-TT-ATTR-OLD' },
    ],
};
const products = [{
    code: 'TEA-A',
    specifications: [{
        group: 'SPEC-TT-GROUP-OLD',
        attribute: 'SPEC-TT-ATTR-OLD',
        option: 'SPEC-TT-OPT-OLD',
    }],
}];

const result = buildDefinitionReconciliation(desired, current, products, ['TEA-A']);
assert.strictEqual(result.eligible, true);
assert.deepStrictEqual(result.kinds.groups.counts, { create: 0, update: 0, noop: 1, delete: 1, conflict: 0 });
assert.deepStrictEqual(result.kinds.attributes.counts, { create: 0, update: 1, noop: 0, delete: 1, conflict: 0 });
assert.deepStrictEqual(result.kinds.options.counts, { create: 0, update: 0, noop: 0, delete: 1, conflict: 0 });
assert.deepStrictEqual(result.delete.attributes, ['SPEC-TT-ATTR-OLD']);
assert(result.rollbackUpsert.attributes.some(item => item.code === 'SPEC-TT-ATTR-A'));
assert(result.rollbackUpsert.attributes.some(item => item.code === 'SPEC-TT-ATTR-OLD'));
assert.strictEqual(result.upsert.attributes[0].type, 'Number');

const conflict = buildDefinitionReconciliation(desired, current, [
    ...products,
    { code: 'OTHER-PRODUCT', specifications: [{ attribute: 'SPEC-TT-ATTR-OLD' }] },
], ['TEA-A']);
assert.strictEqual(conflict.eligible, false);
assert(conflict.conflicts.some(item => item.code === 'SPEC-TT-ATTR-OLD'));
assert(conflict.conflicts.some(item =>
    item.code === 'SPEC-TT-GROUP-OLD'
    && item.reason.includes('SPEC-TT-ATTR-OLD')));

const movedAttribute = buildDefinitionReconciliation(desired, {
    ...current,
    specificationGroups: [
        ...current.specificationGroups,
        { code: 'SPEC-TT-GROUP-OLDER' },
    ],
    specificationAttributes: [
        { code: 'SPEC-TT-ATTR-A', group: 'SPEC-TT-GROUP-OLDER', type: 'Number' },
    ],
    specificationAttributeOptions: [],
}, [], ['TEA-A']);
assert.strictEqual(movedAttribute.eligible, true);
assert(movedAttribute.delete.groups.includes('SPEC-TT-GROUP-OLDER'));

assert.deepStrictEqual(
    canonicalDefinition('attributes', { id: 'x', code: 'spec-tt-a', group: { code: 'spec-tt-g' }, unit: { code: 'g' } }),
    { code: 'SPEC-TT-A', group: 'SPEC-TT-G', unit: 'G' });

console.log('test-reconcile-definitions: OK');
