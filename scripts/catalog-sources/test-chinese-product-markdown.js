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
    normalizeContext,
    normalizeSpecifications,
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

function translationContext(sourceRoot) {
    const source = verifyAdminConsoleArtifact(sourceRoot);
    const mediaRecords = JSON.parse(fs.readFileSync(path.join(
        sourceRoot,
        '07-media',
        'products',
        'media.json',
    ), 'utf8'));
    const mediaByProduct = new Map(
        mediaRecords.map(record => [record.product, record]),
    );
    const products = new Map();
    for (const product of source.bundle.products) {
        const translation = product.translations.find(
            item => item.lang === 'zh-CN',
        );
        const externalId = product.code.slice('ZZC-'.length);
        const productContext = normalizeContext({
            externalId,
            productCode: product.code,
            sourceLinks: {
                observedCanonicalUrl:
                    `https://zzctea.com/tea/t${externalId}-tea.html`,
                stableLookupUrl:
                    `https://zzctea.com/teaDetail/${externalId}.html`,
            },
        }, {
            diagnosticCodes: [],
            factualAttributes: [
                ['brand.name', '大益'],
                ['year-label', '2008年'],
                ['batch', '801'],
                ['production-technology', '生茶'],
                ['shape', '饼茶'],
                ['release.kind', 'factory-release-fact'],
                ['release.quantity', '10000'],
                ['release.basis-unit-code', 'cake'],
                ['release.currency-code', 'CNY'],
                ['market.pricing.current-amount', '8500'],
                ['market.pricing.basis-unit-code', 'case'],
                ['market.pricing.currency-code', 'CNY'],
                ['market.aggregates.follower-count', '980'],
                ['market.source-updated-at', '2025-02-08T00:00:00.000Z'],
            ].map(([attributeCode, normalizedValue]) => ({
                attributeCode,
                normalizedValue,
            })),
            imageUris: [
                `https://images.example.test/${externalId}.jpg`,
            ],
            localizedText: [{
                description: translation.description,
                languageCode: 'zh-CN',
                title: translation.name,
            }],
            packageComponents: [{
                containedUnitCode: 'g',
                containerUnitCode: 'cake',
                ordinal: 0,
                quantity: { nanos: 0, units: '250' },
            }, {
                containedUnitCode: 'cake',
                containerUnitCode: 'case',
                ordinal: 1,
                quantity: { nanos: 0, units: '60' },
            }],
            packageComponentsExact: true,
            rawPackageText: '250克/片 60片/件',
            referencePrices: [{
                amount: { nanos: 0, units: '8500' },
                basisUnitCode: 'case',
                derivationKind: 1,
                observedAt: '2026-07-30T00:00:00.000Z',
                roundingMode: 'none',
                sourceUpdatedAt: '2025-02-08T00:00:00.000Z',
                state: 1,
            }, {
                amount: { nanos: 666666670, units: '141' },
                basisUnitCode: 'cake',
                derivationDivisor: { nanos: 0, units: '60' },
                derivationKind: 2,
                exactFractionDenominator: '3',
                exactFractionNumerator: '425',
                observedAt: '2026-07-30T00:00:00.000Z',
                roundingMode: 'half-up',
                roundingScale: 8,
                sourceUpdatedAt: '2025-02-08T00:00:00.000Z',
                state: 1,
            }],
            sourceDestination: {
                canonicalUri:
                    `https://zzctea.com/tea/t${externalId}-tea.html`,
                lookupUri:
                    `https://zzctea.com/teaDetail/${externalId}.html`,
                observedAt: '2026-07-30T00:00:00.000Z',
            },
            sourceUpdatedAt: '2025-02-08T00:00:00.000Z',
        }, mediaByProduct.get(product.code));
        productContext.specifications = normalizeSpecifications(
            product,
            source.bundle,
        );
        products.set(product.code, productContext);
    }
    const binding = source.manifest.source;
    return {
        manifest: {
            applyAllowed: false,
            bundleId: 'b'.repeat(64),
            inputEvidence: {
                mappingSha256: binding.mappingsSha256,
                mediaItemsSha256: binding.mediaItemsSha256,
                mediaReceiptSha256: binding.mediaReceiptSha256,
                productPatchesSha256: binding.productPatchesSha256,
                projectionSha256: binding.projectionSha256,
                reconciliationSha256: binding.reconciliationSha256,
                sourceArtifactSha256: binding.sourceArtifactSha256,
            },
            productionWrites: false,
            snapshotId: source.manifest.snapshotId,
            sourceId: 'zzctea',
            version: `${source.manifest.snapshotId}.${'b'.repeat(12)}`,
        },
        products,
    };
}

function translatePackage(packageRoot) {
    const manifest = JSON.parse(fs.readFileSync(
        path.join(packageRoot, 'translation-manifest.json'),
        'utf8',
    ));
    for (const item of manifest.products) {
        const file = path.join(packageRoot, ...item.file.split('/'));
        const contents = fs.readFileSync(file, 'utf8')
            .replace(/^# [^\n]+/, `# Translated ${item.code}`)
            .replace(
                /## 产品描述\n\n[\s\S]*?\n\n## /,
                `## Product description\n\n` +
                `Translated description for ${item.code}.\n\n## `,
            );
        fs.writeFileSync(file, contents);
    }
    return manifest;
}

function testChineseOnlyDeterministicExport() {
    const source = sourceArtifact();
    const context = translationContext(source);
    const parent = temporaryDirectory('zzctea-chinese-markdown-');
    const sourceArchive = path.join(parent, 'source-artifact');
    const firstRoot = path.join(parent, 'first');
    const secondRoot = path.join(parent, 'second');
    const first = writeChineseMarkdownPackage({
        sourceDirectory: source,
        sourceArchiveDirectory: sourceArchive,
        outputDirectory: firstRoot,
        context,
    });
    const second = writeChineseMarkdownPackage({
        sourceDirectory: source,
        sourceArchiveDirectory: sourceArchive,
        outputDirectory: secondRoot,
        context,
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
    assert.match(
        markdown,
        new RegExp(`^# 茶 ${first.manifest.products[0].code}`),
    );
    assert.match(markdown, /## 产品资料/);
    assert.match(markdown, /- 年份：2008年/);
    assert.match(markdown, /- 品牌：大益/);
    assert.match(markdown, /## 商品规格/);
    assert.match(markdown, /- 包装规格：1饼\/件|包装规格：/);
    assert.match(markdown, /- 原始包装规格：250克\/片 60片\/件/);
    assert.match(markdown, /## 参考价格（非零售价）/);
    assert.match(markdown, /- 金额：8500 人民币/);
    assert.match(markdown, /- 金额：141\.66666667 人民币/);
    assert.match(markdown, /## 市场数据/);
    assert.match(markdown, /- 关注人数：980/);
    assert.match(markdown, /## 来源信息/);
    assert.match(markdown, /https:\/\/zzctea\.com\/tea\//);
    assert.match(markdown, /## 图片/);
    assert.match(markdown, /来源图片 1/);
    assert.doesNotMatch(
        markdown,
        /Translate|targetLocale|sourceLocale|productCode|schema|placeholder/i,
    );
    assert.strictEqual(markdownFiles(firstRoot).length, 2);
    verifyChineseMarkdownPackage(firstRoot, {
        sourceRoot: sourceArchive,
        requireTranslated: false,
        context,
    });
}

function testReturnedTranslationRoundTripPreservesArtifact() {
    const source = sourceArtifact();
    const context = translationContext(source);
    const parent = temporaryDirectory('zzctea-chinese-roundtrip-');
    const packageRoot = path.join(parent, 'package');
    const outputRoot = path.join(parent, 'artifact');
    const exported = writeChineseMarkdownPackage({
        sourceDirectory: source,
        outputDirectory: packageRoot,
        context,
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
    const context = translationContext(source);
    const parent = temporaryDirectory('zzctea-chinese-fail-');
    const packageRoot = path.join(parent, 'package');
    const exported = writeChineseMarkdownPackage({
        sourceDirectory: source,
        outputDirectory: packageRoot,
        context,
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

    const contextOnlyFile = path.join(
        packageRoot,
        ...exported.manifest.products[0].file.split('/'),
    );
    const sourceContents = fs.readFileSync(contextOnlyFile, 'utf8');
    fs.writeFileSync(
        contextOnlyFile,
        sourceContents.replace('## 产品资料', '## 商品资料'),
    );
    assert.throws(
        () => importTranslatedChineseMarkdown({
            sourceDirectory: source,
            packageDirectory: packageRoot,
            targetLocale: 'ru-RU',
            outputDirectory: path.join(parent, 'context-only'),
        }),
        /was not translated/,
    );
    fs.writeFileSync(contextOnlyFile, sourceContents);

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
        /complete section structure/,
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
