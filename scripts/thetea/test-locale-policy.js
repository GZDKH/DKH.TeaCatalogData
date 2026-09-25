#!/usr/bin/env node
const assert = require('assert');
const {
    DEFAULT_POLICY,
    buildLocaleCoverage,
    policyHash,
    resolveLocalePolicy,
    resolveSourceLocale,
    roundTripLocalizedPayload,
} = require('./lib/locale-policy');

assert.strictEqual(DEFAULT_POLICY.sourceCount, 72);
assert.strictEqual(DEFAULT_POLICY.rows.length, 72);
assert.strictEqual(new Set(DEFAULT_POLICY.rows.map(row => row.sourceBcp47)).size, 72);
assert.strictEqual(policyHash(DEFAULT_POLICY).length, 64);

const destinationRegistry = [...new Set(DEFAULT_POLICY.rows.flatMap(row => row.candidateTargetLocales))];
const resolved = resolveLocalePolicy({ destinationRegistry });
assert.strictEqual(resolved.sourceLocales.length, 72);
assert(resolved.targetLocales.includes('en-US'));
assert(resolved.targetLocales.includes('en-GB'));
assert(resolved.targetLocales.includes('de-DE'));
assert(resolved.targetLocales.includes('de-AT'));
assert(resolved.targetLocales.includes('de-CH'));
assert(resolved.targetLocales.includes('zh-CN'));
assert(resolved.targetLocales.includes('zh-HK'));
assert(resolved.targetLocales.includes('zh-TW'));
assert(resolved.resolutions.find(item => item.sourceLocale === 'tl').status === 'review');
assert(resolved.resolutions.find(item => item.sourceLocale === 'ar').direction === 'rtl');
assert(resolved.resolutions.find(item => item.sourceLocale === 'en').targetLocales.length === 4);
assert(resolved.resolutions.find(item => item.sourceLocale === 'de').targetLocales.length === 3);
assert.strictEqual(resolved.fallbackSemantics.inheritedLanguageIsNotNative, true);

const unknown = resolveSourceLocale('xx', { destinationRegistry });
assert.strictEqual(unknown.status, 'review');
assert.match(unknown.reason, /absent/);
const missingDestination = resolveSourceLocale('fr', { destinationRegistry: ['en-US'] });
assert.strictEqual(missingDestination.status, 'review');
assert.strictEqual(missingDestination.targetLocales.length, 0);

const coverage = buildLocaleCoverage({
    localePolicy: resolveLocalePolicy({ sourceLocales: ['en', 'zh-CN', 'zh-HK'], destinationRegistry }),
    sourceRecords: [
        { locale: 'en', fields: { name: 'English', seoTitle: 'Tea' } },
        { locale: 'zh-CN', fields: { name: '简体', seoTitle: '茶' } },
        { locale: 'zh-HK', fields: { name: '繁體', seoTitle: '茶' } },
    ],
    fields: ['name', 'seoTitle'],
});
assert(coverage.rows.some(row => row.targetLocale === 'en-US' && row.status === 'native'));
assert(coverage.rows.some(row => row.targetLocale === 'en-GB' && row.status === 'inherited-language'));
assert(coverage.rows.some(row => row.targetLocale === 'zh-HK' && row.status === 'native'));
assert(!coverage.rows.some(row => row.targetLocale === 'zh-HK' && row.status === 'inherited-language'));

const payload = {
    translations: [{ lang: 'en', name: 'Tea' }, { lang: 'zh-HK', name: '茶' }],
    specifications: [{ attribute: 'SPEC-TEA-OXIDATION', type: 'Range', value: '10..20' }],
};
const roundTripped = roundTripLocalizedPayload(payload, resolved);
assert.strictEqual(roundTripped.translations.find(item => item.name === 'Tea').lang, 'en-US');
assert.strictEqual(roundTripped.translations.find(item => item.name === '茶').lang, 'zh-HK');
assert.deepStrictEqual(roundTripped.specifications, payload.specifications);
assert.deepStrictEqual(payload.translations[0], { lang: 'en', name: 'Tea' });

console.log('test-locale-policy: OK');
