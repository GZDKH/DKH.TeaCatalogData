#!/usr/bin/env node
const assert = require('assert');
const {
    buildEntityInventory,
    classifySourceEntity,
    normalizeKind,
    validateCardLanguage,
} = require('./lib/source-entities');

assert.strictEqual(normalizeKind('tea'), 'tea');
assert.strictEqual(normalizeKind('topic'), 'category');
assert.strictEqual(normalizeKind('tisane'), 'infusion');
assert.strictEqual(normalizeKind('future-kind'), 'unknown');

assert.deepStrictEqual(
    classifySourceEntity({ article_type: 'infusion' }, 'tea'),
    {
        kind: 'infusion',
        claims: [{ path: 'article_type', value: 'infusion', kind: 'infusion' }],
        evidence: 'source-field',
        conflict: false,
        endpointKind: 'tea',
    });
assert.strictEqual(classifySourceEntity({}, 'teas').kind, 'tea');
assert.strictEqual(classifySourceEntity({ kind: 'tea', article_type: 'infusion' }, 'tea').kind, 'unknown');
assert.strictEqual(classifySourceEntity({ kind: 'tea', article_type: 'infusion' }, 'tea').conflict, true);

const inventory = buildEntityInventory({
    teas: [{ slug: 'green-tea', kind: 'tea' }, { slug: 'landing', article_type: 'category' }],
    infusions: [{ slug: 'buckwheat', article_type: 'infusion' }],
});
assert.deepStrictEqual(inventory.entities.map(item => `${item.entityKind}:${item.slug}`), [
    'category:landing',
    'infusion:buckwheat',
    'tea:green-tea',
]);
assert.strictEqual(inventory.duplicates.length, 0);

const conflictingInventory = buildEntityInventory({
    teas: [{ slug: 'shared', kind: 'tea' }],
    infusions: [{ slug: 'shared', article_type: 'infusion' }],
});
assert.deepStrictEqual(conflictingInventory.kindConflicts, [{ slug: 'shared', kinds: ['infusion', 'tea'] }]);
assert(conflictingInventory.entities.every(item => item.classificationConflict));

assert.deepStrictEqual(validateCardLanguage({ lang: 'ru' }, 'ru'), { ok: true, requested: 'ru', actual: 'ru' });
assert.deepStrictEqual(validateCardLanguage({ lang: 'en' }, 'ru'), { ok: false, requested: 'ru', actual: 'en' });
assert.deepStrictEqual(validateCardLanguage({}, 'ru'), { ok: true, requested: 'ru', actual: null });

console.log('test-source-entities: OK');
