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
    readJson,
    sha256,
} = require('./lib/artifacts');
const {
    verifyAdminConsoleArtifact,
    writeAdminConsoleArtifact,
} = require('./lib/admin-console-artifact');
const {
    verifyImportBundle,
    writeImportBundle,
} = require('./lib/import-bundle');
const {
    materializeVerifiedMedia,
} = require('./lib/media-materialization');
const {
    loadVerifiedCatalogSourceBundle,
} = require('./lib/projection-bundle');
const {
    loadVerifiedProjectionBundle,
} = require('./lib/reconciliation-bundle');
const {
    loadVerifiedMappings,
} = require('./materialize-media');

function resolveDirectory(repositoryRoot, value, label) {
    const directory = path.resolve(repositoryRoot, value);
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${label} must be a real directory.`);
    }
    return directory;
}

function resolveFile(repositoryRoot, value, label) {
    const file = path.resolve(repositoryRoot, value);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`${label} must be a real file.`);
    }
    return file;
}

function assertOutputPath(repositoryRoot, outputDirectory) {
    const canonicalRepositoryRoot = fs.realpathSync(repositoryRoot);
    const allowedRoot = path.join(canonicalRepositoryRoot, 'import', 'zzctea');
    let current = canonicalRepositoryRoot;
    for (const segment of ['import', 'zzctea']) {
        current = path.join(current, segment);
        if (fs.existsSync(current)) {
            const stat = fs.lstatSync(current);
            if (stat.isSymbolicLink() || !stat.isDirectory()) {
                throw new Error(
                    'ZZCTea import bundle root cannot contain symlink ancestors.',
                );
            }
        } else {
            fs.mkdirSync(current);
        }
    }
    const canonicalOutput = assertScopedPath(outputDirectory, {
        repoRoot: canonicalRepositoryRoot,
        allowedRoot,
        allowedDescription: 'import/zzctea/',
        label: 'ZZCTea import bundle output',
    });
    const canonicalAllowedRoot = fs.realpathSync(allowedRoot);
    const relative = path.relative(canonicalAllowedRoot, canonicalOutput);
    if (!relative ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)) {
        throw new Error('ZZCTea import bundle must resolve inside import/zzctea/.');
    }
    current = allowedRoot;
    for (const segment of path.relative(allowedRoot, outputDirectory).split(path.sep)) {
        current = path.join(current, segment);
        if (!fs.existsSync(current)) break;
        if (fs.lstatSync(current).isSymbolicLink()) {
            throw new Error('ZZCTea import bundle path cannot contain symlink ancestors.');
        }
    }
    return canonicalOutput;
}

function assertCacheOutputPath(repositoryRoot, outputDirectory) {
    const canonicalRepositoryRoot = fs.realpathSync(repositoryRoot);
    const allowedRoot = path.join(
        canonicalRepositoryRoot,
        'artifacts',
        'catalog-source-import-bundles',
        'zzctea',
    );
    let current = canonicalRepositoryRoot;
    for (const segment of [
        'artifacts',
        'catalog-source-import-bundles',
        'zzctea',
    ]) {
        current = path.join(current, segment);
        if (fs.existsSync(current)) {
            const stat = fs.lstatSync(current);
            if (stat.isSymbolicLink() || !stat.isDirectory()) {
                throw new Error(
                    'ZZCTea cache bundle root cannot contain symlink ancestors.',
                );
            }
        } else {
            fs.mkdirSync(current);
        }
    }
    const canonicalOutput = assertScopedPath(outputDirectory, {
        repoRoot: canonicalRepositoryRoot,
        allowedRoot,
        allowedDescription:
            'artifacts/catalog-source-import-bundles/zzctea/',
        label: 'ZZCTea verified cache bundle output',
    });
    const canonicalAllowedRoot = fs.realpathSync(allowedRoot);
    const relative = path.relative(canonicalAllowedRoot, canonicalOutput);
    if (!relative ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)) {
        throw new Error(
            'ZZCTea cache bundle must resolve inside ' +
            'artifacts/catalog-source-import-bundles/zzctea/.',
        );
    }
    current = allowedRoot;
    for (const segment of path.relative(
        allowedRoot,
        outputDirectory,
    ).split(path.sep)) {
        current = path.join(current, segment);
        if (!fs.existsSync(current)) break;
        if (fs.lstatSync(current).isSymbolicLink()) {
            throw new Error(
                'ZZCTea cache bundle path cannot contain symlink ancestors.',
            );
        }
    }
    return canonicalOutput;
}

async function buildZzcTeaImportBundle(args, options = {}) {
    const repositoryRoot = path.resolve(options.repositoryRoot || REPO_ROOT);
    const sourceBundle = loadVerifiedCatalogSourceBundle(resolveDirectory(
        repositoryRoot,
        requireArg(args, 'artifact-dir'),
        'Source artifact directory',
    ));
    const projectionBundle = loadVerifiedProjectionBundle(resolveDirectory(
        repositoryRoot,
        requireArg(args, 'projection-dir'),
        'Projection directory',
    ));
    const mappingsBundle = loadVerifiedMappings(resolveDirectory(
        repositoryRoot,
        requireArg(args, 'reconciliation-dir'),
        'Reconciliation directory',
    ), sourceBundle);
    const mediaRoot = resolveDirectory(
        repositoryRoot,
        requireArg(args, 'media-dir'),
        'Media artifact directory',
    );
    const mediaManifest = readJson(path.join(mediaRoot, 'media-manifest.json'));
    const mediaReceipt = readJson(path.join(mediaRoot, mediaManifest.receiptFile));
    const mediaCheckpoint = readJson(path.join(mediaRoot, 'media-checkpoint.json'));
    const catalogReferenceFile = resolveFile(
        repositoryRoot,
        requireArg(args, 'catalog-ref'),
        'Catalog reference',
    );
    const catalogReferenceBuffer = fs.readFileSync(catalogReferenceFile);
    const catalogReference = JSON.parse(
        catalogReferenceBuffer.toString('utf8').replace(/^\uFEFF/, ''),
    );

    await materializeVerifiedMedia({
        artifactBundle: sourceBundle,
        fetchImpl: async () => {
            throw new Error('Completed media verification must not fetch.');
        },
        mappingsBundle,
        maxFileBytes: mediaCheckpoint.binding.maxFileBytes,
        maxTotalBytes: mediaCheckpoint.binding.maxTotalBytes,
        minimumRequestIntervalMs:
            mediaCheckpoint.binding.minimumRequestIntervalMs,
        onlyExternalId: mediaCheckpoint.binding.onlyExternalId,
        outputDirectory: mediaRoot,
    });

    const outputDirectory = assertOutputPath(
        repositoryRoot,
        args.out
            ? path.resolve(repositoryRoot, String(args.out))
            : path.join(repositoryRoot, 'import', 'zzctea', 'current'),
    );
    const context = {
        catalogReference,
        catalogReferenceSha256: sha256(catalogReferenceBuffer),
        mappingsBundle,
        mediaCheckpoint,
        mediaManifest,
        mediaReceipt,
        mediaRoot,
        projectionBundle,
        sourceBundle,
    };
    const cacheOutputDirectory = assertCacheOutputPath(
        repositoryRoot,
        args['cache-out']
            ? path.resolve(repositoryRoot, String(args['cache-out']))
            : path.join(
                repositoryRoot,
                'artifacts',
                'catalog-source-import-bundles',
                'zzctea',
                'current',
            ),
    );
    const cacheDocuments = withStagedOutput(
        cacheOutputDirectory,
        stagingDirectory => {
            const written = writeImportBundle(stagingDirectory, context);
            verifyImportBundle(stagingDirectory);
            return written;
        },
    );
    const cacheVerified = verifyImportBundle(cacheOutputDirectory);

    const documents = withStagedOutput(outputDirectory, stagingDirectory => {
        const written = writeAdminConsoleArtifact(stagingDirectory, context);
        verifyAdminConsoleArtifact(stagingDirectory);
        return written;
    });
    const verified = verifyAdminConsoleArtifact(outputDirectory);
    return {
        cacheDocuments,
        cacheOutputDirectory,
        cacheVerified,
        documents,
        outputDirectory,
        verified,
    };
}

async function main() {
    const result = await buildZzcTeaImportBundle(parseArgs());
    console.log(`Version: ${result.verified.manifest.version}`);
    console.log(`Products: ${result.verified.manifest.counts.products}`);
    console.log(`Media items: ${result.verified.manifest.counts.mediaItems}`);
    console.log(
        `Unique source blobs: ` +
        `${result.verified.manifest.counts.uniqueSourceMediaBlobs}`,
    );
    console.log(`Output: ${result.outputDirectory}`);
    console.log(`Verified cache: ${result.cacheOutputDirectory}`);
    console.log('Apply allowed: false');
    console.log('Production writes: none');
}

if (require.main === module) {
    main().catch(error => {
        console.error(`${error.code || error.name}: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    assertCacheOutputPath,
    assertOutputPath,
    buildZzcTeaImportBundle,
    resolveDirectory,
    resolveFile,
};
