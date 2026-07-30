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
    verifyAdminConsoleArtifact,
    writeAdminConsoleArtifact,
} = require('./lib/admin-console-artifact');
const {
    DESCRIPTION_PLACEHOLDER,
    NAME_PLACEHOLDER,
    artifactIdentity,
    importTranslationPackages,
    verifyTranslationPackage,
    writeTranslationPackage,
} = require('./lib/product-translation-markdown');
const {
    createContext,
} = require('./test-import-bundle');

function temporaryDirectory(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sourceArtifact() {
    const context = createContext();
    const productPatchesFile = path.join(
        context.mappingsBundle.root,
        context.mappingsBundle.manifest.productPatchesFile,
    );
    const productPatches = JSON.parse(fs.readFileSync(
        productPatchesFile,
        'utf8',
    )).map((product, index) => ({
        ...product,
        nativeName: `茶 ${product.code}`,
        specifications: [{
            attribute: 'SPEC-PACKAGE',
            group: 'SPEC-GROUP',
            order: 10,
            showOnPage: true,
            type: 'CustomText',
            value: `${index + 1}饼/件`,
        }],
        translations: [{
            lang: 'zh-CN',
            name: `茶 ${product.code}`,
            description: `产品资料 ${product.code}`,
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
        specificationGroups: [{
            code: 'SPEC-GROUP',
            order: 1,
            published: true,
            translations: [{
                lang: 'zh-CN',
                name: '参数',
                description: '',
            }],
        }],
        specificationAttributes: [{
            code: 'SPEC-PACKAGE',
            group: null,
            unit: null,
            type: 'CustomText',
            order: 1,
            published: true,
            translations: [{
                lang: 'zh-CN',
                name: '包装',
                description: '',
            }],
        }],
        specificationAttributeOptions: [],
    };
    const catalogReferenceSha256 = sha256(stableJson(catalogReference));
    context.catalogReference = catalogReference;
    context.catalogReferenceSha256 = catalogReferenceSha256;
    context.mappingsBundle.manifest.inputCatalogReferenceSha256 =
        catalogReferenceSha256;
    context.sourceBundle.manifest.observedAt = '2026-07-30T00:00:00.000Z';
    const output = temporaryDirectory('zzctea-translation-source-');
    writeAdminConsoleArtifact(output, context);
    verifyAdminConsoleArtifact(output);
    return output;
}

function allFiles(root) {
    const pending = [root];
    const files = [];
    while (pending.length > 0) {
        const directory = pending.pop();
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) pending.push(target);
            else if (entry.isFile()) {
                files.push(path.relative(root, target).split(path.sep).join('/'));
            }
        }
    }
    return files.sort();
}

function replaceTranslation(file, name, description) {
    const contents = fs.readFileSync(file, 'utf8')
        .replace(NAME_PLACEHOLDER, name)
        .replace(DESCRIPTION_PLACEHOLDER, description);
    fs.writeFileSync(file, contents);
}

function completePackage(packageRoot) {
    const manifest = JSON.parse(fs.readFileSync(
        path.join(packageRoot, 'translation-manifest.json'),
        'utf8',
    ));
    for (const product of manifest.products) {
        for (const entry of product.files) {
            replaceTranslation(
                path.join(packageRoot, ...entry.path.split('/')),
                `Translated ${product.code}`,
                `Translated description for ${product.code}.`,
            );
        }
    }
    return manifest;
}

function refreshArtifactIdentity(root, relativePath) {
    const manifestFile = path.join(root, 'artifact-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const content = fs.readFileSync(path.join(root, ...relativePath.split('/')));
    const entry = manifest.files.find(item => item.path === relativePath);
    entry.bytes = content.length;
    entry.sha256 = sha256(content);
    manifest.artifactId = artifactIdentity(manifest);
    manifest.version =
        `${manifest.snapshotId}.${manifest.artifactId.slice(0, 12)}`;
    writeJsonAtomic(manifestFile, manifest);
}

function testDeterministicExport() {
    const source = sourceArtifact();
    const first = temporaryDirectory('zzctea-translation-parent-a-');
    const second = temporaryDirectory('zzctea-translation-parent-b-');
    const firstOutput = path.join(first, 'package');
    const secondOutput = path.join(second, 'package');
    const firstResult = writeTranslationPackage({
        sourceDirectory: source,
        outputDirectory: firstOutput,
        targetLocales: ['ru-ru', 'en-us'],
    });
    const secondResult = writeTranslationPackage({
        sourceDirectory: source,
        outputDirectory: secondOutput,
        targetLocales: ['en-US', 'ru-RU'],
    });
    assert.strictEqual(
        stableJson(firstResult.manifest),
        stableJson(secondResult.manifest),
    );
    assert.deepStrictEqual(allFiles(firstOutput), allFiles(secondOutput));
    for (const file of allFiles(firstOutput)) {
        assert.deepStrictEqual(
            fs.readFileSync(path.join(firstOutput, file)),
            fs.readFileSync(path.join(secondOutput, file)),
        );
    }
    assert.strictEqual(firstResult.manifest.productCount, 2);
    assert.deepStrictEqual(
        firstResult.manifest.targetLocales,
        ['en-US', 'ru-RU'],
    );
    const markdown = fs.readFileSync(path.join(
        firstOutput,
        firstResult.manifest.products[0].files[0].path,
    ), 'utf8');
    assert.match(markdown, /Chinese source — read only/);
    assert.match(markdown, /包装:/);
    assert.match(markdown, /sourceTranslationSha256: [a-f0-9]{64}/);
}

function testSuccessfulRoundTripAndPreservation() {
    const source = sourceArtifact();
    const packageParent = temporaryDirectory('zzctea-translation-package-');
    const packageRoot = path.join(packageParent, 'en-US');
    const exported = writeTranslationPackage({
        sourceDirectory: source,
        outputDirectory: packageRoot,
        targetLocales: ['en-US'],
    });
    completePackage(packageRoot);
    const parsed = verifyTranslationPackage(packageRoot, {
        sourceRoot: source,
        requireCompleted: true,
    });
    assert.strictEqual(parsed.translations.length, 2);
    const outputParent = temporaryDirectory('zzctea-translated-artifact-');
    const output = path.join(outputParent, 'artifact');
    const imported = importTranslationPackages({
        sourceDirectory: source,
        outputDirectory: output,
        packageDirectories: [packageRoot],
    });
    const verified = verifyAdminConsoleArtifact(output);
    assert.deepStrictEqual(verified.manifest.requiredLocales, ['en-US', 'zh-CN']);
    assert.deepStrictEqual(
        verified.manifest.localization.humanTranslatedLocales,
        ['en-US'],
    );
    assert.strictEqual(
        verified.manifest.translationInterchange.packages[0].packageId,
        exported.manifest.packageId,
    );
    for (const item of verified.manifest.products) {
        const sourceProduct = JSON.parse(fs.readFileSync(
            path.join(source, ...item.path.split('/')),
            'utf8',
        ))[0];
        const translatedProduct = JSON.parse(fs.readFileSync(
            path.join(output, ...item.path.split('/')),
            'utf8',
        ))[0];
        const sourceWithoutTranslations = {
            ...sourceProduct,
            translations: undefined,
            replaceTranslations: undefined,
        };
        const translatedWithoutTranslations = {
            ...translatedProduct,
            translations: undefined,
            replaceTranslations: undefined,
        };
        assert.deepStrictEqual(
            translatedWithoutTranslations,
            sourceWithoutTranslations,
        );
        assert.strictEqual(translatedProduct.replaceTranslations, true);
        assert.strictEqual(
            translatedProduct.translations.find(item =>
                item.lang === 'en-US').name,
            `Translated ${item.code}`,
        );
        assert.deepStrictEqual(
            translatedProduct.translations.find(item =>
                item.lang === 'zh-CN'),
            sourceProduct.translations[0],
        );
    }
    assert.notStrictEqual(
        imported.manifest.artifactId,
        verified.manifest.translationInterchange.sourceArtifactId,
    );
}

function testIncompleteAndSourceDriftFailClosed() {
    const source = sourceArtifact();
    const packageParent = temporaryDirectory('zzctea-translation-incomplete-');
    const packageRoot = path.join(packageParent, 'package');
    writeTranslationPackage({
        sourceDirectory: source,
        outputDirectory: packageRoot,
        targetLocales: ['en-US'],
    });
    assert.throws(
        () => importTranslationPackages({
            sourceDirectory: source,
            outputDirectory: path.join(packageParent, 'incomplete-output'),
            packageDirectories: [packageRoot],
        }),
        /is not translated/,
    );

    completePackage(packageRoot);
    const sourceManifest = JSON.parse(fs.readFileSync(
        path.join(source, 'artifact-manifest.json'),
        'utf8',
    ));
    const productPath = sourceManifest.products[0].path;
    const productFile = path.join(source, ...productPath.split('/'));
    const records = JSON.parse(fs.readFileSync(productFile, 'utf8'));
    records[0].translations[0].description += ' changed';
    fs.writeFileSync(productFile, `${JSON.stringify(records, null, 2)}\n`);
    refreshArtifactIdentity(source, productPath);
    verifyAdminConsoleArtifact(source);
    assert.throws(
        () => verifyTranslationPackage(packageRoot, {
            sourceRoot: source,
            requireCompleted: true,
        }),
        /manifest binding is invalid|source drift/,
    );
}

function main() {
    testDeterministicExport();
    testSuccessfulRoundTripAndPreservation();
    testIncompleteAndSourceDriftFailClosed();
    console.log('product translation Markdown tests passed');
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
