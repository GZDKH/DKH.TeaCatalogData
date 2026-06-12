#!/usr/bin/env node
const assert = require('assert');
const { localesFromMeta, resolveRequestedLocales, toProductLocale } = require('./lib/locales');
const { transformCardSet } = require('./lib/transform');

const meta = {
    locales: [
        { code: 'EN', bcp47: 'en', english_name: 'English' },
        { code: 'RU', bcp47: 'ru', english_name: 'Russian' },
        { code: 'ZH', bcp47: 'zh-CN', english_name: 'Chinese (Simplified)' },
        { code: 'ZH-HK', bcp47: 'zh-HK', english_name: 'Chinese (Hong Kong)' },
        { code: 'NO', bcp47: 'nb', english_name: 'Norwegian Bokmal' },
    ],
};

assert.deepStrictEqual(
    localesFromMeta(meta),
    ['en', 'ru', 'zh-CN', 'zh-HK', 'nb']);

assert.deepStrictEqual(
    resolveRequestedLocales(['all'], meta),
    ['en', 'ru', 'zh-CN', 'zh-HK', 'nb']);

assert.deepStrictEqual(
    resolveRequestedLocales([], meta),
    ['en', 'ru', 'zh-CN', 'zh-HK', 'nb']);

assert.deepStrictEqual(
    resolveRequestedLocales(['en', 'ru'], meta),
    ['en', 'ru']);

assert.strictEqual(toProductLocale('en'), 'en-US');
assert.strictEqual(toProductLocale('ru'), 'ru-RU');
assert.strictEqual(toProductLocale('zh'), 'zh-CN');
assert.strictEqual(toProductLocale('zh-CN'), 'zh-CN');
assert.strictEqual(toProductLocale('zh-HK'), 'zh-HK');
assert.strictEqual(toProductLocale('nb'), 'nb');

const baseCard = {
    slug: 'xihu-longjing',
    lang: 'en',
    name: 'Xi Hu Longjing',
    names: { en: 'Xi Hu Longjing' },
    meta: {
        slug: 'xihu-longjing',
        origin_country: 'CN',
        tea_type: 'green',
        province: 'Zhejiang',
    },
    sections: {
        classification_origin: {
            origin: { value: 'China, Zhejiang.', num: null, unit: null },
        },
    },
};

const { product } = transformCardSet({
    en: { ...baseCard, lang: 'en', name: 'Xi Hu Longjing', markdown: '# Xi Hu Longjing\n\nEnglish page.' },
    ru: { ...baseCard, lang: 'ru', name: 'Си Ху Лун Цзин' },
    'zh-CN': { ...baseCard, lang: 'zh-CN', name: '西湖龙井', markdown: '# 西湖龙井\n\n中文页面。' },
    'zh-HK': { ...baseCard, lang: 'zh-HK', name: '西湖龍井' },
    nb: {
        ...baseCard,
        lang: 'nb',
        name: 'Xi Hu Longjing norsk',
        similarEndpoint: { similar: [{ slug: 'anji-baicha', name: 'Anji Baicha', score: 0.91, reason: 'fresh green tea' }] },
    },
});

assert.deepStrictEqual(
    product.translations.map(t => t.lang).sort(),
    ['en-US', 'nb', 'ru-RU', 'zh-CN', 'zh-HK']);

assert(product.translations.some(t => t.lang === 'zh-HK' && t.name === '西湖龍井'));
assert(product.origins[0].translations.some(t => t.lang === 'zh-HK'));
assert(product.origins[0].translations.some(t => t.lang === 'nb'));
assert(!product.specifications.some(s => s.attribute?.startsWith('SPEC-TT-MARKDOWN-')));
assert(!product.specifications.some(s => s.attribute?.startsWith('SPEC-TT-SIMILAR-')));

console.log('test-locales: OK');
