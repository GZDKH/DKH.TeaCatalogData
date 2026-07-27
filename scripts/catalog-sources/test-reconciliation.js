'use strict';

const assert = require('assert');
const {
    reconcileProjection,
} = require('./lib/reconciliation');
const { stableJson } = require('./lib/artifacts');

function projectedItem(externalId, descriptions = {}) {
    return {
        externalId,
        idempotencyKey: `fixture-${externalId}`,
        observation: {
            externalId,
            semanticRevisionDigest: 'a'.repeat(64),
            localizedText: [
                {
                    languageCode: 'en-US',
                    title: `Tea ${externalId}`,
                    description: descriptions['en-US'] ||
                        `Tea catalog facts — year: 2025; package: 357 g per cake.`,
                },
                {
                    languageCode: 'zh-CN',
                    title: `茶 ${externalId}`,
                    description: descriptions['zh-CN'] ||
                        `茶品资料：年份：2025年；包装：每饼357克。`,
                },
            ],
            factualAttributes: [],
            sourceDestination: {
                lookupUri: `https://zzctea.com/teaDetail/${externalId}.html`,
            },
            packageComponents: [],
            imageUris: [],
            referencePrices: [],
            diagnosticCodes: [],
        },
    };
}

function projection(items) {
    return {
        schemaVersion: 'catalog-source-observation-projection-v1',
        inputEvidence: {
            artifactSha256: 'b'.repeat(64),
        },
        source: {
            id: 'zzctea',
            connectorVersion: 'zzctea-connector-v2',
            parserVersion: 'zzctea-public-catalog-js-v2',
        },
        snapshot: {
            id: 'fixture',
            observedAt: '2026-07-28T00:00:00.000Z',
        },
        itemCount: items.length,
        items,
        deletionCount: 0,
        deletions: [],
        authoritativeReferencesIncluded: false,
        reconciliationComplete: false,
        productionWrites: false,
    };
}

function product(code, id) {
    return {
        id,
        code,
        sku: `SKU-${code}`,
        nativeName: `Native ${code}`,
        published: true,
        price: 999,
        prices: [{ currency: 'CNY', amount: 999 }],
        metadata: {
            source: 'manual',
            nested: {
                keep: ['all', 'values'],
            },
        },
        translations: [
            {
                lang: 'en-US',
                name: `English ${code}`,
                description: 'Old English description.',
                metaDescription: 'Old English meta.',
                seoTitle: 'Keep English SEO title',
            },
            {
                lang: 'ru-RU',
                name: `Русский ${code}`,
                description: 'Сохранить источник example.com без изменений.',
                metaDescription: 'Сохранить русское meta example.com.',
            },
            {
                lang: 'zh-CN',
                name: `中文 ${code}`,
                description: '旧中文描述。',
                metaDescription: '旧中文 meta。',
                seoTitle: '保留中文 SEO',
            },
        ],
        specifications: [{
            group: 'SPEC-GROUP',
            attribute: 'SPEC-ATTRIBUTE',
            type: 'CustomText',
            value: 'keep',
        }],
        tags: [{ code: 'TAG-KEEP', name: 'Keep' }],
        tierPrices: [{ quantity: 10, price: 900 }],
        catalogPrices: [{ catalog: 'CATALOG-TEA', price: 950 }],
        storePriceOverrides: [{ store: 'STORE-ONE', price: 975 }],
        packages: [{ package: 'PKG-357G', default: true }],
        catalogs: [{ catalog: 'CATALOG-TEA', category: 'CAT-PUERH', published: true }],
        origins: [{ country: 'CN', region: 'YN' }],
        related: [{ product: 'TEA-RELATED', order: 1 }],
        crossSells: [{ product: 'TEA-CROSS', order: 2 }],
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function assertCode(action, code) {
    assert.throws(action, error => error.code === code, `Expected ${code}`);
}

function withoutManagedDescriptions(productValue) {
    const value = clone(productValue);
    for (const translation of value.translations) {
        if (translation.lang === 'en-US' || translation.lang === 'zh-CN') {
            delete translation.description;
            delete translation.metaDescription;
        }
    }
    return value;
}

function main() {
    const existing = product(
        'ZZC-17641',
        '11111111-1111-4111-8111-111111111111',
    );
    const unrelated = product(
        'TEA-MANUAL',
        '22222222-2222-4222-8222-222222222222',
    );
    const inputs = projection([
        projectedItem('17641'),
        projectedItem('9'),
    ]);
    const originalProducts = clone([existing, unrelated]);
    const result = reconcileProjection(inputs, [existing, unrelated]);

    assert.strictEqual(result.sourceId, 'zzctea');
    assert.deepStrictEqual(
        result.entries.map(entry => entry.externalId),
        ['9', '17641'],
        'Entries must be ordered by numeric external ID.',
    );
    assert.deepStrictEqual(result.entries[0], {
        externalId: '9',
        productCode: 'ZZC-9',
        status: 'missing-create-draft',
        published: false,
    });

    const matched = result.entries[1];
    assert.strictEqual(matched.externalId, '17641');
    assert.strictEqual(matched.productId, existing.id);
    assert.strictEqual(matched.productCode, 'ZZC-17641');
    assert.strictEqual(matched.status, 'matched-update');
    assert.strictEqual(matched.commerceSourceIncarnationId, null);
    assert.strictEqual(
        matched.commerceMappingStatus,
        'blocked-authoritative-reference',
    );
    assert.notStrictEqual(matched.productPatch, existing);
    assert.notStrictEqual(matched.rollbackProduct, existing);
    assert.notStrictEqual(matched.productPatch, matched.rollbackProduct);
    assert.deepStrictEqual(matched.rollbackProduct, existing);

    const en = matched.productPatch.translations.find(value => value.lang === 'en-US');
    const zh = matched.productPatch.translations.find(value => value.lang === 'zh-CN');
    const ru = matched.productPatch.translations.find(value => value.lang === 'ru-RU');
    assert.strictEqual(
        en.description,
        'Tea catalog facts — year: 2025; package: 357 g per cake.',
    );
    assert.strictEqual(en.metaDescription, en.description);
    assert.strictEqual(
        zh.description,
        '茶品资料：年份：2025年；包装：每饼357克。',
    );
    assert.strictEqual(zh.metaDescription, zh.description);
    assert.deepStrictEqual(
        ru,
        existing.translations.find(value => value.lang === 'ru-RU'),
    );
    assert.deepStrictEqual(
        withoutManagedDescriptions(matched.productPatch),
        withoutManagedDescriptions(existing),
        'Only target-locale description and metaDescription may change.',
    );
    for (const field of [
        'prices',
        'tierPrices',
        'catalogPrices',
        'storePriceOverrides',
    ]) {
        assert.deepStrictEqual(matched.productPatch[field], existing[field]);
        assert.deepStrictEqual(matched.rollbackProduct[field], existing[field]);
        assert.notStrictEqual(matched.productPatch[field], existing[field]);
        assert.notStrictEqual(matched.rollbackProduct[field], existing[field]);
    }
    assert.deepStrictEqual([existing, unrelated], originalProducts, 'Inputs must not be mutated.');
    assert.ok(matched.productPatch.translations.every(translation =>
        !/zzctea(?:\.com)?|https?:\/\/|www\./iu.test(translation.description || '') &&
        !/zzctea(?:\.com)?|https?:\/\/|www\./iu.test(translation.metaDescription || '')));

    assert.deepStrictEqual(result.report, {
        matched: [{
            externalId: '17641',
            productId: existing.id,
            productCode: 'ZZC-17641',
            status: 'matched-update',
        }],
        missing: [{
            externalId: '9',
            productCode: 'ZZC-9',
        }],
        ambiguous: [],
        counts: {
            matched: 1,
            missing: 1,
            ambiguous: 0,
        },
    });

    const repeated = reconcileProjection(inputs, [existing, unrelated]);
    assert.deepStrictEqual(repeated, result, 'Same verified inputs must reconcile idempotently.');
    assert.strictEqual(stableJson(repeated), stableJson(result));

    const patchedReference = [
        matched.productPatch,
        unrelated,
    ];
    const repeatedFromPatch = reconcileProjection(inputs, patchedReference);
    assert.deepStrictEqual(
        repeatedFromPatch.entries[1].productPatch,
        matched.productPatch,
        'Applying the same factual descriptions to the patched baseline must be idempotent.',
    );
    assert.strictEqual(repeatedFromPatch.entries[1].status, 'matched-noop');

    const duplicateCode = clone(unrelated);
    duplicateCode.id = '33333333-3333-4333-8333-333333333333';
    duplicateCode.code = 'zzc-17641';
    assertCode(
        () => reconcileProjection(inputs, [existing, unrelated, duplicateCode]),
        'CATALOG_SOURCE_RECONCILIATION_PRODUCT_CODE_DUPLICATE',
    );
    const duplicateId = clone(unrelated);
    duplicateId.code = 'TEA-OTHER';
    duplicateId.id = existing.id.toUpperCase();
    assertCode(
        () => reconcileProjection(inputs, [existing, duplicateId]),
        'CATALOG_SOURCE_RECONCILIATION_PRODUCT_ID_DUPLICATE',
    );

    for (const malformedCode of [
        'ZZC-0',
        'ZZC-017641',
        'zzc-17641',
        'ZZC-abc',
        'ZZC17641',
    ]) {
        const malformed = clone(unrelated);
        malformed.id = '44444444-4444-4444-8444-444444444444';
        malformed.code = malformedCode;
        assertCode(
            () => reconcileProjection(inputs, [unrelated, malformed]),
            'CATALOG_SOURCE_RECONCILIATION_PRODUCT_CODE_INVALID',
        );
    }

    const duplicateProjection = projection([
        projectedItem('17641'),
        projectedItem('17641'),
    ]);
    assertCode(
        () => reconcileProjection(duplicateProjection, [existing, unrelated]),
        'CATALOG_SOURCE_RECONCILIATION_EXTERNAL_ID_DUPLICATE',
    );
    assertCode(
        () => reconcileProjection(projection([projectedItem('017641')]), [existing, unrelated]),
        'CATALOG_SOURCE_RECONCILIATION_EXTERNAL_ID_INVALID',
    );

    const unsafeDomain = projection([projectedItem('17641', {
        'en-US': 'Facts copied from zzctea.com.',
    })]);
    assertCode(
        () => reconcileProjection(unsafeDomain, [existing, unrelated]),
        'CATALOG_SOURCE_RECONCILIATION_DESCRIPTION_INVALID',
    );
    const unsafeBoilerplate = projection([projectedItem('17641', {
        'zh-CN': '找找茶最新报价和价格走势。',
    })]);
    assertCode(
        () => reconcileProjection(unsafeBoilerplate, [existing, unrelated]),
        'CATALOG_SOURCE_RECONCILIATION_DESCRIPTION_INVALID',
    );
    const unsafeMissing = projection([projectedItem('9', {
        'en-US': 'Missing product copied from zzctea.com.',
    })]);
    assertCode(
        () => reconcileProjection(unsafeMissing, [existing, unrelated]),
        'CATALOG_SOURCE_RECONCILIATION_DESCRIPTION_INVALID',
    );

    const ambiguousTranslations = clone(existing);
    ambiguousTranslations.translations.push(clone(
        ambiguousTranslations.translations.find(value => value.lang === 'zh-CN'),
    ));
    assertCode(
        () => reconcileProjection(projection([projectedItem('17641')]), [ambiguousTranslations]),
        'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
    );

    console.log('test-reconciliation: OK');
}

main();
