#!/usr/bin/env node
const assert = require('assert');
const { buildCatalogBindingCatalog } = require('./lib/catalog-bindings');

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

console.log('test-catalog-bindings: OK');
