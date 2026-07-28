'use strict';

const assert = require('assert');
const {
    projectArtifactItems,
    semanticRevisionDigest,
    toDecimalValue,
} = require('./lib/projection');
const {
    sha256,
    stableJson,
} = require('./lib/artifacts');

const DIGESTS = Object.freeze({
    detail: sha256('fixture-detail'),
    list: sha256('fixture-list'),
    raw: sha256('fixture-raw'),
});

function fixtureItem(overrides = {}) {
    const item = {
        schemaVersion: 'catalog-source-item-v1',
        externalId: '17627',
        localizedFields: {
            'zh-CN': {
                name: 'Fixture Case Tea',
            },
        },
        facts: {
            year: 2025,
            yearLabel: '2025年',
            batch: '春',
            productionTechnology: '熟茶',
            shape: '饼',
            brand: {
                externalId: '88',
                name: 'Fixture Brand',
            },
            release: {
                amount: '7200',
                currencyCode: 'CNY',
                quantity: '1600',
                basisUnitCode: 'case',
                kind: 'factory-release-fact',
                retailPrice: false,
            },
        },
        images: [{
            url: 'https://oss.yf-gz.cn/fixture/17627.jpg',
            role: 'primary-source-reference',
        }],
        sourceLinks: {
            stableLookupUrl: 'https://zzctea.com/teaDetail/17627.html',
            observedCanonicalUrl: 'https://zzctea.com/teaDetail/17627.html',
        },
        package: {
            rawText: '357克/片 7片/提 6提/件',
            components: [
                { quantity: '357', containedUnitCode: 'g', containerUnitCode: 'cake' },
                { quantity: '7', containedUnitCode: 'cake', containerUnitCode: 'bundle' },
                { quantity: '6', containedUnitCode: 'bundle', containerUnitCode: 'case' },
            ],
            isExact: true,
            diagnosticCode: null,
        },
        referencePrices: [
            {
                amount: '8700',
                currencyCode: 'CNY',
                basisUnitCode: 'case',
                observedSourceUpdatedAt: '2026-07-20T00:00:00.000Z',
                kind: 'source-reference',
                retailPrice: false,
                roundingPolicy: { mode: 'none' },
            },
            {
                amount: '1450',
                currencyCode: 'CNY',
                basisUnitCode: 'bundle',
                observedSourceUpdatedAt: '2026-07-20T00:00:00.000Z',
                kind: 'derived-reference',
                retailPrice: false,
                derivation: {
                    sourceAmount: '8700',
                    sourceBasisUnitCode: 'case',
                    cumulativeDivisor: '6',
                    exactFraction: { numerator: '1450', denominator: '1' },
                    roundingPolicy: { mode: 'half-up', scale: 8 },
                },
            },
            {
                amount: '207.14285714',
                currencyCode: 'CNY',
                basisUnitCode: 'cake',
                observedSourceUpdatedAt: '2026-07-20T00:00:00.000Z',
                kind: 'derived-reference',
                retailPrice: false,
                derivation: {
                    sourceAmount: '8700',
                    sourceBasisUnitCode: 'case',
                    cumulativeDivisor: '42',
                    exactFraction: { numerator: '1450', denominator: '7' },
                    roundingPolicy: { mode: 'half-up', scale: 8 },
                },
            },
        ],
        sourceUpdatedAt: '2026-07-20T00:00:00.000Z',
        diagnostics: [
            'ZZCTEA_REFERENCE_PRICE_HIDDEN',
            'SOURCE_DETAIL_WARNING',
        ],
        provenance: {
            parserVersion: 'zzctea-public-catalog-js-v1',
            listPayloadDigest: DIGESTS.list,
            detailPayloadDigest: DIGESTS.detail,
            observedAt: '2026-07-28T00:00:00.000Z',
        },
    };
    return {
        ...item,
        ...overrides,
    };
}

function finalizeArtifact(items = [fixtureItem()], overrides = {}) {
    const artifact = {
        schemaVersion: 'catalog-source-artifact-v1',
        source: {
            id: 'zzctea',
            connectorVersion: 'zzctea-connector-v1',
            kind: 'public-reference-catalog',
            referencePricesAreRetailPrices: false,
        },
        snapshot: {
            id: 'zzctea-2026-07-28',
            observedAt: '2026-07-28T00:00:00.000Z',
            parserVersion: 'zzctea-public-catalog-js-v1',
            rawPayloadDigest: DIGESTS.raw,
            complete: true,
            authoritativeForDeletion: false,
        },
        itemCount: items.length,
        items,
        deletions: [],
        diagnostics: [],
        ...overrides,
    };
    const semanticProjection = {
        ...artifact,
        snapshot: {
            ...artifact.snapshot,
            observedAt: undefined,
        },
        items: artifact.items.map(item => ({
            ...item,
            provenance: {
                ...item.provenance,
                observedAt: undefined,
            },
        })),
    };
    artifact.semanticDigest = sha256(stableJson(semanticProjection));
    return {
        artifact,
        artifactSha256: sha256(stableJson(artifact)),
    };
}

function project(items = [fixtureItem()], overrides = {}) {
    const complete = finalizeArtifact(items, overrides);
    return projectArtifactItems(complete.artifact, {
        artifactSha256: complete.artifactSha256,
    });
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function assertCode(action, code) {
    assert.throws(action, error => error.code === code, `Expected ${code}`);
}

function main() {
    const projected = project();
    assert.strictEqual(projected.length, 1);
    assert.deepStrictEqual(Object.keys(projected[0]).sort(), [
        'externalId',
        'idempotencyKey',
        'observation',
    ]);
    assert.strictEqual(projected[0].externalId, '17627');
    assert.match(projected[0].idempotencyKey, /^catalog-source\.item\.[0-9a-f]{64}$/);

    const observation = projected[0].observation;
    assert.strictEqual(observation.externalId, '17627');
    assert.deepStrictEqual(observation.localizedText, [
        {
            languageCode: 'zh-CN',
            title: 'Fixture Case Tea',
            description: '茶品资料：品牌：Fixture Brand；年份：2025年；批次：春；工艺：熟茶；形态：饼；包装：每饼357克，每提7饼，每件6提。',
        },
    ]);
    const sourceLanguageOnly = fixtureItem({
        localizedFields: {
            'en-US': {
                name: 'English title must not be projected',
            },
            'zh-CN': {
                name: 'Source title stays exact',
            },
        },
    });
    assert.deepStrictEqual(
        project([sourceLanguageOnly])[0].observation.localizedText.map(value => ({
            languageCode: value.languageCode,
            title: value.title,
        })),
        [{
            languageCode: 'zh-CN',
            title: 'Source title stays exact',
        }],
    );
    assert.ok(observation.localizedText.every(value =>
        !/zzctea(?:\.com)?/i.test(value.description)));

    const sourceDescription = fixtureItem({
        localizedFields: {
            'zh-CN': {
                name: 'Fixture Case Tea',
                description: '云南大叶种晒青毛茶制成，饼形端正。',
            },
        },
    });
    const sourceDescriptionProjection = project([sourceDescription])[0].observation;
    assert.ok(sourceDescriptionProjection.localizedText.every(value =>
        value.description.startsWith('云南大叶种晒青毛茶制成，饼形端正。\n\n')));
    const sourceBoilerplateFact = fixtureItem({
        facts: {
            ...fixtureItem().facts,
            brand: {
                externalId: '88',
                name: '找找茶最新报价',
            },
        },
    });
    assert.ok(project([sourceBoilerplateFact])[0].observation.localizedText.every(value =>
        !/(?:找找茶|最新报价)/u.test(value.description)));
    const missingSourceLanguage = fixtureItem({
        localizedFields: {
            'en-US': { name: 'English only' },
        },
    });
    assertCode(
        () => project([missingSourceLanguage]),
        'CATALOG_SOURCE_PROJECTION_LOCALIZED_TEXT_INVALID',
    );
    assert.deepStrictEqual(
        observation.factualAttributes.map(value => value.attributeCode),
        [
            'batch',
            'brand.external-id',
            'brand.name',
            'production-technology',
            'release.amount',
            'release.basis-unit-code',
            'release.currency-code',
            'release.kind',
            'release.quantity',
            'release.retail-price',
            'shape',
            'year',
            'year-label',
        ],
    );
    assert.strictEqual(
        observation.sourceDestination.lookupUri,
        'https://zzctea.com/teaDetail/17627.html',
    );
    assert.match(observation.sourceDestination.provenanceDigest, /^[0-9a-f]{64}$/);
    assert.deepStrictEqual(observation.packageComponents[0], {
        quantity: { units: '357', nanos: 0 },
        containedUnitCode: 'g',
        containerUnitCode: 'cake',
        ordinal: 0,
    });
    assert.strictEqual(observation.packageComponentsExact, true);
    assert.strictEqual(observation.rawPackageText, '357克/片 7片/提 6提/件');
    assert.deepStrictEqual(observation.imageUris, [
        'https://oss.yf-gz.cn/fixture/17627.jpg',
    ]);
    assert.deepStrictEqual(observation.diagnosticCodes, [
        'reference_price_hidden',
        'source_detail_warning',
    ]);
    assert.ok(observation.diagnosticCodes.every(code => /^[a-z0-9][a-z0-9._-]*$/.test(code)));

    const [sourcePrice, bundlePrice, cakePrice] = observation.referencePrices;
    assert.strictEqual(sourcePrice.derivationKind, 1);
    assert.deepStrictEqual(sourcePrice.amount, { units: '8700', nanos: 0 });
    assert.strictEqual(bundlePrice.derivationKind, 2);
    assert.strictEqual(bundlePrice.derivedFromObservationKey, sourcePrice.observationKey);
    assert.deepStrictEqual(bundlePrice.derivationDivisor, { units: '6', nanos: 0 });
    assert.strictEqual(cakePrice.derivedFromObservationKey, sourcePrice.observationKey);
    assert.deepStrictEqual(cakePrice.amount, {
        units: '207',
        nanos: 142857140,
    });
    assert.deepStrictEqual(cakePrice.derivationDivisor, {
        units: '42',
        nanos: 0,
    });
    assert.strictEqual(cakePrice.exactFractionNumerator, '1450');
    assert.strictEqual(cakePrice.exactFractionDenominator, '7');
    assert.strictEqual(cakePrice.roundingMode, 'half-up');
    assert.strictEqual(cakePrice.roundingScale, 8);

    const laterObservation = fixtureItem({
        provenance: {
            ...fixtureItem().provenance,
            observedAt: '2026-08-04T00:00:00.000Z',
        },
    });
    assert.strictEqual(
        semanticRevisionDigest(fixtureItem()),
        semanticRevisionDigest(laterObservation),
        'Observation time must not change semantic revision identity.',
    );
    const changedFact = fixtureItem({
        facts: {
            ...fixtureItem().facts,
            year: 2026,
        },
    });
    assert.notStrictEqual(
        semanticRevisionDigest(fixtureItem()),
        semanticRevisionDigest(changedFact),
        'A changed fact must change semantic revision identity.',
    );

    const sourceOnly = fixtureItem({
        referencePrices: [fixtureItem().referencePrices[0]],
    });
    const changedSourceAmount = clone(sourceOnly);
    changedSourceAmount.referencePrices[0].amount = '8800';
    assert.strictEqual(
        project([sourceOnly])[0].observation.referencePrices[0].observationKey,
        project([changedSourceAmount])[0].observation.referencePrices[0].observationKey,
        'Price observation identity must not depend on the observed amount.',
    );

    assert.deepStrictEqual(toDecimalValue('0.00000001'), {
        units: '0',
        nanos: 10,
    });
    assert.deepStrictEqual(toDecimalValue('-1.75'), {
        units: '-1',
        nanos: -750000000,
    });
    assert.deepStrictEqual(toDecimalValue('9223372036854775807'), {
        units: '9223372036854775807',
        nanos: 0,
    });
    assertCode(
        () => toDecimalValue('1e3'),
        'CATALOG_SOURCE_PROJECTION_DECIMAL_INVALID',
    );
    assertCode(
        () => toDecimalValue('1.000000001'),
        'CATALOG_SOURCE_PROJECTION_DECIMAL_SCALE_INVALID',
    );
    assertCode(
        () => toDecimalValue('9223372036854775808'),
        'CATALOG_SOURCE_PROJECTION_DECIMAL_RANGE_INVALID',
    );

    const retail = clone(fixtureItem());
    retail.referencePrices[0].retailPrice = true;
    assertCode(
        () => project([retail]),
        'CATALOG_SOURCE_PROJECTION_RETAIL_PRICE_FORBIDDEN',
    );

    const invalidHost = clone(fixtureItem());
    invalidHost.sourceLinks.stableLookupUrl = 'http://zzctea.com/teaDetail/17627.html';
    assertCode(
        () => project([invalidHost]),
        'CATALOG_SOURCE_PROJECTION_URI_INVALID',
    );
    const privateHost = clone(fixtureItem());
    privateHost.images[0].url = 'https://127.0.0.1/fixture.jpg';
    assertCode(
        () => project([privateHost]),
        'CATALOG_SOURCE_PROJECTION_URI_INVALID',
    );

    const badFraction = clone(fixtureItem());
    badFraction.referencePrices[2].derivation.exactFraction.numerator = '1451';
    assertCode(
        () => project([badFraction]),
        'CATALOG_SOURCE_PROJECTION_PRICE_LINEAGE_INVALID',
    );
    const unreducedFraction = clone(fixtureItem());
    unreducedFraction.referencePrices[2].derivation.exactFraction = {
        numerator: '2900',
        denominator: '14',
    };
    assertCode(
        () => project([unreducedFraction]),
        'CATALOG_SOURCE_PROJECTION_FRACTION_INVALID',
    );
    const wrongRoundedAmount = clone(fixtureItem());
    wrongRoundedAmount.referencePrices[2].amount = '207.14285715';
    assertCode(
        () => project([wrongRoundedAmount]),
        'CATALOG_SOURCE_PROJECTION_PRICE_LINEAGE_INVALID',
    );
    const wrongSourceLineage = clone(fixtureItem());
    wrongSourceLineage.referencePrices[2].derivation.sourceAmount = '8600';
    assertCode(
        () => project([wrongSourceLineage]),
        'CATALOG_SOURCE_PROJECTION_PRICE_LINEAGE_INVALID',
    );

    const duplicatePrice = clone(fixtureItem());
    duplicatePrice.referencePrices.push(clone(duplicatePrice.referencePrices[0]));
    assertCode(
        () => project([duplicatePrice]),
        'CATALOG_SOURCE_PROJECTION_PRICE_DUPLICATE',
    );
    const tooManyPrices = clone(fixtureItem());
    tooManyPrices.referencePrices = Array.from(
        { length: 33 },
        () => clone(fixtureItem().referencePrices[0]),
    );
    assertCode(
        () => project([tooManyPrices]),
        'CATALOG_SOURCE_PROJECTION_PRICE_INVALID',
    );
    assertCode(
        () => project([fixtureItem(), fixtureItem()]),
        'CATALOG_SOURCE_PROJECTION_ITEM_DUPLICATE',
    );

    const invalidPackage = clone(fixtureItem());
    invalidPackage.package.isExact = false;
    assertCode(
        () => project([invalidPackage]),
        'CATALOG_SOURCE_PROJECTION_PACKAGE_INVALID',
    );

    const complete = finalizeArtifact();
    assertCode(
        () => projectArtifactItems(complete.artifact, {
            artifactSha256: sha256('wrong artifact'),
        }),
        'CATALOG_SOURCE_PROJECTION_ARTIFACT_HASH_MISMATCH',
    );

    console.log('test-projection: OK');
}

main();
