#!/usr/bin/env node
const path = require('path');
const { parseArgs, requireArg } = require('./lib/env');
const {
    buildPhotoMapping,
    materializePhotoMedia,
    reportForDisk,
} = require('./lib/photo-media');

function main() {
    const args = parseArgs();
    const artifactDir = path.resolve(requireArg(args, 'artifact-dir'));
    const photoRoot = path.resolve(requireArg(args, 'photo-root'));
    const outputDir = args.out ? path.resolve(String(args.out)) : null;
    const mapping = buildPhotoMapping({ artifactDir, photoRoot });
    const report = outputDir
        ? materializePhotoMedia(mapping, { outputDir, artifactDir, photoRoot })
        : reportForDisk(mapping, { artifactDir, photoRoot });
    process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { main };
