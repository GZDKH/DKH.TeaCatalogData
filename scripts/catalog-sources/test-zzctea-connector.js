'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    PUBLIC_PROTOCOL_IV,
    PUBLIC_PROTOCOL_KEY,
} = require('./zzctea/decoder');
const {
    DETAIL_PATH,
    LIST_PATH,
    createZzcTeaConnector,
} = require('./zzctea/connector');

const FIXTURES = path.join(__dirname, 'zzctea', 'fixtures');

function encrypt(name) {
    const plaintext = fs.readFileSync(path.join(FIXTURES, name));
    const cipher = crypto.createCipheriv('aes-128-cbc', PUBLIC_PROTOCOL_KEY, PUBLIC_PROTOCOL_IV);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.from(JSON.stringify(encrypted.toString('hex')));
}

async function main() {
    const calls = [];
    const mockRequest = async (rawUrl, options) => {
        const url = new URL(rawUrl);
        calls.push({ url, options });
        if (options.method === 'HEAD') {
            return {
                status: 301,
                headers: new Headers({ location: '/tea/fixture-case-tea.html' }),
                body: Buffer.alloc(0),
            };
        }
        return {
            status: 200,
            headers: new Headers(),
            body: url.pathname === LIST_PATH
                ? encrypt('list-page.json')
                : encrypt('detail-case.json'),
        };
    };
    const connector = createZzcTeaConnector({
        clock: () => 1785123347896,
        request: mockRequest,
    });
    const pageRaw = await connector.fetchListPage({ page: 1, pageSize: 36 });
    assert.strictEqual(connector.parseListPage(pageRaw, 36).totalCount, 5);
    const detailRaw = await connector.fetchDetail({ externalId: '17627' });
    assert.strictEqual(connector.parseDetail(detailRaw).externalId, '17627');
    assert.strictEqual(
        await connector.resolveCanonicalUrl({ externalId: '17627' }),
        'https://zzctea.com/tea/fixture-case-tea.html',
    );

    assert.deepStrictEqual(calls.map(call => call.url.pathname), [
        LIST_PATH,
        DETAIL_PATH,
        '/teaDetail/17627.html',
    ]);
    const expectedSign = crypto
        .createHash('md5')
        .update('1785123347896rfq12')
        .digest('hex')
        .toUpperCase();
    assert.strictEqual(calls[0].url.searchParams.get('sign'), expectedSign);
    assert.strictEqual(calls[0].url.searchParams.get('brandIds'), '');
    assert.strictEqual(calls[0].url.searchParams.get('platformId'), '2');
    assert.strictEqual(calls[1].url.searchParams.get('teaId'), '17627');
    assert.strictEqual(calls[2].options.method, 'HEAD');
    assert.ok(calls.every(call => !/sell|buy|phone|customer/i.test(call.url.pathname)));

    const unsafeRedirect = createZzcTeaConnector({
        request: async () => ({
            status: 301,
            headers: new Headers({ location: 'https://evil.example/tea/item.html' }),
            body: Buffer.alloc(0),
        }),
    });
    await assert.rejects(
        unsafeRedirect.resolveCanonicalUrl({ externalId: '17627' }),
        error => error.code === 'SOURCE_HOST_NOT_ALLOWLISTED',
    );

    console.log('test-zzctea-connector: OK');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
