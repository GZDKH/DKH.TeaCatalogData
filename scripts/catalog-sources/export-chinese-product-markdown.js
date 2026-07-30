#!/usr/bin/env node
'use strict';

const path = require('path');
const {
    REPO_ROOT,
    parseArgs,
    requireArg,
} = require('../thetea/lib/env');
const {
    writeChineseMarkdownPackage,
} = require('./lib/chinese-product-markdown');

const ALLOWED_ARGUMENTS = new Set([
    '_',
    'artifact',
    'out',
    'source-archive',
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
        sourceArchiveDirectory: args['source-archive'] === undefined
            ? null
            : path.resolve(
                REPO_ROOT,
                requireArg(args, 'source-archive'),
            ),
        outputDirectory: path.resolve(REPO_ROOT, requireArg(args, 'out')),
    };
}

function main() {
    const result = writeChineseMarkdownPackage(
        validateArguments(parseArgs()),
    );
    console.log(`Package: ${result.manifest.packageId}`);
    console.log(`Products: ${result.manifest.productCount}`);
    console.log('Markdown language: zh-CN source only');
    console.log(`Output: ${result.outputDirectory}`);
    if (result.sourceArchive) {
        console.log(
            `Source archive: ${result.sourceArchive.outputDirectory}` +
            `${result.sourceArchive.reused ? ' (reused)' : ''}`,
        );
    }
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
