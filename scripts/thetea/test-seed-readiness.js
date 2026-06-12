#!/usr/bin/env node
const assert = require('assert');
const { analyzeSeedReadiness } = require('./lib/seed-readiness');

const catalogReference = {
    catalogs: [
        {
            code: 'CATALOG-CHINESE-TEA',
            published: true,
            translations: [{ languageCode: 'en-US', name: 'Chinese Tea' }],
        },
    ],
    categories: [
        {
            code: 'CAT-GREEN-TEA',
            published: true,
            translations: [{ languageCode: 'en-US', name: 'Green Tea' }],
            children: [],
        },
    ],
};

const readyProduct = {
    code: 'TEA-CN-XIHU-LONGJING',
    sku: 'XIHU-LONGJING-CN',
    published: true,
    translations: [
        { lang: 'en-US', name: 'Xi Hu Long Jing' },
        { lang: 'ru-RU', name: 'Си Ху Лун Цзин' },
        { lang: 'zh-CN', name: '西湖龙井' },
    ],
    catalogs: [
        {
            catalog: 'CATALOG-CHINESE-TEA',
            category: 'CAT-GREEN-TEA',
            published: true,
        },
    ],
};

const ready = analyzeSeedReadiness([readyProduct], {
    catalogReference,
    requiredCatalogCode: 'CATALOG-CHINESE-TEA',
    requiredLocales: ['en-US', 'ru-RU', 'zh-CN'],
    minProducts: 1,
    minCategories: 1,
});

assert.strictEqual(ready.ready, true);
assert.strictEqual(ready.productCount, 1);
assert.strictEqual(ready.publishedProductCount, 1);
assert.strictEqual(ready.localeCoverage['ru-RU'], 1);
assert.strictEqual(ready.catalog.found, true);
assert.strictEqual(ready.categoryCount, 1);

const missingLocale = analyzeSeedReadiness([
    {
        ...readyProduct,
        translations: readyProduct.translations.filter(t => t.lang !== 'zh-CN'),
    },
], {
    catalogReference,
    requiredCatalogCode: 'CATALOG-CHINESE-TEA',
    requiredLocales: ['en-US', 'ru-RU', 'zh-CN'],
});

assert.strictEqual(missingLocale.ready, false);
assert(missingLocale.errors.some(error => error.includes('zh-CN')));

const unpublishedCatalog = analyzeSeedReadiness([readyProduct], {
    catalogReference: {
        ...catalogReference,
        catalogs: [{ ...catalogReference.catalogs[0], published: false }],
    },
    requiredCatalogCode: 'CATALOG-CHINESE-TEA',
    requiredLocales: ['en-US'],
});

assert.strictEqual(unpublishedCatalog.ready, false);
assert(unpublishedCatalog.errors.some(error => error.includes('not published')));

console.log('test-seed-readiness: OK');
