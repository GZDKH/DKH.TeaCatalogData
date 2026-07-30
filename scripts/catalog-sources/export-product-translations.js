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
    writeTranslationPackage,
} = require('./lib/product-translation-markdown');

const ALLOWED_ARGUMENTS = new Set([
    '_',
    'artifact',
    'locales',
    'out',
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
    return {
        outputDirectory: path.resolve(REPO_ROOT, requireArg(args, 'out')),
        sourceDirectory: path.resolve(REPO_ROOT, requireArg(args, 'artifact')),
        targetLocales: csv(requireArg(args, 'locales')),
    };
}

function main() {
    const result = writeTranslationPackage(validateArguments(parseArgs()));
    console.log(`Package: ${result.manifest.packageId}`);
    console.log(`Products: ${result.manifest.productCount}`);
    console.log(`Locales: ${result.manifest.targetLocales.join(', ')}`);
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
    validateArguments,
};
