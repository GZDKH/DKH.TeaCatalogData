'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    PUBLIC_PROTOCOL_IV,
    PUBLIC_PROTOCOL_KEY,
    decodeEnvelope,
} = require('./zzctea/decoder');
const { divideDecimal } = require('./zzctea/decimal');
const {
    assertPublicCatalogPayload,
    normalizeDetail,
    normalizeListPage,
} = require('./zzctea/normalizer');
const { parsePackage } = require('./zzctea/package-parser');

const FIXTURES = path.join(__dirname, 'zzctea', 'fixtures');

function readFixture(name) {
    return fs.readFileSync(path.join(FIXTURES, name));
}

function encryptFixture(plaintext) {
    const cipher = crypto.createCipheriv('aes-128-cbc', PUBLIC_PROTOCOL_KEY, PUBLIC_PROTOCOL_IV);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.from(JSON.stringify(ciphertext.toString('hex')));
}

function encrypted(name) {
    return encryptFixture(readFixture(name));
}

function assertRejectsCode(action, code) {
    assert.throws(action, error => error.code === code);
}

function main() {
    const vector = Buffer.from(
        JSON.stringify(
            'dfbdf233a84209b7dc5a1a89fa14c5426d974d5eabeb4bda46d4a13cdc6c154' +
            'a4934f6f31ea8f4c7f6976ee07e81d4a7',
        ),
    );
    assert.deepStrictEqual(decodeEnvelope(vector), {
        status: '1',
        data: { id: '1', name: 'Fixture' },
    });
    for (const body of ['', '"not-hex"', '"abc"']) {
        assert.throws(() => decodeEnvelope(Buffer.from(body)), error =>
            /^ZZCTEA_/.test(error.code) && (!body || !error.message.includes(body)));
    }
    assertRejectsCode(
        () => decodeEnvelope(encryptFixture(Buffer.from('{"status":1,"status":1}'))),
        'SOURCE_DECRYPTED_JSON_INVALID',
    );

    for (const [raw, count, finalContainer] of [
        ['357克/片 7片/提 6提/件', 3, 'case'],
        ['357克/片 7片/提', 2, 'bundle'],
        ['357克/片 7片/盒 6盒/件', 3, 'case'],
        ['200克/饼 5饼/提', 2, 'bundle'],
    ]) {
        const parsed = parsePackage(raw);
        assert.strictEqual(parsed.isExact, true);
        assert.strictEqual(parsed.components.length, count);
        assert.strictEqual(parsed.components.at(-1).containerUnitCode, finalContainer);
        assert.ok(parsed.components.every(component => typeof component.quantity === 'string'));
    }
    assert.strictEqual(
        parsePackage('357克/片 7片/提 6盒/件').diagnosticCode,
        'ZZCTEA_PACKAGE_CHAIN_INCONSISTENT',
    );
    assert.strictEqual(
        parsePackage('7片/提 6提/片').diagnosticCode,
        'ZZCTEA_PACKAGE_CHAIN_CYCLIC',
    );

    const caseItem = normalizeDetail(encrypted('detail-case.json'));
    assert.strictEqual(caseItem.externalId, '17627');
    assert.strictEqual(caseItem.localizedFields['zh-CN'].name, 'Fixture Case Tea');
    assert.strictEqual(caseItem.sourceLinks.stableLookupUrl, 'https://zzctea.com/teaDetail/17627.html');
    assert.deepStrictEqual(caseItem.package.components, [
        { quantity: '357', containedUnitCode: 'g', containerUnitCode: 'cake' },
        { quantity: '7', containedUnitCode: 'cake', containerUnitCode: 'bundle' },
        { quantity: '6', containedUnitCode: 'bundle', containerUnitCode: 'case' },
    ]);
    assert.deepStrictEqual(
        caseItem.referencePrices.map(price => [price.amount, price.basisUnitCode, price.kind]),
        [
            ['8700', 'case', 'source-reference'],
            ['1450', 'bundle', 'derived-reference'],
            ['207.14285714', 'cake', 'derived-reference'],
        ],
    );
    assert.deepStrictEqual(caseItem.referencePrices[2].derivation, {
        sourceAmount: '8700',
        sourceBasisUnitCode: 'case',
        cumulativeDivisor: '42',
        exactFraction: { numerator: '1450', denominator: '7' },
        roundingPolicy: { mode: 'half-up', scale: 8 },
    });
    assert.strictEqual(caseItem.facts.release.amount, '7200');
    assert.strictEqual(caseItem.facts.release.quantity, '1600');
    assert.ok(caseItem.referencePrices.every(price => price.retailPrice === false));

    const bundle = normalizeDetail(encrypted('detail-bundle.json'));
    assert.strictEqual(bundle.referencePrices.at(-1).basisUnitCode, 'cake');
    assert.strictEqual(bundle.referencePrices.at(-1).derivation.cumulativeDivisor, '7');
    const box = normalizeDetail(encrypted('detail-box-case.json'));
    assert.strictEqual(box.referencePrices.at(-1).derivation.cumulativeDivisor, '42');

    const hidden = normalizeDetail(encrypted('detail-hidden-price.json'));
    assert.deepStrictEqual(hidden.referencePrices, []);
    assert.ok(hidden.diagnostics.includes('ZZCTEA_REFERENCE_PRICE_HIDDEN'));
    const malformed = normalizeDetail(encrypted('detail-malformed-package.json'));
    assert.strictEqual(malformed.package.rawText, '357克/片 7片/提 6盒/件');
    assert.strictEqual(malformed.package.isExact, false);
    assert.deepStrictEqual(malformed.package.components, []);
    assert.strictEqual(malformed.referencePrices.length, 1);
    assert.ok(malformed.diagnostics.includes('ZZCTEA_PACKAGE_CHAIN_INCONSISTENT'));
    assert.ok(malformed.diagnostics.includes('ZZCTEA_IMAGE_URL_INVALID'));
    assert.ok(malformed.diagnostics.includes('ZZCTEA_SOURCE_TIMESTAMP_INVALID'));

    const page = normalizeListPage(encrypted('list-page.json'), 36);
    assert.strictEqual(page.totalCount, 5);
    assert.strictEqual(page.items.length, 5);
    assert.strictEqual(new Set(page.items.map(item => item.externalId)).size, 5);

    const exact = divideDecimal('900719925474099312345.67', '7', 8);
    assert.strictEqual(exact.amount, '128674275067728473192.23857143');
    assert.strictEqual(exact.exactFraction.denominator, '700');

    assertRejectsCode(
        () => assertPublicCatalogPayload({ data: { phone: 'redacted' } }),
        'ZZCTEA_PUBLIC_PAYLOAD_PII_DETECTED',
    );
    const forbiddenTokens = [
        /"phone"/i,
        /"customer/i,
        /"avatar/i,
        /"sellList"/i,
        /"buyList"/i,
        /"sellPeople"/i,
        /"buyPeople"/i,
        /(?<!\d)1[3-9]\d{9}(?!\d)/,
    ];
    for (const fixture of fs.readdirSync(FIXTURES)) {
        const content = fs.readFileSync(path.join(FIXTURES, fixture), 'utf8');
        assert.ok(
            forbiddenTokens.every(pattern => !pattern.test(content)),
            `${fixture} must remain PII-free`,
        );
    }

    console.log('test-zzctea-contract: OK');
}

main();
