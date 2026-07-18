#!/usr/bin/env node
const assert = require('assert');
const {
    localizeSpecLabel,
    buildLocalizedTranslations,
} = require('./lib/spec-labels');

assert.deepStrictEqual(
    localizeSpecLabel('group', 'classification_origin', 'en', 'Classification and Origin'),
    { name: 'Classification and Origin', source: 'canonical' });
assert.deepStrictEqual(
    localizeSpecLabel('group', 'classification_origin', 'ru', 'Classification and Origin'),
    { name: 'Классификация и происхождение', source: 'curated' });
assert.deepStrictEqual(
    localizeSpecLabel('attribute', 'atomic.processing', 'zh-cn', 'Processing'),
    { name: '加工工艺', source: 'curated' });
assert.deepStrictEqual(
    localizeSpecLabel('option', 'classification_origin.tea_type.green', 'zh_CN', 'Green'),
    { name: '绿茶', source: 'curated' });

// Short aliases resolve to the same curated semantic identity.
assert.deepStrictEqual(
    localizeSpecLabel('field', 'tea_type', 'RU_ru', 'Tea Type'),
    { name: 'Тип чая', source: 'curated' });
assert.deepStrictEqual(
    localizeSpecLabel('value', 'green', 'ru-RU', 'Green'),
    { name: 'Зелёный чай', source: 'curated' });

// Unsupported locales and unknown semantic keys retain the honest English label.
assert.deepStrictEqual(
    localizeSpecLabel('group', 'classification_origin', 'fr-fr', 'Classification and Origin'),
    { name: 'Classification and Origin', source: 'fallback' });
assert.deepStrictEqual(
    localizeSpecLabel('attribute', 'production.unmapped_process', 'ru', 'Traditional drying method'),
    { name: 'Traditional drying method', source: 'fallback' });

const localized = buildLocalizedTranslations({
    kind: 'attribute',
    semanticKey: 'atomic.processing',
    fallbackName: 'Processing',
    locales: ['zh', 'en', 'RU', 'fr-fr', 'zh-CN', 'EN_us', 'ru-RU'],
});

assert.deepStrictEqual(localized, {
    translations: [
        { lang: 'en-US', name: 'Processing' },
        { lang: 'ru-RU', name: 'Обработка' },
        { lang: 'zh-CN', name: '加工工艺' },
        { lang: 'fr-FR', name: 'Processing' },
    ],
    fallbackLocales: ['fr-FR'],
});
assert.strictEqual(
    new Set(localized.translations.map(translation => translation.lang)).size,
    localized.translations.length);

assert.throws(
    () => localizeSpecLabel('group', 'atomic', 'en', '   '),
    /fallbackName must be a non-empty English label/);
assert.throws(
    () => localizeSpecLabel('group', '', 'en', 'Core Tea Facts'),
    /semanticKey must not be empty/);
assert.throws(
    () => localizeSpecLabel('group', 'atomic', '', 'Core Tea Facts'),
    /locale must not be empty/);
assert.throws(
    () => buildLocalizedTranslations({
        kind: 'group',
        semanticKey: 'atomic',
        fallbackName: 'Core facts',
        locales: ['en', 'ru'],
    }),
    /Conflicting English fallback/);
assert.throws(
    () => buildLocalizedTranslations({
        kind: 'group',
        semanticKey: 'atomic',
        fallbackName: 'Core Tea Facts',
        locales: [],
    }),
    /locales must be a non-empty array/);

console.log('test-spec-labels: OK');
