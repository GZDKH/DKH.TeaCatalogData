'use strict';

const { sha256, stableJson } = require('../lib/artifacts');
const { MANAGED_PACKAGE_CONTENT } = require('../../thetea/lib/package-content');
const { NORMALIZED_SCHEMA } = require('./tieguanyin-normalizer');
const { createXlsx } = require('./deterministic-xlsx');

const EXCHANGE_SCHEMA = 'catalog-sellable-variants-fixtures-v1';
const PROFILE = 'catalog_sellable_variants';
const PACKAGE_CODE = 'PKG-500G';
const PUBLICATION_MODE = 'request_only';
const HEADERS = Object.freeze([
    'RowKey',
    'CatalogCode',
    'ProductCode',
    'VariantAxisCode',
    'VariantLabel',
    'PackageCode',
    'UnitQuantity',
    'UnitCode',
    'DisplayOrder',
    'PublicationMode',
]);

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
}

function normalizeLabel(value) {
    return String(value || '').trim().normalize('NFC');
}

function assertSpreadsheetSafeLabel(value) {
    if (/^[=+\-@]/u.test(value)) fail('CATALOG_SELLABLE_EXCHANGE_FORMULA_LABEL_BLOCKED');
    if (!/^[\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]*$/u.test(value)) {
        fail('CATALOG_SELLABLE_EXCHANGE_XML_LABEL_INVALID');
    }
}

function deriveRowKey(row) {
    const identity = [
        normalizeCode(row.CatalogCode),
        normalizeCode(row.ProductCode),
        normalizeCode(row.VariantAxisCode),
        normalizeLabel(row.VariantLabel),
        normalizeCode(row.PackageCode),
        String(row.UnitQuantity),
        normalizeCode(row.UnitCode),
    ].join('\n');
    return `CSV-${sha256(Buffer.from(identity, 'utf8')).slice(0, 20).toUpperCase()}`;
}

function projectTieguanyinManifest(manifest) {
    if (!manifest || manifest.schemaVersion !== NORMALIZED_SCHEMA) {
        fail('CATALOG_SELLABLE_EXCHANGE_MANIFEST_INVALID');
    }
    const manifestBinding = {
        source: manifest.source,
        summary: manifest.summary,
        exactCandidates: manifest.exactCandidates,
        duplicateOfferCandidates: manifest.duplicateOfferCandidates,
        blockedObservations: manifest.blockedObservations,
    };
    if (manifest.manifestSha256 !== sha256(stableJson(manifestBinding))) {
        fail('CATALOG_SELLABLE_EXCHANGE_MANIFEST_HASH_MISMATCH');
    }
    const expectedSummary = {
        rowCount: 36,
        uniqueGradeLabelCount: 31,
        fixedPackageRowCount: 29,
        uniqueFixedPackageCandidateCount: 25,
        duplicateFixedPackageKeyCount: 4,
        weightOnlyRowCount: 7,
    };
    if (stableJson(manifest.summary) !== stableJson(expectedSummary) ||
        manifest.exactCandidates?.length !== 25 ||
        manifest.duplicateOfferCandidates?.length !== 4 ||
        manifest.blockedObservations?.length !== 7) {
        fail('CATALOG_SELLABLE_EXCHANGE_REVIEW_COUNTS_CHANGED');
    }

    const packageFact = MANAGED_PACKAGE_CONTENT[PACKAGE_CODE];
    if (!packageFact || packageFact.quantity !== 500 || packageFact.packageUnit !== 'g') {
        fail('CATALOG_SELLABLE_EXCHANGE_PACKAGE_AUTHORITY_CHANGED');
    }
    const rows = manifest.exactCandidates.map((candidate, index) => {
        if (candidate.catalogCode !== manifest.target.catalogCode ||
            candidate.productCode !== manifest.target.productCode ||
            candidate.package?.quantity !== '500' ||
            candidate.package?.unitCode !== 'g' ||
            candidate.publicationMode !== 'request-only') {
            fail('CATALOG_SELLABLE_EXCHANGE_CANDIDATE_UNSAFE');
        }
        const variantLabel = normalizeLabel(candidate.gradeLabel);
        assertSpreadsheetSafeLabel(variantLabel);
        const row = {
            RowKey: '',
            CatalogCode: candidate.catalogCode,
            ProductCode: candidate.productCode,
            VariantAxisCode: manifest.target.variantAxisCode,
            VariantLabel: variantLabel,
            PackageCode: PACKAGE_CODE,
            UnitQuantity: '500',
            UnitCode: 'g',
            DisplayOrder: String(1000 + index),
            PublicationMode: PUBLICATION_MODE,
        };
        row.RowKey = deriveRowKey(row);
        return row;
    });

    if (new Set(rows.map(row => row.RowKey)).size !== rows.length) {
        fail('CATALOG_SELLABLE_EXCHANGE_ROW_KEY_COLLISION');
    }

    return {
        schemaVersion: EXCHANGE_SCHEMA,
        profile: PROFILE,
        sourceManifestSha256: manifest.manifestSha256,
        reviewedSource: {
            rowCount: manifest.summary.rowCount,
            exactCandidateCount: rows.length,
            duplicateOfferGroupCount: manifest.duplicateOfferCandidates.length,
            blockedWeightOnlyCount: manifest.blockedObservations.length,
        },
        rows,
        projectionSha256: sha256(stableJson(rows)),
    };
}

function csvCell(value) {
    const text = String(value ?? '');
    return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function rowsToCsv(rows) {
    const lines = [HEADERS, ...rows.map(row => HEADERS.map(header => row[header] ?? ''))];
    return `${lines.map(line => line.map(csvCell).join(',')).join('\n')}\n`;
}

function rowsToMatrix(rows) {
    return rows.map(row => HEADERS.map(header => row[header] ?? ''));
}

function scenarioRows(canonicalRows) {
    const conflicts = [
        { ...canonicalRows[0], RowKey: 'CONFLICT-SAME-ROW' },
        { ...canonicalRows[1], RowKey: 'CONFLICT-SAME-ROW' },
        { ...canonicalRows[2], RowKey: 'CONFLICT-TARGET-A' },
        { ...canonicalRows[2], RowKey: 'CONFLICT-TARGET-B' },
    ];
    const blocked = [
        { ...canonicalRows[3], RowKey: 'BLOCKED-MISSING-PACKAGE', PackageCode: '' },
        { ...canonicalRows[4], RowKey: 'BLOCKED-MISSING-QUANTITY', UnitQuantity: '' },
        { ...canonicalRows[5], RowKey: 'BLOCKED-MISSING-UNIT', UnitCode: '' },
    ];
    return { conflicts, blocked };
}

function buildFixtureSet(manifest) {
    const projection = projectTieguanyinManifest(manifest);
    const { conflicts, blocked } = scenarioRows(projection.rows);
    const fixtures = new Map([
        ['tieguanyin-exact-25.csv', Buffer.from(rowsToCsv(projection.rows), 'utf8')],
        ['tieguanyin-exact-25.xlsx', createXlsx(HEADERS, rowsToMatrix(projection.rows), 'Tieguanyin exact 25')],
        ['tieguanyin-conflicts.csv', Buffer.from(rowsToCsv(conflicts), 'utf8')],
        ['tieguanyin-conflicts.xlsx', createXlsx(HEADERS, rowsToMatrix(conflicts), 'Conflict cases')],
        ['tieguanyin-blocked.csv', Buffer.from(rowsToCsv(blocked), 'utf8')],
        ['tieguanyin-blocked.xlsx', createXlsx(HEADERS, rowsToMatrix(blocked), 'Blocked cases')],
    ]);
    const expectations = {
        schemaVersion: EXCHANGE_SCHEMA,
        profile: PROFILE,
        sourceManifestSha256: projection.sourceManifestSha256,
        projectionSha256: projection.projectionSha256,
        reviewedSource: projection.reviewedSource,
        canonicalRoundTrip: {
            rowCount: 25,
            expectedDispositionAfterReadBack: { noOp: 25 },
            publicationMode: PUBLICATION_MODE,
            containsUnicodeLabels: true,
        },
        conflictCases: {
            rowCount: conflicts.length,
            expectedDisposition: { conflict: conflicts.length },
            reasonCodes: ['DUPLICATE_ROW_KEY', 'DUPLICATE_TARGET_IDENTITY'],
        },
        blockedCases: {
            rowCount: blocked.length,
            expectedDisposition: { blocked: blocked.length },
            reasonCode: 'ROW_CONTRACT_INVALID',
        },
        forbiddenColumns: [
            'SupplierId', 'SellerId', 'OfferId', 'RetailPrice', 'Stock', 'CurrencyCode',
            'ShippingRegion', 'MediaLicense',
        ],
        files: Object.fromEntries([...fixtures].map(([name, contents]) => [name, {
            bytes: contents.length,
            sha256: sha256(contents),
        }])),
    };
    fixtures.set('expected.json', Buffer.from(stableJson(expectations), 'utf8'));
    return { projection, conflicts, blocked, fixtures, expectations };
}

module.exports = {
    EXCHANGE_SCHEMA,
    HEADERS,
    PACKAGE_CODE,
    PROFILE,
    PUBLICATION_MODE,
    buildFixtureSet,
    deriveRowKey,
    projectTieguanyinManifest,
    rowsToCsv,
};
