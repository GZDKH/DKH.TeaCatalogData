'use strict';

const { sha256, stableJson } = require('../lib/artifacts');

const SNAPSHOT_SCHEMA = 'thetea-shop-tieguanyin-price-base-v1';
const NORMALIZED_SCHEMA = 'thetea-shop-tieguanyin-grade-manifest-v1';
const PRODUCT_CODE = 'TEA-CN-TIE-GUANYIN';
const CATALOG_CODE = 'CATALOG-CHINESE-TEA-SHOP';
const SOURCE_SLUG = 'thetea-shop-tie-guanyin';

function reject(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function assertPositiveDecimal(value, optional = false) {
    if (optional && value === null) return;
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
        reject('THETEA_SHOP_PRICE_INVALID');
    }
    if (/^0(?:\.0+)?$/u.test(value)) reject('THETEA_SHOP_PRICE_INVALID');
}

function stableCode(prefix, value) {
    return `${prefix}-${sha256(Buffer.from(value, 'utf8')).slice(0, 12).toUpperCase()}`;
}

function sourceOfferClientReference(sourceOrder) {
    return `${SOURCE_SLUG}-row-${String(sourceOrder).padStart(3, '0')}`;
}

function normalizeRow(row, index, source) {
    if (!row || typeof row !== 'object' || row.sourceOrder !== index + 1) {
        reject('THETEA_SHOP_SOURCE_ORDER_INVALID');
    }
    const gradeLabel = typeof row.gradeLabel === 'string' ? row.gradeLabel.trim() : '';
    if (!gradeLabel || gradeLabel !== row.gradeLabel || gradeLabel.length > 100) {
        reject('THETEA_SHOP_GRADE_LABEL_INVALID');
    }
    assertPositiveDecimal(row.packagePriceCny, true);
    assertPositiveDecimal(row.perKgCny);
    if (!row.package || !['exact-weight', 'weight-only'].includes(row.package.kind)) {
        reject('THETEA_SHOP_PACKAGE_KIND_INVALID');
    }
    if (row.package.kind === 'exact-weight' &&
        (row.package.quantity !== '500' || row.package.unitCode !== 'g')) {
        reject('THETEA_SHOP_EXACT_PACKAGE_INVALID');
    }
    if (row.package.kind === 'weight-only' &&
        (row.package.quantity !== undefined || row.package.unitCode !== undefined ||
            row.packagePriceCny !== null)) {
        reject('THETEA_SHOP_WEIGHT_ONLY_PACKAGE_INVALID');
    }
    return {
        sourceOrder: row.sourceOrder,
        gradeLabel,
        package: { ...row.package },
        sourcePriceObservation: {
            packageAmount: row.packagePriceCny,
            perKgAmount: row.perKgCny,
            currencyCode: source.currencyCode,
            observedPriceBaseDate: source.priceBaseDate,
            priceTerms: source.priceTerms,
            kind: 'source-reference',
            retailPrice: false,
            publicationAllowed: false,
        },
    };
}

function assertExpected(actual, expected) {
    for (const [key, value] of Object.entries(expected || {})) {
        if (actual[key] !== value) reject(`THETEA_SHOP_EXPECTED_${key.toUpperCase()}_MISMATCH`);
    }
}

function fixedPackageKey(row) {
    if (row.package.kind !== 'exact-weight') return null;
    return `${row.gradeLabel}\u0000${row.package.quantity}\u0000${row.package.unitCode}`;
}

function sourceOfferRow(row, duplicateKeyCounts) {
    const gradeValueCode = stableCode('TGY-GRADE', row.gradeLabel);
    const key = fixedPackageKey(row);
    const diagnostics = [];
    if (row.package.kind === 'weight-only') {
        diagnostics.push('exact-sale-quantity-missing');
    }
    if (row.package.kind === 'exact-weight' && row.sourcePriceObservation.packageAmount === null) {
        diagnostics.push('source-package-price-missing');
    }
    if (key && duplicateKeyCounts.get(key) > 1) {
        diagnostics.push('duplicate-fixed-package-source-price');
    }

    const priceObservation = row.sourcePriceObservation;
    return {
        sourceOrder: row.sourceOrder,
        clientReference: sourceOfferClientReference(row.sourceOrder),
        productCode: PRODUCT_CODE,
        catalogCode: CATALOG_CODE,
        gradeLabel: row.gradeLabel,
        gradeValueCode,
        package: { ...row.package },
        sellableInternalCode: row.package.kind === 'exact-weight'
            ? stableCode(`${PRODUCT_CODE}-500G`, `${row.gradeLabel}|500|g`)
            : null,
        offerPublicationMode: diagnostics.includes('exact-sale-quantity-missing') ||
            diagnostics.includes('source-package-price-missing')
            ? 'request-only'
            : 'source-reference',
        sourcePriceObservation: {
            ...priceObservation,
            referencePrices: [
                ...(priceObservation.packageAmount === null
                    ? []
                    : [{
                        observationKey: `${sourceOfferClientReference(row.sourceOrder)}.price-pack`,
                        amount: priceObservation.packageAmount,
                        basisUnitCode: 'package',
                        derivationKind: 'source',
                    }]),
                {
                    observationKey: `${sourceOfferClientReference(row.sourceOrder)}.price-kg`,
                    amount: priceObservation.perKgAmount,
                    basisUnitCode: 'kg',
                    derivationKind: 'source',
                },
            ],
        },
        diagnostics,
    };
}

function normalizeTieguanyinSnapshot(snapshot) {
    if (!snapshot || snapshot.schemaVersion !== SNAPSHOT_SCHEMA || !Array.isArray(snapshot.rows)) {
        reject('THETEA_SHOP_SNAPSHOT_INVALID');
    }
    const source = snapshot.source || {};
    if (source.url !== 'https://shop.thetea.app/tea/tie-guanyin' ||
        source.currencyCode !== 'CNY' ||
        source.priceTerms !== 'EXW' ||
        source.stockPublished !== false ||
        source.sellerIdentityVerified !== false ||
        source.mediaLicenseVerified !== false ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(source.priceBaseDate || '') ||
        typeof source.capturedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(source.capturedAt) ||
        !Number.isFinite(Date.parse(source.capturedAt))) {
        reject('THETEA_SHOP_SOURCE_POLICY_INVALID');
    }
    const rowsHash = sha256(stableJson(snapshot.rows));
    if (snapshot.rowsSha256 !== rowsHash) reject('THETEA_SHOP_ROWS_HASH_MISMATCH');

    const rows = snapshot.rows.map((row, index) => normalizeRow(row, index, source));
    const gradeLabels = new Set(rows.map(row => row.gradeLabel));
    const exactGroups = new Map();
    const fixedPackageCounts = new Map();
    const blockedObservations = [];

    for (const row of rows) {
        const key = fixedPackageKey(row);
        if (key) fixedPackageCounts.set(key, (fixedPackageCounts.get(key) || 0) + 1);
    }

    for (const row of rows) {
        const gradeValueCode = stableCode('TGY-GRADE', row.gradeLabel);
        if (row.package.kind === 'weight-only') {
            blockedObservations.push({
                sourceOrder: row.sourceOrder,
                gradeLabel: row.gradeLabel,
                gradeValueCode,
                sourcePriceObservation: row.sourcePriceObservation,
                blockedReason: 'exact-sale-quantity-missing',
            });
            continue;
        }
        const key = `${row.gradeLabel}\u0000${row.package.quantity}\u0000${row.package.unitCode}`;
        const group = exactGroups.get(key) || {
            key,
            gradeLabel: row.gradeLabel,
            gradeValueCode,
            package: row.package,
            observations: [],
        };
        group.observations.push({
            sourceOrder: row.sourceOrder,
            ...row.sourcePriceObservation,
        });
        exactGroups.set(key, group);
    }

    const exactCandidates = [...exactGroups.values()].map(group => ({
        productCode: PRODUCT_CODE,
        catalogCode: CATALOG_CODE,
        gradeLabel: group.gradeLabel,
        gradeValueCode: group.gradeValueCode,
        package: group.package,
        sellableInternalCode: stableCode(
            `${PRODUCT_CODE}-500G`,
            `${group.gradeLabel}|500|g`,
        ),
        publicationMode: 'request-only',
        sourcePriceObservations: group.observations,
    }));
    const duplicateOfferCandidates = exactCandidates
        .filter(candidate => candidate.sourcePriceObservations.length > 1)
        .map(candidate => ({
            gradeLabel: candidate.gradeLabel,
            gradeValueCode: candidate.gradeValueCode,
            package: candidate.package,
            sourcePriceObservations: candidate.sourcePriceObservations,
            blockedReason: 'seller-and-commercial-authority-missing',
        }));
    const sourceOfferRows = rows.map(row => sourceOfferRow(row, fixedPackageCounts));
    const summary = {
        rowCount: rows.length,
        uniqueGradeLabelCount: gradeLabels.size,
        fixedPackageRowCount: rows.filter(row => row.package.kind === 'exact-weight').length,
        uniqueFixedPackageCandidateCount: exactCandidates.length,
        duplicateFixedPackageKeyCount: duplicateOfferCandidates.length,
        weightOnlyRowCount: blockedObservations.length,
        sourceOfferRowCount: sourceOfferRows.length,
    };
    assertExpected(
        {
            rowCount: summary.rowCount,
            uniqueGradeLabelCount: summary.uniqueGradeLabelCount,
            fixedPackageRowCount: summary.fixedPackageRowCount,
            uniqueFixedPackageCandidateCount: summary.uniqueFixedPackageCandidateCount,
            duplicateFixedPackageKeyCount: summary.duplicateFixedPackageKeyCount,
            weightOnlyRowCount: summary.weightOnlyRowCount,
        },
        snapshot.expected,
    );

    return {
        schemaVersion: NORMALIZED_SCHEMA,
        source: { ...source, rowsSha256: rowsHash },
        target: {
            productCode: PRODUCT_CODE,
            catalogCode: CATALOG_CODE,
            variantAxisCode: 'TGY-GRADE',
        },
        summary,
        exactCandidates,
        sourceOfferRows,
        duplicateOfferCandidates,
        blockedObservations,
        manifestSha256: sha256(stableJson({
            source: { ...source, rowsSha256: rowsHash },
            summary,
            exactCandidates,
            sourceOfferRows,
            duplicateOfferCandidates,
            blockedObservations,
        })),
    };
}

module.exports = {
    CATALOG_CODE,
    NORMALIZED_SCHEMA,
    PRODUCT_CODE,
    SNAPSHOT_SCHEMA,
    normalizeTieguanyinSnapshot,
    sourceOfferClientReference,
    stableCode,
};
