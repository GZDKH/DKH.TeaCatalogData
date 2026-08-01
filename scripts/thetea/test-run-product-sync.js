#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { hashInputPath } = require('./generate-import');
const { packageDefinitionsFor } = require('./lib/package-content');
const { buildReconciliation, sha256 } = require('./reconcile-generated');
const {
    assertBatchState,
    classifyLiveStates,
    loadSyncPlan,
    requestProducts,
    validateStandardPackageCorrection,
} = require('./run-product-sync');

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555';

function product(code, name) {
    return {
        id: `${code}-id`,
        code,
        nativeName: name,
        translations: [],
        specifications: [],
        tags: [],
        tierPrices: [],
        catalogPrices: [],
        storePriceOverrides: [],
        packages: [],
        catalogs: [],
        origins: [],
        related: [],
        crossSells: [],
    };
}

const before = product('TEA-A', 'Before');
const desired = product('TEA-A', 'After');
const syncPlan = {
    expectedCodes: ['TEA-A'],
    desiredByCode: new Map([['TEA-A', desired]]),
    rollbackByCode: new Map([['TEA-A', before]]),
};

assert.deepStrictEqual(classifyLiveStates(syncPlan, [before]).map(item => item.state), ['baseline']);
assert.deepStrictEqual(classifyLiveStates(syncPlan, [desired]).map(item => item.state), ['desired']);
assert.deepStrictEqual(
    classifyLiveStates(syncPlan, [product('TEA-A', 'Drift')]).map(item => item.state),
    ['conflict']);
assert.doesNotThrow(() => assertBatchState(syncPlan, [desired], ['TEA-A'], 'desired'));
assert.throws(() => assertBatchState(syncPlan, [before], ['TEA-A'], 'desired'), /Read-back failed/);
assert.strictEqual(buildReconciliation([desired], [desired]).counts.noop, 1);

const planRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thetea-package-sync-plan-'));
try {
    const artifactRoot = path.join(planRoot, 'artifact');
    const reconciliationRoot = path.join(planRoot, 'reconciliation');
    fs.mkdirSync(artifactRoot, { recursive: true });
    fs.mkdirSync(reconciliationRoot, { recursive: true });
    const artifactManifestPath = path.join(artifactRoot, 'artifact-manifest.json');
    fs.writeFileSync(artifactManifestPath, JSON.stringify({
        targets: {
            updateScope: 'packages',
            catalogAssignmentMode: 'preserve',
        },
    }));

    const packageBefore = {
        ...product('TEA-PACKAGE', 'Package baseline'),
        packages: [
            ...packageDefinitionsFor('standard').map(item => ({ ...item, quantity: 1 })),
            { package: 'PKG-MANUAL-TIN', packageName: 'Tin', quantity: 1, default: false },
        ],
    };
    const packageDesired = {
        ...packageBefore,
        packages: [
            ...packageDefinitionsFor('standard'),
            { package: 'PKG-MANUAL-TIN', packageName: 'Tin', quantity: 1, default: false },
        ],
    };
    assert.deepStrictEqual(
        validateStandardPackageCorrection(
            [packageDesired],
            new Map([['TEA-PACKAGE', packageBefore]])),
        []);
    const invalidPackageDesired = JSON.parse(JSON.stringify(packageDesired));
    invalidPackageDesired.packages.find(item => item.package === 'PKG-50G').quantity = 999;
    assert(validateStandardPackageCorrection(
        [invalidPackageDesired],
        new Map([['TEA-PACKAGE', packageBefore]]))
        .some(error => error.includes('PKG-50G.quantity must be exactly 50')));
    const missingPackageDesired = JSON.parse(JSON.stringify(packageDesired));
    missingPackageDesired.packages = missingPackageDesired.packages
        .filter(item => item.package !== 'PKG-25G');
    assert(validateStandardPackageCorrection(
        [missingPackageDesired],
        new Map([['TEA-PACKAGE', packageBefore]]))
        .some(error => error.includes('missing managed packages PKG-25G')));
    const changedManualDesired = JSON.parse(JSON.stringify(packageDesired));
    changedManualDesired.packages.find(item => item.package === 'PKG-MANUAL-TIN').quantity = 2;
    assert(validateStandardPackageCorrection(
        [changedManualDesired],
        new Map([['TEA-PACKAGE', packageBefore]]))
        .some(error => error.includes('manual package entries differ from rollback')));
    const reconciliation = buildReconciliation([packageDesired], [packageBefore], {
        updateScope: 'packages',
    });
    const plan = {
        eligible: reconciliation.eligible,
        updateScope: reconciliation.updateScope,
        catalogAssignmentPolicy: {
            mode: 'preserve',
            targetCatalog: 'CATALOG-CHINESE-TEA',
        },
        artifactRoot,
        artifactManifestSha256: hashInputPath(artifactManifestPath),
        counts: reconciliation.counts,
        fieldChangeCounts: reconciliation.fieldChangeCounts,
        scopeErrors: reconciliation.scopeErrors,
        operations: reconciliation.operations,
    };
    fs.writeFileSync(
        path.join(reconciliationRoot, 'plan.json'),
        `${JSON.stringify(plan, null, 2)}\n`);
    fs.writeFileSync(
        path.join(reconciliationRoot, 'desired-products.json'),
        `${JSON.stringify([packageDesired], null, 2)}\n`);
    fs.writeFileSync(
        path.join(reconciliationRoot, 'rollback-products.json'),
        `${JSON.stringify([packageBefore], null, 2)}\n`);
    const loadedPackagePlan = loadSyncPlan(reconciliationRoot);
    assert.strictEqual(loadedPackagePlan.updateScope, 'packages');
    assert.deepStrictEqual(loadedPackagePlan.expectedCodes, ['TEA-PACKAGE']);

    plan.counts.noop = 1;
    plan.operations.push({ code: 'TEA-ALREADY-CORRECT', action: 'noop', changedFields: [] });
    fs.writeFileSync(
        path.join(reconciliationRoot, 'plan.json'),
        `${JSON.stringify(plan, null, 2)}\n`);
    assert.doesNotThrow(() => loadSyncPlan(reconciliationRoot));
    plan.counts.noop = 0;
    plan.operations.pop();

    fs.writeFileSync(artifactManifestPath, JSON.stringify({
        targets: {
            updateScope: 'full',
            catalogAssignmentMode: 'preserve',
        },
    }));
    plan.artifactManifestSha256 = hashInputPath(artifactManifestPath);
    fs.writeFileSync(
        path.join(reconciliationRoot, 'plan.json'),
        `${JSON.stringify(plan, null, 2)}\n`);
    assert.throws(
        () => loadSyncPlan(reconciliationRoot),
        /Artifact update scope 'full' differs/);

    fs.writeFileSync(artifactManifestPath, JSON.stringify({
        targets: {
            updateScope: 'packages',
            catalogAssignmentMode: 'target-only',
        },
    }));
    plan.artifactManifestSha256 = hashInputPath(artifactManifestPath);
    fs.writeFileSync(
        path.join(reconciliationRoot, 'plan.json'),
        `${JSON.stringify(plan, null, 2)}\n`);
    assert.throws(
        () => loadSyncPlan(reconciliationRoot),
        /requires catalogAssignmentMode 'preserve'/);

    fs.writeFileSync(artifactManifestPath, JSON.stringify({
        targets: {
            updateScope: 'packages',
            catalogAssignmentMode: 'preserve',
        },
    }));
    plan.artifactManifestSha256 = hashInputPath(artifactManifestPath);

    plan.catalogAssignmentPolicy.mode = 'target-only';
    fs.writeFileSync(
        path.join(reconciliationRoot, 'plan.json'),
        `${JSON.stringify(plan, null, 2)}\n`);
    assert.throws(
        () => loadSyncPlan(reconciliationRoot),
        /requires catalogAssignmentPolicy.mode 'preserve'/);
    plan.catalogAssignmentPolicy.mode = 'preserve';

    const tamperedDesired = { ...packageDesired, nativeName: 'Tampered outside package scope' };
    plan.operations[0].desiredSha256 = sha256(tamperedDesired);
    fs.writeFileSync(
        path.join(reconciliationRoot, 'plan.json'),
        `${JSON.stringify(plan, null, 2)}\n`);
    fs.writeFileSync(
        path.join(reconciliationRoot, 'desired-products.json'),
        `${JSON.stringify([tamperedDesired], null, 2)}\n`);
    assert.throws(
        () => loadSyncPlan(reconciliationRoot),
        /do not form an eligible packages-only update/);
} finally {
    fs.rmSync(planRoot, { recursive: true, force: true });
}

async function testRequestProducts() {
    let invalid = false;
    const server = http.createServer((request, response) => {
        const chunks = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
            assert.strictEqual(request.headers.authorization, 'Bearer token');
            assert.strictEqual(request.headers['x-workspace-id'], WORKSPACE_ID);
            const body = Buffer.concat(chunks).toString('utf8');
            assert(body.includes('products'));
            assert(body.includes('TEA-A'));
            response.setHeader('Content-Type', 'application/json');
            if (request.url.endsWith('/validate')) {
                response.end(JSON.stringify(invalid
                    ? { valid: false, failed: 1, errors: [{ message: 'invalid' }] }
                    : { valid: true, validRecords: 1, errors: [] }));
            } else {
                response.end(JSON.stringify({ processed: 1, failed: 0, errors: [] }));
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const gateway = `http://127.0.0.1:${server.address().port}`;
        await requestProducts(gateway, 'token', WORKSPACE_ID, [desired], true);
        await requestProducts(gateway, 'token', WORKSPACE_ID, [desired], false);
        invalid = true;
        await assert.rejects(requestProducts(gateway, 'token', WORKSPACE_ID, [desired], true), /Validation failed/);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

testRequestProducts()
    .then(() => console.log('test-run-product-sync: OK'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
