#!/usr/bin/env node
const assert = require('assert');
const http = require('http');
const { buildReconciliation } = require('./reconcile-generated');
const {
    assertBatchState,
    classifyLiveStates,
    requestProducts,
} = require('./run-product-sync');

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555';

function product(code, name) {
    return {
        id: `${code}-id`,
        code,
        nativeName: name,
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

const before = product('TEA-A', 'Before');
const desired = product('TEA-A', 'After');
const syncPlan = {
    expectedCodes: ['TEA-A'],
    desiredByCode: new Map([['TEA-A', desired]]),
    rollbackByCode: new Map([['TEA-A', before]]),
};

assert.deepStrictEqual(classifyLiveStates(syncPlan, [before]).map(item => item.state), ['baseline']);
assert.deepStrictEqual(classifyLiveStates(syncPlan, [desired]).map(item => item.state), ['desired']);
assert.deepStrictEqual(
    classifyLiveStates(syncPlan, [product('TEA-A', 'Drift')]).map(item => item.state),
    ['conflict']);
assert.doesNotThrow(() => assertBatchState(syncPlan, [desired], ['TEA-A'], 'desired'));
assert.throws(() => assertBatchState(syncPlan, [before], ['TEA-A'], 'desired'), /Read-back failed/);
assert.strictEqual(buildReconciliation([desired], [desired]).counts.noop, 1);

async function testRequestProducts() {
    let invalid = false;
    const server = http.createServer((request, response) => {
        const chunks = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
            assert.strictEqual(request.headers.authorization, 'Bearer token');
            assert.strictEqual(request.headers['x-workspace-id'], WORKSPACE_ID);
            const body = Buffer.concat(chunks).toString('utf8');
            assert(body.includes('products'));
            assert(body.includes('TEA-A'));
            response.setHeader('Content-Type', 'application/json');
            if (request.url.endsWith('/validate')) {
                response.end(JSON.stringify(invalid
                    ? { valid: false, failed: 1, errors: [{ message: 'invalid' }] }
                    : { valid: true, validRecords: 1, errors: [] }));
            } else {
                response.end(JSON.stringify({ processed: 1, failed: 0, errors: [] }));
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const gateway = `http://127.0.0.1:${server.address().port}`;
        await requestProducts(gateway, 'token', WORKSPACE_ID, [desired], true);
        await requestProducts(gateway, 'token', WORKSPACE_ID, [desired], false);
        invalid = true;
        await assert.rejects(requestProducts(gateway, 'token', WORKSPACE_ID, [desired], true), /Validation failed/);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

testRequestProducts()
    .then(() => console.log('test-run-product-sync: OK'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
