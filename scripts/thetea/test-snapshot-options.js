#!/usr/bin/env node
const assert = require('assert');
const { assertCompleteFieldLocales, resolveFieldLocales, shouldFetchFieldsForLang } = require('./lib/snapshot-options');

assert.strictEqual(resolveFieldLocales([], ['en', 'ru']), null);
assert.strictEqual(resolveFieldLocales(['all'], ['en', 'ru']), null);
assert.deepStrictEqual(resolveFieldLocales(['en'], ['en', 'ru']), ['en']);
assert.deepStrictEqual(resolveFieldLocales(['EN', 'ru'], ['en', 'ru']), ['en', 'ru']);

assert.strictEqual(shouldFetchFieldsForLang('en', null), true);
assert.strictEqual(shouldFetchFieldsForLang('ru', ['en']), false);
assert.strictEqual(shouldFetchFieldsForLang('en', ['en']), true);

assert.doesNotThrow(() => assertCompleteFieldLocales({
    langs: ['en', 'ru'],
    fieldLangs: null,
}));

assert.throws(
    () => assertCompleteFieldLocales({
        langs: ['en', 'ru'],
        fieldLangs: ['en'],
    }),
    /missing per-field endpoint details for locales: ru/);

console.log('test-snapshot-options: OK');
