#!/usr/bin/env node
const assert = require('assert');
const {
    assertTableName,
    quoteIdentifier,
} = require('./export-d1-content');

assert.strictEqual(assertTableName('tea_field'), 'tea_field');
assert.strictEqual(assertTableName('term_i18n'), 'term_i18n');
assert.strictEqual(quoteIdentifier('tea_field'), '"tea_field"');

for (const value of ['', '_cf_KV; DROP TABLE tea', 'tea-field', 'tea field', '"tea"']) {
    assert.throws(() => assertTableName(value), /Unsafe D1 table name/);
}

console.log('test-export-d1-content: OK');
