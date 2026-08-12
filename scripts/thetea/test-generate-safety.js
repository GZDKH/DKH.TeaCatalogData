#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPO_ROOT } = require('./lib/env');
const {
    assertGeneratorOutputPath,
    buildPackageOnlyProduct,
    findNewProductCodes,
    hashInputPath,
    hashSnapshotFiles,
    normalizeBooleanSpecificationValue,
    normalizeGeneratedProduct,
    resolveUpdateScope,
    writeGeneratedBundle,
} = require('./generate-import');
const { packageDefinitionsFor } = require('./lib/package-content');
const { buildReconciliation } = require('./reconcile-generated');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thetea-generate-safety-'));
try {
    assert.throws(
        () => assertGeneratorOutputPath(REPO_ROOT),
        /cannot replace the repository/);
    assert.throws(
        () => assertGeneratorOutputPath(path.join(REPO_ROOT, 'scripts', 'generated')),
        /must be a child of import\/thetea/);
    assert.strictEqual(
        assertGeneratorOutputPath(path.join(REPO_ROOT, 'import', 'thetea', 'safe')),
        path.join(REPO_ROOT, 'import', 'thetea', 'safe'));
    assert.strictEqual(
        assertGeneratorOutputPath(path.join(tempRoot, 'safe-output')),
        path.join(fs.realpathSync(tempRoot), 'safe-output'));

    const snapshot = path.join(tempRoot, 'snapshot');
    const raw = path.join(snapshot, 'raw');
    fs.mkdirSync(raw, { recursive: true });
    fs.writeFileSync(path.join(raw, 'card.json'), '{}');
    fs.mkdirSync(path.join(raw, 'fields'), { recursive: true });
    fs.writeFileSync(path.join(raw, 'fields', 'origin.json'), '{"value":"Zhejiang"}');
    const manifest = {
        files: ['raw/card.json'],
        fieldFiles: ['raw/fields/origin.json'],
    };
    const initialSnapshotHash = hashSnapshotFiles(snapshot, manifest);
    assert.match(initialSnapshotHash, /^[a-f0-9]{64}$/);
    fs.writeFileSync(path.join(raw, 'fields', 'origin.json'), '{"value":"Fujian"}');
    assert.notStrictEqual(hashSnapshotFiles(snapshot, manifest), initialSnapshotHash);

    const outside = path.join(tempRoot, 'outside.json');
    fs.writeFileSync(outside, '{}');
    fs.symlinkSync(outside, path.join(raw, 'linked.json'));
    assert.throws(
        () => hashSnapshotFiles(snapshot, { files: ['raw/linked.json'] }),
        /symlink/);

    const referenceLink = path.join(tempRoot, 'reference-link.json');
    fs.symlinkSync(outside, referenceLink);
    assert.throws(() => hashInputPath(referenceLink), /symlink/);

    assert.deepStrictEqual(
        findNewProductCodes(
            [{ code: 'TEA-CN-EXISTING' }, { code: 'tea-cn-new' }],
            [{ code: 'tea-cn-existing' }]),
        ['TEA-CN-NEW']);
    assert.deepStrictEqual(
        findNewProductCodes([{ code: 'TEA-CN-EXISTING' }], [{ code: 'TEA-CN-EXISTING' }]),
        []);

    const packageScopeArgs = {
        'update-scope': 'packages',
        'product-ref': 'sources/prod/product-reference/complete',
        packages: 'standard',
    };
    assert.strictEqual(resolveUpdateScope(packageScopeArgs), 'packages');
    assert.strictEqual(normalizeBooleanSpecificationValue('True'), 'true');
    assert.strictEqual(normalizeBooleanSpecificationValue('FALSE'), 'false');
    assert.strictEqual(normalizeBooleanSpecificationValue(1), 'true');
    assert.strictEqual(normalizeBooleanSpecificationValue('0'), 'false');
    assert.strictEqual(normalizeBooleanSpecificationValue('unknown'), null);
    assert.strictEqual(resolveUpdateScope({}), null);
    assert.throws(
        () => resolveUpdateScope({ ...packageScopeArgs, 'update-scope': 'catalogs' }),
        /supports only 'packages'/);
    assert.throws(
        () => resolveUpdateScope({ ...packageScopeArgs, 'product-ref': undefined }),
        /requires a complete --product-ref/);
    assert.throws(
        () => resolveUpdateScope({ ...packageScopeArgs, packages: 'default' }),
        /requires --packages=standard/);
    assert.throws(
        () => resolveUpdateScope({ ...packageScopeArgs, 'allow-missing-product-reference': true }),
        /cannot allow a missing product reference/);
    assert.throws(
        () => resolveUpdateScope({ ...packageScopeArgs, 'allow-new-products': true }),
        /cannot allow new products/);
    assert.throws(
        () => resolveUpdateScope({ ...packageScopeArgs, publish: true }),
        /cannot change publication state/);
    assert.throws(
        () => resolveUpdateScope({ ...packageScopeArgs, 'catalog-assignment-mode': 'target-only' }),
        /requires --catalog-assignment-mode=preserve/);

    const baselineProduct = {
        id: '90afe5d3-e4f7-4136-b07d-4c5140ae73ca',
        code: 'TEA-CN-EXISTING',
        sku: 'BASELINE-SKU',
        published: true,
        nativeName: '基准茶',
        translations: [{ lang: 'en-US', name: 'Baseline tea' }],
        specifications: [{
            group: 'SPEC-GROUP-MANUAL',
            attribute: 'SPEC-MANUAL-BASELINE',
            type: 'CustomText',
            value: 'preserve without running full overlay',
        }, {
            group: 'SPEC-TT-GROUP-MANAGED',
            attribute: 'SPEC-TT-MANAGED-BOOLEAN',
            type: 'Boolean',
            value: false,
        }],
        tags: [{ code: 'TAG-BASELINE' }],
        catalogs: [{
            catalog: { code: 'CATALOG-CHINESE-TEA', currency: null, translations: [] },
            category: { code: 'CAT-GREEN', parent: null, translations: [] },
            order: 7,
            published: true,
        }],
        packages: [
            { package: 'PKG-500G', packageName: '500g', packageUnit: 'g', quantity: 1, default: false },
            { package: 'PKG-MANUAL-TIN', packageName: 'Manual tin', packageUnit: 'tin', quantity: 2, default: false },
            { package: 'PKG-50G', packageName: '50g', packageUnit: 'g', quantity: 1, default: true },
        ],
        tierPrices: [{ quantity: 10, price: 100 }],
        catalogPrices: [{ catalog: 'CATALOG-CHINESE-TEA', price: 110 }],
        storePriceOverrides: [{ store: 'STORE-ONE', price: 115 }],
        origins: [{ country: 'CN' }],
        related: [],
        crossSells: [],
    };
    const transformedProduct = {
        ...baselineProduct,
        id: 'must-not-replace-baseline-id',
        sku: 'MUST-NOT-CHANGE',
        published: false,
        nativeName: '不得更改',
        translations: [{ lang: 'en-US', name: 'Must not change' }],
        catalogs: [{ catalog: 'CATALOG-OTHER', category: 'CAT-OTHER' }],
        origins: [{ country: 'US' }],
        packages: packageDefinitionsFor('standard'),
    };
    const packageOnlyProduct = buildPackageOnlyProduct(transformedProduct, baselineProduct);
    const baselineWithoutPackages = { ...baselineProduct };
    const packageOnlyWithoutPackages = { ...packageOnlyProduct };
    delete baselineWithoutPackages.packages;
    delete packageOnlyWithoutPackages.packages;
    assert.deepStrictEqual(packageOnlyWithoutPackages, baselineWithoutPackages);
    assert.deepStrictEqual(
        packageOnlyProduct.packages.map(item => item.package),
        ['PKG-500G', 'PKG-MANUAL-TIN', 'PKG-50G', 'PKG-25G', 'PKG-100G', 'PKG-250G']);
    assert.deepStrictEqual(
        packageOnlyProduct.packages.find(item => item.package === 'PKG-MANUAL-TIN'),
        baselineProduct.packages[1]);
    assert.strictEqual(
        packageOnlyProduct.packages.find(item => item.package === 'PKG-500G').quantity,
        500);
    assert.strictEqual(
        packageOnlyProduct.packages.find(item => item.package === 'PKG-50G').quantity,
        50);
    assert.throws(
        () => buildPackageOnlyProduct(transformedProduct, null),
        /cannot create TEA-CN-EXISTING/);
    assert.throws(
        () => buildPackageOnlyProduct(
            { ...transformedProduct, code: 'TEA-CN-DIFFERENT' },
            baselineProduct),
        /cannot merge TEA-CN-DIFFERENT into baseline product TEA-CN-EXISTING/);

    const normalizedPackageOnlyProduct = normalizeGeneratedProduct(
        packageOnlyProduct,
        'packages');
    assert.strictEqual(
        normalizedPackageOnlyProduct.specifications
            .find(item => item.attribute === 'SPEC-TT-MANAGED-BOOLEAN').value,
        'false');
    const packageOnlyReconciliation = buildReconciliation(
        [normalizedPackageOnlyProduct],
        [baselineProduct]);
    assert.strictEqual(packageOnlyReconciliation.eligible, true);
    assert.deepStrictEqual(
        packageOnlyReconciliation.counts,
        { create: 0, update: 1, noop: 0, conflict: 0 });
    assert.deepStrictEqual(packageOnlyReconciliation.fieldChangeCounts, { packages: 1 });
    assert.deepStrictEqual(
        packageOnlyReconciliation.operations[0].changedFields,
        ['packages']);

    const bundleRoot = path.join(tempRoot, 'package-only-bundle');
    const bundleManifest = writeGeneratedBundle(bundleRoot, {
        snapshotId: 'package-only-snapshot',
        generatedAt: '2026-08-02T00:00:00.000Z',
        sourceManifestSha256: 'source-manifest-sha',
        sourceFilesSha256: 'source-files-sha',
        baselineReferenceSha256: 'baseline-sha',
        catalogReferenceSha256: 'catalog-sha',
        requiredLocales: ['en-US'],
        products: [normalizedPackageOnlyProduct],
        productRecords: [{
            product: normalizedPackageOnlyProduct,
            relativePath: '04-products/CHINA-GREEN-TEA/TEA-CN-EXISTING.json',
        }],
        definitions: { groups: [], attributes: [], options: [], localization: null },
        categories: [],
        catalog: { code: 'CATALOG-CHINESE-TEA' },
        catalogBinding: { code: 'CATALOG-CHINESE-TEA', categories: [] },
        catalogPlacement: null,
        catalogTargets: ['CATALOG-CHINESE-TEA'],
        storefrontTargets: ['shop-thetea', 'thetea-wiki'],
        catalogAssignmentMode: 'preserve',
        publicationMode: 'draft',
        updateScope: 'packages',
        articleCoverage: 'none',
        lossEvents: [],
        routedContent: { articles: [], metaobjects: [] },
        productMedia: { records: [], assets: [] },
        contentMedia: { records: [], assets: [] },
    });
    assert.strictEqual(bundleManifest.targets.updateScope, 'packages');
    assert.strictEqual(bundleManifest.targets.articleCoverage, 'none');
    assert.strictEqual(
        JSON.parse(fs.readFileSync(path.join(bundleRoot, 'artifact-manifest.json'), 'utf8'))
            .targets.updateScope,
        'packages');
} finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('test-generate-safety: OK');
