#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, parseArgs, requireArg } = require('./lib/env');
const { readArtifactBundle } = require('./lib/artifact-bundle');
const { assertScopedPath, withStagedOutput } = require('./lib/generated-output');
const { loadCatalogReference } = require('./lib/catalog-mapping');
const { loadVerifiedProductReference } = require('./lib/product-reference');
const { hashInputPath } = require('./generate-import');

const MANAGED_PREFIX = 'SPEC-TT-';
const KINDS = [
    { name: 'groups', reference: 'specificationGroups' },
    { name: 'attributes', reference: 'specificationAttributes' },
    { name: 'options', reference: 'specificationAttributeOptions' },
];

function usage() {
    console.log(`Usage:
  node scripts/thetea/reconcile-definitions.js \\
    --dir=import/thetea/<snapshot> \\
    --catalog-ref=sources/prod/catalog-reference/<snapshot>.json \\
    --product-ref=sources/prod/product-reference/<snapshot>

Options:
  --report=<name>  Output directory name under reports/thetea/

The command is read-only. It compares all managed SPEC-TT-* definitions,
produces ordered upsert/delete plans and exact rollback payloads, and rejects
deletion of a definition used by any product outside the artifact.`);
}

function normalizeCode(value) {
    const code = value && typeof value === 'object' ? value.code : value;
    return String(code || '').trim().toUpperCase();
}

function isManaged(item) {
    return normalizeCode(item?.code).startsWith(MANAGED_PREFIX);
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key =>
            `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function canonicalDefinition(kind, definition) {
    const copy = Object.fromEntries(Object.entries(definition || {}).filter(([key]) => ![
        'id',
        'creationTime',
        'creatorId',
        'lastModificationTime',
        'lastModifierId',
        'isDeleted',
        'deleterId',
        'deletionTime',
    ].includes(key)));
    copy.code = normalizeCode(copy.code);
    if (kind === 'attributes') {
        copy.group = normalizeCode(copy.group) || null;
        copy.unit = normalizeCode(copy.unit) || copy.unit || null;
    }
    if (kind === 'options') copy.attribute = normalizeCode(copy.attribute) || null;
    if (Array.isArray(copy.translations)) {
        copy.translations = [...copy.translations]
            .map(translation => ({ ...translation }))
            .sort((left, right) => String(left.lang || '').localeCompare(String(right.lang || '')));
    }
    return copy;
}

function indexDefinitions(items, label) {
    const result = new Map();
    for (const item of items || []) {
        const code = normalizeCode(item?.code);
        if (!code || result.has(code)) throw new Error(`${label} has a missing or duplicate code.`);
        result.set(code, item);
    }
    return result;
}

function buildUsage(products) {
    const usage = {
        groups: new Map(),
        attributes: new Map(),
        options: new Map(),
    };
    for (const product of products || []) {
        const productCode = normalizeCode(product.code);
        for (const specification of product.specifications || []) {
            addUsage(usage.groups, normalizeCode(specification.group), productCode);
            addUsage(usage.attributes, normalizeCode(specification.attribute), productCode);
            addUsage(usage.options, normalizeCode(specification.option), productCode);
        }
    }
    return usage;
}

function addUsage(map, definitionCode, productCode) {
    if (!definitionCode) return;
    if (!map.has(definitionCode)) map.set(definitionCode, new Set());
    map.get(definitionCode).add(productCode);
}

function buildDefinitionReconciliation(desiredDefinitions, currentReference, products, artifactProductCodes) {
    const artifactCodes = new Set((artifactProductCodes || []).map(normalizeCode));
    const usage = buildUsage(products);
    const result = {
        eligible: true,
        conflicts: [],
        kinds: {},
        upsert: {},
        rollbackUpsert: {},
        delete: {},
        rollbackDelete: {},
    };

    for (const descriptor of KINDS) {
        const desired = (desiredDefinitions[descriptor.name] || []).filter(isManaged);
        const current = (currentReference[descriptor.reference] || []).filter(isManaged);
        const desiredByCode = indexDefinitions(desired, `Desired ${descriptor.name}`);
        const currentByCode = indexDefinitions(current, `Current ${descriptor.name}`);
        const operations = [];
        const upsert = [];
        const rollbackUpsert = [];
        const deleteCodes = [];
        const rollbackDeleteCodes = [];

        for (const code of [...desiredByCode.keys()].sort()) {
            const after = desiredByCode.get(code);
            const before = currentByCode.get(code);
            if (!before) {
                operations.push({ code, action: 'create' });
                upsert.push(after);
                rollbackDeleteCodes.push(code);
                continue;
            }
            if (stableStringify(canonicalDefinition(descriptor.name, before))
                === stableStringify(canonicalDefinition(descriptor.name, after))) {
                operations.push({ code, action: 'noop' });
                continue;
            }
            operations.push({ code, action: 'update' });
            upsert.push(after);
            rollbackUpsert.push(before);
        }

        for (const code of [...currentByCode.keys()].sort()) {
            if (desiredByCode.has(code)) continue;
            const usedBy = [...(usage[descriptor.name].get(code) || [])].sort();
            const outsideArtifact = usedBy.filter(productCode => !artifactCodes.has(productCode));
            if (outsideArtifact.length) {
                const conflict = {
                    kind: descriptor.name,
                    code,
                    reason: 'definition is used outside the artifact',
                    outsideArtifactProducts: outsideArtifact,
                };
                result.conflicts.push(conflict);
                operations.push({ code, action: 'conflict', usedByProducts: usedBy.length, outsideArtifactProducts: outsideArtifact });
                continue;
            }
            operations.push({ code, action: 'delete', usedByProducts: usedBy.length });
            deleteCodes.push(code);
            rollbackUpsert.push(currentByCode.get(code));
        }

        const counts = operations.reduce((countsByAction, operation) => {
            countsByAction[operation.action] += 1;
            return countsByAction;
        }, { create: 0, update: 0, noop: 0, delete: 0, conflict: 0 });
        result.kinds[descriptor.name] = { counts, operations };
        result.upsert[descriptor.name] = upsert;
        result.rollbackUpsert[descriptor.name] = rollbackUpsert;
        result.delete[descriptor.name] = deleteCodes;
        result.rollbackDelete[descriptor.name] = rollbackDeleteCodes;
    }

    const desiredAttributes = indexDefinitions(
        (desiredDefinitions.attributes || []).filter(isManaged),
        'Desired retained attributes');
    const attributeOperations = new Map(
        result.kinds.attributes.operations.map(operation => [operation.code, operation.action]));
    const deletedGroups = new Set(result.delete.groups);
    const currentAttributes = indexDefinitions(
        (currentReference.specificationAttributes || []).filter(isManaged),
        'Current retained attributes');
    const retainedAttributeCodes = new Set([
        ...desiredAttributes.keys(),
        ...[...attributeOperations.entries()]
            .filter(([, action]) => action === 'conflict')
            .map(([code]) => code),
    ]);
    for (const code of [...retainedAttributeCodes].sort()) {
        const attribute = desiredAttributes.get(code) || currentAttributes.get(code);
        const group = normalizeCode(attribute?.group);
        if (deletedGroups.has(group)) {
            result.conflicts.push({
                kind: 'groups',
                code: group,
                reason: `group is still referenced by retained attribute ${code}`,
            });
        }
    }
    result.eligible = result.conflicts.length === 0;
    return result;
}

function writeOutput(output, report, reconciliation) {
    withStagedOutput(output, staging => {
        fs.writeFileSync(path.join(staging, 'plan.json'), `${JSON.stringify(report, null, 2)}\n`);
        for (const descriptor of KINDS) {
            const name = descriptor.name;
            fs.writeFileSync(path.join(staging, `upsert-${name}.json`), `${JSON.stringify(reconciliation.upsert[name], null, 2)}\n`);
            fs.writeFileSync(path.join(staging, `rollback-upsert-${name}.json`), `${JSON.stringify(reconciliation.rollbackUpsert[name], null, 2)}\n`);
            fs.writeFileSync(path.join(staging, `delete-${name}.json`), `${JSON.stringify(reconciliation.delete[name], null, 2)}\n`);
            fs.writeFileSync(path.join(staging, `rollback-delete-${name}.json`), `${JSON.stringify(reconciliation.rollbackDelete[name], null, 2)}\n`);
        }
    });
}

function main() {
    const args = parseArgs();
    if (args.help || args.h) return usage();
    const artifactRoot = path.resolve(REPO_ROOT, requireArg(args, 'dir'));
    const catalogReferencePath = path.resolve(REPO_ROOT, requireArg(args, 'catalog-ref'));
    const productReferencePath = path.resolve(REPO_ROOT, requireArg(args, 'product-ref'));
    const bundle = readArtifactBundle(artifactRoot);
    if (!bundle.valid) throw new Error(`Artifact integrity failed: ${bundle.errors.slice(0, 10).join('; ')}`);
    if (bundle.manifest.catalogReferenceSha256 !== hashInputPath(catalogReferencePath)) {
        throw new Error('Catalog reference hash differs from artifact manifest.');
    }
    if (bundle.manifest.baselineReferenceSha256 !== hashInputPath(productReferencePath)) {
        throw new Error('Product reference hash differs from artifact manifest.');
    }
    const catalogReference = loadCatalogReference(catalogReferencePath);
    const productReference = loadVerifiedProductReference(productReferencePath);
    for (const descriptor of KINDS) {
        if (!Array.isArray(catalogReference[descriptor.reference])) {
            throw new Error(`Catalog reference lacks complete ${descriptor.reference} export.`);
        }
    }
    const reconciliation = buildDefinitionReconciliation(
        bundle.definitions,
        catalogReference,
        productReference.products,
        bundle.manifest.productCodes);
    const report = {
        generatedAt: new Date().toISOString(),
        mode: 'read-only-definition-reconciliation',
        eligible: reconciliation.eligible,
        artifactRoot,
        artifactManifestSha256: hashInputPath(path.join(artifactRoot, 'artifact-manifest.json')),
        catalogReferencePath,
        catalogReferenceSha256: hashInputPath(catalogReferencePath),
        productReferencePath,
        productReferenceSha256: hashInputPath(productReferencePath),
        workspaceId: catalogReference.workspaceId || productReference.manifest.workspaceId,
        conflicts: reconciliation.conflicts,
        kinds: reconciliation.kinds,
    };
    const output = assertScopedPath(
        path.join(REPO_ROOT, 'reports', 'thetea', String(args.report || `${bundle.manifest.snapshotId}-definitions`)),
        {
            repoRoot: REPO_ROOT,
            allowedRoot: path.join(REPO_ROOT, 'reports', 'thetea'),
            allowedDescription: 'reports/thetea/',
            label: 'TheTea definition reconciliation report',
        });
    writeOutput(output, report, reconciliation);
    console.log(`Eligible: ${report.eligible ? 'yes' : 'no'}`);
    for (const descriptor of KINDS) {
        const counts = report.kinds[descriptor.name].counts;
        console.log(`${descriptor.name}: create ${counts.create}, update ${counts.update}, noop ${counts.noop}, delete ${counts.delete}, conflict ${counts.conflict}`);
    }
    console.log(`Report: ${output}`);
    if (!report.eligible) process.exitCode = 1;
    return report;
}

if (require.main === module) {
    try { main(); } catch (error) {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { buildDefinitionReconciliation, canonicalDefinition };
