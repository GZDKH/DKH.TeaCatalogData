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

function fixtureArgs() {
    return {
        _: [],
        'catalog-ref': 'sources/prod/catalog-reference/prod.json',
        concurrency: '3',
        'max-file-bytes': '1234',
        'minimum-request-interval-ms': '1000',
        'product-ref': 'sources/prod/product-reference/products',
        resume: true,
        snapshot: 'zzctea-2026-07-28-weekly-v1',
        'timeout-ms': '4321',
    };
}

function stageDoubles(root, calls, failAt = null) {
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
    const result = await updateZzcTeaCurrent(fixtureArgs(), {
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
    assert.strictEqual(calls[0].args['product-ref'], fixtureArgs()['product-ref']);
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
        'catalog-ref': fixtureArgs()['catalog-ref'],
        'product-ref': fixtureArgs()['product-ref'],
        'projection-dir': path.join(root, 'artifacts', 'projection'),
    });
    assert.strictEqual(
        calls[3].args['minimum-request-interval-ms'],
        '1000',
    );
    assert.strictEqual(calls[3].args['max-file-bytes'], '1234');
    assert.strictEqual(calls[3].args['timeout-ms'], '4321');
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
        const calls = [];
        await assert.rejects(
            () => updateZzcTeaCurrent(fixtureArgs(), {
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

async function main() {
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
    } finally {
        fs.rmSync(root, { force: true, recursive: true });
    }
    console.log('test-update-zzctea-current: OK');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
