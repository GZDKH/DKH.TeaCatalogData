#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPO_ROOT } = require('./lib/env');
const {
    assertGeneratorOutputPath,
    hashInputPath,
    hashSnapshotFiles,
} = require('./generate-import');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thetea-generate-safety-'));
try {
    assert.throws(
        () => assertGeneratorOutputPath(REPO_ROOT),
        /cannot replace the repository/);
    assert.throws(
        () => assertGeneratorOutputPath(path.join(REPO_ROOT, 'scripts', 'generated')),
        /must be a child of import\/thetea/);
    assert.strictEqual(
        assertGeneratorOutputPath(path.join(REPO_ROOT, 'import', 'thetea', 'safe')),
        path.join(REPO_ROOT, 'import', 'thetea', 'safe'));
    assert.strictEqual(
        assertGeneratorOutputPath(path.join(tempRoot, 'safe-output')),
        path.join(fs.realpathSync(tempRoot), 'safe-output'));

    const snapshot = path.join(tempRoot, 'snapshot');
    const raw = path.join(snapshot, 'raw');
    fs.mkdirSync(raw, { recursive: true });
    fs.writeFileSync(path.join(raw, 'card.json'), '{}');
    const manifest = { files: ['raw/card.json'] };
    assert.match(hashSnapshotFiles(snapshot, manifest), /^[a-f0-9]{64}$/);

    const outside = path.join(tempRoot, 'outside.json');
    fs.writeFileSync(outside, '{}');
    fs.symlinkSync(outside, path.join(raw, 'linked.json'));
    assert.throws(
        () => hashSnapshotFiles(snapshot, { files: ['raw/linked.json'] }),
        /symlink/);

    const referenceLink = path.join(tempRoot, 'reference-link.json');
    fs.symlinkSync(outside, referenceLink);
    assert.throws(() => hashInputPath(referenceLink), /symlink/);
} finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('test-generate-safety: OK');
