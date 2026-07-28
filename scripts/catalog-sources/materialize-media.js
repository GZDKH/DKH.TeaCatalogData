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
} = require('../thetea/lib/generated-output');
const {
    readJson,
    safeSegment,
    sha256,
} = require('./lib/artifacts');
const {
    DEFAULT_MAX_FILE_BYTES,
    DEFAULT_MAX_TOTAL_BYTES,
    DEFAULT_MINIMUM_REQUEST_INTERVAL_MS,
    materializeVerifiedMedia,
    validateMappingCoverage,
} = require('./lib/media-materialization');
const {
    loadVerifiedCatalogSourceBundle,
} = require('./lib/projection-bundle');

function parseInteger(args, name, fallback) {
    if (args[name] === undefined) return fallback;
    if (args[name] === true || !/^[1-9]\d*$/.test(String(args[name]))) {
        throw new Error(`--${name} must be a positive integer.`);
    }
    return Number(args[name]);
}

function resolveRealDirectory(repositoryRoot, value, label) {
    const directory = path.resolve(repositoryRoot, value);
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${label} must be a real directory.`);
    }
    return directory;
}

function loadVerifiedMappings(directory, artifactBundle) {
    const root = resolveRealDirectory('/', directory, 'Reconciliation directory');
    const manifestFile = path.join(root, 'reconciliation-manifest.json');
    const manifestStat = fs.lstatSync(manifestFile);
    if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
        throw new Error('Reconciliation manifest must be a real file.');
    }
    const manifest = readJson(manifestFile);
    if (manifest.schemaVersion !==
            'catalog-source-product-reconciliation-manifest-v1' ||
        manifest.complete !== true ||
        manifest.mode !== 'dry-run' ||
        manifest.sourceId !== artifactBundle.manifest.sourceId ||
        manifest.snapshotId !== artifactBundle.manifest.snapshotId ||
        manifest.selection?.mode !== 'full-snapshot' ||
        manifest.selectionComplete !== true ||
        manifest.counts?.ambiguous !== 0 ||
        manifest.counts?.matched + manifest.counts?.missing !==
            artifactBundle.manifest.itemCount ||
        manifest.productionWrites !== false ||
        !/^[a-f0-9]{64}$/.test(String(manifest.mappingSha256 || '')) ||
        manifest.mappingFile !==
            `source-product-mappings.${manifest.mappingSha256}.json`) {
        throw new Error('Reconciliation manifest is not an exact full-snapshot mapping.');
    }
    if (!/^[a-f0-9]{64}$/.test(String(manifest.reconciliationSha256 || '')) ||
        manifest.reconciliationFile !==
            `catalog-source-product-reconciliation-v1.${manifest.reconciliationSha256}.json`) {
        throw new Error('Reconciliation document is not content-addressed.');
    }
    const reconciliationFile = path.resolve(root, manifest.reconciliationFile);
    if (!reconciliationFile.startsWith(`${root}${path.sep}`)) {
        throw new Error('Reconciliation document escapes its bundle.');
    }
    const reconciliationStat = fs.lstatSync(reconciliationFile);
    if (reconciliationStat.isSymbolicLink() || !reconciliationStat.isFile()) {
        throw new Error('Reconciliation document must be a real file.');
    }
    const reconciliationBuffer = fs.readFileSync(reconciliationFile);
    if (sha256(reconciliationBuffer) !== manifest.reconciliationSha256) {
        throw new Error('Reconciliation document hash differs from its manifest.');
    }
    const reconciliation = JSON.parse(
        reconciliationBuffer.toString('utf8').replace(/^\uFEFF/, ''),
    );
    if (reconciliation.source?.id !== artifactBundle.manifest.sourceId ||
        reconciliation.snapshot?.id !== artifactBundle.manifest.snapshotId ||
        reconciliation.inputEvidence?.sourceArtifactSha256 !==
            artifactBundle.manifest.artifactSha256 ||
        reconciliation.mappingFile !== manifest.mappingFile ||
        reconciliation.mappingSha256 !== manifest.mappingSha256 ||
        reconciliation.productionWrites !== false) {
        throw new Error(
            'Reconciliation document is not bound to the verified source artifact.',
        );
    }
    const mappingFile = path.resolve(root, manifest.mappingFile);
    if (!mappingFile.startsWith(`${root}${path.sep}`)) {
        throw new Error('Reconciliation mapping file escapes its bundle.');
    }
    const stat = fs.lstatSync(mappingFile);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error('Reconciliation mapping must be a real file.');
    }
    const mappingBuffer = fs.readFileSync(mappingFile);
    if (sha256(mappingBuffer) !== manifest.mappingSha256) {
        throw new Error('Reconciliation mapping hash differs from its manifest.');
    }
    const mappings = JSON.parse(mappingBuffer.toString('utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(mappings) ||
        mappings.length !== manifest.counts.matched + manifest.counts.missing) {
        throw new Error('Reconciliation mapping count is incomplete.');
    }
    validateMappingCoverage(artifactBundle.artifact, mappings, manifest.counts);
    return { manifest, mappings, root };
}

function assertMediaOutputPath(repositoryRoot, allowedOutputRoot, outputDirectory) {
    fs.mkdirSync(allowedOutputRoot, { recursive: true });
    const relativeOutput = path.relative(allowedOutputRoot, outputDirectory);
    if (!relativeOutput ||
        relativeOutput === '..' ||
        relativeOutput.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeOutput)) {
        throw new Error(
            'Media output must be a child of artifacts/catalog-source-media/.',
        );
    }
    let current = allowedOutputRoot;
    for (const segment of relativeOutput.split(path.sep)) {
        current = path.join(current, segment);
        if (!fs.existsSync(current)) break;
        if (fs.lstatSync(current).isSymbolicLink()) {
            throw new Error('Media output cannot contain symlink ancestors.');
        }
    }
    const canonicalOutput = assertScopedPath(outputDirectory, {
        repoRoot: repositoryRoot,
        allowedRoot: allowedOutputRoot,
        allowedDescription: 'artifacts/catalog-source-media/',
        label: 'Catalog-source media output',
    });
    const canonicalAllowedRoot = fs.realpathSync(allowedOutputRoot);
    const canonicalRelative = path.relative(canonicalAllowedRoot, canonicalOutput);
    if (!canonicalRelative ||
        canonicalRelative === '..' ||
        canonicalRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(canonicalRelative)) {
        throw new Error(
            'Media output must resolve inside artifacts/catalog-source-media/ ' +
            'without symlink ancestors.',
        );
    }
    return canonicalOutput;
}

async function materializeMedia(args, options = {}) {
    const repositoryRoot = path.resolve(options.repositoryRoot || REPO_ROOT);
    const artifactDirectory = path.resolve(
        repositoryRoot,
        requireArg(args, 'artifact-dir'),
    );
    const reconciliationDirectory = path.resolve(
        repositoryRoot,
        requireArg(args, 'reconciliation-dir'),
    );
    const artifactBundle = loadVerifiedCatalogSourceBundle(artifactDirectory);
    const mappingsBundle = loadVerifiedMappings(
        reconciliationDirectory,
        artifactBundle,
    );
    const sourceId = safeSegment(artifactBundle.manifest.sourceId, 'source ID');
    const snapshotId = safeSegment(artifactBundle.manifest.snapshotId, 'snapshot ID');
    const onlyExternalId = args.only === undefined ? null : String(args.only);
    const selection = onlyExternalId
        ? `only-${safeSegment(onlyExternalId, 'external ID')}`
        : 'full';
    const allowedOutputRoot = path.join(
        repositoryRoot,
        'artifacts',
        'catalog-source-media',
    );
    const outputDirectory = args.out
        ? path.resolve(repositoryRoot, String(args.out))
        : path.join(
            allowedOutputRoot,
            sourceId,
            snapshotId,
            artifactBundle.manifest.artifactSha256,
            mappingsBundle.manifest.mappingSha256,
            selection,
        );
    const canonicalOutput = assertMediaOutputPath(
        repositoryRoot,
        allowedOutputRoot,
        outputDirectory,
    );
    const explicitPreviousMediaDirectory = Object.hasOwn(
        options,
        'previousMediaDirectory',
    )
        ? options.previousMediaDirectory
        : args['previous-media-dir'];
    if (explicitPreviousMediaDirectory !== undefined &&
        explicitPreviousMediaDirectory !== null &&
        (!path.isAbsolute(String(explicitPreviousMediaDirectory)) ||
            path.normalize(String(explicitPreviousMediaDirectory)) !==
                String(explicitPreviousMediaDirectory))) {
        throw new Error(
            'Explicit previous media directory must be an absolute, normalized path.',
        );
    }
    const previousMediaDirectory = explicitPreviousMediaDirectory === null
        ? null
        : explicitPreviousMediaDirectory === undefined
            ? path.join(repositoryRoot, 'import', 'zzctea', 'current', 'media')
            : String(explicitPreviousMediaDirectory);
    return materializeVerifiedMedia({
        artifactBundle,
        fetchImpl: options.fetchImpl,
        mappingsBundle,
        maxFileBytes: parseInteger(
            args,
            'max-file-bytes',
            DEFAULT_MAX_FILE_BYTES,
        ),
        maxTotalBytes: parseInteger(
            args,
            'max-total-bytes',
            DEFAULT_MAX_TOTAL_BYTES,
        ),
        minimumRequestIntervalMs: parseInteger(
            args,
            'minimum-request-interval-ms',
            DEFAULT_MINIMUM_REQUEST_INTERVAL_MS,
        ),
        onlyExternalId,
        outputDirectory: canonicalOutput,
        previousMediaDirectory,
        timeoutMs: parseInteger(args, 'timeout-ms', 30_000),
    });
}

async function main() {
    const result = await materializeMedia(parseArgs());
    console.log(`Source: ${result.manifest.sourceId}`);
    console.log(`Snapshot: ${result.manifest.snapshotId}`);
    console.log(`Original image references: ${result.manifest.originalImageCount}`);
    console.log(`Media items: ${result.manifest.mediaItemCount}`);
    console.log(`Unique blobs: ${result.manifest.uniqueBlobCount}`);
    console.log(`Total bytes: ${result.manifest.totalBytes}`);
    console.log(`Output: ${result.outputDirectory}`);
    console.log('Production writes: none');
}

if (require.main === module) {
    main().catch(error => {
        console.error(`${error.code || error.name}: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    assertMediaOutputPath,
    loadVerifiedMappings,
    materializeMedia,
    parseInteger,
};
