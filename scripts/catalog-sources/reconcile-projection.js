#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
    REPO_ROOT,
    parseArgs,
    requireArg,
} = require('../thetea/lib/env');
const {
    assertScopedPath,
    withStagedOutput,
} = require('../thetea/lib/generated-output');
const {
    safeSegment,
    sha256,
    stableJson,
} = require('./lib/artifacts');
const { reconcileProjection } = require('./lib/reconciliation');
const { loadVerifiedProjectionBundle } = require('./lib/reconciliation-bundle');
const {
    writeReconciliationBundle,
} = require('./lib/reconciliation-output');
const {
    loadReconciliationReferences,
} = require('./lib/reconciliation-references');

function resolveInput(repositoryRoot, value) {
    return path.resolve(repositoryRoot, value);
}

function canonicalFuturePath(target) {
    const suffix = [];
    let current = path.resolve(target);
    while (!fs.existsSync(current)) {
        suffix.unshift(path.basename(current));
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return path.join(fs.realpathSync(current), ...suffix);
}

function requireCanonicalChild(root, target) {
    const canonicalRoot = canonicalFuturePath(root);
    const canonicalTarget = canonicalFuturePath(target);
    const relative = path.relative(canonicalRoot, canonicalTarget);
    if (!relative ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)) {
        throw new Error(
            'Catalog-source reconciliation output must resolve inside ' +
            'artifacts/catalog-source-reconciliations/.',
        );
    }
}

function selectProjection(projection, onlyExternalId) {
    if (!onlyExternalId) return projection;
    if (!/^[1-9]\d*$/.test(onlyExternalId)) {
        throw new Error('--only must be a canonical positive external ID.');
    }
    const items = projection.items.filter(item => item.externalId === onlyExternalId);
    if (items.length !== 1) {
        throw new Error(
            `--only=${onlyExternalId} must identify exactly one projected item.`,
        );
    }
    return {
        ...projection,
        itemCount: 1,
        items,
    };
}

function referenceCode(value) {
    const raw = value && typeof value === 'object' ? value.code : value;
    return typeof raw === 'string' && raw.trim()
        ? raw.trim().toUpperCase()
        : null;
}

function assertReconciliationReferences(reconciliation, references) {
    const available = {
        catalogs: new Set(references.catalogs.map(entry =>
            referenceCode(entry.code))),
        categories: new Set(references.categories.map(entry =>
            referenceCode(entry.code))),
        groups: new Set(references.specificationGroups.map(entry =>
            referenceCode(entry.code))),
        attributes: new Set(references.specificationAttributes.map(entry =>
            referenceCode(entry.code))),
        options: new Set(references.specificationAttributeOptions.map(entry =>
            referenceCode(entry.code))),
    };
    for (const entry of reconciliation.entries) {
        const product = entry.productPatch;
        if (!product) continue;
        for (const specification of product.specifications || []) {
            const attribute = referenceCode(specification.attribute);
            const group = referenceCode(specification.group);
            const option = referenceCode(specification.option);
            if (!attribute || !available.attributes.has(attribute) ||
                (group && !available.groups.has(group)) ||
                (option && !available.options.has(option))) {
                throw new Error(
                    `ZZCTea product ${entry.productCode} references an unavailable specification definition.`,
                );
            }
        }
        for (const assignment of product.catalogs || []) {
            const catalog = referenceCode(assignment.catalog);
            const category = referenceCode(assignment.category);
            if (!catalog || !category ||
                !available.catalogs.has(catalog) ||
                !available.categories.has(category)) {
                throw new Error(
                    `ZZCTea product ${entry.productCode} references an unavailable catalog definition.`,
                );
            }
        }
    }
}

function reconcileCatalogSource(args, options = {}) {
    const repositoryRoot = path.resolve(options.repositoryRoot || REPO_ROOT);
    const projectionBundle = loadVerifiedProjectionBundle(resolveInput(
        repositoryRoot,
        requireArg(args, 'projection-dir'),
    ));
    const references = loadReconciliationReferences({
        catalogReferencePath: resolveInput(
            repositoryRoot,
            requireArg(args, 'catalog-ref'),
        ),
        productReferencePath: resolveInput(
            repositoryRoot,
            requireArg(args, 'product-ref'),
        ),
    });
    const onlyExternalId = args.only === undefined
        ? null
        : String(args.only);
    const selectedProjection = selectProjection(
        projectionBundle.projection,
        onlyExternalId,
    );
    const reconciliation = reconcileProjection(
        selectedProjection,
        references.products,
    );
    assertReconciliationReferences(reconciliation, references);
    const sourceId = safeSegment(reconciliation.sourceId, 'source ID');
    const snapshotId = safeSegment(
        projectionBundle.manifest.snapshotId,
        'snapshot ID',
    );
    const allowedOutputRoot = path.join(
        repositoryRoot,
        'artifacts',
        'catalog-source-reconciliations',
    );
    const selectionSegment = onlyExternalId
        ? `only-${safeSegment(onlyExternalId, 'external ID')}`
        : 'full';
    const inputBindingDigest = sha256(stableJson({
        catalogReferenceSha256:
            references.evidence.hashes.catalogReferenceSha256,
        productReferenceTreeSha256:
            references.evidence.hashes.productReferenceTreeSha256,
        projectionManifestSha256: projectionBundle.manifestSha256,
        projectionSha256: projectionBundle.manifest.projectionSha256,
        workspaceId: references.workspaceId,
    }));
    const outputDirectory = args.out
        ? resolveInput(repositoryRoot, String(args.out))
        : path.join(
            allowedOutputRoot,
            sourceId,
            snapshotId,
            inputBindingDigest,
            selectionSegment,
        );
    const relativeOutput = path.relative(allowedOutputRoot, outputDirectory);
    if (!relativeOutput ||
        relativeOutput === '..' ||
        relativeOutput.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeOutput)) {
        throw new Error(
            'Catalog-source reconciliation output must be a child of ' +
            'artifacts/catalog-source-reconciliations/.',
        );
    }
    requireCanonicalChild(allowedOutputRoot, outputDirectory);
    assertScopedPath(outputDirectory, {
        repoRoot: repositoryRoot,
        allowedRoot: allowedOutputRoot,
        allowedDescription: 'artifacts/catalog-source-reconciliations/',
        label: 'Catalog-source reconciliation output',
    });
    const documents = withStagedOutput(
        outputDirectory,
        stagingDirectory => writeReconciliationBundle(stagingDirectory, {
            onlyExternalId,
            projectionBundle,
            reconciliation,
            references,
        }),
    );
    return {
        documents,
        outputDirectory,
        reconciliation,
    };
}

function main() {
    const result = reconcileCatalogSource(parseArgs());
    console.log(`Source: ${result.documents.manifest.sourceId}`);
    console.log(`Snapshot: ${result.documents.manifest.snapshotId}`);
    console.log(`Matched existing: ${result.documents.manifest.counts.matched}`);
    console.log(`Proposed drafts: ${result.documents.manifest.counts.missing}`);
    console.log(`Ambiguous: ${result.documents.manifest.counts.ambiguous}`);
    console.log(`Output: ${result.outputDirectory}`);
    console.log('Production writes: none');
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`${error.code || error.name}: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = {
    assertReconciliationReferences,
    requireCanonicalChild,
    reconcileCatalogSource,
    selectProjection,
};
