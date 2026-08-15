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
    });
    assert.strictEqual(manifest.target.productCode, PRODUCT_CODE);
    assert.strictEqual(manifest.target.catalogCode, CATALOG_CODE);
    assert.strictEqual(manifest.exactCandidates.length, 25);
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
