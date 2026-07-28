'use strict';

const assert = require('assert');
const {
    reconcileProjection,
    SOURCE_SPECIFICATIONS,
} = require('./lib/reconciliation');
const { stableJson } = require('./lib/artifacts');

function projectedItem(externalId, descriptions = {}) {
    const fact = (attributeCode, normalizedValue) => ({
        attributeCode,
        normalizedValue,
        sourceValueDigest: 'c'.repeat(64),
    });
    return {
        externalId,
        idempotencyKey: `fixture-${externalId}`,
        observation: {
            externalId,
            semanticRevisionDigest: 'a'.repeat(64),
            localizedText: [
                {
                    languageCode: 'zh-CN',
                    title: `茶 ${externalId}`,
                    description: descriptions['zh-CN'] ||
                        `茶品资料：年份：2025年；包装：每饼357克。`,
                },
            ],
            factualAttributes: [
                fact('batch', '春'),
                fact('production-technology', '熟茶'),
                fact('shape', '饼'),
                fact('year', '2025'),
            ],
            sourceDestination: {
                lookupUri: `https://zzctea.com/teaDetail/${externalId}.html`,
            },
            rawPackageText: '357克/片 7片/提',
            packageComponents: [
                {
                    quantity: { units: '357', nanos: 0 },
                    containedUnitCode: 'g',
                    containerUnitCode: 'cake',
                    ordinal: 0,
                },
                {
                    quantity: { units: '7', nanos: 0 },
                    containedUnitCode: 'cake',
                    containerUnitCode: 'bundle',
                    ordinal: 1,
                },
            ],
            packageComponentsExact: true,
            imageUris: [],
            referencePrices: [
                {
                    basisUnitCode: 'bundle',
                    amount: { units: '8700', nanos: 0 },
                    currencyCode: 'CNY',
                    derivationKind: 2,
                },
                {
                    basisUnitCode: 'cake',
                    amount: { units: '1242', nanos: 857142850 },
                    currencyCode: 'CNY',
                    derivationKind: 2,
                },
            ],
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
                metaTitle: '保留中文 meta title',
                seo: {
                    title: '保留嵌套 SEO',
                },
            },
        ],
        specifications: [
            {
                group: 'SPEC-GROUP',
                attribute: 'SPEC-ATTRIBUTE',
                type: 'CustomText',
                value: 'keep',
            },
            {
                group: 'SPEC-TT-GROUP-ATOMIC',
                attribute: SOURCE_SPECIFICATIONS.rawPackage,
                type: 'CustomText',
                value: 'stale package',
            },
            {
                group: 'SPEC-TT-GROUP-ATOMIC',
                attribute: SOURCE_SPECIFICATIONS.unitWeight,
                type: 'Number',
                value: '999.000000',
            },
        ],
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

function withoutManagedEnrichment(productValue) {
    const value = clone(productValue);
    delete value.nativeName;
    delete value.translations;
    value.specifications = value.specifications.filter(specification =>
        !Object.values(SOURCE_SPECIFICATIONS).includes(specification.attribute));
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
    const missing = result.entries[0];
    assert.strictEqual(missing.externalId, '9');
    assert.strictEqual(missing.productCode, 'ZZC-9');
    assert.strictEqual(missing.status, 'missing-create-draft');
    assert.strictEqual(missing.published, false);
    assert.strictEqual(missing.productPatch.code, 'ZZC-9');
    assert.strictEqual(missing.productPatch.sku, 'ZZC-9');
    assert.strictEqual(missing.productPatch.published, false);
    assert.strictEqual(missing.productPatch.nativeName, '茶 9');
    assert.deepStrictEqual(
        missing.productPatch.catalogs.map(value => value.category.code),
        ['CAT-PUER-TEA', 'CAT-PUER-SHU', 'CAT-SHAPE-CAKE'],
    );
    assert.ok(missing.productPatch.catalogs.every(value =>
        value.catalog.code === 'CATALOG-PUERH' &&
        value.catalog.currency === 'CNY' &&
        value.published === false));
    assert.deepStrictEqual(missing.productPatch.catalogPrices, []);
    assert.deepStrictEqual(missing.productPatch.tierPrices, []);
    assert.deepStrictEqual(missing.productPatch.storePriceOverrides, []);
    for (const retailField of [
        'price',
        'prices',
        'oldPrice',
        'catalogPrice',
        'productCost',
        'enteredPrice',
        'minEnteredPrice',
        'maxEnteredPrice',
    ]) {
        assert.strictEqual(
            Object.hasOwn(missing.productPatch, retailField),
            false,
            `Draft must not contain retail field ${retailField}.`,
        );
    }
    assert.deepStrictEqual(
        missing.productPatch.translations.map(value => [value.lang, value.name]),
        [['zh-CN', '茶 9']],
    );
    assert.deepStrictEqual(
        Object.keys(missing.productPatch.translations[0]).sort(),
        ['description', 'lang', 'name'],
        'Draft must let DKH.Platform.Seo generate all SEO metadata.',
    );

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

    assert.deepStrictEqual(
        matched.productPatch.translations.map(value => value.lang),
        ['zh-CN'],
        'Source-owned bundle must contain only the source language.',
    );
    const zh = matched.productPatch.translations.find(value => value.lang === 'zh-CN');
    assert.strictEqual(matched.productPatch.nativeName, '茶 17641');
    assert.strictEqual(zh.name, '茶 17641');
    assert.strictEqual(
        zh.description,
        '茶品资料：年份：2025年；包装：每饼357克。',
    );
    for (const field of ['seo', 'seoTitle', 'metaTitle', 'metaDescription']) {
        assert.strictEqual(
            Object.hasOwn(zh, field),
            false,
            `Managed zh-CN translation must not override ${field}.`,
        );
    }
    assert.deepStrictEqual(
        withoutManagedEnrichment(matched.productPatch),
        withoutManagedEnrichment(existing),
        'Only the zh-CN source bundle and source-owned specifications may change.',
    );
    assert.deepStrictEqual(
        matched.productPatch.specifications[0],
        existing.specifications[0],
        'Unrelated baseline specifications must be preserved.',
    );
    const specifications = Object.fromEntries(
        matched.productPatch.specifications.map(value => [value.attribute, value]),
    );
    assert.strictEqual(
        specifications[SOURCE_SPECIFICATIONS.teaType].option,
        'SPEC-TT-OPT-CLASSIFICATION-ORIGIN-TEA-TYPE-PUER',
    );
    assert.strictEqual(
        specifications[SOURCE_SPECIFICATIONS.year].option,
        'OPT-PUERH-VINTAGE-2025',
    );
    assert.strictEqual(
        specifications[SOURCE_SPECIFICATIONS.processing].option,
        'OPT-PUERH-PROCESSING-SHU',
    );
    assert.strictEqual(
        specifications[SOURCE_SPECIFICATIONS.shape].option,
        'OPT-D902FEC129A64389',
    );
    assert.strictEqual(
        specifications[SOURCE_SPECIFICATIONS.rawPackage].value,
        '357克/片 7片/提',
    );
    assert.strictEqual(
        specifications[SOURCE_SPECIFICATIONS.unitWeight].value,
        '357.000000',
    );
    assert.strictEqual(
        specifications[SOURCE_SPECIFICATIONS.referencePriceBasis].value,
        'bundle,cake',
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
    assert.ok(!/zzctea(?:\.com)?|https?:\/\/|www\./iu.test(zh.description));

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

    const importedReference = clone(matched.productPatch);
    importedReference.translations[0].seo = 'platform-generated-seo';
    importedReference.translations[0].metaTitle = '平台生成标题';
    importedReference.translations[0].metaDescription = '平台生成描述';
    importedReference.translations.push(
        clone(existing.translations.find(value => value.lang === 'en-US')),
        clone(existing.translations.find(value => value.lang === 'ru-RU')),
    );
    const repeatedFromImportedReference = reconcileProjection(
        inputs,
        [importedReference, unrelated],
    );
    assert.strictEqual(
        repeatedFromImportedReference.entries[1].status,
        'matched-noop',
        'Generated SEO and preserved non-source locales must not force a weekly update.',
    );

    const inexactItem = projectedItem('17641');
    inexactItem.observation.packageComponentsExact = false;
    inexactItem.observation.packageComponents = [];
    inexactItem.observation.rawPackageText = '约357克/片';
    const inexact = reconcileProjection(
        projection([inexactItem]),
        [existing, unrelated],
    ).entries[0].productPatch;
    const inexactSpecs = Object.fromEntries(
        inexact.specifications.map(value => [value.attribute, value]),
    );
    assert.strictEqual(
        inexactSpecs[SOURCE_SPECIFICATIONS.rawPackage].value,
        '约357克/片',
    );
    assert.strictEqual(inexactSpecs[SOURCE_SPECIFICATIONS.unitWeight], undefined);

    const observedPrice = projectedItem('17641');
    observedPrice.observation.referencePrices[0].amount = {
        units: '999999999',
        nanos: 999999999,
    };
    const priceSafe = reconcileProjection(
        projection([observedPrice]),
        [existing, unrelated],
    ).entries[0].productPatch;
    assert.strictEqual(priceSafe.price, existing.price);
    assert.deepStrictEqual(priceSafe.prices, existing.prices);
    assert.deepStrictEqual(priceSafe.catalogPrices, existing.catalogPrices);
    assert.deepStrictEqual(priceSafe.tierPrices, existing.tierPrices);
    assert.deepStrictEqual(
        priceSafe.storePriceOverrides,
        existing.storePriceOverrides,
    );

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
        'zh-CN': '产品资料来自 zzctea.com。',
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
        'zh-CN': '产品资料来自 zzctea.com。',
    })]);
    assertCode(
        () => reconcileProjection(unsafeMissing, [existing, unrelated]),
        'CATALOG_SOURCE_RECONCILIATION_DESCRIPTION_INVALID',
    );

    const extraLocale = projectedItem('17641');
    extraLocale.observation.localizedText.unshift({
        languageCode: 'en-US',
        title: 'English title',
        description: 'English description.',
    });
    assertCode(
        () => reconcileProjection(projection([extraLocale]), [existing, unrelated]),
        'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
    );

    assert.ok(
        matched.productPatch.specifications.every(specification =>
            specification.attribute !== 'SPEC-TEA-BATCH'),
        'Batch must remain a factual attribute when the catalog has no valid definition.',
    );
    const batchCatalogReference = {
        specificationGroups: [{
            code: 'SPEC-TT-GROUP-ATOMIC',
            published: true,
        }],
        specificationAttributes: [{
            code: 'SPEC-TEA-BATCH',
            group: null,
            type: 'CustomText',
            published: true,
            translations: [
                { lang: 'en-US', name: 'Batch' },
                { lang: 'zh-CN', name: '批次' },
            ],
        }],
    };
    const withBatchDefinition = reconcileProjection(
        projection([projectedItem('17641')]),
        [existing, unrelated],
        { catalogReference: batchCatalogReference },
    ).entries[0].productPatch;
    const batchSpecification = withBatchDefinition.specifications.find(
        specification => specification.attribute === 'SPEC-TEA-BATCH',
    );
    assert.deepStrictEqual(batchSpecification, {
        group: 'SPEC-TT-GROUP-ATOMIC',
        attribute: 'SPEC-TEA-BATCH',
        type: 'CustomText',
        value: '春',
        showOnPage: true,
        order: 25,
    });
    const ambiguousBatchCatalog = clone(batchCatalogReference);
    ambiguousBatchCatalog.specificationAttributes.push({
        ...clone(ambiguousBatchCatalog.specificationAttributes[0]),
        code: 'SPEC-TEA-BATCH-OTHER',
    });
    assertCode(
        () => reconcileProjection(
            projection([projectedItem('17641')]),
            [existing, unrelated],
            { catalogReference: ambiguousBatchCatalog },
        ),
        'CATALOG_SOURCE_RECONCILIATION_BATCH_DEFINITION_AMBIGUOUS',
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
