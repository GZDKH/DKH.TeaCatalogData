'use strict';

const fs = require('fs');
const path = require('path');
const {
    readJson,
    sha256,
    stableJson,
    writeJsonAtomic,
} = require('./artifacts');
const {
    verifyAdminConsoleArtifact,
} = require('./admin-console-artifact');
const {
    SOURCE_LOCALE,
    archiveTranslationSource,
    artifactFiles,
    artifactIdentity,
    assertRealDirectory,
    assertSeparateOutput,
    canonicalLocale,
    copyTree,
    sourceTranslation,
    sourceTranslationSha256,
    walkFiles,
} = require('./product-translation-markdown');
const {
    withStagedOutput,
} = require('../../thetea/lib/generated-output');

const PACKAGE_KIND = 'dkh.zzctea.chinese-source-markdown';
const PACKAGE_SCHEMA_VERSION = 1;

function normalizeText(value) {
    return String(value ?? '')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n')
        .normalize('NFC')
        .trim();
}

function assertSafeText(value, file) {
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
        || /<\s*\/?\s*(?:script|iframe|object|embed)\b/i.test(value)
        || /zzctea|找找茶/i.test(value)) {
        throw new Error(`${file} contains unsafe or source-attribution text.`);
    }
}

function assertDocumentValues(document, file) {
    if (document.name.length < 2 || document.name.length > 200
        || document.name.includes('\n')) {
        throw new Error(`${file} name must be one 2-200 character line.`);
    }
    if (document.description.length < 1
        || document.description.length > 4000) {
        throw new Error(`${file} description must contain 1-4000 characters.`);
    }
    assertSafeText(document.name, file);
    assertSafeText(document.description, file);
}

function markdownDocument(product) {
    const translation = sourceTranslation(product);
    const document = {
        name: normalizeText(translation.name),
        description: normalizeText(translation.description),
    };
    assertDocumentValues(document, product.code);
    return `# ${document.name}\n\n${document.description}\n`;
}

function parseMarkdownDocument(file) {
    const contents = fs.readFileSync(file, 'utf8')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n')
        .normalize('NFC');
    const match = /^# ([^\n]+)\n\n([\s\S]+)\n$/.exec(contents);
    if (!match) {
        throw new Error(
            `${file} must contain only '# <name>', one blank line, and the description.`,
        );
    }
    const document = {
        name: normalizeText(match[1]),
        description: normalizeText(match[2]),
    };
    assertDocumentValues(document, file);
    return document;
}

function packageIdentity(manifest) {
    return sha256(stableJson({
        kind: manifest.kind,
        products: manifest.products,
        schemaVersion: manifest.schemaVersion,
        source: manifest.source,
    }));
}

function expectedRelativePath(item) {
    const parts = String(item.path || '').split('/');
    if (parts.length !== 3 || parts[0] !== '04-products') {
        throw new Error(`Invalid source product path for ${item.code}.`);
    }
    return `products/${parts[1]}/${item.code}.md`;
}

function writeChineseMarkdownPackage(options) {
    let sourceRoot = assertRealDirectory(
        options.sourceDirectory,
        'Source Admin Console artifact',
    );
    let sourceArchive = null;
    if (options.sourceArchiveDirectory) {
        sourceArchive = archiveTranslationSource({
            sourceDirectory: sourceRoot,
            outputDirectory: options.sourceArchiveDirectory,
        });
        sourceRoot = sourceArchive.outputDirectory;
    }
    const outputRoot = assertSeparateOutput(sourceRoot, options.outputDirectory);
    const source = verifyAdminConsoleArtifact(sourceRoot);
    const productByCode = new Map(
        source.bundle.products.map(product => [product.code, product]),
    );
    let manifest;
    withStagedOutput(outputRoot, stagingDirectory => {
        const products = source.manifest.products.map(item => {
            const product = productByCode.get(item.code);
            if (!product) {
                throw new Error(`Artifact product ${item.code} is unavailable.`);
            }
            const relativePath = expectedRelativePath(item);
            const contents = markdownDocument(product);
            const file = path.join(
                stagingDirectory,
                ...relativePath.split('/'),
            );
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, contents);
            return {
                code: item.code,
                file: relativePath,
                sourceMarkdownSha256: sha256(contents),
                sourceProductPath: item.path,
                sourceTranslationSha256: sourceTranslationSha256(product),
            };
        });
        manifest = {
            schemaVersion: PACKAGE_SCHEMA_VERSION,
            kind: PACKAGE_KIND,
            source: {
                artifactId: source.manifest.artifactId,
                locale: SOURCE_LOCALE,
                snapshotId: source.manifest.snapshotId,
                version: source.manifest.version,
            },
            productCount: products.length,
            products,
            safety: {
                productionWrites: false,
                sourceArtifactMutation: false,
            },
        };
        manifest.packageId = packageIdentity(manifest);
        writeJsonAtomic(
            path.join(stagingDirectory, 'translation-manifest.json'),
            manifest,
        );
        verifyChineseMarkdownPackage(stagingDirectory, {
            sourceRoot,
            requireTranslated: false,
        });
        return manifest;
    });
    return {
        manifest,
        outputDirectory: outputRoot,
        sourceArchive,
    };
}

function verifyChineseMarkdownPackage(directory, options = {}) {
    const root = assertRealDirectory(directory, 'Chinese Markdown package');
    const sourceRoot = assertRealDirectory(
        options.sourceRoot,
        'Source Admin Console artifact',
    );
    const source = verifyAdminConsoleArtifact(sourceRoot);
    const manifest = readJson(path.join(root, 'translation-manifest.json'));
    if (manifest.schemaVersion !== PACKAGE_SCHEMA_VERSION
        || manifest.kind !== PACKAGE_KIND
        || manifest.source?.artifactId !== source.manifest.artifactId
        || manifest.source?.version !== source.manifest.version
        || manifest.source?.snapshotId !== source.manifest.snapshotId
        || manifest.source?.locale !== SOURCE_LOCALE
        || manifest.safety?.productionWrites !== false
        || manifest.safety?.sourceArtifactMutation !== false
        || manifest.packageId !== packageIdentity(manifest)) {
        throw new Error('Chinese Markdown package manifest binding is invalid.');
    }
    if (!Array.isArray(manifest.products)
        || manifest.productCount !== source.manifest.counts.products
        || manifest.products.length !== source.manifest.counts.products) {
        throw new Error('Chinese Markdown package product count is incomplete.');
    }
    const sourceByCode = new Map(
        source.bundle.products.map(product => [product.code, product]),
    );
    const sourcePathByCode = new Map(
        source.manifest.products.map(item => [item.code, item.path]),
    );
    const expectedFiles = new Set(['translation-manifest.json']);
    const translations = [];
    const seenCodes = new Set();
    for (const item of manifest.products) {
        const product = sourceByCode.get(item.code);
        const sourceProductPath = sourcePathByCode.get(item.code);
        const expectedFile = expectedRelativePath({
            code: item.code,
            path: sourceProductPath,
        });
        const sourceContents = product ? markdownDocument(product) : '';
        if (!product || seenCodes.has(item.code)
            || item.sourceProductPath !== sourceProductPath
            || item.file !== expectedFile
            || item.sourceTranslationSha256 !==
                sourceTranslationSha256(product)
            || item.sourceMarkdownSha256 !== sha256(sourceContents)) {
            throw new Error(
                `Chinese Markdown package source drift for ${item.code}.`,
            );
        }
        seenCodes.add(item.code);
        expectedFiles.add(item.file);
        const file = path.join(root, ...item.file.split('/'));
        const document = parseMarkdownDocument(file);
        const contentsSha256 = sha256(fs.readFileSync(file));
        if (options.requireTranslated === true
            && contentsSha256 === item.sourceMarkdownSha256) {
            throw new Error(`${item.file} was not translated.`);
        }
        if (options.requireTranslated !== true
            && contentsSha256 !== item.sourceMarkdownSha256) {
            throw new Error(`${item.file} differs from the Chinese source.`);
        }
        translations.push({
            code: item.code,
            translation: document,
        });
    }
    if (seenCodes.size !== source.manifest.counts.products) {
        throw new Error('Chinese Markdown package product codes are incomplete.');
    }
    const actualFiles = walkFiles(root);
    if (actualFiles.length !== expectedFiles.size
        || actualFiles.some(file => !expectedFiles.has(file))) {
        throw new Error(
            'Chinese Markdown package contains missing or unexpected files.',
        );
    }
    return { manifest, root, source, translations };
}

function importTranslatedChineseMarkdown(options) {
    const sourceRoot = assertRealDirectory(
        options.sourceDirectory,
        'Source Admin Console artifact',
    );
    const outputRoot = assertSeparateOutput(sourceRoot, options.outputDirectory);
    const targetLocale = canonicalLocale(options.targetLocale);
    if (targetLocale === SOURCE_LOCALE) {
        throw new Error(`${SOURCE_LOCALE} is the protected source locale.`);
    }
    const translated = verifyChineseMarkdownPackage(
        options.packageDirectory,
        {
            sourceRoot,
            requireTranslated: true,
        },
    );
    const translationByCode = new Map(
        translated.translations.map(item => [item.code, {
            lang: targetLocale,
            ...item.translation,
        }]),
    );
    const source = verifyAdminConsoleArtifact(sourceRoot);
    let manifest;
    withStagedOutput(outputRoot, stagingDirectory => {
        copyTree(sourceRoot, stagingDirectory);
        for (const item of source.manifest.products) {
            const productFile = path.join(
                stagingDirectory,
                ...item.path.split('/'),
            );
            const records = readJson(productFile);
            if (!Array.isArray(records) || records.length !== 1) {
                throw new Error(
                    `${item.path} must contain exactly one product.`,
                );
            }
            const product = records[0];
            const incoming = translationByCode.get(item.code);
            if (!incoming) {
                throw new Error(`Translation is missing for ${item.code}.`);
            }
            product.translations = [
                ...(product.translations || [])
                    .filter(entry => entry.lang !== targetLocale),
                incoming,
            ].sort((left, right) => left.lang.localeCompare(right.lang));
            product.replaceTranslations = true;
            fs.writeFileSync(
                productFile,
                `${JSON.stringify(records, null, 2)}\n`,
            );
        }
        manifest = readJson(
            path.join(stagingDirectory, 'artifact-manifest.json'),
        );
        manifest.requiredLocales = [...new Set([
            ...(manifest.requiredLocales || []),
            targetLocale,
        ])].sort();
        manifest.localization = {
            ...(manifest.localization || {}),
            humanTranslatedLocales: [...new Set([
                ...(manifest.localization?.humanTranslatedLocales || []),
                targetLocale,
            ])].sort(),
        };
        const translationContent = translated.translations.map(item => ({
            code: item.code,
            translation: {
                lang: targetLocale,
                ...item.translation,
            },
        }));
        manifest.translationInterchange = {
            packages: [{
                packageId: translated.manifest.packageId,
                targetLocales: [targetLocale],
                translationContentSha256: sha256(
                    stableJson(translationContent),
                ),
            }],
            sourceArtifactId: source.manifest.artifactId,
            targetLocales: [targetLocale],
        };
        manifest.files = artifactFiles(stagingDirectory);
        manifest.artifactId = artifactIdentity(manifest);
        manifest.version =
            `${manifest.snapshotId}.${manifest.artifactId.slice(0, 12)}`;
        writeJsonAtomic(
            path.join(stagingDirectory, 'artifact-manifest.json'),
            manifest,
        );
        verifyAdminConsoleArtifact(stagingDirectory);
        return manifest;
    });
    return {
        manifest,
        outputDirectory: outputRoot,
        targetLocale,
    };
}

module.exports = {
    PACKAGE_KIND,
    PACKAGE_SCHEMA_VERSION,
    importTranslatedChineseMarkdown,
    markdownDocument,
    parseMarkdownDocument,
    verifyChineseMarkdownPackage,
    writeChineseMarkdownPackage,
};
