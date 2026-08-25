'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    readJson,
    sha256,
    stableJson,
    writeJsonAtomic,
} = require('./lib/artifacts');
const { METHODS } = require('./lib/commerce-publication');
const {
    applyBundle,
    beginBody,
    loadBundle,
} = require('./apply-admin-rest-import-bundle');

const STOREFRONT_ID = '22222222-3333-4444-8555-666666666666';
const CATALOG_ID = '77777777-8888-4999-aaaa-bbbbbbbbbbbb';
const IMPORT_ID = '99999999-8888-4777-8666-555555555555';

function item(externalId) {
    return {
        externalId,
        semanticRevisionDigest: sha256(`semantic-${externalId}`),
        listPayloadDigest: sha256(`list-${externalId}`),
        detailPayloadDigest: sha256(`detail-${externalId}`),
        localizedTexts: [{
            languageCode: 'en-US',
            title: `Fixture ${externalId}`,
        }],
        factualAttributes: [],
        sourceDestination: {
            lookupUri: `urn:fixture:${externalId}`,
            observedAt: '2026-08-01T00:00:00.000Z',
            provenanceDigest: sha256(`destination-${externalId}`),
        },
        packageComponents: [],
        packageComponentsExact: false,
        imageUris: [],
        referencePrices: [],
        diagnosticCodes: [],
    };
}

function writeBundle(root) {
    const directory = path.join(root, 'bundle');
    const chunkDirectory = path.join(directory, 'chunks');
    fs.mkdirSync(chunkDirectory, { recursive: true });
    const items = [item('one'), item('two')];
    const chunkBytes = Buffer.from(stableJson({ items }));
    fs.writeFileSync(path.join(chunkDirectory, 'items-001.json'), chunkBytes);
    writeJsonAtomic(path.join(directory, 'begin.json'), {
        registeredSourceCode: 'fixture-source',
        connectorVersion: 'fixture-connector-v1',
        parserVersion: 'fixture-parser-v1',
        artifactSchemaVersion: 'admin-gateway-commerce-catalog-source-import-v1',
        snapshotId: 'fixture-snapshot',
        expectedItemCount: items.length,
        rawPayloadDigest: sha256('raw'),
        semanticDigest: sha256('semantic'),
        observedAt: '2026-08-01T00:00:00.000Z',
    });
    writeJsonAtomic(path.join(directory, 'manifest.json'), {
        schemaVersion: 'owner-tea-admin-gateway-source-import-staging-v1',
        sourceId: 'fixture-source',
        snapshotId: 'fixture-snapshot',
        expectedItemCount: items.length,
        productionWrites: false,
        remoteMutationAttempted: false,
        chunks: [{
            file: 'chunks/items-001.json',
            count: items.length,
            sha256: sha256(chunkBytes),
        }],
    });
    return { directory, items };
}

function response(state, acceptedItemCount = '0') {
    return {
        importId: { value: IMPORT_ID },
        state,
        expectedItemCount: '1',
        acceptedItemCount,
        replayedItemCount: '0',
        quarantinedItemCount: '0',
    };
}

function fakeClient(calls) {
    return {
        getReceiptMetadata() {
            return {
                kind: 'admin-rest',
                sanitizedTargetEndpoint: 'admin.example:443',
                tlsMode: 'tls-system-ca',
                routeTemplate:
                    '/api/v1.0/admin/commerce-network/storefronts/{storefrontId}' +
                    '/catalogs/{catalogId}/catalog-source-imports',
                apiVersion: '1.0',
            };
        },
        async invoke(method, request) {
            calls.push({ method, request });
            if (method === METHODS.begin) return response('open');
            if (method === METHODS.importItem) return { replayed: false };
            if (method === METHODS.commit) return response('committed', '1');
            throw new Error(`unexpected method ${method}`);
        },
    };
}

async function testBundleApply(root) {
    const { directory, items } = writeBundle(root);
    const loaded = loadBundle(directory);
    assert.strictEqual(loaded.items.length, 2);
    assert.strictEqual(
        beginBody(loaded.begin, 'canary', [items[0]]).expectedItemCount,
        1,
    );

    const canaryCalls = [];
    const canary = await applyBundle({
        'bundle-dir': directory,
        canary: true,
        yes: true,
        'admin-url': 'https://admin.example',
        'storefront-id': STOREFRONT_ID,
        'catalog-id': CATALOG_ID,
    }, {
        repositoryRoot: root,
        environment: {},
        createClient(options) {
            assert.strictEqual(options.baseUrl, 'https://admin.example');
            assert.strictEqual(options.storefrontId, STOREFRONT_ID);
            assert.strictEqual(options.catalogId, CATALOG_ID);
            return fakeClient(canaryCalls);
        },
    });
    assert.strictEqual(canary.expectedItemCount, 1);
    assert.deepStrictEqual(canaryCalls.map(call => call.method), [
        METHODS.begin,
        METHODS.importItem,
        METHODS.commit,
    ]);
    assert.strictEqual(canaryCalls[1].request.item.externalId, 'one');
    const canaryReceipt = readJson(canary.receiptFile);
    assert.strictEqual(canaryReceipt.complete, true);
    assert.strictEqual(canaryReceipt.tokenStored, false);
    assert.doesNotMatch(stableJson(canaryReceipt), /fixture-admin-token|Bearer/);
    assert.doesNotMatch(
        stableJson(canaryReceipt),
        /participantId|commerceChannelId/,
    );

    const fullCalls = [];
    const full = await applyBundle({
        'bundle-dir': directory,
        full: true,
        yes: true,
        'admin-url': 'https://admin.example',
        'storefront-id': STOREFRONT_ID,
        'catalog-id': CATALOG_ID,
    }, {
        repositoryRoot: root,
        environment: {},
        createClient() {
            return fakeClient(fullCalls);
        },
    });
    assert.strictEqual(full.expectedItemCount, 2);
    assert.deepStrictEqual(
        fullCalls
            .filter(call => call.method === METHODS.importItem)
            .map(call => call.request.item.externalId),
        ['one', 'two'],
    );
    const fullReceipt = readJson(full.receiptFile);
    assert.strictEqual(fullReceipt.complete, true);
    assert.strictEqual(fullReceipt.source.expectedItemCount, 2);
}

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-rest-bundle-'));
    try {
        await testBundleApply(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
    console.log('test-admin-rest-import-bundle: OK');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
