#!/usr/bin/env node
'use strict';

const path = require('path');
const {
    REPO_ROOT,
    parseArgs,
    requireArg,
} = require('../thetea/lib/env');
const {
    safeSegment,
} = require('./lib/artifacts');
const {
    ingestSourceSnapshot,
} = require('./lib/runtime');
const {
    buildZzcTeaImportBundle,
} = require('./build-import-bundle');
const {
    createProductReferenceSeed,
    createWeeklyProductReferenceSeed,
} = require('./fetch-snapshot');
const {
    materializeMedia,
} = require('./materialize-media');
const {
    projectArtifact,
} = require('./project-artifact');
const {
    reconcileCatalogSource,
} = require('./reconcile-projection');
const {
    createZzcTeaConnector,
} = require('./zzctea/connector');

const ALLOWED_ARGUMENTS = new Set([
    '_',
    'catalog-ref',
    'concurrency',
    'max-file-bytes',
    'max-total-bytes',
    'maximum-drop-ratio',
    'maximum-growth-ratio',
    'minimum-request-interval-ms',
    'page-size',
    'product-ref',
    'resume',
    'snapshot',
    'timeout-ms',
]);

function numberArgument(args, name, fallback) {
    if (args[name] === undefined) return fallback;
    if (args[name] === true || String(args[name]).trim() === '') {
        throw new Error(`--${name}=... must contain a number.`);
    }
    const value = Number(args[name]);
    if (!Number.isFinite(value)) {
        throw new Error(`--${name}=... must contain a finite number.`);
    }
    return value;
}

function validateArguments(args) {
    const unknown = Object.keys(args)
        .filter(name => !ALLOWED_ARGUMENTS.has(name))
        .sort();
    if (unknown.length > 0) {
        throw new Error(
            `Unsupported argument(s): ${unknown.map(name => `--${name}`).join(', ')}.`,
        );
    }
    if (Array.isArray(args._) && args._.length > 0) {
        throw new Error('Positional arguments are not supported.');
    }
    if (args.resume !== undefined && args.resume !== true) {
        throw new Error('--resume does not accept a value.');
    }
    const snapshotId = safeSegment(
        requireArg(args, 'snapshot'),
        'Snapshot ID',
    );
    if (!snapshotId.startsWith('zzctea-')) {
        throw new Error('Snapshot ID must start with "zzctea-".');
    }
    return {
        catalogReference: requireArg(args, 'catalog-ref'),
        productReference: requireArg(args, 'product-ref'),
        snapshotId,
    };
}

async function fetchWeeklySnapshot(args, options = {}) {
    const repositoryRoot = path.resolve(options.repositoryRoot || REPO_ROOT);
    const { productReference, snapshotId } = validateArguments(args);
    const minimumRequestIntervalMs =
        args['minimum-request-interval-ms'] === undefined
            ? undefined
            : numberArgument(args, 'minimum-request-interval-ms');
    const connector = options.connector || createZzcTeaConnector({
        fetchImpl: options.fetchImpl,
        minimumRequestIntervalMs,
    });
    const baseSeed = createProductReferenceSeed({
        connector,
        inputPath: productReference,
        repositoryRoot,
    });
    const seed = await createWeeklyProductReferenceSeed({
        baseSeed,
        connector,
        repositoryRoot,
        replay: false,
        snapshotId,
    });
    return ingestSourceSnapshot({
        concurrency: numberArgument(args, 'concurrency', 4),
        connector,
        maximumDropRatio:
            numberArgument(args, 'maximum-drop-ratio', 0.25),
        maximumGrowthRatio:
            numberArgument(args, 'maximum-growth-ratio', 2),
        pageSize: numberArgument(
            args,
            'page-size',
            connector.defaultPageSize,
        ),
        repositoryRoot,
        resume: true,
        seed,
        snapshotId,
    });
}

function passOptionalArguments(source, target, names) {
    for (const name of names) {
        if (source[name] !== undefined) {
            target[name] = source[name];
        }
    }
    return target;
}

async function updateZzcTeaCurrent(args, options = {}) {
    const repositoryRoot = path.resolve(options.repositoryRoot || REPO_ROOT);
    const validated = validateArguments(args);
    const stages = {
        buildBundle:
            options.stages?.buildBundle || buildZzcTeaImportBundle,
        fetchSnapshot:
            options.stages?.fetchSnapshot || fetchWeeklySnapshot,
        materializeMedia:
            options.stages?.materializeMedia || materializeMedia,
        projectArtifact:
            options.stages?.projectArtifact || projectArtifact,
        reconcile:
            options.stages?.reconcile || reconcileCatalogSource,
    };

    // Every upstream stage writes immutable/resumable evidence. The canonical
    // current bundle is touched only by the final staged, verified swap.
    const fetched = await stages.fetchSnapshot(args, {
        repositoryRoot,
    });
    const artifactDirectory = path.dirname(fetched.artifactFile);
    const projected = await stages.projectArtifact({
        'artifact-dir': artifactDirectory,
    }, {
        repositoryRoot,
    });
    const reconciled = await stages.reconcile({
        'catalog-ref': validated.catalogReference,
        'product-ref': validated.productReference,
        'projection-dir': projected.outputDirectory,
    }, {
        repositoryRoot,
    });
    const mediaArgs = passOptionalArguments(args, {
        'artifact-dir': artifactDirectory,
        'reconciliation-dir': reconciled.outputDirectory,
    }, [
        'max-file-bytes',
        'max-total-bytes',
        'minimum-request-interval-ms',
        'timeout-ms',
    ]);
    const media = await stages.materializeMedia(mediaArgs, {
        repositoryRoot,
    });
    const bundle = await stages.buildBundle({
        'artifact-dir': artifactDirectory,
        'media-dir': media.outputDirectory,
        'projection-dir': projected.outputDirectory,
        'reconciliation-dir': reconciled.outputDirectory,
    }, {
        repositoryRoot,
    });

    return {
        artifactDirectory,
        bundle,
        fetched,
        media,
        projected,
        reconciled,
        snapshotId: validated.snapshotId,
    };
}

async function main() {
    const result = await updateZzcTeaCurrent(parseArgs());
    console.log(`Snapshot: ${result.snapshotId}`);
    console.log(`Items: ${result.fetched.manifest.itemCount}`);
    console.log(`Media output: ${result.media.outputDirectory}`);
    console.log(`Current bundle: ${result.bundle.outputDirectory}`);
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
    ALLOWED_ARGUMENTS,
    fetchWeeklySnapshot,
    numberArgument,
    passOptionalArguments,
    updateZzcTeaCurrent,
    validateArguments,
};
