'use strict';

const fs = require('fs');
const path = require('path');
const {
    atomicWrite,
    sha256,
    stableJson,
    writeJsonAtomic,
} = require('./artifacts');

const RECONCILIATION_SCHEMA = 'catalog-source-product-reconciliation-v1';
const RECONCILIATION_MANIFEST_SCHEMA =
    'catalog-source-product-reconciliation-manifest-v1';
const RECONCILIATION_REPORT_SCHEMA =
    'catalog-source-product-reconciliation-report-v1';

function contentAddressedJson(prefix, value) {
    const json = stableJson(value);
    const digest = sha256(json);
    return {
        digest,
        file: `${prefix}.${digest}.json`,
        json,
        value,
    };
}

function publicMapping(entry) {
    const mapping = {
        externalId: entry.externalId,
        productCode: entry.productCode,
        status: entry.status,
    };
    if (entry.productId) mapping.productId = entry.productId;
    if (entry.published !== undefined) mapping.published = entry.published;
    if (entry.commerceSourceIncarnationId !== undefined) {
        mapping.commerceSourceIncarnationId = entry.commerceSourceIncarnationId;
    }
    if (entry.commerceMappingStatus !== undefined) {
        mapping.commerceMappingStatus = entry.commerceMappingStatus;
    }
    return mapping;
}

function buildReconciliationDocuments(options) {
    const {
        onlyExternalId = null,
        projectionBundle,
        reconciliation,
        references,
    } = options;
    const matchedEntries = reconciliation.entries.filter(
        entry => entry.status === 'matched-update',
    );
    const patchEntries = reconciliation.entries.filter(entry =>
        entry.status === 'matched-update' ||
        entry.status === 'missing-create-draft',
    );
    const mappings = reconciliation.entries.map(publicMapping);
    const productPatches = patchEntries.map(entry => entry.productPatch);
    const rollbackProducts = matchedEntries.map(entry => entry.rollbackProduct);
    const draftProposals = reconciliation.entries
        .filter(entry => entry.status === 'missing-create-draft')
        .map(publicMapping);

    const patchesDocument = contentAddressedJson(
        'product-patches',
        productPatches,
    );
    const rollbackDocument = contentAddressedJson(
        'rollback-products',
        rollbackProducts,
    );
    const mappingsDocument = contentAddressedJson(
        'source-product-mappings',
        mappings,
    );
    const reconciliationDocument = {
        schemaVersion: RECONCILIATION_SCHEMA,
        scope: 'productcatalog-reconciliation-dry-run',
        source: projectionBundle.projection.source,
        snapshot: projectionBundle.projection.snapshot,
        workspaceId: references.workspaceId,
        selection: onlyExternalId
            ? { mode: 'one-product', externalId: onlyExternalId }
            : { mode: 'full-snapshot' },
        selectionComplete: !onlyExternalId,
        inputEvidence: {
            projectionSha256: projectionBundle.manifest.projectionSha256,
            projectionManifestSha256: projectionBundle.manifestSha256,
            projectionReportSha256: projectionBundle.manifest.reportSha256,
            sourceArtifactSha256:
                projectionBundle.manifest.inputArtifactSha256,
            sourceCheckpointSha256:
                projectionBundle.manifest.inputCheckpointSha256,
            catalogReferenceSha256:
                references.evidence.hashes.catalogReferenceSha256,
            productManifestSha256:
                references.evidence.hashes.productManifestSha256,
            productReferenceTreeSha256:
                references.evidence.hashes.productReferenceTreeSha256,
            productsSha256: references.evidence.hashes.productsSha256,
            productCodesSha256:
                references.evidence.hashes.productCodesSha256,
            productReferenceFetchedAt: references.fetchedAt.products,
            catalogReferenceFetchedAt: references.fetchedAt.catalog,
        },
        counts: reconciliation.report.counts,
        mappingFile: mappingsDocument.file,
        mappingSha256: mappingsDocument.digest,
        productPatchesFile: patchesDocument.file,
        productPatchesSha256: patchesDocument.digest,
        productPatchCount: productPatches.length,
        rollbackProductsFile: rollbackDocument.file,
        rollbackProductsSha256: rollbackDocument.digest,
        draftProposals,
        completeProductReferenceIncluded: true,
        catalogReferenceStructurallyVerified: true,
        catalogReferenceCompletenessProven: false,
        authoritativeProductReferencesIncluded: false,
        authoritativeCommerceReferencesIncluded: false,
        productCatalogReconciliationComplete: false,
        reconciliationComplete: false,
        publicationEligible: false,
        productionWrites: false,
    };
    const reconciliationJson = stableJson(reconciliationDocument);
    const reconciliationSha256 = sha256(reconciliationJson);
    const reconciliationFile =
        `${RECONCILIATION_SCHEMA}.${reconciliationSha256}.json`;
    const report = {
        schemaVersion: RECONCILIATION_REPORT_SCHEMA,
        mode: 'dry-run',
        sourceId: reconciliation.sourceId,
        snapshotId: projectionBundle.manifest.snapshotId,
        workspaceId: references.workspaceId,
        selection: reconciliationDocument.selection,
        inputProjectionItemCount: projectionBundle.manifest.itemCount,
        selectedItemCount:
            reconciliation.report.counts.matched +
            reconciliation.report.counts.missing +
            reconciliation.report.counts.ambiguous,
        counts: reconciliation.report.counts,
        matched: reconciliation.report.matched,
        missing: reconciliation.report.missing,
        ambiguous: reconciliation.report.ambiguous,
        productPatchCount: productPatches.length,
        rollbackProductCount: rollbackProducts.length,
        productionWriteCount: 0,
        commercePublicationReady: false,
        commerceBlocker: 'authoritative-source-incarnation-reference',
        reconciliationFile,
        reconciliationSha256,
    };
    const reportJson = stableJson(report);
    const reportSha256 = sha256(reportJson);
    const manifest = {
        schemaVersion: RECONCILIATION_MANIFEST_SCHEMA,
        complete: true,
        mode: 'dry-run',
        scope: 'productcatalog-reconciliation-dry-run',
        sourceId: reconciliation.sourceId,
        snapshotId: projectionBundle.manifest.snapshotId,
        workspaceId: references.workspaceId,
        selection: reconciliationDocument.selection,
        selectionComplete: reconciliationDocument.selectionComplete,
        inputProjectionItemCount: projectionBundle.manifest.itemCount,
        selectedItemCount:
            reconciliation.report.counts.matched +
            reconciliation.report.counts.missing +
            reconciliation.report.counts.ambiguous,
        counts: reconciliation.report.counts,
        completeProductReferenceIncluded: true,
        catalogReferenceStructurallyVerified: true,
        catalogReferenceCompletenessProven: false,
        authoritativeProductReferencesIncluded: false,
        authoritativeCommerceReferencesIncluded: false,
        productCatalogReconciliationComplete: false,
        reconciliationComplete: false,
        publicationEligible: false,
        productionWrites: false,
        rollbackScope: 'productcatalog-product-patches',
        commerceRollbackCovered: false,
        rollbackComplete: reconciliation.report.counts.missing === 0,
        nonReversibleCreateCodes: reconciliation.report.missing
            .map(entry => entry.productCode),
        reconciliationFile,
        reconciliationSha256,
        reportFile: 'reconciliation-report.json',
        reportSha256,
        mappingFile: mappingsDocument.file,
        mappingSha256: mappingsDocument.digest,
        productPatchesFile: patchesDocument.file,
        productPatchesSha256: patchesDocument.digest,
        productPatchCount: productPatches.length,
        rollbackProductsFile: rollbackDocument.file,
        rollbackProductsSha256: rollbackDocument.digest,
        inputProjectionSha256: projectionBundle.manifest.projectionSha256,
        inputProjectionManifestSha256: projectionBundle.manifestSha256,
        inputCatalogReferenceSha256:
            references.evidence.hashes.catalogReferenceSha256,
        inputProductsSha256: references.evidence.hashes.productsSha256,
        inputProductReferenceTreeSha256:
            references.evidence.hashes.productReferenceTreeSha256,
    };
    return {
        manifest,
        mappingsDocument,
        patchesDocument,
        reconciliationDocument,
        reconciliationFile,
        reconciliationJson,
        report,
        reportJson,
        rollbackDocument,
    };
}

function writeReconciliationBundle(outputDirectory, options) {
    const documents = buildReconciliationDocuments(options);
    fs.mkdirSync(outputDirectory, { recursive: true });
    for (const document of [
        documents.mappingsDocument,
        documents.patchesDocument,
        documents.rollbackDocument,
    ]) {
        atomicWrite(path.join(outputDirectory, document.file), document.json);
    }
    atomicWrite(
        path.join(outputDirectory, documents.reconciliationFile),
        documents.reconciliationJson,
    );
    atomicWrite(
        path.join(outputDirectory, 'reconciliation-report.json'),
        documents.reportJson,
    );
    // The manifest is deliberately the final file published.
    writeJsonAtomic(
        path.join(outputDirectory, 'reconciliation-manifest.json'),
        documents.manifest,
    );
    return documents;
}

module.exports = {
    RECONCILIATION_MANIFEST_SCHEMA,
    RECONCILIATION_REPORT_SCHEMA,
    RECONCILIATION_SCHEMA,
    buildReconciliationDocuments,
    writeReconciliationBundle,
};
