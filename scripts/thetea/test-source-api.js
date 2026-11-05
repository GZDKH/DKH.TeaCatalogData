#!/usr/bin/env node
const assert = require('assert');
const { sourceHeaders } = require('./lib/source-api');
const { buildEntityInventory } = require('./lib/source-entities');
const { referenceCoverage, assertCurrentSourceReferences } = require('./lib/source-reference-coverage');
const key = 'fixture-key';
assert.deepStrictEqual(sourceHeaders('https://api.thetea.app/api/v2/meta', key), { Authorization: `Bearer ${key}` });
for (const url of ['https://tea.support/skill/SKILL.md', 'http://api.thetea.app/api/v2/meta', 'https://api.thetea.app.evil.test/', 'https://evil.test/?api.thetea.app']) {
    assert.deepStrictEqual(sourceHeaders(url, key), {});
}
assert.throws(() => sourceHeaders('https://user@api.thetea.app/', key), /credentials/);
const inventory = buildEntityInventory({ teas: [{ slug: 'tea-one' }], categories: [{ slug: 'tea-class' }] });
assert.strictEqual(inventory.entities.find(item => item.slug === 'tea-class').entityKind, 'category');
assert.strictEqual(inventory.entities.filter(item => item.entityKind === 'tea').length, 1);
const cached = { count: 200, places: Array.from({ length: 200 }, (_, index) => ({ id: index })) };
assert.strictEqual(referenceCoverage('places', 'en', 200, cached, 'places').possiblyTruncated, true);
assert.throws(() => assertCurrentSourceReferences({ langs: ['en'], referenceCoverage: [] }), /complete source references/);
assert.throws(() => assertCurrentSourceReferences({ langs: ['en'], referenceCoverage: [referenceCoverage('places', 'en', 200, cached, 'places')] }), /capped reference/);
assert.doesNotThrow(() => assertCurrentSourceReferences({ langs: ['en'], referenceCoverage: [
    referenceCoverage('places', 'en', 200, { places: [] }, 'places'),
    referenceCoverage('glossary', 'en', 500, { terms: [] }, 'terms'),
] }));
assert.doesNotThrow(() => assertCurrentSourceReferences({ fieldSource: 'cloudflare-d1-packs', d1Files: ['raw/d1/manifest.json'], fieldPackFiles: ['raw/d1/field-packs/tea.json.gz'] }));
console.log('test-source-api: OK');
const { validateCardLanguage } = require('./lib/source-entities');
assert.strictEqual(validateCardLanguage({ lang: 'zh' }, 'zh-CN').ok, true);
assert.strictEqual(validateCardLanguage({ lang: 'en' }, 'zh-CN').ok, false);
assert.strictEqual(validateCardLanguage({ lang: 'zh-TW' }, 'zh-CN').ok, false);
const { mergeRows, assertCounts } = require('./lib/complete-api-references');
const rows = new Map();
mergeRows(rows, [{ id: 1, kind: 'name' }], row => row.id, 'fixture');
mergeRows(rows, [{ id: 1, kind: 'name' }], row => row.id, 'fixture');
assert.throws(() => mergeRows(rows, [{ id: 1, kind: 'toponym' }], row => row.id, 'fixture'), /conflicting/);
assert.throws(() => assertCounts([...rows.values()], [{ key: 'name', count: 2 }], 'kind', 'fixture'), /1\/2/);
assert.doesNotThrow(() => assertCounts([...rows.values()], [{ key: 'name', count: 1 }], 'kind', 'fixture'));
