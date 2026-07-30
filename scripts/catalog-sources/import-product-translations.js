#!/usr/bin/env node
'use strict';

const path = require('path');
const {
    REPO_ROOT,
    csv,
    parseArgs,
    requireArg,
} = require('../thetea/lib/env');
const {
    importTranslationPackages,
} = require('./lib/product-translation-markdown');

const ALLOWED_ARGUMENTS = new Set([
    '_',
    'artifact',
    'out',
    'translations',
]);

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
    const packages = csv(requireArg(args, 'translations'));
    if (packages.length === 0) {
        throw new Error('--translations must contain at least one directory.');
    }
    return {
        outputDirectory: path.resolve(REPO_ROOT, requireArg(args, 'out')),
        packageDirectories: packages.map(directory =>
            path.resolve(REPO_ROOT, directory)),
        sourceDirectory: path.resolve(REPO_ROOT, requireArg(args, 'artifact')),
    };
}

function main() {
    const result = importTranslationPackages(validateArguments(parseArgs()));
    console.log(`Version: ${result.manifest.version}`);
    console.log(`Products: ${result.manifest.counts.products}`);
    console.log(
        `Locales: ${result.manifest.requiredLocales.join(', ')}`,
    );
    console.log(`Output: ${result.outputDirectory}`);
    console.log('Apply allowed: false');
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
    validateArguments,
};
