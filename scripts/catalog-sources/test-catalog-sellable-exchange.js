#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { sha256, stableJson } = require('./lib/artifacts');
const { normalizeTieguanyinSnapshot } = require('./thetea-shop/tieguanyin-normalizer');
const {
    HEADERS,
    buildFixtureSet,
    deriveRowKey,
    projectTieguanyinManifest,
} = require('./thetea-shop/catalog-sellable-exchange');
const { readZipEntries } = require('./thetea-shop/deterministic-xlsx');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = path.join(
    ROOT,
    'scripts/catalog-sources/thetea-shop/fixtures/tieguanyin-price-base-2026-08-01.json',
);
const FIXTURE_ROOT = path.join(
    ROOT,
    'scripts/catalog-sources/thetea-shop/fixtures/catalog-sellable-exchange',
);

function parseCsv(text) {
    const records = [];
    let record = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (quoted) {
            if (character === '"' && text[index + 1] === '"') {
                field += '"';
                index++;
            } else if (character === '"') {
                quoted = false;
            } else {
                field += character;
            }
        } else if (character === '"') {
            quoted = true;
        } else if (character === ',') {
            record.push(field);
            field = '';
        } else if (character === '\n') {
            record.push(field);
            records.push(record);
            record = [];
            field = '';
        } else {
            field += character;
        }
    }
    assert.equal(quoted, false, 'CSV quote must be closed');
    assert.equal(field, '', 'CSV must end with LF');
    assert.deepEqual(record, [], 'CSV must end after a complete record');
    return records;
}

function countWorksheetRows(sheet) {
    return [...sheet.matchAll(/<row r="\d+">/gu)].length;
}

function main() {
    const source = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
    const manifest = normalizeTieguanyinSnapshot(source);
    const projection = projectTieguanyinManifest(manifest);
    assert.deepEqual(projection.reviewedSource, {
        rowCount: 36,
        exactCandidateCount: 25,
        duplicateOfferGroupCount: 4,
        blockedWeightOnlyCount: 7,
    });
    assert.equal(projection.rows.length, 25);
    assert.equal(new Set(projection.rows.map(row => row.RowKey)).size, 25);
    assert.ok(projection.rows.every((row, index) =>
        row.CatalogCode === 'CATALOG-CHINESE-TEA-SHOP' &&
        row.ProductCode === 'TEA-CN-TIE-GUANYIN' &&
        row.VariantAxisCode === 'TGY-GRADE' &&
        row.PackageCode === 'PKG-500G' &&
        row.UnitQuantity === '500' &&
        row.UnitCode === 'g' &&
        row.DisplayOrder === String(1000 + index) &&
        row.PublicationMode === 'request_only' &&
        row.RowKey === deriveRowKey(row)));
    assert.ok(projection.rows.every(row => row.VariantLabel === row.VariantLabel.normalize('NFC')));
    assert.ok(projection.rows.some(row => row.VariantLabel === '高山正味铁观音（花香）'));
    const formulaSource = structuredClone(source);
    formulaSource.rows[0].gradeLabel = '=HYPERLINK("https://example.invalid")';
    formulaSource.rowsSha256 = sha256(stableJson(formulaSource.rows));
    const formulaManifest = normalizeTieguanyinSnapshot(formulaSource);
    assert.throws(
        () => projectTieguanyinManifest(formulaManifest),
        error => error.code === 'CATALOG_SELLABLE_EXCHANGE_FORMULA_LABEL_BLOCKED',
    );

    const first = buildFixtureSet(manifest);
    const second = buildFixtureSet(manifest);
    assert.deepEqual([...first.fixtures.keys()], [...second.fixtures.keys()]);
    for (const [name, expected] of first.fixtures) {
        assert.ok(expected.equals(second.fixtures.get(name)), `${name} must be deterministic`);
        assert.ok(fs.readFileSync(path.join(FIXTURE_ROOT, name)).equals(expected), `${name} drifted`);
    }

    const canonicalCsv = first.fixtures.get('tieguanyin-exact-25.csv').toString('utf8');
    const canonicalRecords = parseCsv(canonicalCsv);
    assert.deepEqual(canonicalRecords[0], HEADERS);
    assert.equal(canonicalRecords.length, 26);
    assert.ok(canonicalCsv.includes('高山正味铁观音（花香）'));
    assert.equal(canonicalCsv.includes('packagePriceCny'), false);
    assert.equal(canonicalCsv.includes('perKgCny'), false);

    const conflictRecords = parseCsv(
        first.fixtures.get('tieguanyin-conflicts.csv').toString('utf8'),
    );
    assert.equal(conflictRecords.length, 5);
    assert.equal(conflictRecords[1][0], conflictRecords[2][0]);
    assert.notEqual(conflictRecords[3][0], conflictRecords[4][0]);
    assert.deepEqual(conflictRecords[3].slice(1, 8), conflictRecords[4].slice(1, 8));

    const blockedRecords = parseCsv(
        first.fixtures.get('tieguanyin-blocked.csv').toString('utf8'),
    );
    assert.equal(blockedRecords.length, 4);
    assert.equal(blockedRecords[1][5], '');
    assert.equal(blockedRecords[2][6], '');
    assert.equal(blockedRecords[3][7], '');

    for (const name of [
        'tieguanyin-exact-25.xlsx',
        'tieguanyin-conflicts.xlsx',
        'tieguanyin-blocked.xlsx',
    ]) {
        const workbook = first.fixtures.get(name);
        assert.equal(workbook.readUInt32LE(0), 0x04034B50, `${name} must be a ZIP XLSX`);
        const entries = readZipEntries(workbook);
        assert.deepEqual([...entries.keys()], [
            '[Content_Types].xml',
            '_rels/.rels',
            'xl/workbook.xml',
            'xl/_rels/workbook.xml.rels',
            'xl/styles.xml',
            'xl/worksheets/sheet1.xml',
        ]);
        const sheet = entries.get('xl/worksheets/sheet1.xml').toString('utf8');
        assert.ok(sheet.includes('<autoFilter ref="A1:J1"/>'));
        assert.ok(sheet.includes('PublicationMode'));
        assert.ok(!sheet.includes('RetailPrice'));
        if (name === 'tieguanyin-exact-25.xlsx') {
            assert.equal(countWorksheetRows(sheet), 26);
            assert.ok(sheet.includes('高山正味铁观音（花香）'));
        }
    }

    assert.deepEqual(first.expectations.canonicalRoundTrip.expectedDispositionAfterReadBack, {
        noOp: 25,
    });
    assert.deepEqual(first.expectations.conflictCases.reasonCodes, [
        'DUPLICATE_ROW_KEY',
        'DUPLICATE_TARGET_IDENTITY',
    ]);
    assert.equal(first.expectations.blockedCases.reasonCode, 'ROW_CONTRACT_INVALID');
    for (const [name, evidence] of Object.entries(first.expectations.files)) {
        const contents = first.fixtures.get(name);
        assert.equal(contents.length, evidence.bytes);
        assert.equal(sha256(contents), evidence.sha256);
    }
    assert.ok(!JSON.stringify(projection.rows).match(/sellerId|retailPrice|stockPublished/iu));

    console.log('Catalog sellable CSV/XLSX projection and fixture tests passed.');
}

main();
