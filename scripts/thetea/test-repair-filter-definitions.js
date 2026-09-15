#!/usr/bin/env node
const assert = require('assert');
const {
    assertLiveReferenceUnchanged,
    buildRepairPlan,
    isRawLabel,
    mergeTranslations,
    verifyApplied,
} = require('./repair-filter-definitions');

const desired = {
    attributes: [
        {
            code: 'SPEC-TT-TEA-TYPE',
            group: 'SPEC-TT-GROUP-CLASSIFICATION-ORIGIN',
            type: 'Option',
            filterable: true,
            translations: [
                { lang: 'en-US', name: 'Tea Type' },
                { lang: 'ru-RU', name: 'Тип чая' },
            ],
        },
        {
            code: 'SPEC-TT-RECIPE-RINSE',
            group: 'SPEC-TT-GROUP-RECIPE',
            type: 'Boolean',
            filterable: false,
            translations: [{ lang: 'en-US', name: 'Rinse Required' }],
        },
    ],
};
const current = {
    specificationAttributes: [
        {
            id: 'stable-id',
            code: 'SPEC-TT-TEA-TYPE',
            group: { code: 'SPEC-TT-GROUP-CLASSIFICATION-ORIGIN' },
            type: 'Option',
            order: 9,
            published: false,
            filterable: false,
            translations: [{ lang: 'en-US', name: 'Tea Type' }],
        },
        {
            id: 'recipe-id',
            code: 'SPEC-TT-RECIPE-RINSE',
            group: 'SPEC-TT-GROUP-RECIPE',
            type: 'Boolean',
            order: 4,
            published: true,
            filterable: true,
            translations: [{ lang: 'en-US', name: 'SPEC-TT-RECIPE-RINSE' }],
        },
        { id: 'custom', code: 'CUSTOM-ATTR', filterable: true, translations: [{ lang: 'en-US', name: 'Custom' }] },
    ],
};

assert.strictEqual(isRawLabel('SPEC-TT-TEA-TYPE', 'SPEC-TT-TEA-TYPE'), true);
assert.strictEqual(isRawLabel('Custom name', 'SPEC-TT-TEA-TYPE'), false);
const merged = mergeTranslations([{ lang: 'en-US', name: 'SPEC-TT-TEA-TYPE' }], desired.attributes[0].translations, 'SPEC-TT-TEA-TYPE');
assert.deepStrictEqual(merged.translations, [
    { lang: 'en-US', name: 'Tea Type' },
    { lang: 'ru-RU', name: 'Тип чая' },
]);

const plan = buildRepairPlan(desired, current);
assert.strictEqual(plan.eligible, true);
assert.deepStrictEqual(plan.counts, { update: 2, noop: 0, conflict: 0 });
const teaUpdate = plan.updates.find(item => item.code === 'SPEC-TT-TEA-TYPE');
const rinseUpdate = plan.updates.find(item => item.code === 'SPEC-TT-RECIPE-RINSE');
const teaOperation = plan.operations.find(item => item.code === 'SPEC-TT-TEA-TYPE');
assert.deepStrictEqual(teaOperation.changedFields, ['filterable', 'translations']);
assert.strictEqual(teaUpdate.id, 'stable-id');
assert.strictEqual(teaUpdate.order, 9);
assert.strictEqual(teaUpdate.published, false);
assert.strictEqual(rinseUpdate.filterable, false);
assert.strictEqual(plan.rollback.find(item => item.code === 'SPEC-TT-TEA-TYPE').filterable, false);
assert.strictEqual(plan.rollback.find(item => item.code === 'SPEC-TT-RECIPE-RINSE').filterable, true);

const noop = buildRepairPlan({ attributes: plan.updates }, { specificationAttributes: plan.updates });
assert.deepStrictEqual(noop.counts, { update: 0, noop: 2, conflict: 0 });
assert.deepStrictEqual(noop.updates, []);

const conflict = buildRepairPlan(desired, {
    specificationAttributes: current.specificationAttributes.filter(item => item.code !== 'SPEC-TT-TEA-TYPE'),
});
assert.strictEqual(conflict.eligible, false);
assert.strictEqual(conflict.counts.conflict, 1);
const immutableConflict = buildRepairPlan(desired, {
    specificationAttributes: current.specificationAttributes.map(item =>
        item.code === 'SPEC-TT-TEA-TYPE' ? { ...item, type: 'Number' } : item),
});
assert.strictEqual(immutableConflict.eligible, false);
assert.strictEqual(immutableConflict.counts.conflict, 1);

assert.doesNotThrow(() => assertLiveReferenceUnchanged(plan, current.specificationAttributes, current));
assert.throws(() => assertLiveReferenceUnchanged(
    plan,
    current.specificationAttributes.map(item => item.code === 'SPEC-TT-TEA-TYPE'
        ? { ...item, order: 10 }
        : item),
    current), /differs/);
assert.doesNotThrow(() => verifyApplied(plan, plan.updates));
assert.throws(() => verifyApplied(plan, plan.updates.map(item =>
    item.code === 'SPEC-TT-TEA-TYPE' ? { ...item, filterable: false } : item)), /filterable/);

console.log('test-repair-filter-definitions: OK');
