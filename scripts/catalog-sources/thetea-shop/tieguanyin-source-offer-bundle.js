'use strict';

const { sha256, stableJson } = require('../lib/artifacts');
const {
    CATALOG_CODE,
    PRODUCT_CODE,
} = require('./tieguanyin-normalizer');

const BUNDLE_FORMAT_CODE = 'commerce-source-offer-bundle';
const BUNDLE_SCHEMA_VERSION = '1.0';
const PRODUCER = 'DKH.TeaCatalogData/thetea-shop';
const REGISTERED_SOURCE_CODE = 'thetea-shop-price-base';
const PARSER_VERSION = 'thetea-shop-tieguanyin-source-offer-v1';
const SNAPSHOT_ID = 'thetea-shop-tieguanyin-price-base-2026-08-01';

function fail(code, detail = '') {
    const error = new Error(detail ? `${code}: ${detail}` : code);
    error.code = code;
    throw error;
}

function observedAt(manifest) {
    return manifest.source.capturedAt || `${manifest.source.priceBaseDate}T00:00:00Z`;
}

function digest(value) {
    return `sha256:${sha256(stableJson(value))}`;
}

function decimal(value) {
    if (value === null || value === undefined) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        fail('TGY_SOURCE_OFFER_PRICE_INVALID', String(value));
    }
    return number;
}

function textValue(value) {
    return {
        kind: 'text',
        normalizedValue: String(value),
        textValue: String(value),
    };
}

function numberFact(code, value, unitCode = null) {
    return {
        code,
        value: {
            kind: 'number',
            normalizedValue: String(value),
            numericValue: Number(value),
        },
        unitCode,
    };
}

function textFact(code, value, languageCode = null) {
    return {
        code,
        value: textValue(value),
        languageCode,
    };
}

function sourceAttribute(code, value, languageCode = null) {
    return {
        attributeCode: code,
        normalizedValue: String(value),
        languageCode,
        sourceValueDigest: digest({ code, value }),
    };
}

function diagnostic(severity, code, rowNumber, message = null, path = null) {
    return {
        severity,
        code,
        message,
        rowNumber,
        path,
    };
}

function packageText(row) {
    if (row.package.kind === 'exact-weight') {
        return `${row.package.quantity} ${row.package.unitCode}`;
    }
    return 'by weight variant';
}

function referencePrices(row, when) {
    const prices = row.sourcePriceObservation.referencePrices.map(price => ({
        observationKey: price.observationKey,
        state: 'known',
        amount: decimal(price.amount),
        currencyCode: row.sourcePriceObservation.currencyCode,
        basisUnitCode: price.basisUnitCode,
        derivationKind: price.derivationKind,
        observedAt: when,
        sourceUpdatedAt: when,
        provenanceDigest: digest({
            clientReference: row.clientReference,
            observationKey: price.observationKey,
            amount: price.amount,
            basisUnitCode: price.basisUnitCode,
            currencyCode: row.sourcePriceObservation.currencyCode,
        }),
    }));

    if (prices.length === 0) {
        return [{
            observationKey: `${row.clientReference}.price-pack`,
            state: 'unknown',
            amount: null,
            currencyCode: row.sourcePriceObservation.currencyCode,
            basisUnitCode: 'package',
            derivationKind: 'source',
            observedAt: when,
            sourceUpdatedAt: when,
            provenanceDigest: digest({
                clientReference: row.clientReference,
                observationKey: 'price-pack',
                state: 'unknown',
            }),
        }];
    }

    return prices;
}

function sourceItem(row, source, when) {
    const itemPayload = {
        clientReference: row.clientReference,
        gradeLabel: row.gradeLabel,
        package: row.package,
        sourcePriceObservation: row.sourcePriceObservation,
        diagnostics: row.diagnostics,
    };
    const rowDigest = digest(itemPayload);
    return {
        externalId: row.clientReference,
        semanticRevisionDigest: rowDigest,
        listPayloadDigest: digest({
            rowsSha256: source.rowsSha256,
            sourceOrder: row.sourceOrder,
        }),
        detailPayloadDigest: rowDigest,
        localizedTexts: [{
            languageCode: 'zh-CN',
            title: row.gradeLabel,
            description: null,
        }],
        factualAttributes: [
            sourceAttribute('catalog.product-code', row.productCode),
            sourceAttribute('catalog.catalog-code', row.catalogCode),
            sourceAttribute('source.grade-label', row.gradeLabel, 'zh-CN'),
            sourceAttribute('source.grade-value-code', row.gradeValueCode),
            sourceAttribute('source.package-kind', row.package.kind),
            sourceAttribute('source.price-terms', row.sourcePriceObservation.priceTerms),
            sourceAttribute('source.price-base-date', row.sourcePriceObservation.observedPriceBaseDate),
            ...(row.package.kind === 'exact-weight'
                ? [
                    sourceAttribute('source.package-quantity', row.package.quantity),
                    sourceAttribute('source.package-unit', row.package.unitCode),
                ]
                : []),
        ],
        sourceDestination: {
            lookupUri: `${source.url}#row-${String(row.sourceOrder).padStart(3, '0')}`,
            canonicalUri: source.url,
            observedAt: when,
            provenanceDigest: digest({
                url: source.url,
                sourceOrder: row.sourceOrder,
            }),
        },
        rawPackageText: packageText(row),
        packageComponents: row.package.kind === 'exact-weight'
            ? [{
                quantity: Number(row.package.quantity),
                containedUnitCode: row.package.unitCode,
                containerUnitCode: 'package',
                ordinal: 1,
            }]
            : [],
        packageComponentsExact: row.package.kind === 'exact-weight',
        imageUris: [],
        sourceUpdatedAt: when,
        referencePrices: referencePrices(row, when),
        diagnosticCodes: row.diagnostics,
    };
}

function offerTerms(row) {
    const terms = [
        {
            code: 'source.grade-label',
            role: 'commercial-attribute',
            visibility: 'public',
            value: textValue(row.gradeLabel),
            label: 'Supplier grade',
            languageCode: 'zh-CN',
            sortOrder: 10,
            highlighted: true,
        },
        {
            code: 'source.package',
            role: 'packaging',
            visibility: 'public',
            value: textValue(packageText(row)),
            label: 'Package',
            sortOrder: 20,
            highlighted: true,
        },
        {
            code: 'source.price-terms',
            role: 'selling-condition',
            visibility: 'counterparty',
            value: textValue(row.sourcePriceObservation.priceTerms),
            label: 'Source price terms',
            sortOrder: 30,
            highlighted: false,
        },
    ];

    if (row.offerPublicationMode === 'request-only') {
        terms.push({
            code: 'source.request-only-reason',
            role: 'disclosure',
            visibility: 'public',
            value: textValue(row.diagnostics.join(',')),
            label: 'Request-only reason',
            sortOrder: 40,
            highlighted: false,
        });
    }

    return terms;
}

function specifications(row) {
    return [
        textFact('catalog.product-code', row.productCode),
        textFact('catalog.catalog-code', row.catalogCode),
        textFact('source.grade-label', row.gradeLabel, 'zh-CN'),
        textFact('source.grade-value-code', row.gradeValueCode),
        textFact('source.package-kind', row.package.kind),
        textFact('source.package-text', packageText(row)),
        numberFact('source.price-kg', row.sourcePriceObservation.perKgAmount, 'kg'),
        ...(row.sourcePriceObservation.packageAmount === null
            ? []
            : [numberFact('source.price-pack', row.sourcePriceObservation.packageAmount, 'package')]),
    ];
}

function productMappingHints(row) {
    return [{
        hintKind: 'product-code',
        productCode: row.productCode,
        sellableCode: row.sellableInternalCode,
        displayName: row.gradeLabel,
        confidence: row.sellableInternalCode ? 1 : 0.7,
        evidenceFacts: [
            textFact('catalog.product-code', row.productCode),
            textFact('source.grade-label', row.gradeLabel, 'zh-CN'),
            textFact('source.package-text', packageText(row)),
        ],
    }];
}

function position(row, source, when) {
    return {
        rowNumber: row.sourceOrder,
        clientReference: row.clientReference,
        sourceItem: sourceItem(row, source, when),
        productMappingHints: productMappingHints(row),
        offerTerms: offerTerms(row),
        wholesaleTiers: [],
        discounts: [],
        mediaReferences: [],
        specifications: specifications(row),
        diagnostics: row.diagnostics.map(code => diagnostic(
            code === 'duplicate-fixed-package-source-price' ? 'warning' : 'info',
            `source.${code}`,
            row.sourceOrder,
            code,
            '$.sourcePositions[].sourceItem',
        )),
    };
}

function buildCommerceSourceOfferBundle(manifest, options = {}) {
    if (!manifest ||
        manifest.target?.productCode !== PRODUCT_CODE ||
        manifest.target?.catalogCode !== CATALOG_CODE ||
        !Array.isArray(manifest.sourceOfferRows) ||
        manifest.sourceOfferRows.length !== manifest.summary?.rowCount) {
        fail('TGY_SOURCE_OFFER_MANIFEST_INVALID');
    }

    const when = options.generatedAt || observedAt(manifest);
    const sourcePositions = manifest.sourceOfferRows.map(row => position(row, manifest.source, when));
    const semanticPayload = {
        source: {
            url: manifest.source.url,
            rowsSha256: manifest.source.rowsSha256,
            priceBaseDate: manifest.source.priceBaseDate,
        },
        sourcePositions,
    };
    const rawPayloadDigest = `sha256:${manifest.source.rowsSha256}`;
    const semanticDigest = digest(semanticPayload);

    return {
        manifest: {
            formatCode: BUNDLE_FORMAT_CODE,
            schemaVersion: BUNDLE_SCHEMA_VERSION,
            producer: PRODUCER,
            bundleId: options.bundleId || SNAPSHOT_ID,
            rawPayloadDigest,
            semanticDigest,
            generatedAt: when,
            defaultLanguageCode: 'zh-CN',
            defaultCurrencyCode: manifest.source.currencyCode,
        },
        import: {
            begin: {
                registeredSourceCode: options.registeredSourceCode || REGISTERED_SOURCE_CODE,
                connectorVersion: options.connectorVersion || manifest.schemaVersion,
                parserVersion: options.parserVersion || PARSER_VERSION,
                artifactSchemaVersion: BUNDLE_FORMAT_CODE,
                snapshotId: options.snapshotId || SNAPSHOT_ID,
                expectedItemCount: sourcePositions.length,
                rawPayloadDigest,
                semanticDigest,
                observedAt: observedAt(manifest),
            },
            sourceListKind: 'supplier-price-base',
            sourceListName: 'TheTea Shop Tie Guanyin price base',
            sourceFileType: 'json',
            providerCounterpartyId: null,
            storefrontId: null,
            catalogId: null,
        },
        sourcePositions,
        exportDiagnostics: [
            diagnostic(
                'info',
                'bundle.source-offer-rows-preserved',
                null,
                `${sourcePositions.length} source offer rows preserved from immutable price base.`,
            ),
        ],
    };
}

module.exports = {
    BUNDLE_FORMAT_CODE,
    BUNDLE_SCHEMA_VERSION,
    buildCommerceSourceOfferBundle,
};
