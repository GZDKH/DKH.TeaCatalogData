#!/usr/bin/env node
'use strict';

const { REPO_ROOT, parseArgs, requireArg } = require('../thetea/lib/env');
const {
    ingestSourceSnapshot,
    replaySourceSnapshot,
} = require('./lib/runtime');
const { createZzcTeaConnector } = require('./zzctea/connector');

const CONNECTORS = Object.freeze({
    zzctea: createZzcTeaConnector,
});

async function main() {
    const args = parseArgs();
    const source = requireArg(args, 'source');
    const snapshotId = requireArg(args, 'snapshot');
    const connectorFactory = CONNECTORS[source];
    if (!connectorFactory) {
        throw new Error(`Unsupported source '${source}'. Available: ${Object.keys(CONNECTORS).join(', ')}`);
    }
    const connector = connectorFactory();
    const common = {
        connector,
        repositoryRoot: REPO_ROOT,
        snapshotId,
    };
    const result = args.replay === true
        ? await replaySourceSnapshot(common)
        : await ingestSourceSnapshot({
            ...common,
            concurrency: Number(args.concurrency || 4),
            maximumDropRatio: Number(args['maximum-drop-ratio'] || 0.25),
            maximumGrowthRatio: Number(args['maximum-growth-ratio'] || 2),
            pageSize: Number(args['page-size'] || connector.defaultPageSize),
            resume: args.resume === true,
        });

    console.log(`Source: ${source}`);
    console.log(`Snapshot: ${snapshotId}`);
    console.log(`Items: ${result.manifest.itemCount}`);
    console.log(`Raw payload digest: ${result.manifest.rawPayloadDigest}`);
    console.log(`Semantic digest: ${result.manifest.semanticDigest}`);
    console.log(`Artifact: ${result.artifactFile}`);
    console.log('Production writes: none');
}

main().catch(error => {
    console.error(`${error.code || error.name}: ${error.message}`);
    process.exitCode = 1;
});
