'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    SANITIZED_ENVELOPE_SCHEMA,
    decodeSanitizedEnvelope,
} = require('./zzctea/sanitized-envelope');
const { divideDecimal } = require('./zzctea/decimal');
const {
    assertPublicCatalogPayload,
    marketDecimal,
    normalizeDetail,
    normalizeListPage,
    subtractMarketDecimal,
} = require('./zzctea/normalizer');
const { parsePackage } = require('./zzctea/package-parser');
const { PRODUCT_FIELDS } = require('./zzctea/nuxt');

const FIXTURES = path.join(__dirname, 'zzctea', 'fixtures');

function readFixture(name) {
    return fs.readFileSync(path.join(FIXTURES, name));
}

function readFixtureValue(name) {
    return JSON.parse(readFixture(name));
}

function detailEnvelopeValue(value) {
    return Buffer.from(JSON.stringify({
        schemaVersion: SANITIZED_ENVELOPE_SCHEMA,
        kind: 'detail',
        data: value.data,
    }));
}

function detailEnvelope(name) {
    return detailEnvelopeValue(readFixtureValue(name));
}

function listEnvelopeValue(value) {
    return Buffer.from(JSON.stringify({
        schemaVersion: SANITIZED_ENVELOPE_SCHEMA,
        kind: 'list',
        page: 1,
        pageSize: 36,
        totalPages: 1,
        data: value.data,
    }));
}

function listEnvelope(name) {
    return listEnvelopeValue(readFixtureValue(name));
}

function assertRejectsCode(action, code) {
    assert.throws(action, error => error.code === code);
}

function main() {
    const vector = detailEnvelopeValue({
        data: { id: 1, name: 'Fixture' },
    });
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(decodeSanitizedEnvelope(vector))),
        {
            schemaVersion: SANITIZED_ENVELOPE_SCHEMA,
            kind: 'detail',
            data: { id: '1', name: 'Fixture' },
        },
    );
    for (const body of ['', '"not-an-envelope"', '{"kind":"detail"}']) {
        assert.throws(() => decodeSanitizedEnvelope(Buffer.from(body)), error =>
            /^ZZCTEA_|^SOURCE_/.test(error.code) &&
            (!body || !error.message.includes(body)));
    }
    assertRejectsCode(
        () => decodeSanitizedEnvelope(Buffer.from(
            `{"schemaVersion":"${SANITIZED_ENVELOPE_SCHEMA}",` +
            '"kind":"detail","kind":"detail","data":{}}',
        )),
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

    const caseItem = normalizeDetail(detailEnvelope('detail-case.json'));
    assert.strictEqual(caseItem.externalId, '17627');
    assert.strictEqual(caseItem.localizedFields['zh-CN'].name, 'Fixture Case Tea');
    assert.strictEqual(
        caseItem.localizedFields['zh-CN'].description,
        '云南大叶种晒青毛茶制成，饼形端正。 香气清晰，滋味醇厚。',
    );
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
    assert.deepStrictEqual(caseItem.facts.market, {
        sourceUpdatedAt: '2026-03-17T03:53:25.000Z',
        pricing: {
            currencyCode: 'CNY',
            basisUnitCode: 'case',
            currentAmount: '8700',
            previousAmount: '8000',
            previousAmountDerivation:
                'current-minus-source-absolute-change',
            ranges: {
                source: {
                    minimumAmount: '6300',
                    maximumAmount: '8700',
                },
                week: {
                    minimumAmount: '8700',
                    maximumAmount: '8700',
                },
                year: {
                    minimumAmount: '6300',
                    maximumAmount: '8700',
                },
            },
            trends: {
                absoluteChangeAmount: '700',
                displayPercentChange: '8.8',
                periodRatios: {
                    halfYear: '0.12987012987012986',
                },
            },
        },
        aggregates: {
            demandCount: 29,
            supplyCount: 10,
            followerCount: 1007,
            commentCount: 7,
            forumCount: 10,
            demandParticipantCount: 29,
            supplyParticipantCount: 10,
        },
    });
    assert.ok(caseItem.referencePrices.every(price => price.retailPrice === false));
    assert.strictEqual(marketDecimal('-.16666666666666666'), '-0.16666666666666666');
    assert.strictEqual(marketDecimal('.12987012987012986'), '0.12987012987012986');
    assert.strictEqual(marketDecimal('-0.000'), '0');
    assert.strictEqual(
        subtractMarketDecimal('30000', '-4000'),
        '34000',
    );
    assert.strictEqual(
        marketDecimal('1.1234567890123456789'),
        null,
    );

    const bundle = normalizeDetail(detailEnvelope('detail-bundle.json'));
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(bundle.localizedFields['zh-CN'], 'description'),
        false,
    );
    assert.ok(!bundle.diagnostics.includes('ZZCTEA_SOURCE_DESCRIPTION_UNSAFE'));
    assert.strictEqual(bundle.referencePrices.at(-1).basisUnitCode, 'cake');
    assert.strictEqual(bundle.referencePrices.at(-1).derivation.cumulativeDivisor, '7');
    const box = normalizeDetail(detailEnvelope('detail-box-case.json'));
    assert.strictEqual(box.referencePrices.at(-1).derivation.cumulativeDivisor, '42');

    const unsafeDescription = normalizeDetail(
        detailEnvelope('detail-description-unsafe.json'),
    );
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(
            unsafeDescription.localizedFields['zh-CN'],
            'description',
        ),
        false,
    );
    assert.ok(unsafeDescription.diagnostics.includes('ZZCTEA_SOURCE_DESCRIPTION_UNSAFE'));

    const unsafeDescriptionFixture = readFixtureValue('detail-description-unsafe.json');
    for (const description of [
        '<p>Product-specific text</p>',
        'Product\u0000specific text',
        'See https://example.com/tea for details',
        'See example.com/tea for details',
        '找找茶提供茶品资料',
        '查看找茶出茶供需和价格走势',
        '茶'.repeat(4_001),
    ]) {
        const payload = {
            ...unsafeDescriptionFixture,
            data: {
                ...unsafeDescriptionFixture.data,
                description,
            },
        };
        const normalized = normalizeDetail(detailEnvelopeValue(payload));
        assert.strictEqual(
            Object.prototype.hasOwnProperty.call(
                normalized.localizedFields['zh-CN'],
                'description',
            ),
            false,
        );
        assert.ok(normalized.diagnostics.includes('ZZCTEA_SOURCE_DESCRIPTION_UNSAFE'));
    }

    const maximumDescriptionPayload = {
        ...unsafeDescriptionFixture,
        data: {
            ...unsafeDescriptionFixture.data,
            description: '茶'.repeat(4_000),
        },
    };
    assert.strictEqual(
        normalizeDetail(detailEnvelopeValue(maximumDescriptionPayload))
            .localizedFields['zh-CN'].description.length,
        4_000,
    );

    const piiDescriptionPayload = {
        ...unsafeDescriptionFixture,
        data: {
            ...unsafeDescriptionFixture.data,
            description: 'Product details 13800138000',
        },
    };
    assertRejectsCode(
        () => normalizeDetail(detailEnvelopeValue(piiDescriptionPayload)),
        'ZZCTEA_PUBLIC_PAYLOAD_PII_DETECTED',
    );

    const hidden = normalizeDetail(detailEnvelope('detail-hidden-price.json'));
    assert.deepStrictEqual(hidden.referencePrices, []);
    assert.strictEqual(hidden.facts.market, null);
    assert.ok(hidden.diagnostics.includes('ZZCTEA_REFERENCE_PRICE_HIDDEN'));
    const malformed = normalizeDetail(detailEnvelope('detail-malformed-package.json'));
    assert.strictEqual(malformed.package.rawText, '357克/片 7片/提 6盒/件');
    assert.strictEqual(malformed.package.isExact, false);
    assert.deepStrictEqual(malformed.package.components, []);
    assert.strictEqual(malformed.referencePrices.length, 1);
    assert.ok(malformed.diagnostics.includes('ZZCTEA_PACKAGE_CHAIN_INCONSISTENT'));
    assert.ok(malformed.diagnostics.includes('ZZCTEA_IMAGE_URL_INVALID'));
    assert.ok(malformed.diagnostics.includes('ZZCTEA_SOURCE_TIMESTAMP_INVALID'));

    const page = normalizeListPage(listEnvelope('list-page.json'), 36);
    assert.strictEqual(page.totalCount, null);
    assert.strictEqual(page.totalPages, 1);
    assert.strictEqual(page.items.length, 5);
    assert.strictEqual(new Set(page.items.map(item => item.externalId)).size, 5);
    const listWithDescription = readFixtureValue('list-page.json');
    listWithDescription.data[0].description = 'List payload description must not be imported';
    const normalizedListWithDescription = normalizeListPage(
        listEnvelopeValue(listWithDescription),
        36,
    );
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(
            normalizedListWithDescription.items[0].localizedFields['zh-CN'],
            'description',
        ),
        false,
    );

    const exact = divideDecimal('900719925474099312345.67', '7', 8);
    assert.strictEqual(exact.amount, '128674275067728473192.23857143');
    assert.strictEqual(exact.exactFraction.denominator, '700');

    assertRejectsCode(
        () => assertPublicCatalogPayload({ data: { phone: 'redacted' } }),
        'ZZCTEA_PUBLIC_PAYLOAD_PII_DETECTED',
    );
    for (const unsafeValue of [
        'sales@example.cn',
        '138 0013 8000',
        '138-0013-8000',
        '010-12345678',
        '+86 020 12345678',
        '+86 10 12345678',
        '400-123-4567',
        '电话：12345678',
        'WeChat: tea_sales_2026',
        '微信号 tea-seller',
        'wxid_tea_seller_2026',
        'QQ: 12345678',
        'LINE: tea42',
        'contact: tea.seller',
    ]) {
        for (const field of PRODUCT_FIELDS) {
            assertRejectsCode(
                () => assertPublicCatalogPayload({ [field]: unsafeValue }),
                'ZZCTEA_PUBLIC_PAYLOAD_PII_DETECTED',
            );
        }
    }
    for (const safeValue of [
        '357克/片 7片/提 6提/件',
        '8700',
        '207.14285714',
        '2026-07-20',
        '2501',
        '云南大叶种晒青毛茶',
        'linearity tested',
        'baseline quality',
        'onlinecatalog',
        'airlineproduct',
        'line shape round',
        'production line value green',
        'straight line process',
    ]) {
        for (const field of PRODUCT_FIELDS) {
            assert.doesNotThrow(() =>
                assertPublicCatalogPayload({ [field]: safeValue }));
        }
    }
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
