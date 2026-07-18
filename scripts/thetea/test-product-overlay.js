#!/usr/bin/env node
const assert = require('assert');
const {
    overlayExistingProduct,
    validateBaselinePreservation,
} = require('./lib/product-overlay');

const baseline = {
    code: 'TEA-CN-ONE',
    sku: 'MANUAL-SKU',
    published: true,
    price: 123,
    translations: [
        { lang: 'en-US', name: 'Old name' },
        { lang: 'fr-FR', name: 'Nom manuel' },
    ],
    tags: [{ code: 'TAG-MANUAL', name: 'Manual', lang: 'en-US' }],
    specifications: [
        { group: 'SPEC-GROUP-MANUAL', attribute: 'SPEC-MANUAL', type: 'CustomText', value: 'keep' },
        { group: 'SPEC-TT-GROUP-OLD', attribute: 'SPEC-TT-OLD', type: 'CustomText', value: 'replace' },
    ],
    catalogs: [{ catalog: 'CATALOG-OTHER', category: 'CAT-MANUAL', published: true }],
    packages: [{ package: 'PKG-100G', default: true }],
    tierPrices: [{ quantity: 10, price: 100 }],
    catalogPrices: [{ catalog: 'CATALOG-OTHER', price: 110 }],
    storePriceOverrides: [{ store: 'STORE-ONE', price: 115 }],
    related: [{ product: 'TEA-CN-MANUAL', catalog: 'CATALOG-OTHER', order: 7 }],
    crossSells: [{ product: 'TEA-CN-CROSS', catalog: 'CATALOG-OTHER' }],
};

const generated = {
    code: 'TEA-CN-ONE',
    sku: 'GENERATED-SKU',
    published: false,
    nativeName: '新茶',
    translations: [{ lang: 'en-US', name: 'Fresh name' }],
    tags: [{ code: 'TAG-TT-FRESH', name: 'Fresh', lang: 'en-US' }],
    specifications: [{
        group: 'SPEC-TT-GROUP-NEW',
        attribute: 'SPEC-TT-NEW',
        type: 'List',
        value: '["a","b"]',
    }],
    catalogs: [{ catalog: 'CATALOG-CHINESE-TEA', category: 'CAT-GREEN', published: true }],
    packages: [{ package: 'PKG-50G', default: true }],
    origins: [{ country: 'CN' }],
    related: [{ product: 'TEA-CN-SIMILAR', catalog: 'CATALOG-CHINESE-TEA', order: 1 }],
    crossSells: [],
};

const overlaid = overlayExistingProduct(generated, baseline);
assert.strictEqual(overlaid.sku, 'MANUAL-SKU');
assert.strictEqual(overlaid.published, true);
assert.strictEqual(overlaid.price, 123);
assert.strictEqual(overlaid.nativeName, '新茶');
assert.strictEqual(overlaid.translations.find(item => item.lang === 'en-US').name, 'Fresh name');
assert(overlaid.translations.some(item => item.lang === 'fr-FR'));
assert(overlaid.tags.some(item => item.code === 'TAG-MANUAL'));
assert(overlaid.tags.some(item => item.code === 'TAG-TT-FRESH'));
assert(overlaid.specifications.some(item => item.attribute === 'SPEC-MANUAL'));
assert(overlaid.specifications.some(item => item.attribute === 'SPEC-TT-NEW'));
assert(!overlaid.specifications.some(item => item.attribute === 'SPEC-TT-OLD'));
assert(overlaid.catalogs.some(item => item.category === 'CAT-MANUAL'));
assert.deepStrictEqual(overlaid.packages, baseline.packages);
assert.deepStrictEqual(overlaid.crossSells, baseline.crossSells);
assert.strictEqual(overlaid.related[0].product, 'TEA-CN-MANUAL');
assert.strictEqual(overlaid.related[0].order, 7);
assert.strictEqual(overlaid.related.find(item => item.product === 'TEA-CN-SIMILAR').order, 8);
assert.deepStrictEqual(validateBaselinePreservation([overlaid], [baseline]), []);

const unsafe = JSON.parse(JSON.stringify(overlaid));
unsafe.crossSells = [];
unsafe.catalogs = unsafe.catalogs.filter(item => item.category !== 'CAT-MANUAL');
unsafe.specifications = unsafe.specifications.filter(item => item.attribute !== 'SPEC-MANUAL');
const preservationErrors = validateBaselinePreservation([unsafe], [baseline]);
assert(preservationErrors.some(error => error.includes('crossSells')));
assert(preservationErrors.some(error => error.includes('catalogs')));
assert(preservationErrors.some(error => error.includes('SPEC-MANUAL')));

const changedManualSpec = JSON.parse(JSON.stringify(overlaid));
changedManualSpec.specifications.find(item => item.attribute === 'SPEC-MANUAL').value = 'changed';
assert(validateBaselinePreservation([changedManualSpec], [baseline])
    .some(error => error.includes('SPEC-MANUAL') && error.includes('changed')));

const reorderedManualRelation = JSON.parse(JSON.stringify(overlaid));
reorderedManualRelation.related.find(item => item.product === 'TEA-CN-MANUAL').order = 1;
assert(validateBaselinePreservation([reorderedManualRelation], [baseline])
    .some(error => error.includes('related') && error.includes('removed or changed')));

assert.throws(() => overlayExistingProduct({ ...generated, code: 'TEA-CN-TWO' }, baseline), /Cannot overlay/);

console.log('test-product-overlay: OK');
