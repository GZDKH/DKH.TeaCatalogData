#!/usr/bin/env node
const assert = require('assert');
const {
    buildCatalogBindingCatalog,
    catalogBindingCategoriesForProducts,
    catalogBindingCategoriesFromReference,
    defaultCatalogTranslations,
    mergeCatalogBindingCategories,
    summarizeCatalogPlacement,
} = require('./lib/catalog-bindings');

const categories = [
    {
        code: 'CAT-ROOT',
        order: 0,
        published: true,
        translations: [{ lang: 'en-US', name: 'Tea', seo: 'tea' }],
    },
    {
        code: 'CAT-GREEN-TEA',
        parent: 'CAT-ROOT',
        order: 1,
        published: true,
        translations: [{ lang: 'en-US', name: 'Green Tea', seo: 'green-tea' }],
    },
];

const products = [
    {
        code: 'TEA-GREEN-1',
        order: 10,
        published: true,
        catalogs: [
            { catalog: 'CATALOG-CHINESE-TEA', category: 'CAT-GREEN-TEA', published: true },
            { catalog: 'CATALOG-OTHER', category: 'CAT-ROOT', published: true },
        ],
    },
    {
        code: 'TEA-GREEN-2',
        order: 5,
        published: false,
        catalogs: [
            { catalog: 'CATALOG-CHINESE-TEA', category: 'CAT-GREEN-TEA', published: true },
        ],
    },
];

const REQUIRED_LOCALES = [
    'af',
    'de',
    'en-US',
    'ja',
    'ru-RU',
    'zh-CN',
    'zh-HK',
    'zh-TW',
];
const localizedCatalog = defaultCatalogTranslations(REQUIRED_LOCALES);
assert.strictEqual(localizedCatalog.length, REQUIRED_LOCALES.length);
assert.deepStrictEqual(localizedCatalog.map(item => item.lang), REQUIRED_LOCALES);
assert.strictEqual(localizedCatalog.find(item => item.lang === 'de').name, 'Chinesischer Tee');
assert.strictEqual(localizedCatalog.find(item => item.lang === 'ja').name, '中国茶');
assert.strictEqual(localizedCatalog.find(item => item.lang === 'zh-HK').name, '中國茶');
assert(localizedCatalog.every(item => item.name && item.description && item.seo));
assert.throws(
    () => defaultCatalogTranslations(['en-US', 'xx-TEST']),
    /no maintained translation for required locale xx-Test/);

const catalog = buildCatalogBindingCatalog({
    catalogCode: 'CATALOG-CHINESE-TEA',
    currency: 'CNY',
    translations: [{ lang: 'en-US', name: 'Chinese Tea', seo: 'chinese-tea' }],
    categories,
    products,
});

assert.strictEqual(catalog.code, 'CATALOG-CHINESE-TEA');
assert.strictEqual(catalog.currency, 'CNY');
assert.deepStrictEqual(catalog.translations, [{ lang: 'en-US', name: 'Chinese Tea', seo: 'chinese-tea' }]);
assert.strictEqual(catalog.categories.length, 2);

const root = catalog.categories.find(category => category.category === 'CAT-ROOT');
assert(root);
assert.deepStrictEqual(root.products, []);

const green = catalog.categories.find(category => category.category === 'CAT-GREEN-TEA');
assert(green);
assert.deepStrictEqual(green.products, [
    { product: 'TEA-GREEN-2', order: 5, published: true },
    { product: 'TEA-GREEN-1', order: 10, published: true },
]);

const productionCategories = catalogBindingCategoriesFromReference({
    catalogs: [{
        code: 'CATALOG-CHINESE-TEA',
        categories: [
            { category: 'CAT-ROOT', order: 0, published: true, products: [] },
            { category: { code: 'CAT-GREEN-TEA' }, order: 1, published: true, products: [] },
        ],
    }],
}, 'catalog-chinese-tea');
assert.deepStrictEqual(productionCategories, [
    { code: 'CAT-ROOT', order: 0, published: true },
    { code: 'CAT-GREEN-TEA', order: 1, published: true },
]);
assert.deepStrictEqual(
    mergeCatalogBindingCategories(
        productionCategories,
        [{ code: 'CAT-GREEN-TEA', order: 7, published: false }, { code: 'CAT-NEW' }]),
    [
        { code: 'CAT-ROOT', order: 0, published: true },
        { code: 'CAT-GREEN-TEA', order: 7, published: false },
        { code: 'CAT-NEW' },
    ]);
assert.deepStrictEqual(
    catalogBindingCategoriesForProducts(
        products,
        'CATALOG-CHINESE-TEA',
        [...categories, { code: 'CAT-UNUSED', order: 99, published: true }]),
    [{ code: 'CAT-GREEN-TEA', order: 1, published: true }]);
assert.deepStrictEqual(
    summarizeCatalogPlacement(
        products,
        [catalog],
        'CATALOG-CHINESE-TEA'),
    {
        requiredCatalog: 'CATALOG-CHINESE-TEA',
        productCount: 2,
        bindingCategoryCount: 2,
        bindingAssignmentCount: 2,
        assignedProductCount: 2,
        unassignedProductCount: 0,
    });

console.log('test-catalog-bindings: OK');
