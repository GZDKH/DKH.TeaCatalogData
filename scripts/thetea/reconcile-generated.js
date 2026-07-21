#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, parseArgs, requireArg, csv } = require('./lib/env');
const { readArtifactBundle } = require('./lib/artifact-bundle');
const { assertScopedPath, withStagedOutput } = require('./lib/generated-output');
const { loadVerifiedProductReference } = require('./lib/product-reference');
const { validateBaselinePreservation } = require('./lib/product-overlay');
const { hashInputPath } = require('./generate-import');

const COLLECTION_KEYS = {
    translations: item => String(item?.lang || '').trim().toLowerCase(),
    specifications: item => normalizeCode(item?.attribute),
    tags: item => normalizeCode(item?.code),
    catalogs: item => `${normalizeCode(item?.catalog)}|${normalizeCode(item?.category)}`,
    packages: item => normalizeCode(item?.package),
    related: item => `${normalizeCode(item?.product)}|${normalizeCode(item?.catalog)}`,
    crossSells: item => `${normalizeCode(item?.product)}|${normalizeCode(item?.catalog)}`,
};

function usage() {
    console.log(`Usage:
  node scripts/thetea/reconcile-generated.js \\
    --dir=import/thetea/<snapshot> \\
    --product-ref=sources/prod/product-reference/<snapshot>

Options:
  --report=<name>      Output directory name under reports/thetea/
  --only=<code,...>    Reconcile exact product codes only
  --limit=<n>          Reconcile at most n sorted products

The command is read-only. It writes a field-level plan, exact desired payload,
and exact rollback payload. A missing baseline product is reported as create and
makes the resynchronization ineligible for apply.`);
}

function normalizeCode(value) {
    const code = value && typeof value === 'object' ? value.code : value;
    return String(code || '').trim().toUpperCase();
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key =>
            `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256(value) {
    return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function collectionDiff(before, after, keyFn) {
    const beforeMap = keyedCollection(before, keyFn, 'baseline');
    const afterMap = keyedCollection(after, keyFn, 'desired');
    const added = [];
    const removed = [];
    const changed = [];
    for (const [key, value] of afterMap) {
        if (!beforeMap.has(key)) added.push(key);
        else if (stableStringify(beforeMap.get(key)) !== stableStringify(value)) changed.push(key);
    }
    for (const key of beforeMap.keys()) {
        if (!afterMap.has(key)) removed.push(key);
    }
    return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

function keyedCollection(value, keyFn, label) {
    if (!Array.isArray(value)) throw new Error(`${label} collection must be an array.`);
    const result = new Map();
    for (const item of value) {
        const key = keyFn(item);
        if (!key) throw new Error(`${label} collection item has no stable key.`);
        if (result.has(key)) throw new Error(`${label} collection contains duplicate key ${key}.`);
        result.set(key, item);
    }
    return result;
}

function structuralCollectionDiff(before, after) {
    const beforeCounts = multiset((before || []).map(stableStringify));
    const afterCounts = multiset((after || []).map(stableStringify));
    let added = 0;
    let removed = 0;
    for (const [key, count] of afterCounts) added += Math.max(0, count - (beforeCounts.get(key) || 0));
    for (const [key, count] of beforeCounts) removed += Math.max(0, count - (afterCounts.get(key) || 0));
    return { added, removed, changed: 0 };
}

function multiset(values) {
    const result = new Map();
    for (const value of values) result.set(value, (result.get(value) || 0) + 1);
    return result;
}

function diffProduct(before, after) {
    const fields = {};
    const allFields = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const field of allFields) {
        if (stableStringify(before[field]) === stableStringify(after[field])) continue;
        if (COLLECTION_KEYS[field]) {
            fields[field] = collectionDiff(before[field] || [], after[field] || [], COLLECTION_KEYS[field]);
        } else if (Array.isArray(before[field]) || Array.isArray(after[field])) {
            fields[field] = structuralCollectionDiff(before[field] || [], after[field] || []);
        } else {
            fields[field] = { before: before[field] ?? null, after: after[field] ?? null };
        }
    }
    return fields;
}

function buildReconciliation(desiredProducts, baselineProducts) {
    const baselineByCode = new Map();
    for (const product of baselineProducts) {
        const code = normalizeCode(product.code);
        if (!code || baselineByCode.has(code)) throw new Error(`Invalid baseline product code ${code || '<missing>'}.`);
        baselineByCode.set(code, product);
    }

    const desiredByCode = new Map();
    for (const product of desiredProducts) {
        const code = normalizeCode(product.code);
        if (!code || desiredByCode.has(code)) throw new Error(`Invalid desired product code ${code || '<missing>'}.`);
        desiredByCode.set(code, product);
    }

    const operations = [];
    const desiredPayload = [];
    const rollbackPayload = [];
    for (const code of [...desiredByCode.keys()].sort()) {
        const after = desiredByCode.get(code);
        const before = baselineByCode.get(code);
        if (!before) {
            operations.push({ code, action: 'create', desiredSha256: sha256(after) });
            desiredPayload.push(after);
            continue;
        }
        if (normalizeCode(before.id) !== normalizeCode(after.id)) {
            operations.push({ code, action: 'conflict', reason: 'product id differs from baseline' });
            continue;
        }
        const fields = diffProduct(before, after);
        const action = Object.keys(fields).length ? 'update' : 'noop';
        operations.push({
            code,
            action,
            beforeSha256: sha256(before),
            desiredSha256: sha256(after),
            changedFields: Object.keys(fields),
            fields,
        });
        if (action === 'update') {
            desiredPayload.push(after);
            rollbackPayload.push(before);
        }
    }

    const counts = operations.reduce((result, operation) => {
        result[operation.action] += 1;
        return result;
    }, { create: 0, update: 0, noop: 0, conflict: 0 });
    const fieldChangeCounts = {};
    for (const operation of operations) {
        for (const field of operation.changedFields || []) {
            fieldChangeCounts[field] = (fieldChangeCounts[field] || 0) + 1;
        }
    }
    const preservationErrors = validateBaselinePreservation(desiredProducts, baselineProducts);
    return {
        counts,
        fieldChangeCounts,
        operations,
        desiredPayload,
        rollbackPayload,
        preservationErrors,
        eligible: counts.create === 0 && counts.conflict === 0 && preservationErrors.length === 0,
    };
}

function selectProducts(products, args) {
    const only = new Set(csv(args.only).map(normalizeCode));
    const sorted = [...products].sort((a, b) => normalizeCode(a.code).localeCompare(normalizeCode(b.code)));
    const selected = only.size ? sorted.filter(product => only.has(normalizeCode(product.code))) : sorted;
    if (only.size) {
        const found = new Set(selected.map(product => normalizeCode(product.code)));
        const missing = [...only].filter(code => !found.has(code));
        if (missing.length) throw new Error(`Requested product codes are absent from artifact: ${missing.join(', ')}.`);
    }
    if (args.limit) {
        const limit = Number(args.limit);
        if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer.');
        return selected.slice(0, limit);
    }
    return selected;
}

function writeOutput(output, report, desiredPayload, rollbackPayload) {
    withStagedOutput(output, staging => {
        fs.writeFileSync(path.join(staging, 'plan.json'), `${JSON.stringify(report, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'desired-products.json'), `${JSON.stringify(desiredPayload, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'rollback-products.json'), `${JSON.stringify(rollbackPayload, null, 2)}\n`);
    });
}

function main() {
    const args = parseArgs();
    if (args.help || args.h) return usage();
    const artifactRoot = path.resolve(REPO_ROOT, requireArg(args, 'dir'));
    const productReferencePath = path.resolve(REPO_ROOT, requireArg(args, 'product-ref'));
    const bundle = readArtifactBundle(artifactRoot);
    if (!bundle.valid) throw new Error(`Artifact integrity failed: ${bundle.errors.slice(0, 10).join('; ')}`);
    const reference = loadVerifiedProductReference(productReferencePath);
    if (bundle.manifest.baselineReferenceSha256 !== hashInputPath(productReferencePath)) {
        throw new Error('Product reference hash differs from artifact manifest.');
    }

    const selected = selectProducts(bundle.products, args);
    if (!selected.length) throw new Error('No products selected.');
    const reconciliation = buildReconciliation(selected, reference.products);
    const report = {
        generatedAt: new Date().toISOString(),
        mode: 'read-only-reconciliation',
        eligible: reconciliation.eligible,
        artifactRoot,
        artifactManifestSha256: hashInputPath(path.join(artifactRoot, 'artifact-manifest.json')),
        productReferenceSha256: hashInputPath(productReferencePath),
        workspaceId: reference.manifest.workspaceId,
        selectedProductCount: selected.length,
        counts: reconciliation.counts,
        fieldChangeCounts: reconciliation.fieldChangeCounts,
        preservationErrors: reconciliation.preservationErrors,
        operations: reconciliation.operations,
        desiredPayload: 'desired-products.json',
        rollbackPayload: 'rollback-products.json',
    };
    const output = assertScopedPath(
        path.join(REPO_ROOT, 'reports', 'thetea', String(args.report || `${bundle.manifest.snapshotId}-reconciliation`)),
        {
            repoRoot: REPO_ROOT,
            allowedRoot: path.join(REPO_ROOT, 'reports', 'thetea'),
            allowedDescription: 'reports/thetea/',
            label: 'TheTea reconciliation report',
        });
    writeOutput(output, report, reconciliation.desiredPayload, reconciliation.rollbackPayload);
    console.log(`Eligible: ${report.eligible ? 'yes' : 'no'}`);
    console.log(`Selected: ${report.selectedProductCount}`);
    console.log(`Create: ${report.counts.create}`);
    console.log(`Update: ${report.counts.update}`);
    console.log(`Noop: ${report.counts.noop}`);
    console.log(`Conflict: ${report.counts.conflict}`);
    console.log(`Preservation errors: ${report.preservationErrors.length}`);
    console.log(`Report: ${output}`);
    if (!report.eligible) process.exitCode = 1;
    return report;
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { buildReconciliation, collectionDiff, diffProduct, sha256 };
