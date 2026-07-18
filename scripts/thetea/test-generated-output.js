#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    BACKUP_SUFFIX,
    STAGING_SUFFIX,
    withStagedOutput,
} = require('./lib/generated-output');

function writeFile(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
}

function assertNoTemporarySiblings(destination) {
    const parent = path.dirname(destination);
    const name = path.basename(destination);
    const temporaryPrefixes = [
        `.${name}${STAGING_SUFFIX}`,
        `.${name}${BACKUP_SUFFIX}`,
    ];
    const leftovers = fs.readdirSync(parent)
        .filter(entry => temporaryPrefixes.some(prefix => entry.startsWith(prefix)));
    assert.deepStrictEqual(leftovers, []);
}

function inTemporaryDirectory(test) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thetea-generated-output-'));
    try {
        test(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

inTemporaryDirectory(root => {
    const destination = path.join(root, 'generated');
    writeFile(path.join(destination, 'stale.json'), 'stale');
    writeFile(path.join(destination, 'nested', 'also-stale.json'), 'stale');

    const result = withStagedOutput(destination, stagingDirectory => {
        writeFile(path.join(stagingDirectory, 'fresh.json'), 'fresh');
        return { productCount: 1 };
    });

    assert.deepStrictEqual(result, { productCount: 1 });
    assert.strictEqual(fs.readFileSync(path.join(destination, 'fresh.json'), 'utf8'), 'fresh');
    assert.strictEqual(fs.existsSync(path.join(destination, 'stale.json')), false);
    assert.strictEqual(fs.existsSync(path.join(destination, 'nested')), false);
    assertNoTemporarySiblings(destination);
});

inTemporaryDirectory(root => {
    const destination = path.join(root, 'generated');
    writeFile(path.join(destination, 'original.json'), 'original');

    assert.throws(() => withStagedOutput(destination, stagingDirectory => {
        writeFile(path.join(stagingDirectory, 'partial.json'), 'partial');
        throw new Error('injected build failure');
    }), /injected build failure/);

    assert.strictEqual(fs.readFileSync(path.join(destination, 'original.json'), 'utf8'), 'original');
    assert.strictEqual(fs.existsSync(path.join(destination, 'partial.json')), false);
    assertNoTemporarySiblings(destination);
});

inTemporaryDirectory(root => {
    const destination = path.join(root, 'generated');
    writeFile(path.join(destination, 'original.json'), 'original');
    const originalRenameSync = fs.renameSync;
    let renameCount = 0;

    fs.renameSync = function injectedRenameFailure(from, to) {
        renameCount += 1;
        if (renameCount === 2) {
            const error = new Error('injected swap failure');
            error.code = 'EIO';
            throw error;
        }
        return originalRenameSync.call(fs, from, to);
    };

    try {
        assert.throws(() => withStagedOutput(destination, stagingDirectory => {
            writeFile(path.join(stagingDirectory, 'fresh.json'), 'fresh');
        }), /injected swap failure/);
    } finally {
        fs.renameSync = originalRenameSync;
    }

    assert.strictEqual(renameCount, 3);
    assert.strictEqual(fs.readFileSync(path.join(destination, 'original.json'), 'utf8'), 'original');
    assert.strictEqual(fs.existsSync(path.join(destination, 'fresh.json')), false);
    assertNoTemporarySiblings(destination);
});

{
    let builderCalled = false;
    const builder = () => {
        builderCalled = true;
    };
    assert.throws(() => withStagedOutput('', builder), /non-empty path/);
    assert.throws(() => withStagedOutput('   ', builder), /non-empty path/);
    assert.throws(
        () => withStagedOutput(path.parse(process.cwd()).root, builder),
        /filesystem root/);
    assert.throws(() => withStagedOutput('.', builder), /cannot end with/);
    assert.strictEqual(builderCalled, false);
}

inTemporaryDirectory(root => {
    const destination = path.join(root, 'generated');
    const symlinkTarget = path.join(root, 'real-output');
    writeFile(path.join(symlinkTarget, 'sentinel.json'), 'sentinel');
    fs.symlinkSync(symlinkTarget, destination, 'dir');

    let builderCalled = false;
    assert.throws(() => withStagedOutput(destination, () => {
        builderCalled = true;
    }), /symbolic link/);

    assert.strictEqual(builderCalled, false);
    assert.strictEqual(fs.readFileSync(path.join(symlinkTarget, 'sentinel.json'), 'utf8'), 'sentinel');
    assert.strictEqual(fs.lstatSync(destination).isSymbolicLink(), true);
    assertNoTemporarySiblings(destination);
});

console.log('test-generated-output: OK');
