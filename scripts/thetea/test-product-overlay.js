#!/usr/bin/env node
const assert = require('assert');
const {
    mergeManagedPackages,
    overlayExistingProduct,
    validateBaselinePreservation,
} = require('./lib/product-overlay');
const { packageDefinitionsFor } = require('./lib/package-content');

const baseline = {
    id: 'a09cc4b6-c512-47a4-9df4-f562e19e97b2',
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
    packages: [
        { package: 'PKG-CUSTOM-TIN', packageName: 'Manual tin', quantity: 2, default: false },
        { package: 'PKG-100G', packageName: 'old 1g', packageUnit: 'g', quantity: 1, default: true },
    ],
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
    packages: [
        { package: 'PKG-50G', packageName: '50g', packageUnit: 'g', quantity: 50, default: true },
        { package: 'PKG-100G', packageName: '100g', packageUnit: 'g', quantity: 100, default: false },
        { package: 'PKG-250G', packageName: '250g', packageUnit: 'g', quantity: 250, default: false },
        { package: 'PKG-GENERATED-UNKNOWN', packageName: 'must not replace manual data' },
    ],
    origins: [{ country: 'CN' }],
    related: [{ product: 'TEA-CN-SIMILAR', catalog: 'CATALOG-CHINESE-TEA', order: 1 }],
    crossSells: [],
};

const overlaid = overlayExistingProduct(generated, baseline);
assert.strictEqual(overlaid.sku, 'MANUAL-SKU');
assert.strictEqual(overlaid.id, baseline.id);
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
assert.deepStrictEqual(overlaid.packages, [
    baseline.packages[0],
    generated.packages[1],
    generated.packages[0],
    generated.packages[2],
]);
assert(!overlaid.packages.some(item => item.package === 'PKG-GENERATED-UNKNOWN'));
assert.deepStrictEqual(
    mergeManagedPackages(generated.packages, baseline.packages),
    overlaid.packages);
assert.deepStrictEqual(overlaid.crossSells, baseline.crossSells);
assert.strictEqual(overlaid.related[0].product, 'TEA-CN-MANUAL');
assert.strictEqual(overlaid.related[0].order, 7);
assert.strictEqual(overlaid.related.find(item => item.product === 'TEA-CN-SIMILAR').order, 8);
assert.deepStrictEqual(validateBaselinePreservation([overlaid], [baseline]), []);

const standardBaseline = {
    ...baseline,
    packages: [
        { package: 'PKG-500G', quantity: 1, default: false },
        baseline.packages[0],
        { package: 'PKG-25G', quantity: 1, default: false },
        { package: 'PKG-100G', quantity: 1, default: false },
        { package: 'PKG-50G', quantity: 1, default: true },
        { package: 'PKG-250G', quantity: 1, default: false },
    ],
};
const standardOverlaid = overlayExistingProduct(
    { ...generated, packages: packageDefinitionsFor('standard') },
    standardBaseline);
assert.strictEqual(standardOverlaid.id, standardBaseline.id);
assert.deepStrictEqual(
    standardOverlaid.packages.map(item => item.package),
    standardBaseline.packages.map(item => item.package));
assert.deepStrictEqual(
    standardOverlaid.packages
        .filter(item => item.package !== 'PKG-CUSTOM-TIN')
        .map(item => [item.package, item.quantity, item.packageUnit, item.packageName, item.default]),
    [
        ['PKG-500G', 500, 'g', '500g', false],
        ['PKG-25G', 25, 'g', '25g', false],
        ['PKG-100G', 100, 'g', '100g', false],
        ['PKG-50G', 50, 'g', '50g', true],
        ['PKG-250G', 250, 'g', '250g', false],
    ]);
assert.deepStrictEqual(
    standardOverlaid.packages.find(item => item.package === 'PKG-CUSTOM-TIN'),
    baseline.packages[0]);
assert.deepStrictEqual(
    validateBaselinePreservation([standardOverlaid], [standardBaseline]),
    []);

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

const changedManagedPackage = JSON.parse(JSON.stringify(overlaid));
changedManagedPackage.packages.find(item => item.package === 'PKG-100G').quantity = 101;
assert.deepStrictEqual(validateBaselinePreservation([changedManagedPackage], [baseline]), []);

const changedManualPackage = JSON.parse(JSON.stringify(overlaid));
changedManualPackage.packages.find(item => item.package === 'PKG-CUSTOM-TIN').quantity = 3;
assert(validateBaselinePreservation([changedManualPackage], [baseline])
    .some(error => error.includes('packages') && error.includes('removed or changed')));

const removedManualPackage = JSON.parse(JSON.stringify(overlaid));
removedManualPackage.packages = removedManualPackage.packages
    .filter(item => item.package !== 'PKG-CUSTOM-TIN');
assert(validateBaselinePreservation([removedManualPackage], [baseline])
    .some(error => error.includes('packages') && error.includes('removed or changed')));

const duplicateGeneratedManagedPackage = {
    ...generated,
    packages: [...generated.packages, { ...generated.packages[0] }],
};
assert.throws(
    () => overlayExistingProduct(duplicateGeneratedManagedPackage, baseline),
    /duplicate managed package PKG-50G/);

const reorderedManualRelation = JSON.parse(JSON.stringify(overlaid));
reorderedManualRelation.related.find(item => item.product === 'TEA-CN-MANUAL').order = 1;
assert(validateBaselinePreservation([reorderedManualRelation], [baseline])
    .some(error => error.includes('related') && error.includes('removed or changed')));

assert.throws(() => overlayExistingProduct({ ...generated, code: 'TEA-CN-TWO' }, baseline), /Cannot overlay/);

const targetOnlyBaseline = {
    ...baseline,
    catalogs: [
        { catalog: { code: 'CATALOG-OTHER' }, category: { code: 'CAT-MANUAL' } },
        { catalog: { code: 'CATALOG-CHINESE-TEA' }, category: { code: 'CAT-KEEP' } },
    ],
};
const targetOnly = overlayExistingProduct(generated, targetOnlyBaseline, {
    catalogAssignmentMode: 'target-only',
    targetCatalog: 'CATALOG-CHINESE-TEA',
});
assert(!targetOnly.catalogs.some(item => item.category?.code === 'CAT-MANUAL'));
assert(targetOnly.catalogs.some(item => item.category?.code === 'CAT-KEEP'));
assert.deepStrictEqual(validateBaselinePreservation(
    [targetOnly],
    [targetOnlyBaseline],
    {
        catalogAssignmentMode: 'target-only',
        targetCatalog: 'CATALOG-CHINESE-TEA',
    }), []);
assert.throws(() => overlayExistingProduct(generated, baseline, {
    catalogAssignmentMode: 'target-only',
}), /targetCatalog is required/);

console.log('test-product-overlay: OK');
