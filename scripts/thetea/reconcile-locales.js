#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REPO_ROOT, parseArgs, requireArg } = require('./lib/env');
const { localesFromMeta } = require('./lib/locales');
const { assertScopedPath, withStagedOutput } = require('./lib/generated-output');
const { DEFAULT_POLICY, resolveLocalePolicy } = require('./lib/locale-policy');

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function destinationLocales(value) {
    const source = value?.data || value || {};
    const rows = source.cultures || source.locales || source.items || source;
    return Array.isArray(rows) ? rows : [];
}

function main() {
    const args = parseArgs();
    const sourceMetaPath = args['source-meta'] ? path.resolve(REPO_ROOT, args['source-meta']) : null;
    const destinationPath = args['destination-registry'] ? path.resolve(REPO_ROOT, args['destination-registry']) : null;
    const sourceMeta = sourceMetaPath ? JSON.parse(fs.readFileSync(sourceMetaPath, 'utf8')) : null;
    const destination = destinationPath ? destinationLocales(JSON.parse(fs.readFileSync(destinationPath, 'utf8'))) : [];
    const sourceLocales = sourceMeta ? localesFromMeta(sourceMeta) : DEFAULT_POLICY.rows.map(row => row.sourceBcp47);
    const policy = resolveLocalePolicy({ sourceLocales, destinationRegistry: destination });
    const report = {
        ...policy,
        mode: 'read-only-locale-policy-reconciliation',
        applyAllowed: false,
        inputs: {
            sourceMetaPath,
            sourceMetaSha256: sourceMetaPath ? sha256File(sourceMetaPath) : null,
            destinationRegistryPath: destinationPath,
            destinationRegistrySha256: destinationPath ? sha256File(destinationPath) : null,
        },
        invariants: [
            'A source language is not a destination culture; target locales are selected from the destination registry.',
            'Inherited-language content is never reported as native translation.',
            'Existing regional/manual values take precedence over inherited values in the later three-way merge.',
            'Unknown, unavailable or script-ambiguous mappings remain review-required.',
            'Locale mapping does not choose product origin, price, tax, timezone, unit or offer availability.',
        ],
    };
    const output = assertScopedPath(
        path.join(REPO_ROOT, 'reports', 'thetea', String(args.report || 'locale-policy-reconciliation')),
        { repoRoot: REPO_ROOT, allowedRoot: path.join(REPO_ROOT, 'reports', 'thetea'), allowedDescription: 'reports/thetea/', label: 'TheTea locale reconciliation report' });
    withStagedOutput(output, staging => {
        fs.writeFileSync(path.join(staging, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'locale-map.json'), `${JSON.stringify(report.resolutions, null, 2)}\n`);
    });
    console.log(`Source locales: ${report.sourceLocales.length}`);
    console.log(`Target locales: ${report.targetLocales.length}`);
    console.log(`Review required: ${report.reviewRequired.length}`);
    console.log(`Report: ${output}`);
    return report;
}

if (require.main === module) {
    try { main(); } catch (error) {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { destinationLocales };
