#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    updateZzcTeaCurrent,
    validateArguments,
} = require('./update-zzctea-current');

function fixtureArgs(root = '/canonical/tea-catalog-data') {
    return {
        _: [],
        'catalog-ref': 'sources/prod/catalog-reference/prod.json',
        concurrency: '3',
        'max-file-bytes': '1234',
        'minimum-request-interval-ms': '1000',
        'previous-media-dir': path.join(
            root,
            'import',
            'zzctea',
            'current',
            'media',
        ),
        'product-ref': 'sources/prod/product-reference/products',
        resume: true,
        snapshot: 'zzctea-2026-07-28-weekly-v1',
        'timeout-ms': '4321',
    };
}

function stageDoubles(
    root,
    calls,
    failAt = null,
    mediaProductionWrites = false,
) {
    function stage(name, result) {
        return async (args, options) => {
            calls.push({ args, name, options });
            if (name === failAt) {
                throw new Error(`${name} failed`);
            }
            return result;
        };
    }
    return {
        buildBundle: stage('buildBundle', {
            outputDirectory: path.join(root, 'import', 'zzctea', 'current'),
        }),
        fetchSnapshot: stage('fetchSnapshot', {
            artifactFile: path.join(
                root,
                'artifacts',
                'catalog-sources',
                'zzctea',
                'zzctea-2026-07-28-weekly-v1',
                'artifact.json',
            ),
            manifest: { itemCount: 3151 },
        }),
        materializeMedia: stage('materializeMedia', {
            manifest: {
                productionWrites: mediaProductionWrites,
            },
            outputDirectory: path.join(root, 'artifacts', 'media'),
        }),
        projectArtifact: stage('projectArtifact', {
            outputDirectory: path.join(root, 'artifacts', 'projection'),
        }),
        reconcile: stage('reconcile', {
            outputDirectory: path.join(root, 'artifacts', 'reconciliation'),
        }),
    };
}

function writeSentinel(root) {
    const current = path.join(root, 'import', 'zzctea', 'current');
    fs.mkdirSync(current, { recursive: true });
    const sentinel = path.join(current, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'previous-current\n');
    return sentinel;
}

async function testHappyPath(root) {
    const calls = [];
    const args = fixtureArgs(root);
    writeSentinel(root);
    fs.mkdirSync(args['previous-media-dir']);
    const result = await updateZzcTeaCurrent(args, {
        repositoryRoot: root,
        stages: stageDoubles(root, calls),
    });
    assert.strictEqual(result.snapshotId, 'zzctea-2026-07-28-weekly-v1');
    assert.deepStrictEqual(calls.map(call => call.name), [
        'fetchSnapshot',
        'projectArtifact',
        'reconcile',
        'materializeMedia',
        'buildBundle',
    ]);
    assert.strictEqual(calls[0].args['product-ref'], args['product-ref']);
    assert.strictEqual(calls[0].args.resume, true);
    assert.deepStrictEqual(calls[1].args, {
        'artifact-dir': path.join(
            root,
            'artifacts',
            'catalog-sources',
            'zzctea',
            'zzctea-2026-07-28-weekly-v1',
        ),
    });
    assert.deepStrictEqual(calls[2].args, {
        'catalog-ref': args['catalog-ref'],
        'product-ref': args['product-ref'],
        'projection-dir': path.join(root, 'artifacts', 'projection'),
    });
    assert.strictEqual(
        calls[3].args['minimum-request-interval-ms'],
        '1000',
    );
    assert.strictEqual(calls[3].args['max-file-bytes'], '1234');
    assert.strictEqual(calls[3].args['timeout-ms'], '4321');
    assert.strictEqual(
        calls[3].options.previousMediaDirectory,
        args['previous-media-dir'],
    );
    assert.strictEqual(
        calls[3].args['previous-media-dir'],
        undefined,
        'The weekly CLI argument must become an explicit verified stage option.',
    );
    assert.strictEqual(calls[4].args.out, undefined);
    assert.strictEqual(
        calls[4].args['media-dir'],
        path.join(root, 'artifacts', 'media'),
    );
}

async function testFailClosed(root) {
    for (const failAt of [
        'fetchSnapshot',
        'projectArtifact',
        'reconcile',
        'materializeMedia',
        'buildBundle',
    ]) {
        const sentinel = writeSentinel(root);
        const args = fixtureArgs(root);
        fs.mkdirSync(args['previous-media-dir'], { recursive: true });
        const calls = [];
        await assert.rejects(
            () => updateZzcTeaCurrent(args, {
                repositoryRoot: root,
                stages: stageDoubles(root, calls, failAt),
            }),
            new RegExp(`${failAt} failed`),
        );
        assert.strictEqual(
            fs.readFileSync(sentinel, 'utf8'),
            'previous-current\n',
        );
        if (failAt !== 'buildBundle') {
            assert.ok(
                !calls.some(call => call.name === 'buildBundle'),
                `${failAt} failure must not start the current-bundle swap`,
            );
        }
    }
}

async function testProductionWriteProof(root) {
    const args = fixtureArgs(root);
    fs.mkdirSync(args['previous-media-dir'], { recursive: true });
    const calls = [];
    await assert.rejects(
        () => updateZzcTeaCurrent(args, {
            repositoryRoot: root,
            stages: stageDoubles(root, calls, null, true),
        }),
        /must prove productionWrites=false/,
    );
    assert.ok(
        !calls.some(call => call.name === 'buildBundle'),
        'Unproven media write safety must block the current-bundle swap.',
    );
}

async function main() {
    assert.throws(
        () => validateArguments({
            ...fixtureArgs(),
            'previous-media-dir': undefined,
        }),
        /--previous-media-dir=.*required/,
    );
    assert.throws(
        () => validateArguments({
            ...fixtureArgs(),
            'previous-media-dir': 'import/zzctea/current/media',
        }),
        /absolute, normalized path/,
    );
    assert.throws(
        () => validateArguments({
            ...fixtureArgs(),
            'previous-media-dir': '/canonical/tea-catalog-data/import/../media',
        }),
        /absolute, normalized path/,
    );
    assert.throws(
        () => validateArguments({
            ...fixtureArgs(),
            snapshot: undefined,
        }),
        /--snapshot=.*required/,
    );
    assert.throws(
        () => validateArguments({
            ...fixtureArgs(),
            snapshot: 'weekly-v1',
        }),
        /must start with "zzctea-"/,
    );
    assert.throws(
        () => validateArguments({
            ...fixtureArgs(),
            apply: true,
        }),
        /Unsupported argument.*--apply/,
    );
    assert.throws(
        () => validateArguments({
            ...fixtureArgs(),
            official: true,
        }),
        /Unsupported argument.*--official/,
    );
    assert.throws(
        () => validateArguments({
            ...fixtureArgs(),
            api: true,
        }),
        /Unsupported argument.*--api/,
    );

    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'zzctea-weekly-orchestrator-'),
    );
    try {
        await testHappyPath(root);
        await testFailClosed(root);
        await testProductionWriteProof(path.join(root, 'write-proof'));
        const symlinkRoot = path.join(root, 'symlink-gate');
        const outside = fs.mkdtempSync(
            path.join(os.tmpdir(), 'zzctea-prior-media-outside-'),
        );
        fs.mkdirSync(
            path.join(symlinkRoot, 'import', 'zzctea', 'current'),
            { recursive: true },
        );
        fs.symlinkSync(
            outside,
            path.join(
                symlinkRoot,
                'import',
                'zzctea',
                'current',
                'media',
            ),
        );
        await assert.rejects(
            () => updateZzcTeaCurrent(fixtureArgs(symlinkRoot), {
                repositoryRoot: symlinkRoot,
                stages: stageDoubles(symlinkRoot, []),
            }),
            /must be an existing real directory/,
        );
        fs.rmSync(outside, { force: true, recursive: true });
    } finally {
        fs.rmSync(root, { force: true, recursive: true });
    }
    console.log('test-update-zzctea-current: OK');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
