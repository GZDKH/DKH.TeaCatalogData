#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { HEADERS, rowsToCsv } = require('./thetea-shop/catalog-sellable-exchange');
const {
    NO_OP_REASON,
    requestAccessToken,
    runNoOpCanary,
} = require('./thetea-shop/catalog-sellable-exchange-canary');
const { parseCsv } = require('./lib/csv-records');
const { parseAllowedDotenv, safeError } = require('./run-catalog-sellable-exchange-canary');

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
