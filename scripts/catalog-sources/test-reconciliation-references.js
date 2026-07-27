'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    PRODUCT_REFERENCE_DATA_FILE,
    PRODUCT_REFERENCE_MANIFEST_FILE,
    writeProductReference,
} = require('../thetea/lib/product-reference');
const {
    CATALOG_COLLECTIONS,
    loadReconciliationReferences,
} = require('./lib/reconciliation-references');

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FETCHED_AT = '2026-07-28T01:02:03.000Z';

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function product(code) {
    return {
        code,
        translations: [],
        specifications: [],
        tags: [],
        tierPrices: [],
        catalogPrices: [],
        storePriceOverrides: [],
        packages: [],
        catalogs: [],
        origins: [],
        related: [],
        crossSells: [],
    };
}

function catalogReference(overrides = {}) {
    return {
        source: 'AdminGateway ProductCatalog',
        workspaceId: WORKSPACE_ID,
        fetchedAt: FETCHED_AT,
        catalogs: [{ code: 'CATALOG-TEA' }],
        categories: [{ code: 'CATEGORY-TEA' }],
        specificationGroups: [{ code: 'SPEC-GROUP-TEA' }],
        specificationAttributes: [{ code: 'SPEC-ATTRIBUTE-TEA' }],
        specificationAttributeOptions: [{ code: 'SPEC-OPTION-TEA' }],
        ...overrides,
    };
}

function writeJson(file, value) {
    const buffer = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    fs.writeFileSync(file, buffer);
    return buffer;
}

function createReferences(root, options = {}) {
    const productRoot = path.join(root, 'products');
    fs.mkdirSync(productRoot);
    const products = options.products || [product('TEA-A'), product('TEA-B')];
    writeProductReference(productRoot, products, {
        workspaceId: options.productWorkspaceId || WORKSPACE_ID,
        fetchedAt: options.productFetchedAt || FETCHED_AT,
    });
    const catalogFile = path.join(root, 'catalog.json');
    const catalogBuffer = writeJson(
        catalogFile,
        options.catalog || catalogReference());
    return {
        catalogBuffer,
        catalogFile,
        productRoot,
        products,
    };
}

function withTempDirectory(test) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-reconciliation-reference-'));
    try {
        test(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

withTempDirectory(root => {
    const fixture = createReferences(root);
    const result = loadReconciliationReferences({
        productReferencePath: fixture.productRoot,
        catalogReferencePath: fixture.catalogFile,
    });
    const manifestBuffer = fs.readFileSync(
        path.join(fixture.productRoot, PRODUCT_REFERENCE_MANIFEST_FILE));
    const manifest = JSON.parse(manifestBuffer);

    assert.strictEqual(result.workspaceId, WORKSPACE_ID);
    assert.deepStrictEqual(result.products, fixture.products);
    assert.deepStrictEqual(result.productReference.products, fixture.products);
    assert.strictEqual(result.productReference.manifest.workspaceId, WORKSPACE_ID);
    assert.deepStrictEqual(result.catalogs, [{ code: 'CATALOG-TEA' }]);
    assert.deepStrictEqual(result.fetchedAt, {
        products: FETCHED_AT,
        catalog: FETCHED_AT,
    });
    assert.deepStrictEqual(result.evidence.hashes, {
        productManifestSha256: sha256(manifestBuffer),
        productReferenceTreeSha256: sha256(Buffer.from(
            `${sha256(manifestBuffer)}\n${manifest.productsSha256}\n`,
        )),
        productsSha256: manifest.productsSha256,
        productCodesSha256: manifest.productCodesSha256,
        catalogReferenceSha256: sha256(fixture.catalogBuffer),
    });
    assert.deepStrictEqual(result.evidence.counts, {
        products: 2,
        catalogs: 1,
        categories: 1,
        specificationGroups: 1,
        specificationAttributes: 1,
        specificationAttributeOptions: 1,
    });
});

withTempDirectory(root => {
    const fixture = createReferences(root, {
        catalog: catalogReference({ workspaceId: OTHER_WORKSPACE_ID }),
    });
    assert.throws(
        () => loadReconciliationReferences({
            productReferencePath: fixture.productRoot,
            catalogReferencePath: fixture.catalogFile,
        }),
        /different workspaces/);
});

withTempDirectory(root => {
    const fixture = createReferences(root);
    const catalogLink = path.join(root, 'catalog-link.json');
    fs.symlinkSync(fixture.catalogFile, catalogLink);
    assert.throws(
        () => loadReconciliationReferences({
            productReferencePath: fixture.productRoot,
            catalogReferencePath: catalogLink,
        }),
        /non-symlink regular JSON file/);

    const productLink = path.join(root, 'products-link');
    fs.symlinkSync(fixture.productRoot, productLink);
    assert.throws(
        () => loadReconciliationReferences({
            productReferencePath: productLink,
            catalogReferencePath: fixture.catalogFile,
        }),
        /must not be a symbolic link/);
});

withTempDirectory(root => {
    const fixture = createReferences(root, {
        catalog: catalogReference({
            catalogs: [{ code: 'CATALOG-TEA' }, { code: ' catalog-tea ' }],
        }),
    });
    assert.throws(
        () => loadReconciliationReferences({
            productReferencePath: fixture.productRoot,
            catalogReferencePath: fixture.catalogFile,
        }),
        /duplicate code CATALOG-TEA/);
});

for (const collectionName of CATALOG_COLLECTIONS) {
    withTempDirectory(root => {
        const incomplete = catalogReference();
        delete incomplete[collectionName];
        const fixture = createReferences(root, { catalog: incomplete });
        assert.throws(
            () => loadReconciliationReferences({
                productReferencePath: fixture.productRoot,
                catalogReferencePath: fixture.catalogFile,
            }),
            new RegExp(`${collectionName} must be a non-empty array`));
    });
}

withTempDirectory(root => {
    const fixture = createReferences(root, {
        catalog: catalogReference({ categories: [] }),
    });
    assert.throws(
        () => loadReconciliationReferences({
            productReferencePath: fixture.productRoot,
            catalogReferencePath: fixture.catalogFile,
        }),
        /categories must be a non-empty array/);
});

withTempDirectory(root => {
    const fixture = createReferences(root, {
        catalog: catalogReference({
            specificationAttributes: [{ code: '   ' }],
        }),
    });
    assert.throws(
        () => loadReconciliationReferences({
            productReferencePath: fixture.productRoot,
            catalogReferencePath: fixture.catalogFile,
        }),
        /has no code/);
});

withTempDirectory(root => {
    const fixture = createReferences(root);
    fs.appendFileSync(path.join(fixture.productRoot, PRODUCT_REFERENCE_DATA_FILE), '\n');
    assert.throws(
        () => loadReconciliationReferences({
            productReferencePath: fixture.productRoot,
            catalogReferencePath: fixture.catalogFile,
        }),
        /data hash differs/);
});

withTempDirectory(root => {
    const fixture = createReferences(root, {
        catalog: catalogReference({ fetchedAt: '2026-07-28T01:02:03Z' }),
    });
    assert.throws(
        () => loadReconciliationReferences({
            productReferencePath: fixture.productRoot,
            catalogReferencePath: fixture.catalogFile,
        }),
        /canonical UTC timestamp/);
});

withTempDirectory(root => {
    const fixture = createReferences(root);
    const manifestFile = path.join(fixture.productRoot, PRODUCT_REFERENCE_MANIFEST_FILE);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.fetchedAt = 'not-a-timestamp';
    writeJson(manifestFile, manifest);
    assert.throws(
        () => loadReconciliationReferences({
            productReferencePath: fixture.productRoot,
            catalogReferencePath: fixture.catalogFile,
        }),
        /Product reference fetchedAt must be a canonical UTC timestamp/);
});

withTempDirectory(root => {
    const fixture = createReferences(root, {
        catalog: catalogReference({ workspaceId: 'not-a-uuid' }),
    });
    assert.throws(
        () => loadReconciliationReferences({
            productReferencePath: fixture.productRoot,
            catalogReferencePath: fixture.catalogFile,
        }),
        /workspaceId must be a UUID/);
});

console.log('test-reconciliation-references: OK');
