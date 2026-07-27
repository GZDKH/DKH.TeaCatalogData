'use strict';

const fs = require('fs');
const path = require('path');
const {
    atomicWrite,
    sha256,
    stableJson,
    writeJsonAtomic,
} = require('./artifacts');
const { projectArtifactItems } = require('./projection');

const PROJECTION_SCHEMA = 'catalog-source-observation-projection-v1';
const PROJECTION_MANIFEST_SCHEMA = 'catalog-source-observation-projection-manifest-v1';
const PROJECTION_REPORT_SCHEMA = 'catalog-source-observation-projection-report-v1';

function buildProjectionDocuments(bundle) {
    const { artifact, manifest } = bundle;
    const items = projectArtifactItems(artifact, {
        artifactSha256: manifest.artifactSha256,
    });
    const projection = {
        schemaVersion: PROJECTION_SCHEMA,
        inputEvidence: {
            artifactFile: manifest.artifactFile,
            artifactSha256: manifest.artifactSha256,
            checkpointFile: manifest.checkpointFile,
            checkpointSha256: manifest.checkpointSha256,
            rawPayloadDigest: manifest.rawPayloadDigest,
            semanticDigest: manifest.semanticDigest,
        },
        source: {
            id: manifest.sourceId,
            connectorVersion: manifest.connectorVersion,
            parserVersion: manifest.parserVersion,
        },
        snapshot: {
            id: manifest.snapshotId,
            observedAt: artifact.snapshot.observedAt,
        },
        itemCount: items.length,
        items,
        deletionCount: 0,
        deletions: [],
        authoritativeReferencesIncluded: false,
        reconciliationComplete: false,
        productionWrites: false,
    };
    const projectionJson = stableJson(projection);
    const projectionSha256 = sha256(projectionJson);
    const projectionFile = `${PROJECTION_SCHEMA}.${projectionSha256}.json`;
    const report = {
        schemaVersion: PROJECTION_REPORT_SCHEMA,
        mode: 'dry-run',
        sourceId: manifest.sourceId,
        snapshotId: manifest.snapshotId,
        observedAt: artifact.snapshot.observedAt,
        projectedItemCount: items.length,
        deletionCount: 0,
        productionWriteCount: 0,
        projectionFile,
        projectionSha256,
        inputArtifactSha256: manifest.artifactSha256,
        inputSemanticDigest: manifest.semanticDigest,
        diagnosticCounts: items
            .flatMap(item => item.observation.diagnosticCodes)
            .sort()
            .reduce((counts, code) => {
                counts[code] = (counts[code] || 0) + 1;
                return counts;
            }, Object.create(null)),
    };
    const reportJson = stableJson(report);
    const reportSha256 = sha256(reportJson);
    const outputManifest = {
        schemaVersion: PROJECTION_MANIFEST_SCHEMA,
        complete: true,
        sourceId: manifest.sourceId,
        snapshotId: manifest.snapshotId,
        itemCount: items.length,
        scope: 'commerce-observation-dry-run',
        authoritativeReferencesIncluded: false,
        reconciliationComplete: false,
        productionWrites: false,
        projectionFile,
        projectionSha256,
        reportFile: 'projection-report.json',
        reportSha256,
        inputArtifactSha256: manifest.artifactSha256,
        inputCheckpointSha256: manifest.checkpointSha256,
    };
    return {
        outputManifest,
        projection,
        projectionFile,
        projectionJson,
        report,
        reportJson,
    };
}

function writeProjectionBundle(outputDirectory, bundle) {
    const documents = buildProjectionDocuments(bundle);
    fs.mkdirSync(outputDirectory, { recursive: true });
    atomicWrite(
        path.join(outputDirectory, documents.projectionFile),
        documents.projectionJson,
    );
    atomicWrite(
        path.join(outputDirectory, 'projection-report.json'),
        documents.reportJson,
    );
    // The manifest is deliberately the final file written.
    writeJsonAtomic(
        path.join(outputDirectory, 'projection-manifest.json'),
        documents.outputManifest,
    );
    return documents;
}

module.exports = {
    PROJECTION_MANIFEST_SCHEMA,
    PROJECTION_REPORT_SCHEMA,
    PROJECTION_SCHEMA,
    buildProjectionDocuments,
    writeProjectionBundle,
};
