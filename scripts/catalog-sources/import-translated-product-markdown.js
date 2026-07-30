#!/usr/bin/env node
'use strict';

const path = require('path');
const {
    REPO_ROOT,
    parseArgs,
    requireArg,
} = require('../thetea/lib/env');
const {
    importTranslatedChineseMarkdown,
} = require('./lib/chinese-product-markdown');

const ALLOWED_ARGUMENTS = new Set([
    '_',
    'artifact',
    'locale',
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
    return {
        sourceDirectory: path.resolve(
            REPO_ROOT,
            requireArg(args, 'artifact'),
        ),
        packageDirectory: path.resolve(
            REPO_ROOT,
            requireArg(args, 'translations'),
        ),
        targetLocale: requireArg(args, 'locale'),
        outputDirectory: path.resolve(REPO_ROOT, requireArg(args, 'out')),
    };
}

function main() {
    const result = importTranslatedChineseMarkdown(
        validateArguments(parseArgs()),
    );
    console.log(`Version: ${result.manifest.version}`);
    console.log(`Products: ${result.manifest.counts.products}`);
    console.log(`Imported locale: ${result.targetLocale}`);
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
