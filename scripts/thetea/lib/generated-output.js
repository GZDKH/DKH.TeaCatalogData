const fs = require('fs');
const path = require('path');

const STAGING_SUFFIX = '.staging-';
const BACKUP_SUFFIX = '.backup-';

function assertSafeDestination(destination) {
    if (typeof destination !== 'string' || destination.trim() === '') {
        throw new TypeError('Generated output destination must be a non-empty path.');
    }

    const rawDestination = destination.trim();
    const finalSegment = rawDestination.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    if (finalSegment === '.' || finalSegment === '..') {
        throw new Error('Generated output destination cannot end with "." or "..".');
    }

    const resolvedDestination = path.resolve(rawDestination);
    if (resolvedDestination === path.parse(resolvedDestination).root) {
        throw new Error('Generated output destination cannot be a filesystem root.');
    }

    return resolvedDestination;
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

function pathIsWithin(root, target) {
    const relative = path.relative(root, target);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function assertScopedPath(target, options) {
    const resolvedTarget = path.resolve(target);
    const canonicalRepo = fs.realpathSync(options.repoRoot);
    const canonicalTarget = canonicalFuturePath(resolvedTarget);
    if (canonicalTarget === canonicalRepo || pathIsWithin(canonicalTarget, canonicalRepo)) {
        throw new Error(`${options.label || 'Managed output'} cannot replace the repository or one of its parent directories.`);
    }
    if (pathIsWithin(canonicalRepo, canonicalTarget)) {
        const allowedRoot = canonicalFuturePath(options.allowedRoot);
        if (!pathIsWithin(allowedRoot, canonicalTarget)) {
            throw new Error(
                `${options.label || 'Managed output'} inside the repository must be a child of ${options.allowedDescription || options.allowedRoot}.`);
        }
    }
    return canonicalTarget;
}

function lstatIfExists(target) {
    try {
        return fs.lstatSync(target);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

function inspectDestination(destination) {
    const stat = lstatIfExists(destination);
    if (!stat) return null;
    if (stat.isSymbolicLink()) {
        throw new Error(`Generated output destination cannot be a symbolic link: ${destination}`);
    }
    if (!stat.isDirectory()) {
        throw new Error(`Generated output destination must be a directory: ${destination}`);
    }
    return stat;
}

function assertDestinationUnchanged(initialStat, currentStat, destination) {
    if (!initialStat && !currentStat) return;
    if (!initialStat || !currentStat
        || initialStat.dev !== currentStat.dev
        || initialStat.ino !== currentStat.ino) {
        throw new Error(`Generated output destination changed while staging: ${destination}`);
    }
}

function assertStagingDirectory(stagingDirectory) {
    const stat = lstatIfExists(stagingDirectory);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error('Generated output builder must leave the staging directory intact.');
    }
}

function removeOwnedPath(target) {
    const stat = lstatIfExists(target);
    if (!stat) return;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        fs.unlinkSync(target);
        return;
    }
    fs.rmSync(target, { recursive: true, force: true });
}

function cleanupOrThrow(paths, primaryError) {
    const cleanupErrors = [];
    for (const target of paths) {
        if (!target) continue;
        try {
            removeOwnedPath(target);
        } catch (error) {
            cleanupErrors.push(error);
        }
    }

    if (cleanupErrors.length === 0) return;
    if (primaryError) {
        throw new AggregateError(
            [primaryError, ...cleanupErrors],
            'Generated output failed and temporary output cleanup also failed.');
    }
    throw new AggregateError(cleanupErrors, 'Generated output temporary cleanup failed.');
}

function withStagedOutput(destination, buildFn) {
    if (typeof buildFn !== 'function') {
        throw new TypeError('Generated output builder must be a function.');
    }

    const resolvedDestination = assertSafeDestination(destination);
    const parentDirectory = path.dirname(resolvedDestination);
    const destinationName = path.basename(resolvedDestination);
    fs.mkdirSync(parentDirectory, { recursive: true });

    const initialDestinationStat = inspectDestination(resolvedDestination);
    let stagingDirectory = fs.mkdtempSync(
        path.join(parentDirectory, `.${destinationName}${STAGING_SUFFIX}`));
    let backupDirectory = null;
    let preserveBackup = false;
    let primaryError = null;

    try {
        const result = buildFn(stagingDirectory);
        if (result && typeof result.then === 'function') {
            throw new TypeError('Generated output builder must be synchronous.');
        }

        assertStagingDirectory(stagingDirectory);
        const currentDestinationStat = inspectDestination(resolvedDestination);
        assertDestinationUnchanged(
            initialDestinationStat,
            currentDestinationStat,
            resolvedDestination);

        if (currentDestinationStat) {
            backupDirectory = fs.mkdtempSync(
                path.join(parentDirectory, `.${destinationName}${BACKUP_SUFFIX}`));
            const previousDestination = path.join(backupDirectory, 'previous');
            fs.renameSync(resolvedDestination, previousDestination);

            try {
                fs.renameSync(stagingDirectory, resolvedDestination);
                stagingDirectory = null;
            } catch (swapError) {
                try {
                    fs.renameSync(previousDestination, resolvedDestination);
                } catch (restoreError) {
                    preserveBackup = true;
                    const error = new AggregateError(
                        [swapError, restoreError],
                        `Generated output swap failed and the previous output could not be restored. Backup retained at ${backupDirectory}.`);
                    error.backupDirectory = backupDirectory;
                    throw error;
                }
                throw swapError;
            }
        } else {
            fs.renameSync(stagingDirectory, resolvedDestination);
            stagingDirectory = null;
        }

        return result;
    } catch (error) {
        primaryError = error;
        throw error;
    } finally {
        const cleanupPaths = [stagingDirectory];
        if (!preserveBackup) cleanupPaths.push(backupDirectory);
        cleanupOrThrow(cleanupPaths, primaryError);
    }
}

module.exports = {
    BACKUP_SUFFIX,
    STAGING_SUFFIX,
    assertScopedPath,
    assertSafeDestination,
    withStagedOutput,
};
