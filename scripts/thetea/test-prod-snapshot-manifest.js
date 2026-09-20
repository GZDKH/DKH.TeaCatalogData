#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');

const file = process.argv[2] || 'docs/prod-snapshot-2026-09-20.json';
const report = JSON.parse(fs.readFileSync(file, 'utf8'));

assert.strictEqual(report.schemaVersion, 1);
assert.strictEqual(report.snapshotId, 'prod-admin-2026-09-20');
assert.strictEqual(report.source.host, 'admin.xnata.com');
assert.strictEqual(report.source.catalogId, '0be5b4fc-651b-4953-87d8-08d976ddb13d');
assert.strictEqual(report.source.catalogCode, 'CATALOG-CHINESE-TEA');
assert.strictEqual(report.source.completeExport, true);
assert.strictEqual(report.source.pagination, 'single downloaded system export; UI catalog count matched 526 products');
assert.strictEqual(report.source.workspaceId, null);
assert.strictEqual(report.files.products.sha256, '0480b20703257638b6a2925e81270aa5c7de62c2e847ef1b475677a913f89e5f');
assert.strictEqual(report.files.template.sha256, '6691af43c76cc8a387ce410bc9fa5837a98ed4af3ca9cff000d75ccb38dec4f8');
assert.strictEqual(report.coverage.products, 526);
assert.strictEqual(report.coverage.productIds, 526);
assert.strictEqual(report.coverage.productCodes, 526);
assert.strictEqual(report.coverage.duplicateIds, 0);
assert.strictEqual(report.coverage.duplicateCodes, 0);
assert.strictEqual(report.coverage.specifications, 18967);
assert.strictEqual(report.coverage.packages, 2631);
assert.strictEqual(report.coverage.catalogs, 3947);
assert.strictEqual(report.coverage.origins, 526);
assert.strictEqual(report.coverage.crossSells, 0);
assert.strictEqual(report.specificationCoverage.distinctAttributes, 78);
assert.deepStrictEqual(report.specificationCoverage.types, {
    Number: 6388,
    CustomMarkdownText: 6377,
    Option: 1574,
    Duration: 1350,
    List: 1350,
    Boolean: 900,
    CustomText: 514,
    Date: 514,
});
assert.strictEqual(report.exchangeTemplate.columns, 443);
assert(report.exchangeTemplate.specificationColumns.includes('specs.type'));
assert.strictEqual(report.preparationStatus.productionWrite, false);

console.log('test-prod-snapshot-manifest: OK');
