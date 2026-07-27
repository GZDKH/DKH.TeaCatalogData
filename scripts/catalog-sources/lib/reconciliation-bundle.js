'use strict';

const fs = require('fs');
const path = require('path');
const { sha256 } = require('./artifacts');
const {
    PROJECTION_MANIFEST_SCHEMA,
    PROJECTION_REPORT_SCHEMA,
    PROJECTION_SCHEMA,
} = require('./projection-output');

const DIGEST = /^[a-f0-9]{64}$/;
const CODE = /^[a-z0-9][a-z0-9._-]*$/;

function requireDigest(value, label) {
    if (typeof value !== 'string' || !DIGEST.test(value)) {
        throw new Error(`${label} must be a lowercase SHA-256 digest.`);
    }
}

function realDirectory(directory) {
    const resolved = path.resolve(directory);
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error('Projection bundle input must be a real directory.');
    }
    return resolved;
}

function realContainedFile(root, fileName, label) {
    if (!fileName || path.isAbsolute(fileName)) {
        throw new Error(`${label} must use a relative file name.`);
    }
    const resolved = path.resolve(root, fileName);
    if (!resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`${label} escapes the projection bundle.`);
    }
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`${label} must be a real file.`);
    }
    return resolved;
}

function parseJsonBuffer(buffer, label) {
    try {
        return JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
        throw new Error(`${label} is invalid JSON: ${error.message}`);
    }
}

function readHashedJson(file, expectedHash, label) {
    const buffer = fs.readFileSync(file);
    if (sha256(buffer) !== expectedHash) {
        throw new Error(`${label} hash differs from the projection manifest.`);
    }
    return parseJsonBuffer(buffer, label);
}

function assertManifest(manifest) {
    if (manifest.schemaVersion !== PROJECTION_MANIFEST_SCHEMA ||
        manifest.complete !== true ||
        manifest.scope !== 'commerce-observation-dry-run' ||
        manifest.authoritativeReferencesIncluded !== false ||
        manifest.reconciliationComplete !== false ||
        manifest.productionWrites !== false ||
        typeof manifest.sourceId !== 'string' ||
        !CODE.test(manifest.sourceId) ||
        typeof manifest.snapshotId !== 'string' ||
        !manifest.snapshotId ||
        !Number.isSafeInteger(manifest.itemCount) ||
        manifest.itemCount < 1 ||
        manifest.itemCount > 100_000) {
        throw new Error('Projection manifest is incomplete or unsupported.');
    }
    for (const [value, label] of [
        [manifest.projectionSha256, 'manifest.projectionSha256'],
        [manifest.reportSha256, 'manifest.reportSha256'],
        [manifest.inputArtifactSha256, 'manifest.inputArtifactSha256'],
        [manifest.inputCheckpointSha256, 'manifest.inputCheckpointSha256'],
    ]) {
        requireDigest(value, label);
    }
    if (manifest.projectionFile !==
            `${PROJECTION_SCHEMA}.${manifest.projectionSha256}.json` ||
        manifest.reportFile !== 'projection-report.json') {
        throw new Error('Projection manifest file names are not content-addressed.');
    }
}

function assertProjection(manifest, projection) {
    if (projection.schemaVersion !== PROJECTION_SCHEMA ||
        projection.source?.id !== manifest.sourceId ||
        projection.snapshot?.id !== manifest.snapshotId ||
        projection.itemCount !== manifest.itemCount ||
        !Array.isArray(projection.items) ||
        projection.items.length !== manifest.itemCount ||
        projection.deletionCount !== 0 ||
        !Array.isArray(projection.deletions) ||
        projection.deletions.length !== 0 ||
        projection.authoritativeReferencesIncluded !== false ||
        projection.reconciliationComplete !== false ||
        projection.productionWrites !== false ||
        projection.inputEvidence?.artifactSha256 !== manifest.inputArtifactSha256 ||
        projection.inputEvidence?.checkpointSha256 !== manifest.inputCheckpointSha256) {
        throw new Error('Projection data does not match its manifest.');
    }
    const externalIds = projection.items.map(item => String(item?.externalId || ''));
    if (externalIds.some(value => !/^[1-9]\d*$/.test(value)) ||
        new Set(externalIds).size !== externalIds.length) {
        throw new Error('Projection external IDs must be unique positive integers.');
    }
}

function assertReport(manifest, projection, report) {
    if (report.schemaVersion !== PROJECTION_REPORT_SCHEMA ||
        report.mode !== 'dry-run' ||
        report.sourceId !== manifest.sourceId ||
        report.snapshotId !== manifest.snapshotId ||
        report.projectedItemCount !== manifest.itemCount ||
        report.deletionCount !== 0 ||
        report.productionWriteCount !== 0 ||
        report.projectionFile !== manifest.projectionFile ||
        report.projectionSha256 !== manifest.projectionSha256 ||
        report.inputArtifactSha256 !== manifest.inputArtifactSha256 ||
        report.inputSemanticDigest !== projection.inputEvidence?.semanticDigest) {
        throw new Error('Projection report does not match its manifest and data.');
    }
}

function loadVerifiedProjectionBundle(directory) {
    const root = realDirectory(directory);
    const manifestFile = realContainedFile(
        root,
        'projection-manifest.json',
        'Projection manifest',
    );
    const manifestBuffer = fs.readFileSync(manifestFile);
    const manifest = parseJsonBuffer(
        manifestBuffer,
        'Projection manifest',
    );
    assertManifest(manifest);
    const projectionFile = realContainedFile(
        root,
        manifest.projectionFile,
        'Projection data',
    );
    const reportFile = realContainedFile(
        root,
        manifest.reportFile,
        'Projection report',
    );
    const actualFiles = fs.readdirSync(root, { withFileTypes: true }).map(entry => {
        if (entry.isSymbolicLink() || !entry.isFile()) {
            throw new Error(`Projection bundle contains a non-file entry: ${entry.name}.`);
        }
        return entry.name;
    }).sort();
    const expectedFiles = [
        'projection-manifest.json',
        manifest.projectionFile,
        manifest.reportFile,
    ].sort();
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
        throw new Error(
            `Projection bundle must contain exactly: ${expectedFiles.join(', ')}.`,
        );
    }
    const projection = readHashedJson(
        projectionFile,
        manifest.projectionSha256,
        'Projection data',
    );
    const report = readHashedJson(
        reportFile,
        manifest.reportSha256,
        'Projection report',
    );
    assertProjection(manifest, projection);
    assertReport(manifest, projection, report);
    return {
        manifest,
        manifestFile,
        manifestSha256: sha256(manifestBuffer),
        projection,
        projectionFile,
        report,
        reportFile,
        root,
    };
}

module.exports = {
    loadVerifiedProjectionBundle,
};
