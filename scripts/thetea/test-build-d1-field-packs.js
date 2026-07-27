#!/usr/bin/env node
const assert = require('assert');
const {
    bucketForSlug,
    parseFieldRow,
} = require('./build-d1-field-packs');

assert.strictEqual(bucketForSlug('xihu-longjing', 64), bucketForSlug('xihu-longjing', 64));
assert.ok(bucketForSlug('xihu-longjing', 64) >= 0);
assert.ok(bucketForSlug('xihu-longjing', 64) < 64);

const parsed = parseFieldRow(JSON.stringify({
    slug: 'xihu-longjing',
    lang: 'en',
    section_code: 'terroir',
    field_code: 'soil',
    ord: 0,
    value_md: 'Sandy loam',
}), 1);
assert.strictEqual(parsed.slug, 'xihu-longjing');
assert.strictEqual(parsed.lang, 'en');
assert.strictEqual(parsed.section, 'terroir');
assert.strictEqual(parsed.field, 'soil');

assert.throws(() => parseFieldRow('{', 2), /Invalid tea_field NDJSON at line 2/);
assert.throws(() => parseFieldRow(JSON.stringify({
    slug: '../escape',
    lang: 'en',
    section_code: 'terroir',
    field_code: 'soil',
}), 3), /Invalid tea_field identity at line 3/);

console.log('test-build-d1-field-packs: OK');
