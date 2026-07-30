#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    stableJson,
} = require('./lib/artifacts');
const {
    verifyAdminConsoleArtifact,
} = require('./lib/admin-console-artifact');
const {
    importTranslatedChineseMarkdown,
    verifyChineseMarkdownPackage,
    writeChineseMarkdownPackage,
} = require('./lib/chinese-product-markdown');
const {
    allFiles,
    sourceArtifact,
} = require('./test-product-translation-markdown');

function temporaryDirectory(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function markdownFiles(root) {
    return allFiles(root).filter(file => file.endsWith('.md'));
}

function translatePackage(packageRoot) {
    const manifest = JSON.parse(fs.readFileSync(
        path.join(packageRoot, 'translation-manifest.json'),
        'utf8',
    ));
    for (const item of manifest.products) {
        fs.writeFileSync(
            path.join(packageRoot, ...item.file.split('/')),
            `# Translated ${item.code}\n\nTranslated description for ${item.code}.\n`,
        );
    }
    return manifest;
}

function testChineseOnlyDeterministicExport() {
    const source = sourceArtifact();
    const parent = temporaryDirectory('zzctea-chinese-markdown-');
    const sourceArchive = path.join(parent, 'source-artifact');
    const firstRoot = path.join(parent, 'first');
    const secondRoot = path.join(parent, 'second');
    const first = writeChineseMarkdownPackage({
        sourceDirectory: source,
        sourceArchiveDirectory: sourceArchive,
        outputDirectory: firstRoot,
    });
    const second = writeChineseMarkdownPackage({
        sourceDirectory: source,
        sourceArchiveDirectory: sourceArchive,
        outputDirectory: secondRoot,
    });
    assert.strictEqual(first.sourceArchive.reused, false);
    assert.strictEqual(second.sourceArchive.reused, true);
    assert.strictEqual(first.manifest.productCount, 2);
    assert.strictEqual(
        stableJson(first.manifest),
        stableJson(second.manifest),
    );
    assert.deepStrictEqual(allFiles(firstRoot), allFiles(secondRoot));
    for (const file of allFiles(firstRoot)) {
        assert.deepStrictEqual(
            fs.readFileSync(path.join(firstRoot, file)),
            fs.readFileSync(path.join(secondRoot, file)),
        );
    }
    const markdown = fs.readFileSync(
        path.join(firstRoot, ...first.manifest.products[0].file.split('/')),
        'utf8',
    );
    assert.strictEqual(
        markdown,
        `# 茶 ${first.manifest.products[0].code}\n\n` +
        `产品资料 ${first.manifest.products[0].code}\n`,
    );
    assert.doesNotMatch(
        markdown,
        /Translate|targetLocale|sourceLocale|productCode|schema|placeholder/i,
    );
    assert.strictEqual(markdownFiles(firstRoot).length, 2);
    verifyChineseMarkdownPackage(firstRoot, {
        sourceRoot: sourceArchive,
        requireTranslated: false,
    });
}

function testReturnedTranslationRoundTripPreservesArtifact() {
    const source = sourceArtifact();
    const parent = temporaryDirectory('zzctea-chinese-roundtrip-');
    const packageRoot = path.join(parent, 'package');
    const outputRoot = path.join(parent, 'artifact');
    const exported = writeChineseMarkdownPackage({
        sourceDirectory: source,
        outputDirectory: packageRoot,
    });
    translatePackage(packageRoot);
    const imported = importTranslatedChineseMarkdown({
        sourceDirectory: source,
        packageDirectory: packageRoot,
        targetLocale: 'en-us',
        outputDirectory: outputRoot,
    });
    const verified = verifyAdminConsoleArtifact(outputRoot);
    assert.strictEqual(imported.targetLocale, 'en-US');
    assert.deepStrictEqual(
        verified.manifest.requiredLocales,
        ['en-US', 'zh-CN'],
    );
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
            path.join(outputRoot, ...item.path.split('/')),
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
        assert.deepStrictEqual(
            translatedProduct.translations.find(
                translation => translation.lang === 'zh-CN',
            ),
            sourceProduct.translations[0],
        );
        assert.strictEqual(
            translatedProduct.translations.find(
                translation => translation.lang === 'en-US',
            ).name,
            `Translated ${item.code}`,
        );
    }
}

function testReturnedPackageFailsClosed() {
    const source = sourceArtifact();
    const parent = temporaryDirectory('zzctea-chinese-fail-');
    const packageRoot = path.join(parent, 'package');
    const exported = writeChineseMarkdownPackage({
        sourceDirectory: source,
        outputDirectory: packageRoot,
    });
    assert.throws(
        () => importTranslatedChineseMarkdown({
            sourceDirectory: source,
            packageDirectory: packageRoot,
            targetLocale: 'ru-RU',
            outputDirectory: path.join(parent, 'unchanged'),
        }),
        /was not translated/,
    );

    translatePackage(packageRoot);
    const missingFile = path.join(
        packageRoot,
        ...exported.manifest.products[0].file.split('/'),
    );
    const missingContents = fs.readFileSync(missingFile);
    fs.unlinkSync(missingFile);
    assert.throws(
        () => verifyChineseMarkdownPackage(packageRoot, {
            sourceRoot: source,
            requireTranslated: true,
        }),
        /ENOENT/,
    );
    fs.mkdirSync(path.dirname(missingFile), { recursive: true });
    fs.writeFileSync(missingFile, missingContents);

    const unexpected = path.join(packageRoot, 'extra.md');
    fs.writeFileSync(unexpected, '# 额外\n\n额外说明\n');
    assert.throws(
        () => verifyChineseMarkdownPackage(packageRoot, {
            sourceRoot: source,
            requireTranslated: true,
        }),
        /missing or unexpected files/,
    );
    fs.unlinkSync(unexpected);

    fs.writeFileSync(missingFile, '## Wrong structure\n\nText\n');
    assert.throws(
        () => verifyChineseMarkdownPackage(packageRoot, {
            sourceRoot: source,
            requireTranslated: true,
        }),
        /must contain only/,
    );
}

function main() {
    testChineseOnlyDeterministicExport();
    testReturnedTranslationRoundTripPreservesArtifact();
    testReturnedPackageFailsClosed();
    console.log('Chinese-only product Markdown tests passed');
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
