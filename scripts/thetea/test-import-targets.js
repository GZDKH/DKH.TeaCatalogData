#!/usr/bin/env node
const assert = require('assert');
const { resolveArtifactCatalogPolicy } = require('./lib/import-targets');

const targetOnly = resolveArtifactCatalogPolicy({
    targets: {
        catalogCodes: ['CATALOG-CHINESE-TEA'],
        catalogAssignmentMode: 'target-only',
    },
});
assert.deepStrictEqual(targetOnly, {
    targetCatalog: 'CATALOG-CHINESE-TEA',
    catalogAssignmentMode: 'target-only',
    baselinePreservation: {
        catalogAssignmentMode: 'target-only',
        targetCatalog: 'CATALOG-CHINESE-TEA',
    },
    allowedCatalogCodes: ['CATALOG-CHINESE-TEA'],
});

const preserve = resolveArtifactCatalogPolicy({
    targets: {
        catalogCodes: ['CATALOG-CHINESE-TEA'],
        catalogAssignmentMode: 'preserve',
    },
});
assert.strictEqual(preserve.catalogAssignmentMode, 'preserve');
assert.strictEqual(preserve.allowedCatalogCodes, undefined);
assert.deepStrictEqual(preserve.baselinePreservation, {
    catalogAssignmentMode: 'preserve',
    targetCatalog: 'CATALOG-CHINESE-TEA',
});

assert.throws(
    () => resolveArtifactCatalogPolicy({
        targets: {
            catalogCodes: ['CATALOG-CHINESE-TEA'],
            catalogAssignmentMode: 'target-only',
        },
    }, { catalog: 'CATALOG-PUERH' }),
    /differs from artifact target/);

console.log('test-import-targets: OK');
