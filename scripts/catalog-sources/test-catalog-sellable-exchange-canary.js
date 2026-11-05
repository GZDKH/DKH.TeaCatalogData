#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { HEADERS, rowsToCsv } = require('./thetea-shop/catalog-sellable-exchange');
const {
    NO_OP_REASON,
    CatalogSellableExchangeClient,
    requestAccessToken,
    runNoOpCanary,
} = require('./thetea-shop/catalog-sellable-exchange-canary');
const { parseCsv } = require('./lib/csv-records');
const { main: runCanaryCli, parseAllowedDotenv, safeError } = require('./run-catalog-sellable-exchange-canary');

async function assertRedirectsNeverReachAnotherOrigin() {
    let destinationRequests = 0;
    const destination = http.createServer((_request, response) => {
        destinationRequests += 1;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ access_token: 'synthetic' }));
    });
    await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve));
    const redirector = http.createServer((_request, response) => {
        response.writeHead(307, { Location: `http://127.0.0.1:${destination.address().port}/capture` });
        response.end();
    });
    await new Promise(resolve => redirector.listen(0, '127.0.0.1', resolve));
    try {
        const baseUrl = `http://127.0.0.1:${redirector.address().port}`;
        await assert.rejects(
            requestAccessToken({ keycloakUrl: baseUrl, clientId: 'fixture', clientSecret: 'synthetic' }),
            error => error.code === 'CANARY_HTTP_UNAVAILABLE',
        );
        const client = new CatalogSellableExchangeClient({
            baseUrl,
            workspaceId: '11111111-2222-4333-8444-555555555555',
            token: 'synthetic',
        });
        await assert.rejects(client.request('/api/v1/data-exchange/template'),
            error => error.code === 'CANARY_HTTP_UNAVAILABLE');
        assert.equal(destinationRequests, 0, 'credentials must never be sent to a redirect destination');
    } finally {
        redirector.closeAllConnections();
        destination.closeAllConnections();
        await Promise.all([
            new Promise(resolve => redirector.close(resolve)),
            new Promise(resolve => destination.close(resolve)),
        ]);
    }
}

async function assertOversizedResponseStopsReading() {
    let produced = 0;
    let cancelled = false;
    const stream = new ReadableStream({
        pull(controller) {
            if (produced === 20) {
                controller.close();
                return;
            }
            produced += 1;
            controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel() { cancelled = true; },
    });
    const client = new CatalogSellableExchangeClient({
        baseUrl: 'https://gateway.example.test',
        workspaceId: '11111111-2222-4333-8444-555555555555',
        token: 'synthetic',
        fetchImpl: async () => new Response(stream, { status: 200 }),
    });
    await assert.rejects(client.request('/api/v1/data-exchange/template'),
        error => error.code === 'CANARY_RESPONSE_TOO_LARGE');
    assert.ok(produced < 20, 'the response stream must stop before the full oversized body is buffered');
    assert.equal(cancelled, true);
}

async function assertResponseBodyRespectsTimeout() {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.write('{');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const result = requestAccessToken({
            keycloakUrl: `http://127.0.0.1:${server.address().port}`,
            clientId: 'fixture',
            clientSecret: 'synthetic',
            timeoutMs: 75,
        }).then(() => 'unexpected-success', error => error.code || error.name);
        const observed = await Promise.race([
            result,
            new Promise(resolve => setTimeout(() => resolve('body-timeout-not-enforced'), 500)),
        ]);
        assert.equal(observed, 'CANARY_HTTP_UNAVAILABLE');
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

async function assertDefaultCanaryUsesCurrentRowCount() {
    const rows = Array.from({ length: 155 }, (_, index) => ({
        RowKey: `ROW-${index}`,
        CatalogCode: 'CATALOG-CHINESE-TEA-SHOP',
        ProductCode: 'TEA-CN-TIE-GUANYIN',
        VariantAxisCode: 'FIXTURE',
        VariantLabel: `Fixture ${index}`,
        PackageCode: 'FIXTURE',
        UnitQuantity: '1',
        UnitCode: 'g',
        DisplayOrder: String(index),
        PublicationMode: 'request_only',
    }));
    let imports = 0;
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (url.pathname === '/api/v1/catalogs') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ items: [{
                id: '11111111-2222-4333-8444-555555555555',
                code: 'CATALOG-CHINESE-TEA-SHOP',
            }] }));
        } else if (url.pathname === '/api/v1/data-exchange/template') {
            response.end(rowsToCsv([]));
        } else if (url.pathname === '/api/v1/data-exchange/export') {
            response.end(rowsToCsv(rows));
        } else if (url.pathname === '/api/v1/data-exchange/validate') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(validation(155)));
        } else {
            imports += 1;
            response.writeHead(500);
            response.end();
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const result = await runCanaryCli([], {
            GATEWAY_URL: `http://127.0.0.1:${server.address().port}`,
            PRODUCT_CATALOG_WORKSPACE_ID: '11111111-2222-4333-8444-555555555555',
            ADMIN_GATEWAY_ACCESS_TOKEN: 'synthetic',
        });
        assert.equal(result.before.rows, 155);
        assert.equal(result.apply.attempted, false);
        assert.equal(imports, 0);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

const FIXTURE = path.join(
    __dirname,
    'thetea-shop/fixtures/catalog-sellable-exchange/tieguanyin-exact-25.csv',
);

function validation(rows = 25, reason = NO_OP_REASON) {
    return {
        valid: true,
        totalRecords: rows,
        validRecords: rows,
        errors: [],
        warnings: Array.from({ length: rows }, (_, index) => ({
            line: index + 2,
            field: 'disposition',
            message: reason,
        })),
    };
}

function imported(rows = 25) {
    return { processed: rows, failed: 0, errors: [] };
}

class FakeClient {
    constructor(options = {}) {
        this.before = fs.readFileSync(FIXTURE);
        this.exports = options.exports || [this.before, this.before, this.before];
        this.validation = options.validation || validation();
        this.importResults = options.importResults || [imported(), imported()];
        this.calls = [];
    }

    resolveCatalogId(code) {
        this.calls.push(['catalog', code]);
        return Promise.resolve('11111111-2222-4333-8444-555555555555');
    }

    getTemplate(format) {
        this.calls.push(['template', format]);
        return Promise.resolve(Buffer.from(rowsToCsv([]), 'utf8'));
    }

    exportCurrent(catalogId, productCode) {
        this.calls.push(['export', catalogId, productCode]);
        return Promise.resolve(this.exports.shift() || this.before);
    }

    validate(contents) {
        this.calls.push(['validate', contents.length]);
        return Promise.resolve(this.validation);
    }

    import(contents) {
        this.calls.push(['import', contents.length]);
        const result = this.importResults.shift();
        if (result instanceof Error) return Promise.reject(result);
        return Promise.resolve(result || imported());
    }
}

async function main() {
    await assertRedirectsNeverReachAnotherOrigin();
    await assertOversizedResponseStopsReading();
    await assertResponseBodyRespectsTimeout();
    await assertDefaultCanaryUsesCurrentRowCount();
    assert.deepEqual(parseAllowedDotenv([
        '# encrypted values are piped in memory only',
        'ADMIN_GATEWAY_ORIGIN=https://admin-api.example.test',
        'ADMIN_GATEWAY_KEYCLOAK_SECRET="secret-with-=value"',
        'UNRELATED_SECRET=must-not-be-loaded',
    ].join('\n')), {
        ADMIN_GATEWAY_ORIGIN: 'https://admin-api.example.test',
        ADMIN_GATEWAY_KEYCLOAK_SECRET: 'secret-with-=value',
    });
    assert.equal(safeError(new Error('unsafe response payload')), 'CANARY_FAILED');
    assert.deepEqual(parseCsv('a,b\r\n1,"二"\r\n'), [['a', 'b'], ['1', '二']]);
    assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
    assert.throws(() => parseCsv('a,"b'), error => error.code === 'CSV_UNCLOSED_QUOTE');

    const token = await requestAccessToken({
        keycloakUrl: 'https://auth.example.test',
        clientId: 'dkh-admin-gateway',
        clientSecret: 'not-logged-secret',
        fetchImpl: async (url, init) => {
            assert.equal(url.pathname, '/realms/dkh/protocol/openid-connect/token');
            assert.equal(init.method, 'POST');
            return new Response(JSON.stringify({ access_token: 'header.payload.signature' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });
    assert.equal(token, 'header.payload.signature');

    const dryClient = new FakeClient();
    const dry = await runNoOpCanary(dryClient, {
        catalogCode: 'CATALOG-CHINESE-TEA-SHOP',
        productCode: 'TEA-CN-TIE-GUANYIN',
        expectedRows: 25,
        apply: false,
    });
    assert.deepEqual(dry.validation, { valid: true, totalRecords: 25, noOp: 25 });
    assert.deepEqual(dry.apply, { attempted: false });
    assert.equal(dryClient.calls.filter(call => call[0] === 'import').length, 0);
    assert.equal(JSON.stringify(dry).includes('11111111-2222-4333-8444-555555555555'), false);

    const applyClient = new FakeClient();
    const applied = await runNoOpCanary(applyClient, {
        catalogCode: 'CATALOG-CHINESE-TEA-SHOP',
        productCode: 'TEA-CN-TIE-GUANYIN',
        expectedRows: 25,
        apply: true,
    });
    assert.equal(applied.apply.attempted, true);
    assert.equal(applied.apply.restored, true);
    assert.equal(applyClient.calls.filter(call => call[0] === 'import').length, 2);
    assert.equal(applied.before.canonicalSha256, applied.apply.final.canonicalSha256);

    const blockedClient = new FakeClient({ validation: validation(25, 'CATALOG_SELLABLE_VARIANT_UPDATE') });
    await assert.rejects(
        runNoOpCanary(blockedClient, {
            catalogCode: 'CATALOG-CHINESE-TEA-SHOP',
            productCode: 'TEA-CN-TIE-GUANYIN',
            expectedRows: 25,
            apply: true,
        }),
        error => error.code === 'CANARY_VALIDATION_NOT_EXACT_NO_OP',
    );
    assert.equal(blockedClient.calls.filter(call => call[0] === 'import').length, 0);

    const records = parseCsv(fs.readFileSync(FIXTURE));
    records[1][HEADERS.indexOf('DisplayOrder')] = '9999';
    const drift = Buffer.from(`${records.map(row => row.join(',')).join('\n')}\n`, 'utf8');
    const driftClient = new FakeClient({ exports: [fs.readFileSync(FIXTURE), drift, fs.readFileSync(FIXTURE)] });
    await assert.rejects(
        runNoOpCanary(driftClient, {
            catalogCode: 'CATALOG-CHINESE-TEA-SHOP',
            productCode: 'TEA-CN-TIE-GUANYIN',
            expectedRows: 25,
            apply: true,
        }),
        error => error.code === 'CANARY_READ_BACK_DRIFT',
    );
    assert.equal(driftClient.calls.filter(call => call[0] === 'import').length, 2);

    const partialClient = new FakeClient({ importResults: [new Error('unsafe payload'), imported()] });
    await assert.rejects(
        runNoOpCanary(partialClient, {
            catalogCode: 'CATALOG-CHINESE-TEA-SHOP',
            productCode: 'TEA-CN-TIE-GUANYIN',
            expectedRows: 25,
            apply: true,
        }),
        error => error.message === 'unsafe payload',
    );
    assert.equal(partialClient.calls.filter(call => call[0] === 'import').length, 2);

    console.log('Catalog sellable exchange no-op canary tests passed.');
}

main().catch(error => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
});
