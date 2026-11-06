#!/usr/bin/env node
const assert = require('assert');
const { validateProductArray } = require('./lib/product-reference');
const { toCurrentProductContract, validateCurrentProductContract } = require('./lib/product-contract');
const { overlayExistingProduct, validateBaselinePreservation } = require('./lib/product-overlay');
const { normalizeProductForImport } = require('./lib/import-contract');
const { buildReconciliation } = require('./reconcile-generated');
const { baselineSourceIndex, resolveSourceProductCode } = require('./lib/source-product-identity');

const baseline = {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'TEA-CN-EXAMPLE',
    published: true,
    shipping: { enabled: true },
    translations: [{ lang: 'ru-RU', name: 'Чай', seo: 'example' }],
    specifications: [],
    tags: [],
    packageBindings: [{ package: 'MANUAL-PACK', packageName: 'Manual package' }],
    catalogs: [{ catalog: 'OTHER-CATALOG', category: 'MANUAL-CATEGORY' }],
    related: [],
    crossSells: [{ product: 'MANUAL-OTHER', catalog: 'OTHER-CATALOG' }],
};
assert.deepStrictEqual(validateProductArray([baseline]), [baseline]);
for (const field of ['packages', 'origins', 'tierPrices', 'catalogPrices', 'storePriceOverrides']) {
    assert.throws(() => validateProductArray([{ ...baseline, [field]: [] }]), /retired product field/);
}
assert.throws(() => validateCurrentProductContract({ ...baseline, packageBindings: [{ package: 'A', quantity: 50 }] }), /retired quantity/);

const generated = {
    code: baseline.code,
    published: false,
    translations: [{ lang: 'en-US', name: 'Tea', seo: 'example' }],
    specifications: [], tags: [],
    packages: [{ package: 'PKG-50G', packageName: '50g', packageUnit: 'g', quantity: 50, default: true }],
    origins: [{ country: 'CN', state: 'ZJ' }],
    catalogs: [{ catalog: 'CHINESE-TEA', category: 'GREEN' }],
    related: [], crossSells: [],
};
const current = toCurrentProductContract(generated);
assert.deepStrictEqual(current.packageBindings, [{ package: 'PKG-50G', packageName: '50g', packageUnit: 'g' }]);
assert(!Object.hasOwn(current, 'packages'));
assert(!Object.hasOwn(current, 'origins'));
const result = normalizeProductForImport(overlayExistingProduct(current, baseline));
assert.strictEqual(result.id, baseline.id);
assert.strictEqual(result.published, baseline.published);
assert.deepStrictEqual(result.shipping, baseline.shipping);
assert.deepStrictEqual(result.packageBindings, baseline.packageBindings);
assert.deepStrictEqual(result.crossSells, baseline.crossSells);
assert(result.catalogs.some(item => item.catalog === 'OTHER-CATALOG'));
assert.strictEqual(result.translations.length, 2);
assert.deepStrictEqual(validateBaselinePreservation([result], [baseline]), []);
assert(validateBaselinePreservation([{ ...result, packageBindings: [] }], [baseline]).some(error => error.includes('packageBindings')));
const reordered = { ...baseline, packageBindings: [...baseline.packageBindings].reverse() };
assert.strictEqual(buildReconciliation([reordered], [baseline]).counts.noop, 1);
const identities = [baseline, { ...baseline, code: 'ZZC-OTHER' }];
const byCode = new Map(identities.map(item => [item.code, item]));
const bySource = baselineSourceIndex(identities);
assert.strictEqual(resolveSourceProductCode('example', 'TEA-TW-EXAMPLE', byCode, bySource), baseline.code);
assert.strictEqual(resolveSourceProductCode('new-tea', 'TEA-CN-NEW-TEA', byCode, bySource), 'TEA-CN-NEW-TEA');
assert.throws(() => resolveSourceProductCode('different-source', baseline.code, byCode, bySource), /conflicts with source slug/);
assert.throws(() => resolveSourceProductCode('example', 'TEA-TW-EXAMPLE', byCode,
    baselineSourceIndex([baseline, { ...baseline, code: 'TEA-CN-DUPLICATE' }])), /ambiguous/);
console.log('test-current-product-contract: OK');
const { buildDescription } = require('./lib/transform');
const localizedCard = {enrichment:{},sections:{classification_origin:{category:{value:'Горный зелёный чай.'},type:{value:'Зелёный чай.'},origin:{value:'Ханчжоу.'}}},recipe:[{style:'gongfu',water_temp:90,tea_grams:5,water_ml:100,steep_sec:10,max_steeps:4}]};
assert.strictEqual(buildDescription(localizedCard,{sourceDescriptions:true}),'Горный зелёный чай.\n\nЗелёный чай.\n\nХанчжоу.');
assert(!buildDescription(localizedCard,{sourceDescriptions:true}).includes('Brewing recipes'));
assert(buildDescription(localizedCard).includes('Brewing recipes'));
assert.strictEqual(buildDescription({...localizedCard,enrichment:{summary:'Источник о вкусе.',tasting_note:'Свежий аромат.'}},{sourceDescriptions:true}),'Источник о вкусе.\n\nСвежий аромат.');
