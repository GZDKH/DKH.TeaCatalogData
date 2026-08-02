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
    withStagedOutput,
} = require('../../thetea/lib/generated-output');

const PACKAGE_KIND = 'dkh.zzctea.product-translations';
const PACKAGE_SCHEMA_VERSION = 1;
const MARKDOWN_SCHEMA = 'dkh.zzctea.product-translation.v1';
const SOURCE_LOCALE = 'zh-CN';
const NAME_PLACEHOLDER = '[TRANSLATE NAME]';
const DESCRIPTION_PLACEHOLDER = '[TRANSLATE DESCRIPTION]';
const NAME_START = '<!-- DKH:TARGET-NAME:START -->';
const NAME_END = '<!-- DKH:TARGET-NAME:END -->';
const DESCRIPTION_START = '<!-- DKH:TARGET-DESCRIPTION:START -->';
const DESCRIPTION_END = '<!-- DKH:TARGET-DESCRIPTION:END -->';
const FRONT_MATTER_KEYS = [
    'schema',
    'productCode',
    'targetLocale',
    'sourceLocale',
    'sourceArtifactId',
    'sourceTranslationSha256',
];

const PLATFORM_PRODUCT_LOCALE_ALIASES = new Map(Object.entries({
    af: 'af-ZA',
    am: 'am-ET',
    ar: 'ar-SA',
    az: 'az-AZ',
    be: 'be-BY',
    bg: 'bg-BG',
    bho: 'bho-IN',
    bn: 'bn-BD',
    bo: 'bo-CN',
    ca: 'ca-ES',
    cs: 'cs-CZ',
    da: 'da-DK',
    de: 'de-DE',
    el: 'el-GR',
    es: 'es-ES',
    et: 'et-EE',
    fa: 'fa-IR',
    fi: 'fi-FI',
    fil: 'fil-PH',
    fr: 'fr-FR',
    gu: 'gu-IN',
    he: 'he-IL',
    hi: 'hi-IN',
    hr: 'hr-HR',
    hu: 'hu-HU',
    id: 'id-ID',
    is: 'is-IS',
    it: 'it-IT',
    ja: 'ja-JP',
    ka: 'ka-GE',
    kk: 'kk-KZ',
    km: 'km-KH',
    kn: 'kn-IN',
    ko: 'ko-KR',
    lo: 'lo-LA',
    lt: 'lt-LT',
    lv: 'lv-LV',
    mg: 'mg-MG',
    ml: 'ml-IN',
    mn: 'mn-MN',
    mr: 'mr-IN',
    ms: 'ms-MY',
    my: 'my-MM',
    ne: 'ne-NP',
    nl: 'nl-NL',
    no: 'nb-NO',
    ny: 'ny-MW',
    or: 'or-IN',
    pa: 'pa-IN',
    pl: 'pl-PL',
    pt: 'pt-BR',
    ro: 'ro-RO',
    si: 'si-LK',
    sk: 'sk-SK',
    sl: 'sl-SI',
    sr: 'sr-RS',
    sv: 'sv-SE',
    sw: 'sw-KE',
    ta: 'ta-IN',
    te: 'te-IN',
    th: 'th-TH',
    tr: 'tr-TR',
    uk: 'uk-UA',
    ur: 'ur-PK',
    uz: 'uz-UZ',
    vi: 'vi-VN',
    zu: 'zu-ZA',
}));

function canonicalLocale(value) {
    const raw = String(value || '').trim();
    let locale;
    try {
        [locale] = Intl.getCanonicalLocales(raw);
    } catch {
        throw new Error(`Invalid BCP 47 locale '${raw}'.`);
    }
    if (!locale || locale.length < 2 || locale.length > 10) {
        throw new Error(
            `Locale '${raw}' must fit the ProductCatalog 2-10 character limit.`,
        );
    }
    return locale;
}

function productLocale(value) {
    const locale = canonicalLocale(value);
    return PLATFORM_PRODUCT_LOCALE_ALIASES.get(locale) || locale;
}

function localizedProductName(value, nativeName, locale) {
    const name = String(value || '').trim();
    const sourceName = String(nativeName || '').trim();
    const productCulture = productLocale(locale);
    if (productCulture === SOURCE_LOCALE || !sourceName || name === sourceName) {
        return name;
    }
    if (!name.startsWith(sourceName)) {
        return name;
    }
    const suffix = name.slice(sourceName.length).trim();
    const opening = suffix[0];
    const closing = suffix[suffix.length - 1];
    if (!['(', '（'].includes(opening)) {
        return name;
    }
    if (![')', '）'].includes(closing)) {
        throw new Error(
            `Localized ${productCulture} name has an unterminated native wrapper.`,
        );
    }
    const localized = suffix.slice(1, -1).trim();
    if (!localized) {
        throw new Error(`Localized ${productCulture} name wrapper is empty.`);
    }
    return localized;
}

function mappedLocales(values, label) {
    const mapped = values.map(productLocale);
    const unique = new Set(mapped);
    if (unique.size !== mapped.length) {
        throw new Error(`${label} contains colliding ProductCatalog locales.`);
    }
    return [...unique].sort();
}

function targetLocales(values) {
    const locales = [...new Set(values.map(canonicalLocale))].sort();
    if (locales.length === 0) {
        throw new Error('At least one target locale is required.');
    }
    if (locales.includes(SOURCE_LOCALE)) {
        throw new Error(`${SOURCE_LOCALE} is the protected source locale.`);
    }
    return locales;
}

function sourceTranslation(product) {
    const translations = (product.translations || [])
        .filter(item => item?.lang === SOURCE_LOCALE);
    if (translations.length !== 1) {
        throw new Error(
            `Product ${product.code} must contain exactly one ${SOURCE_LOCALE} translation.`,
        );
    }
    return translations[0];
}

function sourceTranslationSha256(product) {
    return sha256(stableJson({
        code: product.code,
        nativeName: product.nativeName || '',
        specifications: product.specifications || [],
        translation: sourceTranslation(product),
    }));
}

function translationName(record, locale = SOURCE_LOCALE) {
    const translations = Array.isArray(record?.translations)
        ? record.translations
        : [];
    return String(
        translations.find(item => item?.lang === locale)?.name
        || translations.find(item => item?.lang === 'en-US')?.name
        || record?.code
        || '',
    ).trim();
}

function definitionMaps(bundle) {
    const attributes = new Map();
    const options = new Map();
    const addAttribute = attribute => {
        if (!attribute?.code) return;
        attributes.set(attribute.code, attribute);
        for (const option of attribute.options || []) {
            if (option?.code) options.set(option.code, option);
        }
    };
    for (const group of bundle.definitions.groups || []) {
        for (const attribute of group.attributes || []) addAttribute(attribute);
    }
    for (const attribute of bundle.definitions.attributes || []) {
        addAttribute(attribute);
    }
    for (const option of bundle.definitions.options || []) {
        if (option?.code) options.set(option.code, option);
    }
    return { attributes, options };
}

function oneLine(value) {
    return String(value ?? '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function specificationContext(product, definitions) {
    return (product.specifications || [])
        .slice()
        .sort((left, right) =>
            Number(left.order || 0) - Number(right.order || 0)
            || String(left.attribute || '').localeCompare(
                String(right.attribute || ''),
            ))
        .map(specification => {
            const attribute = definitions.attributes.get(specification.attribute);
            const option = definitions.options.get(specification.option);
            const label = translationName(attribute) || specification.attribute;
            const value = specification.option
                ? translationName(option) || specification.option
                : oneLine(specification.value);
            const unit = oneLine(attribute?.unit);
            return `- ${oneLine(label)}: ${value}${unit ? ` ${unit}` : ''}`;
        });
}

function blockquote(value) {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n');
}

function markdownDocument(context) {
    const specifications = specificationContext(
        context.product,
        context.definitions,
    );
    return [
        '---',
        `schema: ${MARKDOWN_SCHEMA}`,
        `productCode: ${context.product.code}`,
        `targetLocale: ${context.targetLocale}`,
        `sourceLocale: ${SOURCE_LOCALE}`,
        `sourceArtifactId: ${context.sourceArtifactId}`,
        `sourceTranslationSha256: ${sourceTranslationSha256(context.product)}`,
        '---',
        '',
        `# ${context.product.code} — ${sourceTranslation(context.product).name}`,
        '',
        'Translate only the text between the DKH markers. Keep the markers and',
        'front matter unchanged. Use plain text; do not add SEO fields or source',
        'attribution.',
        '',
        '## Translated name',
        '',
        NAME_START,
        NAME_PLACEHOLDER,
        NAME_END,
        '',
        '## Translated description',
        '',
        DESCRIPTION_START,
        DESCRIPTION_PLACEHOLDER,
        DESCRIPTION_END,
        '',
        '---',
        '',
        '## Chinese source — read only',
        '',
        '### Name',
        '',
        blockquote(sourceTranslation(context.product).name),
        '',
        '### Description',
        '',
        blockquote(sourceTranslation(context.product).description),
        '',
        '### Product context',
        '',
        `- Product code: \`${context.product.code}\``,
        `- Native name: ${oneLine(context.product.nativeName)}`,
        ...specifications,
        '',
    ].join('\n');
}

function assertRealDirectory(directory, label) {
    const resolved = path.resolve(directory);
    const stat = fs.lstatSync(resolved, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${label} must be an existing real directory.`);
    }
    return resolved;
}

function assertSeparateOutput(source, output) {
    const resolvedSource = fs.realpathSync(source);
    const outputSuffix = [];
    let existingOutputAncestor = path.resolve(output);
    while (!fs.existsSync(existingOutputAncestor)) {
        outputSuffix.unshift(path.basename(existingOutputAncestor));
        const parent = path.dirname(existingOutputAncestor);
        if (parent === existingOutputAncestor) break;
        existingOutputAncestor = parent;
    }
    const resolvedOutput = path.join(
        fs.realpathSync(existingOutputAncestor),
        ...outputSuffix,
    );
    const relative = path.relative(resolvedSource, resolvedOutput);
    const reverse = path.relative(resolvedOutput, resolvedSource);
    if (!relative || !reverse
        || (!relative.startsWith(`..${path.sep}`) && relative !== '..')
        || (!reverse.startsWith(`..${path.sep}`) && reverse !== '..')) {
        throw new Error('Source and output directories must not overlap.');
    }
    return resolvedOutput;
}

function packageIdentity(manifest) {
    return sha256(stableJson({
        kind: manifest.kind,
        products: manifest.products,
        schemaVersion: manifest.schemaVersion,
        source: manifest.source,
        targetLocales: manifest.targetLocales,
    }));
}

function archiveTranslationSource(options) {
    const sourceRoot = assertRealDirectory(
        options.sourceDirectory,
        'Source Admin Console artifact',
    );
    const outputRoot = assertSeparateOutput(
        sourceRoot,
        options.outputDirectory,
    );
    const source = verifyAdminConsoleArtifact(sourceRoot);
    if (fs.existsSync(outputRoot)) {
        const archived = verifyAdminConsoleArtifact(outputRoot);
        if (archived.manifest.artifactId !== source.manifest.artifactId) {
            throw new Error(
                'Translation source archive is already bound to another artifact.',
            );
        }
        return {
            manifest: archived.manifest,
            outputDirectory: outputRoot,
            reused: true,
        };
    }
    withStagedOutput(outputRoot, stagingDirectory => {
        copyTree(sourceRoot, stagingDirectory);
        const archived = verifyAdminConsoleArtifact(stagingDirectory);
        if (archived.manifest.artifactId !== source.manifest.artifactId) {
            throw new Error('Translation source archive identity changed.');
        }
        return archived.manifest;
    });
    return {
        manifest: source.manifest,
        outputDirectory: outputRoot,
        reused: false,
    };
}

function writeTranslationPackage(options) {
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
    const verified = verifyAdminConsoleArtifact(sourceRoot);
    const locales = targetLocales(options.targetLocales || []);
    const definitions = definitionMaps(verified.bundle);
    const productByCode = new Map(
        verified.bundle.products.map(product => [product.code, product]),
    );
    let manifest;
    withStagedOutput(outputRoot, stagingDirectory => {
        const products = [];
        for (const item of verified.manifest.products) {
            const product = productByCode.get(item.code);
            if (!product) {
                throw new Error(`Artifact product ${item.code} is unavailable.`);
            }
            const files = locales.map(locale => {
                const category = item.path.split('/')[1];
                const relativePath =
                    `translations/${locale}/${category}/${item.code}.md`;
                const file = path.join(
                    stagingDirectory,
                    ...relativePath.split('/'),
                );
                fs.mkdirSync(path.dirname(file), { recursive: true });
                const contents = markdownDocument({
                    definitions,
                    product,
                    sourceArtifactId: verified.manifest.artifactId,
                    targetLocale: locale,
                });
                fs.writeFileSync(file, contents);
                return {
                    locale,
                    path: relativePath,
                    templateStructureSha256: sha256(
                        translationDocumentSkeleton(contents, file),
                    ),
                };
            });
            products.push({
                code: item.code,
                files,
                sourceProductPath: item.path,
                sourceTranslationSha256: sourceTranslationSha256(product),
            });
        }
        manifest = {
            schemaVersion: PACKAGE_SCHEMA_VERSION,
            kind: PACKAGE_KIND,
            source: {
                artifactId: verified.manifest.artifactId,
                locale: SOURCE_LOCALE,
                snapshotId: verified.manifest.snapshotId,
                version: verified.manifest.version,
            },
            targetLocales: locales,
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
        verifyTranslationPackage(stagingDirectory, {
            sourceRoot,
            requireCompleted: false,
        });
        return manifest;
    });
    return {
        manifest,
        outputDirectory: outputRoot,
        sourceArchive,
    };
}

function walkFiles(root) {
    const pending = [root];
    const files = [];
    while (pending.length > 0) {
        const directory = pending.pop();
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) {
                throw new Error(`Translation package contains symlink ${target}.`);
            }
            if (entry.isDirectory()) pending.push(target);
            else if (entry.isFile()) {
                files.push(path.relative(root, target).split(path.sep).join('/'));
            } else {
                throw new Error(`Translation package contains non-file ${target}.`);
            }
        }
    }
    return files.sort();
}

function parseFrontMatter(contents, file) {
    const normalized = contents.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const match = /^---\n([\s\S]*?)\n---\n/.exec(normalized);
    if (!match) throw new Error(`${file} has invalid front matter.`);
    const values = {};
    for (const line of match[1].split('\n')) {
        const separator = line.indexOf(':');
        if (separator <= 0) {
            throw new Error(`${file} has invalid front matter line '${line}'.`);
        }
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (!FRONT_MATTER_KEYS.includes(key) || key in values || !value) {
            throw new Error(`${file} has unsupported front matter key '${key}'.`);
        }
        values[key] = value;
    }
    if (Object.keys(values).sort().join('\n')
        !== [...FRONT_MATTER_KEYS].sort().join('\n')) {
        throw new Error(`${file} front matter keys are incomplete.`);
    }
    return { body: normalized.slice(match[0].length), values };
}

function markerValue(body, start, end, file) {
    const first = body.indexOf(start);
    const last = body.indexOf(end);
    if (first < 0 || last < 0 || last <= first
        || body.indexOf(start, first + start.length) >= 0
        || body.indexOf(end, last + end.length) >= 0) {
        throw new Error(`${file} has invalid translation markers.`);
    }
    return body.slice(first + start.length, last).trim().normalize('NFC');
}

function replaceMarkerBody(contents, start, end, placeholder, file) {
    const first = contents.indexOf(start);
    const last = contents.indexOf(end);
    if (first < 0 || last < 0 || last <= first
        || contents.indexOf(start, first + start.length) >= 0
        || contents.indexOf(end, last + end.length) >= 0) {
        throw new Error(`${file} has invalid translation markers.`);
    }
    return contents.slice(0, first + start.length)
        + `\n${placeholder}\n`
        + contents.slice(last);
}

function translationDocumentSkeleton(contents, file) {
    const normalized = contents
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n');
    return replaceMarkerBody(
        replaceMarkerBody(
            normalized,
            NAME_START,
            NAME_END,
            NAME_PLACEHOLDER,
            file,
        ),
        DESCRIPTION_START,
        DESCRIPTION_END,
        DESCRIPTION_PLACEHOLDER,
        file,
    );
}

function assertTranslationText(translation, file) {
    if (translation.name === NAME_PLACEHOLDER
        || translation.description === DESCRIPTION_PLACEHOLDER) {
        throw new Error(`${file} is not translated.`);
    }
    if (translation.name.length < 2 || translation.name.length > 200
        || /[\r\n]/.test(translation.name)) {
        throw new Error(`${file} translated name must be one 2-200 character line.`);
    }
    if (translation.description.length < 1
        || translation.description.length > 4000) {
        throw new Error(
            `${file} translated description must contain 1-4000 characters.`,
        );
    }
    for (const value of [translation.name, translation.description]) {
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
            || /<\s*\/?\s*(?:script|iframe|object|embed)\b/i.test(value)
            || value.includes('DKH:TARGET-')) {
            throw new Error(`${file} contains unsafe translated text.`);
        }
    }
}

function parseTranslationMarkdown(file, expected, requireCompleted) {
    const contents = fs.readFileSync(file, 'utf8');
    const { body, values } = parseFrontMatter(contents, file);
    const exact = {
        schema: MARKDOWN_SCHEMA,
        productCode: expected.code,
        targetLocale: expected.locale,
        sourceLocale: SOURCE_LOCALE,
        sourceArtifactId: expected.sourceArtifactId,
        sourceTranslationSha256: expected.sourceTranslationSha256,
    };
    for (const [key, value] of Object.entries(exact)) {
        if (values[key] !== value) {
            throw new Error(`${file} front matter ${key} does not match source.`);
        }
    }
    if (sha256(translationDocumentSkeleton(contents, file))
        !== expected.templateStructureSha256) {
        throw new Error(`${file} protected Markdown content changed.`);
    }
    const translation = {
        lang: expected.locale,
        name: markerValue(body, NAME_START, NAME_END, file),
        description: markerValue(
            body,
            DESCRIPTION_START,
            DESCRIPTION_END,
            file,
        ),
    };
    if (requireCompleted) assertTranslationText(translation, file);
    return translation;
}

function verifyTranslationPackage(directory, options = {}) {
    const root = assertRealDirectory(directory, 'Translation package');
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
        throw new Error('Translation package manifest binding is invalid.');
    }
    const locales = targetLocales(manifest.targetLocales || []);
    if (locales.join('\n') !== manifest.targetLocales.join('\n')) {
        throw new Error('Translation package target locales are not canonical.');
    }
    if (!Array.isArray(manifest.products)
        || manifest.productCount !== source.manifest.counts.products
        || manifest.products.length !== source.manifest.counts.products) {
        throw new Error('Translation package product count is incomplete.');
    }
    const sourceByCode = new Map(
        source.bundle.products.map(product => [product.code, product]),
    );
    const sourcePathByCode = new Map(
        source.manifest.products.map(item => [item.code, item.path]),
    );
    const expectedFiles = new Set(['translation-manifest.json']);
    const translations = [];
    const seenProducts = new Set();
    for (const item of manifest.products) {
        const product = sourceByCode.get(item.code);
        if (!product || seenProducts.has(item.code)
            || item.sourceProductPath !== sourcePathByCode.get(item.code)
            || item.sourceTranslationSha256 !==
                sourceTranslationSha256(product)) {
            throw new Error(`Translation package source drift for ${item.code}.`);
        }
        seenProducts.add(item.code);
        if (!Array.isArray(item.files) || item.files.length !== locales.length) {
            throw new Error(`Translation package files are incomplete for ${item.code}.`);
        }
        const fileLocales = new Set();
        for (const entry of item.files) {
            const locale = canonicalLocale(entry.locale);
            const relativePath = String(entry.path || '');
            if (!locales.includes(locale) || fileLocales.has(locale)
                || !relativePath.startsWith(`translations/${locale}/`)
                || !relativePath.endsWith(`/${item.code}.md`)
                || !/^[a-f0-9]{64}$/.test(String(
                    entry.templateStructureSha256 || '',
                ))) {
                throw new Error(`Translation package path is invalid for ${item.code}.`);
            }
            fileLocales.add(locale);
            expectedFiles.add(relativePath);
            translations.push({
                code: item.code,
                translation: parseTranslationMarkdown(
                    path.join(root, ...relativePath.split('/')),
                    {
                        code: item.code,
                        locale,
                        sourceArtifactId: source.manifest.artifactId,
                        sourceTranslationSha256: item.sourceTranslationSha256,
                        templateStructureSha256:
                            entry.templateStructureSha256,
                    },
                    options.requireCompleted === true,
                ),
            });
        }
    }
    if (seenProducts.size !== source.manifest.counts.products) {
        throw new Error('Translation package product codes are incomplete.');
    }
    const actualFiles = walkFiles(root);
    if (actualFiles.length !== expectedFiles.size
        || actualFiles.some(file => !expectedFiles.has(file))) {
        throw new Error('Translation package contains missing or unexpected files.');
    }
    return { manifest, root, source, translations };
}

function copyTree(source, destination) {
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name);
        const destinationPath = path.join(destination, entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error(`Source artifact contains symlink ${sourcePath}.`);
        }
        if (entry.isDirectory()) {
            fs.mkdirSync(destinationPath, { recursive: true });
            copyTree(sourcePath, destinationPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(
                sourcePath,
                destinationPath,
                fs.constants.COPYFILE_FICLONE,
            );
        } else {
            throw new Error(`Source artifact contains non-file ${sourcePath}.`);
        }
    }
}

function artifactFiles(root) {
    return walkFiles(root)
        .filter(file => file !== 'artifact-manifest.json')
        .map(relativePath => {
            const contents = fs.readFileSync(
                path.join(root, ...relativePath.split('/')),
            );
            return {
                path: relativePath,
                bytes: contents.length,
                sha256: sha256(contents),
            };
        });
}

function artifactIdentity(manifest) {
    const identity = {
        files: manifest.files,
        productCodes: manifest.productCodes,
        snapshotId: manifest.snapshotId,
        source: manifest.source,
    };
    if (manifest.translationInterchange) {
        identity.translationInterchange = manifest.translationInterchange;
    }
    return sha256(stableJson(identity));
}

function importTranslationPackages(options) {
    const sourceRoot = assertRealDirectory(
        options.sourceDirectory,
        'Source Admin Console artifact',
    );
    const outputRoot = assertSeparateOutput(sourceRoot, options.outputDirectory);
    const packageRoots = [...new Set(options.packageDirectories || [])]
        .map(directory => assertRealDirectory(directory, 'Translation package'));
    if (packageRoots.length === 0) {
        throw new Error('At least one translation package is required.');
    }
    const source = verifyAdminConsoleArtifact(sourceRoot);
    const sourceProductsByCode = new Map(
        source.bundle.products.map(product => [product.code, product]),
    );
    const packages = packageRoots.map(directory =>
        verifyTranslationPackage(directory, {
            sourceRoot,
            requireCompleted: true,
        }));
    const translationsByCode = new Map();
    const targetLocaleSet = new Set();
    const packageBindings = [];
    for (const item of packages) {
        const productLocales = item.manifest.targetLocales.map(productLocale);
        for (const locale of productLocales) {
            if (targetLocaleSet.has(locale)) {
                throw new Error(`Target locale ${locale} appears in multiple packages.`);
            }
            targetLocaleSet.add(locale);
        }
        const normalizedEntries = item.translations.map(entry => {
            const product = sourceProductsByCode.get(entry.code);
            if (!product) {
                throw new Error(`Translation references unknown product ${entry.code}.`);
            }
            const lang = productLocale(entry.translation.lang);
            return {
                code: entry.code,
                translation: {
                    ...entry.translation,
                    lang,
                    name: localizedProductName(
                        entry.translation.name,
                        product.nativeName,
                        lang,
                    ),
                },
            };
        });
        const content = normalizedEntries;
        packageBindings.push({
            packageId: item.manifest.packageId,
            targetLocales: productLocales,
            translationContentSha256: sha256(stableJson(content)),
        });
        for (const entry of normalizedEntries) {
            if (!translationsByCode.has(entry.code)) {
                translationsByCode.set(entry.code, []);
            }
            translationsByCode.get(entry.code).push(entry.translation);
        }
    }
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
                throw new Error(`${item.path} must contain exactly one product.`);
            }
            const product = records[0];
            const incoming = translationsByCode.get(item.code) || [];
            if (incoming.length !== targetLocaleSet.size) {
                throw new Error(`Translations are incomplete for ${item.code}.`);
            }
            const incomingLocales = new Set(incoming.map(entry => entry.lang));
            const preserved = (product.translations || [])
                .filter(entry => !incomingLocales.has(entry.lang));
            product.translations = [...preserved, ...incoming]
                .sort((left, right) => left.lang.localeCompare(right.lang));
            product.replaceTranslations = true;
            fs.writeFileSync(
                productFile,
                `${JSON.stringify(records, null, 2)}\n`,
            );
        }
        manifest = readJson(path.join(stagingDirectory, 'artifact-manifest.json'));
        const allLocales = [...new Set([
            ...(manifest.requiredLocales || []),
            ...targetLocaleSet,
        ])].sort();
        const previousHumanLocales =
            manifest.localization?.humanTranslatedLocales || [];
        manifest.requiredLocales = allLocales;
        manifest.localization = {
            ...(manifest.localization || {}),
            humanTranslatedLocales: [...new Set([
                ...previousHumanLocales,
                ...targetLocaleSet,
            ])].sort(),
        };
        manifest.translationInterchange = {
            packages: packageBindings.sort((left, right) =>
                left.packageId.localeCompare(right.packageId)),
            sourceArtifactId: source.manifest.artifactId,
            targetLocales: [...targetLocaleSet].sort(),
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
    };
}

function normalizeProductTranslationLocales(options) {
    const sourceRoot = assertRealDirectory(
        options.sourceDirectory,
        'Source Admin Console artifact',
    );
    const outputRoot = assertSeparateOutput(sourceRoot, options.outputDirectory);
    const source = verifyAdminConsoleArtifact(sourceRoot);
    let manifest;
    withStagedOutput(outputRoot, stagingDirectory => {
        copyTree(sourceRoot, stagingDirectory);
        const productByCode = new Map();
        for (const item of source.manifest.products) {
            const productFile = path.join(
                stagingDirectory,
                ...item.path.split('/'),
            );
            const records = readJson(productFile);
            if (!Array.isArray(records) || records.length !== 1) {
                throw new Error(`${item.path} must contain exactly one product.`);
            }
            const product = records[0];
            const translations = (product.translations || []).map(entry => {
                const lang = productLocale(entry.lang);
                return {
                    ...entry,
                    lang,
                    name: localizedProductName(
                        entry.name,
                        product.nativeName,
                        lang,
                    ),
                };
            });
            const locales = translations.map(entry => entry.lang);
            if (new Set(locales).size !== locales.length) {
                throw new Error(
                    `Product ${item.code} has colliding ProductCatalog locales.`,
                );
            }
            product.translations = translations.sort((left, right) =>
                left.lang.localeCompare(right.lang));
            productByCode.set(item.code, product);
            fs.writeFileSync(
                productFile,
                `${JSON.stringify(records, null, 2)}\n`,
            );
        }
        manifest = readJson(path.join(stagingDirectory, 'artifact-manifest.json'));
        manifest.requiredLocales = mappedLocales(
            manifest.requiredLocales || [],
            'Artifact requiredLocales',
        );
        manifest.localization = {
            ...(manifest.localization || {}),
            humanTranslatedLocales: mappedLocales(
                manifest.localization?.humanTranslatedLocales || [],
                'Artifact humanTranslatedLocales',
            ),
        };
        if (manifest.translationInterchange) {
            const packages = manifest.translationInterchange.packages.map(binding => {
                const locales = mappedLocales(
                    binding.targetLocales || [],
                    `Translation package ${binding.packageId}`,
                );
                const content = [];
                for (const item of source.manifest.products) {
                    const product = productByCode.get(item.code);
                    for (const locale of locales) {
                        const translation = product.translations.find(entry =>
                            entry.lang === locale);
                        if (!translation) {
                            throw new Error(
                                `Translation ${locale} is missing for ${item.code}.`,
                            );
                        }
                        content.push({ code: item.code, translation });
                    }
                }
                return {
                    ...binding,
                    targetLocales: locales,
                    translationContentSha256: sha256(stableJson(content)),
                };
            });
            manifest.translationInterchange = {
                ...manifest.translationInterchange,
                packages,
                targetLocales: mappedLocales(
                    manifest.translationInterchange.targetLocales || [],
                    'Artifact translationInterchange.targetLocales',
                ),
            };
        }
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
    return { manifest, outputDirectory: outputRoot };
}

module.exports = {
    DESCRIPTION_END,
    DESCRIPTION_PLACEHOLDER,
    DESCRIPTION_START,
    MARKDOWN_SCHEMA,
    NAME_END,
    NAME_PLACEHOLDER,
    NAME_START,
    PACKAGE_KIND,
    PACKAGE_SCHEMA_VERSION,
    SOURCE_LOCALE,
    archiveTranslationSource,
    artifactFiles,
    artifactIdentity,
    assertRealDirectory,
    assertSeparateOutput,
    canonicalLocale,
    copyTree,
    importTranslationPackages,
    localizedProductName,
    normalizeProductTranslationLocales,
    parseTranslationMarkdown,
    productLocale,
    sourceTranslation,
    sourceTranslationSha256,
    targetLocales,
    translationDocumentSkeleton,
    verifyTranslationPackage,
    walkFiles,
    writeTranslationPackage,
};
