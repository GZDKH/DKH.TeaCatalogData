#!/usr/bin/env node
'use strict';

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
const { safeSegment } = require('./lib/artifacts');
const { loadVerifiedCatalogSourceBundle } = require('./lib/projection-bundle');
const { writeProjectionBundle } = require('./lib/projection-output');

function repoPath(repositoryRoot, value) {
    return path.resolve(repositoryRoot, value);
}

function projectArtifact(args, options = {}) {
    const repositoryRoot = path.resolve(options.repositoryRoot || REPO_ROOT);
    const allowedOutputRoot = path.join(
        repositoryRoot,
        'artifacts',
        'catalog-source-projections',
    );
    const artifactDirectory = repoPath(
        repositoryRoot,
        requireArg(args, 'artifact-dir'),
    );
    const bundle = loadVerifiedCatalogSourceBundle(artifactDirectory);
    const sourceId = safeSegment(bundle.manifest.sourceId, 'source ID');
    const snapshotId = safeSegment(bundle.manifest.snapshotId, 'snapshot ID');
    const outputDirectory = args.out
        ? repoPath(repositoryRoot, String(args.out))
        : path.join(
            allowedOutputRoot,
            sourceId,
            snapshotId,
        );
    const relativeOutput = path.relative(allowedOutputRoot, outputDirectory);
    if (!relativeOutput ||
        relativeOutput === '..' ||
        relativeOutput.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeOutput)) {
        throw new Error(
            'Catalog-source projection output must be a child of ' +
            'artifacts/catalog-source-projections/.',
        );
    }
    assertScopedPath(outputDirectory, {
        repoRoot: repositoryRoot,
        allowedRoot: allowedOutputRoot,
        allowedDescription: 'artifacts/catalog-source-projections/',
        label: 'Catalog-source projection output',
    });
    const documents = withStagedOutput(
        outputDirectory,
        stagingDirectory => writeProjectionBundle(stagingDirectory, bundle),
    );
    return { documents, outputDirectory };
}

function main() {
    const result = projectArtifact(parseArgs());
    console.log(`Source: ${result.documents.outputManifest.sourceId}`);
    console.log(`Snapshot: ${result.documents.outputManifest.snapshotId}`);
    console.log(`Projected items: ${result.documents.outputManifest.itemCount}`);
    console.log(`Projection SHA-256: ${result.documents.outputManifest.projectionSha256}`);
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
    projectArtifact,
};
