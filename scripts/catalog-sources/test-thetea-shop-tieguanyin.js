'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { sha256, stableJson } = require('./lib/artifacts');
const {
    CATALOG_CODE,
    PRODUCT_CODE,
    normalizeTieguanyinSnapshot,
} = require('./thetea-shop/tieguanyin-normalizer');
const {
    buildCommerceSourceOfferBundle,
} = require('./thetea-shop/tieguanyin-source-offer-bundle');

const FIXTURE = path.join(
    __dirname,
    'thetea-shop',
    'fixtures',
    'tieguanyin-price-base-2026-08-01.json',
);

function readFixture() {
    return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

function assertRejectsCode(action, code) {
    assert.throws(action, error => error.code === code);
}

function main() {
    const snapshot = readFixture();
    assert.strictEqual(snapshot.rowsSha256, sha256(stableJson(snapshot.rows)));
    assert.deepStrictEqual(
        snapshot.rows.map(row => row.sourceOrder),
        Array.from({ length: 36 }, (_, index) => index + 1),
    );
    assert.ok(snapshot.rows.every(row => /\p{Script=Han}/u.test(row.gradeLabel)));

    const manifest = normalizeTieguanyinSnapshot(snapshot);
    assert.deepStrictEqual(manifest.summary, {
        rowCount: 36,
        uniqueGradeLabelCount: 31,
        fixedPackageRowCount: 29,
        uniqueFixedPackageCandidateCount: 25,
        duplicateFixedPackageKeyCount: 4,
        weightOnlyRowCount: 7,
        sourceOfferRowCount: 36,
    });
    assert.strictEqual(manifest.target.productCode, PRODUCT_CODE);
    assert.strictEqual(manifest.target.catalogCode, CATALOG_CODE);
    assert.strictEqual(manifest.exactCandidates.length, 25);
    assert.strictEqual(manifest.sourceOfferRows.length, 36);
    assert.strictEqual(manifest.blockedObservations.length, 7);
    assert.strictEqual(manifest.duplicateOfferCandidates.length, 4);
    assert.deepStrictEqual(
        manifest.duplicateOfferCandidates.map(item => item.gradeLabel),
        ['铁观音果香', '花香铁观音', '2026春花香铁观音', '铁观音茶王'],
    );
    assert.ok(manifest.exactCandidates.every(candidate =>
        candidate.package.quantity === '500' &&
        candidate.package.unitCode === 'g' &&
        candidate.publicationMode === 'request-only' &&
        candidate.sourcePriceObservations.every(observation =>
            observation.retailPrice === false &&
            observation.publicationAllowed === false)));
    assert.ok(manifest.blockedObservations.every(item =>
        item.blockedReason === 'exact-sale-quantity-missing'));
    assert.ok(manifest.duplicateOfferCandidates.every(item =>
        item.blockedReason === 'seller-and-commercial-authority-missing'));
    assert.ok(manifest.exactCandidates.some(candidate =>
        candidate.gradeLabel === '高山正味铁观音（花香）' &&
        candidate.sourcePriceObservations[0].packageAmount === null));
    assert.strictEqual(
        manifest.exactCandidates.filter(candidate => candidate.gradeLabel === '铁观音果香').length,
        1,
    );
    assert.strictEqual(
        manifest.exactCandidates.find(candidate => candidate.gradeLabel === '铁观音果香')
            .sourcePriceObservations.length,
        2,
    );
    assert.deepStrictEqual(
        manifest.sourceOfferRows
            .filter(row => row.gradeLabel === '铁观音果香' && row.package.kind === 'exact-weight')
            .map(row => ({
                sourceOrder: row.sourceOrder,
                packageAmount: row.sourcePriceObservation.packageAmount,
                perKgAmount: row.sourcePriceObservation.perKgAmount,
                diagnostics: row.diagnostics,
            })),
        [
            {
                sourceOrder: 3,
                packageAmount: '82',
                perKgAmount: '164',
                diagnostics: ['duplicate-fixed-package-source-price'],
            },
            {
                sourceOrder: 4,
                packageAmount: '90',
                perKgAmount: '180',
                diagnostics: ['duplicate-fixed-package-source-price'],
            },
        ],
    );
    assert.strictEqual(
        new Set(manifest.sourceOfferRows.map(row => row.clientReference)).size,
        36,
    );
    assert.strictEqual(
        manifest.sourceOfferRows.filter(row => row.sellableInternalCode).length,
        29,
    );
    assert.strictEqual(
        new Set(
            manifest.sourceOfferRows
                .filter(row => row.sellableInternalCode)
                .map(row => row.sellableInternalCode),
        ).size,
        25,
    );
    assert.ok(manifest.sourceOfferRows.every(row =>
        row.sourcePriceObservation.kind === 'source-reference' &&
        row.sourcePriceObservation.retailPrice === false &&
        row.sourcePriceObservation.publicationAllowed === false));
    assert.ok(manifest.sourceOfferRows
        .filter(row => row.package.kind === 'weight-only')
        .every(row => row.offerPublicationMode === 'request-only' &&
            row.diagnostics.includes('exact-sale-quantity-missing')));
    assert.deepStrictEqual(
        manifest.sourceOfferRows
            .find(row => row.sourceOrder === 27)
            .diagnostics,
        ['source-package-price-missing'],
    );
    assert.strictEqual(
        manifest.blockedObservations.filter(item => item.gradeLabel === '安溪铁观音果香').length,
        1,
    );
    assert.ok(!JSON.stringify(manifest).includes('retailPrice":true'));
    assert.ok(!Object.hasOwn(manifest, 'sellerId'));
    assert.strictEqual(manifest.source.stockPublished, false);
    assert.strictEqual(manifest.source.sellerIdentityVerified, false);
    assert.strictEqual(manifest.source.mediaLicenseVerified, false);
    assert.strictEqual(
        normalizeTieguanyinSnapshot(readFixture()).manifestSha256,
        manifest.manifestSha256,
    );

    const sourceOfferBundle = buildCommerceSourceOfferBundle(manifest, {
        generatedAt: '2026-08-01T00:00:00Z',
    });
    assert.strictEqual(sourceOfferBundle.manifest.formatCode, 'commerce-source-offer-bundle');
    assert.strictEqual(sourceOfferBundle.manifest.schemaVersion, '1.0');
    assert.strictEqual(sourceOfferBundle.import.begin.expectedItemCount, 36);
    assert.strictEqual(sourceOfferBundle.sourcePositions.length, 36);
    assert.strictEqual(
        sourceOfferBundle.sourcePositions.reduce(
            (total, row) => total + row.sourceItem.referencePrices.length,
            0,
        ),
        64,
    );
    assert.strictEqual(
        sourceOfferBundle.sourcePositions.reduce(
            (total, row) => total + row.offerTerms.length,
            0,
        ),
        116,
    );
    assert.deepStrictEqual(
        sourceOfferBundle.sourcePositions
            .filter(row => row.sourceItem.localizedTexts[0].title === '铁观音果香')
            .map(row => ({
                rowNumber: row.rowNumber,
                reference: row.clientReference,
                packagePrice: row.sourceItem.referencePrices
                    .find(price => price.basisUnitCode === 'package').amount,
                kgPrice: row.sourceItem.referencePrices
                    .find(price => price.basisUnitCode === 'kg').amount,
                sellableCode: row.productMappingHints[0].sellableCode,
            })),
        [
            {
                rowNumber: 3,
                reference: 'thetea-shop-tie-guanyin-row-003',
                packagePrice: 82,
                kgPrice: 164,
                sellableCode: manifest.sourceOfferRows[2].sellableInternalCode,
            },
            {
                rowNumber: 4,
                reference: 'thetea-shop-tie-guanyin-row-004',
                packagePrice: 90,
                kgPrice: 180,
                sellableCode: manifest.sourceOfferRows[3].sellableInternalCode,
            },
        ],
    );
    assert.strictEqual(
        sourceOfferBundle.sourcePositions.find(row => row.rowNumber === 27)
            .sourceItem.referencePrices.some(price => price.basisUnitCode === 'package'),
        false,
    );
    assert.strictEqual(
        sourceOfferBundle.sourcePositions.find(row => row.rowNumber === 8)
            .sourceItem.packageComponentsExact,
        false,
    );
    assert.ok(sourceOfferBundle.sourcePositions.every(row =>
        row.sourceItem.referencePrices.every(price =>
            ['known', 'unknown'].includes(price.state) &&
            ['source', 'derived'].includes(price.derivationKind))));
    const sourceOfferJson = JSON.stringify(sourceOfferBundle);
    assert.ok(!sourceOfferJson.includes('retailPrice":true'));
    assert.ok(!sourceOfferJson.includes('"cost"'));
    assert.ok(!sourceOfferJson.includes('"margin"'));
    assert.ok(!sourceOfferJson.includes('buyPrice'));
    assert.ok(!sourceOfferJson.includes('sellerId'));

    const changed = readFixture();
    changed.rows[0].perKgCny = '89';
    assertRejectsCode(
        () => normalizeTieguanyinSnapshot(changed),
        'THETEA_SHOP_ROWS_HASH_MISMATCH',
    );
    const invalidWeight = readFixture();
    invalidWeight.rowsSha256 = sha256(stableJson(invalidWeight.rows));
    invalidWeight.rows[7].package.quantity = '500';
    invalidWeight.rowsSha256 = sha256(stableJson(invalidWeight.rows));
    assertRejectsCode(
        () => normalizeTieguanyinSnapshot(invalidWeight),
        'THETEA_SHOP_WEIGHT_ONLY_PACKAGE_INVALID',
    );

    console.log('TheTea Shop Tieguanyin source contract tests passed.');
}

main();
