#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    sha256,
    stableJson,
    writeJsonAtomic,
} = require('./lib/artifacts');
const {
    DATA_IMPORT_BATCH_MAX_BYTES,
    verifyAdminConsoleArtifact,
    writeAdminConsoleArtifact,
} = require('./lib/admin-console-artifact');
const {
    createContext,
} = require('./test-import-bundle');

function fixture() {
    const context = createContext();
    const productPatchesFile = path.join(
        context.mappingsBundle.root,
        context.mappingsBundle.manifest.productPatchesFile,
    );
    const productPatches = JSON.parse(fs.readFileSync(
        productPatchesFile,
        'utf8',
    )).map(product => ({
        ...product,
        translations: [{
            lang: 'zh-CN',
            name: `茶 ${product.code}`,
            description: '来源资料',
        }],
    }));
    fs.writeFileSync(productPatchesFile, stableJson(productPatches));
    context.mappingsBundle.manifest.productPatchesSha256 =
        sha256(fs.readFileSync(productPatchesFile));
    const catalogReference = {
        catalogs: [{
            code: 'CATALOG-PUERH',
            currency: 'CNY',
            order: 0,
            published: true,
            translations: [{
                lang: 'zh-CN',
                name: '普洱茶',
                description: '',
                seo: 'puerh',
            }],
            categories: [],
        }],
        categories: [],
        specificationGroups: [],
        specificationAttributes: [],
        specificationAttributeOptions: [],
    };
    const catalogReferenceSha256 = sha256(stableJson(catalogReference));
    context.catalogReference = catalogReference;
    context.catalogReferenceSha256 = catalogReferenceSha256;
    context.mappingsBundle.manifest.inputCatalogReferenceSha256 =
        catalogReferenceSha256;
    context.sourceBundle.manifest.observedAt = '2026-07-29T00:00:00.000Z';
    return context;
}

function temporaryDirectory() {
    return fs.mkdtempSync(path.join(
        os.tmpdir(),
        'zzctea-admin-console-artifact-',
    ));
}

function refreshFileEntry(root, relativePath) {
    const manifestFile = path.join(root, 'artifact-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const file = path.join(root, ...relativePath.split('/'));
    const content = fs.readFileSync(file);
    const entry = manifest.files.find(item => item.path === relativePath);
    entry.bytes = content.length;
    entry.sha256 = sha256(content);
    writeJsonAtomic(manifestFile, manifest);
}

function testConsoleLayout() {
    const output = temporaryDirectory();
    const documents = writeAdminConsoleArtifact(output, fixture());
    const verified = verifyAdminConsoleArtifact(output);
    assert.strictEqual(documents.manifest.counts.products, 2);
    assert.strictEqual(verified.manifest.counts.mediaItems, 1);
    assert.strictEqual(verified.manifest.safety.applyAllowed, false);
    assert.strictEqual(verified.manifest.safety.productionWrites, false);
    assert.strictEqual(verified.manifest.safety.canaryRequired, true);
    assert.ok(fs.existsSync(path.join(
        output,
        '04-products',
        'CAT-PUER-UNCLASSIFIED',
        'ZZC-1.json',
    )));
    assert.ok(fs.existsSync(path.join(
        output,
        '04-products',
        'CAT-PUER-UNCLASSIFIED',
        'ZZC-3.json',
    )));
    assert.ok(fs.existsSync(path.join(
        output,
        '07-media',
        'products',
        'ZZC-1',
    )));
    assert.ok(!fs.existsSync(path.join(output, 'data')));
    assert.ok(!fs.existsSync(path.join(output, 'evidence')));
    assert.ok(!fs.existsSync(path.join(output, 'media')));
    const productFiles = documents.manifest.files
        .filter(item => item.path.startsWith('04-products/'));
    assert.strictEqual(productFiles.length, 2);
    assert.ok(productFiles.every(item => item.bytes < DATA_IMPORT_BATCH_MAX_BYTES));
    const media = JSON.parse(fs.readFileSync(path.join(
        output,
        '07-media',
        'products',
        'media.json',
    )));
    assert.strictEqual(media.length, 1);
    assert.strictEqual(media[0].product, 'ZZC-1');
    assert.strictEqual(media[0].replace, true);
    assert.strictEqual(media[0].items[0].isCover, true);
}

function testUnsupportedDuplicateEvidenceFails() {
    const output = temporaryDirectory();
    writeAdminConsoleArtifact(output, fixture());
    fs.mkdirSync(path.join(output, 'data'));
    fs.writeFileSync(path.join(output, 'data', 'products.json'), '[]\n');
    assert.throws(
        () => verifyAdminConsoleArtifact(output),
        /untracked artifact file|unsupported files/,
    );
}

function testOversizedProductFailsEvenWithUpdatedOuterHash() {
    const output = temporaryDirectory();
    writeAdminConsoleArtifact(output, fixture());
    const relativePath =
        '04-products/CAT-PUER-UNCLASSIFIED/ZZC-1.json';
    const productFile = path.join(output, ...relativePath.split('/'));
    const product = JSON.parse(fs.readFileSync(productFile, 'utf8'))[0];
    product.padding = 'x'.repeat(DATA_IMPORT_BATCH_MAX_BYTES);
    fs.writeFileSync(productFile, `${JSON.stringify([product])}\n`);
    refreshFileEntry(output, relativePath);
    assert.throws(
        () => verifyAdminConsoleArtifact(output),
        /exceeds the Data Import Console batch ceiling/,
    );
}

function testCatalogReferenceBindingFailsClosed() {
    const context = fixture();
    context.catalogReferenceSha256 = 'f'.repeat(64);
    assert.throws(
        () => writeAdminConsoleArtifact(temporaryDirectory(), context),
        /Catalog reference does not match/,
    );
}

function testMediaSourceBindingAndArtifactIdentityFailClosed() {
    const output = temporaryDirectory();
    writeAdminConsoleArtifact(output, fixture());
    const media = JSON.parse(fs.readFileSync(path.join(
        output,
        '07-media',
        'products',
        'media.json',
    )));
    const relativeImage =
        `${media[0].path}/${media[0].items[0].file}`;
    const imageFile = path.join(output, ...relativeImage.split('/'));
    const bytes = fs.readFileSync(imageFile);
    bytes[bytes.length - 1] ^= 0xff;
    fs.writeFileSync(imageFile, bytes);
    refreshFileEntry(output, relativeImage);
    assert.throws(
        () => verifyAdminConsoleArtifact(output),
        /Media source binding is invalid/,
    );

    const identityOutput = temporaryDirectory();
    writeAdminConsoleArtifact(identityOutput, fixture());
    const manifestFile = path.join(identityOutput, 'artifact-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.artifactId = 'f'.repeat(64);
    writeJsonAtomic(manifestFile, manifest);
    assert.throws(
        () => verifyAdminConsoleArtifact(identityOutput),
        /artifact identity is invalid/,
    );
}

function main() {
    testConsoleLayout();
    testUnsupportedDuplicateEvidenceFails();
    testOversizedProductFailsEvenWithUpdatedOuterHash();
    testCatalogReferenceBindingFailsClosed();
    testMediaSourceBindingAndArtifactIdentityFailClosed();
    console.log('admin console artifact tests passed');
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
