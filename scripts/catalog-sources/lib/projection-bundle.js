'use strict';

const fs = require('fs');
const path = require('path');
const { readJson, sha256 } = require('./artifacts');
const {
    ARTIFACT_SCHEMA,
    CHECKPOINT_SCHEMA,
    MANIFEST_SCHEMA,
    artifactSemanticDigest,
    assertArtifactSafe,
} = require('./runtime');

const DIGEST = /^[a-f0-9]{64}$/;

function assertDigest(value, label) {
    if (!DIGEST.test(String(value || ''))) {
        throw new Error(`${label} must be a lowercase SHA-256 digest.`);
    }
}

function assertRealDirectory(directory, label) {
    const resolved = path.resolve(directory);
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${label} must be a real directory.`);
    }
    return resolved;
}

function resolveContainedFile(root, relativePath, label) {
    if (!relativePath || path.isAbsolute(relativePath)) {
        throw new Error(`${label} must be a relative file path.`);
    }
    const resolved = path.resolve(root, relativePath);
    if (!resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`${label} escapes the artifact directory.`);
    }
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`${label} must be a real file.`);
    }
    return resolved;
}

function assertExactBundleFiles(root, expectedFiles) {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const actual = entries.map(entry => {
        if (entry.isSymbolicLink() || !entry.isFile()) {
            throw new Error(`Artifact bundle contains a non-file entry: ${entry.name}.`);
        }
        return entry.name;
    }).sort();
    const expected = [...expectedFiles].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
            `Artifact bundle must contain exactly: ${expected.join(', ')}.`);
    }
}

function readVerifiedJson(file, expectedDigest, label) {
    const content = fs.readFileSync(file);
    if (sha256(content) !== expectedDigest) {
        throw new Error(`${label} hash differs from the manifest.`);
    }
    try {
        return JSON.parse(content.toString('utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
        throw new Error(`${label} is invalid JSON: ${error.message}`);
    }
}

function assertManifest(manifest) {
    if (manifest.schemaVersion !== MANIFEST_SCHEMA ||
        manifest.complete !== true ||
        manifest.authoritativeForDeletion !== false ||
        !manifest.sourceId ||
        !manifest.connectorVersion ||
        !manifest.parserVersion ||
        !manifest.snapshotId ||
        typeof manifest.observedAt !== 'string' ||
        !Number.isFinite(new Date(manifest.observedAt).getTime()) ||
        new Date(manifest.observedAt).toISOString() !== manifest.observedAt ||
        !Number.isSafeInteger(manifest.itemCount) ||
        manifest.itemCount < 1 ||
        manifest.itemCount > 100_000) {
        throw new Error('Catalog-source artifact manifest is incomplete or unsupported.');
    }
    for (const [value, label] of [
        [manifest.rawPayloadDigest, 'manifest.rawPayloadDigest'],
        [manifest.semanticDigest, 'manifest.semanticDigest'],
        [manifest.artifactSha256, 'manifest.artifactSha256'],
        [manifest.checkpointSha256, 'manifest.checkpointSha256'],
    ]) {
        assertDigest(value, label);
    }
    if (manifest.artifactFile !==
            `${ARTIFACT_SCHEMA}.${manifest.artifactSha256}.json` ||
        manifest.checkpointFile !== 'source-checkpoint.json') {
        throw new Error('Catalog-source manifest file names are not content-addressed.');
    }
}

function assertArtifact(manifest, artifact) {
    if (artifact.schemaVersion !== ARTIFACT_SCHEMA ||
        artifact.source?.id !== manifest.sourceId ||
        artifact.source?.connectorVersion !== manifest.connectorVersion ||
        artifact.source?.referencePricesAreRetailPrices !== false ||
        artifact.snapshot?.id !== manifest.snapshotId ||
        artifact.snapshot?.observedAt !== manifest.observedAt ||
        artifact.snapshot?.parserVersion !== manifest.parserVersion ||
        artifact.snapshot?.rawPayloadDigest !== manifest.rawPayloadDigest ||
        artifact.snapshot?.complete !== true ||
        artifact.snapshot?.authoritativeForDeletion !== false ||
        artifact.semanticDigest !== manifest.semanticDigest ||
        artifact.itemCount !== manifest.itemCount ||
        !Array.isArray(artifact.items) ||
        artifact.items.length !== manifest.itemCount ||
        !Array.isArray(artifact.deletions) ||
        artifact.deletions.length !== 0) {
        throw new Error('Catalog-source artifact does not match its complete manifest.');
    }
    if (artifactSemanticDigest(artifact) !== artifact.semanticDigest) {
        throw new Error('Catalog-source artifact semantic digest is invalid.');
    }
    const externalIds = artifact.items.map(item => String(item?.externalId || ''));
    if (externalIds.some(value => !value) ||
        new Set(externalIds).size !== externalIds.length) {
        throw new Error('Catalog-source artifact external IDs must be non-empty and unique.');
    }
    assertArtifactSafe(artifact);
}

function assertCheckpoint(manifest, checkpoint) {
    if (checkpoint.schemaVersion !== CHECKPOINT_SCHEMA ||
        checkpoint.status !== 'complete' ||
        checkpoint.sourceId !== manifest.sourceId ||
        checkpoint.snapshotId !== manifest.snapshotId ||
        checkpoint.connectorVersion !== manifest.connectorVersion ||
        checkpoint.parserVersion !== manifest.parserVersion ||
        checkpoint.observedAt !== manifest.observedAt ||
        checkpoint.artifactSchemaVersion !== ARTIFACT_SCHEMA ||
        checkpoint.artifactSha256 !== manifest.artifactSha256 ||
        checkpoint.totalCount !== manifest.itemCount) {
        throw new Error('Catalog-source checkpoint does not match the published artifact.');
    }
}

function loadVerifiedCatalogSourceBundle(directory) {
    const root = assertRealDirectory(directory, 'Catalog-source artifact directory');
    const manifestFile = resolveContainedFile(
        root,
        'artifact-manifest.json',
        'Artifact manifest');
    const manifest = readJson(manifestFile);
    assertManifest(manifest);

    const artifactFile = resolveContainedFile(
        root,
        manifest.artifactFile,
        'Artifact data file');
    const checkpointFile = resolveContainedFile(
        root,
        manifest.checkpointFile,
        'Artifact checkpoint file');
    assertExactBundleFiles(root, [
        'artifact-manifest.json',
        manifest.artifactFile,
        manifest.checkpointFile,
    ]);

    const artifact = readVerifiedJson(
        artifactFile,
        manifest.artifactSha256,
        'Catalog-source artifact');
    const checkpoint = readVerifiedJson(
        checkpointFile,
        manifest.checkpointSha256,
        'Catalog-source checkpoint');
    assertArtifact(manifest, artifact);
    assertCheckpoint(manifest, checkpoint);
    return {
        artifact,
        artifactFile,
        checkpoint,
        checkpointFile,
        manifest,
        manifestFile,
        root,
    };
}

module.exports = {
    loadVerifiedCatalogSourceBundle,
};
