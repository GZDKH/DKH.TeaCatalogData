#!/usr/bin/env node
const assert = require('assert');
const { analyzeCatalogMapping, flattenCategories } = require('./lib/catalog-mapping');

const refs = {
    catalogs: [
        {
            code: 'CATALOG-CHINESE-TEA',
            published: true,
            translations: [{ languageCode: 'en-US', name: 'Chinese Tea' }],
        },
    ],
    categories: [
        {
            code: 'CAT-ROOT',
            published: true,
            translations: [{ languageCode: 'en-US', name: 'Tea Catalog' }],
            children: [
                {
                    code: 'CAT-GREEN-TEA',
                    published: true,
                    translations: [{ languageCode: 'en-US', name: 'Green Tea' }],
                    children: [],
                },
            ],
        },
        {
            code: 'CAT-REGION-ZHEJIANG',
            published: true,
            translations: [{ languageCode: 'en-US', name: 'Zhejiang' }],
            children: [],
        },
    ],
};

const product = {
    code: 'TEA-CN-XIHU-LONGJING',
    catalogs: [
        { catalog: 'CATALOG-CHINESE-TEA', category: 'CAT-GREEN-TEA' },
        { catalog: 'CATALOG-CHINESE-TEA', category: 'CAT-REGION-ZHEJIANG' },
    ],
};

assert.deepStrictEqual(
    flattenCategories(refs.categories).map(x => x.code).sort(),
    ['CAT-GREEN-TEA', 'CAT-REGION-ZHEJIANG', 'CAT-ROOT']);

const ok = analyzeCatalogMapping([product], refs, { requiredCatalogCode: 'CATALOG-CHINESE-TEA' });
assert.strictEqual(ok.valid, true);
assert.strictEqual(ok.catalog.found, true);
assert.strictEqual(ok.missingCategories.length, 0);
assert.strictEqual(ok.categoryUsage.find(x => x.code === 'CAT-GREEN-TEA').productCount, 1);
assert.strictEqual(ok.categoryUsage.find(x => x.code === 'CAT-REGION-ZHEJIANG').published, true);

const missing = analyzeCatalogMapping([{
    code: 'TEA-CN-MISSING',
    catalogs: [{ catalog: 'CATALOG-CHINESE-TEA', category: 'CAT-REGION-YUNNAN' }],
}], refs, { requiredCatalogCode: 'CATALOG-CHINESE-TEA' });
assert.strictEqual(missing.valid, false);
assert.deepStrictEqual(missing.missingCategories, ['CAT-REGION-YUNNAN']);
assert(missing.errors.some(x => x.includes('CAT-REGION-YUNNAN')));

const missingCatalog = analyzeCatalogMapping([product], { catalogs: [], categories: refs.categories }, {
    requiredCatalogCode: 'CATALOG-CHINESE-TEA',
});
assert.strictEqual(missingCatalog.valid, false);
assert.strictEqual(missingCatalog.catalog.found, false);
assert(missingCatalog.errors.some(x => x.includes('CATALOG-CHINESE-TEA')));

console.log('test-catalog-mapping: OK');
