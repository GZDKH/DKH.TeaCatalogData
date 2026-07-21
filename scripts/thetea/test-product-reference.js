#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const {
    requestDataExchangeExport,
    requestProductExport,
} = require('./fetch-prod-products');
const {
    PRODUCT_REFERENCE_DATA_FILE,
    loadVerifiedProductReference,
    validateProductArray,
    writeProductReference,
} = require('./lib/product-reference');
const {
    catalogWorkspaceHeader,
    resolveCatalogWorkspaceId,
} = require('./lib/catalog-workspace');

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555';

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

function withTempDirectory(test) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thetea-product-reference-'));
    try {
        test(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

withTempDirectory(root => {
    const products = [
        product('TEA-CN-A'),
        product('TEA-CN-B'),
    ];
    const manifest = writeProductReference(root, products, { workspaceId: WORKSPACE_ID });
    assert.strictEqual(manifest.complete, true);
    assert.strictEqual(manifest.productCount, 2);
    assert.deepStrictEqual(loadVerifiedProductReference(root).products, products);
    assert.throws(
        () => loadVerifiedProductReference(path.join(root, PRODUCT_REFERENCE_DATA_FILE)),
        /must be the directory/);

    fs.appendFileSync(path.join(root, PRODUCT_REFERENCE_DATA_FILE), '\n');
    assert.throws(
        () => loadVerifiedProductReference(root),
        /hash differs/);
});

assert.throws(() => validateProductArray([]), /at least one product/);
assert.throws(
    () => validateProductArray([product('TEA-A'), product('tea-a')]),
    /duplicate product code/);
assert.throws(
    () => validateProductArray([{ code: 'TEA-A' }]),
    /not a complete nested products export/);
assert.deepStrictEqual(catalogWorkspaceHeader(WORKSPACE_ID), {
    'X-Workspace-Id': WORKSPACE_ID,
});
assert.strictEqual(
    resolveCatalogWorkspaceId({ 'workspace-id': WORKSPACE_ID }),
    WORKSPACE_ID);
assert.throws(() => resolveCatalogWorkspaceId({}), /workspace is required/i);

async function testRequest() {
    let expectedProfile = 'products';
    const server = http.createServer((request, response) => {
        const chunks = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
            assert.strictEqual(request.method, 'POST');
            assert.strictEqual(request.url, '/api/v1/data-exchange/export/stream');
            assert.strictEqual(request.headers.authorization, 'Bearer test-token');
            assert.strictEqual(request.headers['x-workspace-id'], WORKSPACE_ID);
            assert.deepStrictEqual(
                JSON.parse(Buffer.concat(chunks).toString('utf8')),
                { profile: expectedProfile, format: 'json' });
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify([product('TEA-CN-A')]));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        const result = await requestProductExport(
            `http://127.0.0.1:${address.port}`,
            'test-token',
            WORKSPACE_ID);
        assert.deepStrictEqual(JSON.parse(result.toString('utf8')), [product('TEA-CN-A')]);
        expectedProfile = 'specification_attributes';
        const definitions = await requestDataExchangeExport(
            `http://127.0.0.1:${address.port}`,
            'test-token',
            WORKSPACE_ID,
            expectedProfile);
        assert.deepStrictEqual(JSON.parse(definitions.toString('utf8')), [product('TEA-CN-A')]);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

testRequest()
    .then(() => console.log('test-product-reference: OK'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
