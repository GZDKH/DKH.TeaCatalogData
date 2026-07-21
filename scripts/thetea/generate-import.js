#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, loadDotEnv, parseArgs, csv, requireArg } = require('./lib/env');
const { productCodeForCardSet, transformCardSet } = require('./lib/transform');
const { writeReport } = require('./lib/report');
const { flattenCategories, loadCatalogReference } = require('./lib/catalog-mapping');
const { canonicalLocale, toProductLocale } = require('./lib/locales');
const { applyFieldDetails } = require('./lib/field-details');
const { buildTheTeaCategories } = require('./lib/category-taxonomy');
const { buildCatalogBindingCatalog, defaultCatalogTranslations } = require('./lib/catalog-bindings');
const { assertCompleteFieldLocales } = require('./lib/snapshot-options');
const { buildSpecificationDefinitions } = require('./lib/spec-definitions');
const { validateArtifact } = require('./lib/artifact-validator');
const { assertScopedPath, withStagedOutput } = require('./lib/generated-output');
const {
    createArtifactManifest,
    readArtifactBundle,
    sha256,
    writeJson,
} = require('./lib/artifact-bundle');
const { normalizeProductForImport } = require('./lib/import-contract');
const { overlayExistingProduct } = require('./lib/product-overlay');
const { loadVerifiedProductReference } = require('./lib/product-reference');

loadDotEnv();

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function safeFolder(value) {
    return String(value || 'UNCATEGORIZED')
        .toUpperCase()
        .replace(/[^A-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'UNCATEGORIZED';
}

function repoPath(value) {
    if (!value) return null;
    return path.isAbsolute(String(value)) ? String(value) : path.join(REPO_ROOT, String(value));
}

function walkFiles(dir, predicate = () => true) {
    if (!fs.existsSync(dir)) return [];
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Input reference must not contain symlinks: ${full}`);
        if (entry.isDirectory()) files.push(...walkFiles(full, predicate));
        else if (entry.isFile() && predicate(full)) files.push(full);
    }
    return files.sort();
}

function walkJson(dir) {
    return walkFiles(dir, file => file.endsWith('.json'));
}

function readFieldDetails(snapshotRoot, lang, slug) {
    const dir = path.join(snapshotRoot, 'raw', 'fields', lang, slug);
    return walkJson(dir).map(file => {
        const rel = path.relative(dir, file).split(path.sep);
        return {
            section: rel.length > 1 ? rel[0] : undefined,
            field: path.basename(file, '.json'),
            payload: readJson(file),
        };
    });
}

function readTextIfExists(file) {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function readSimilar(snapshotRoot, lang, slug) {
    const file = path.join(snapshotRoot, 'raw', 'similar', lang, `${slug}.json`);
    return fs.existsSync(file) ? readJson(file) : null;
}

function assertSafeSlug(value) {
    const slug = String(value || '').trim();
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) {
        throw new Error(`Unsafe or invalid TheTea slug '${value}'.`);
    }
    return slug;
}

function loadCardSet({
    snapshotRoot,
    manifest,
    langs,
    slug,
    allowMissingFieldDetails,
    allowMissingMarkdown,
    warnings,
}) {
    const cardSet = {};
    for (const lang of langs) {
        const file = path.join(snapshotRoot, 'raw', 'cards', lang, `${slug}.json`);
        if (!fs.existsSync(file)) continue;

        const card = readJson(file);
        const fieldDetails = readFieldDetails(snapshotRoot, lang, slug);
        const fieldLangs = Array.isArray(manifest.fieldLangs) ? manifest.fieldLangs : null;
        const fieldsExpectedForLang = fieldLangs === null || fieldLangs.includes(lang);
        if (!fieldDetails.length && !allowMissingFieldDetails && fieldsExpectedForLang) {
            warnings.push(`No field detail endpoint files found for ${slug}/${lang}.`);
        }
        const enriched = fieldDetails.length ? applyFieldDetails(card, fieldDetails) : card;
        const markdown = readTextIfExists(
            path.join(snapshotRoot, 'raw', 'markdown', lang, `${slug}.md`));
        if (markdown) enriched.markdown = markdown;
        else if (!allowMissingMarkdown) {
            warnings.push(`No markdown endpoint file found for ${slug}/${lang}.`);
        }

        const similar = readSimilar(snapshotRoot, lang, slug);
        if (similar) enriched.similarEndpoint = similar;
        cardSet[lang] = enriched;
    }
    return cardSet;
}

function primaryCard(cardSet, langs) {
    return cardSet.en || cardSet['en-US'] || cardSet[langs[0]] || Object.values(cardSet)[0];
}

function loadPrimaryCard(snapshotRoot, langs, slug) {
    const orderedLangs = [...new Set(['en', 'en-US', ...langs])];
    for (const lang of orderedLangs) {
        const file = path.join(snapshotRoot, 'raw', 'cards', lang, `${slug}.json`);
        if (fs.existsSync(file)) return readJson(file);
    }
    return null;
}

function hashInputPath(inputPath) {
    if (!inputPath) return '';
    const stat = fs.lstatSync(inputPath);
    if (stat.isSymbolicLink()) throw new Error(`Input reference must not be a symlink: ${inputPath}`);
    const files = stat.isDirectory() ? walkFiles(inputPath) : [inputPath];
    const hash = require('crypto').createHash('sha256');
    for (const file of files) {
        const relative = stat.isDirectory() ? path.relative(inputPath, file) : path.basename(file);
        hash.update(relative.split(path.sep).join('/'));
        hash.update('\0');
        hash.update(sha256(fs.readFileSync(file)));
        hash.update('\n');
    }
    return hash.digest('hex');
}

function hashSnapshotFiles(snapshotRoot, manifest) {
    const rootStat = fs.lstatSync(snapshotRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
        throw new Error(`Snapshot root must be a real directory, not a symlink: ${snapshotRoot}`);
    }
    const files = [...new Set(manifest.files || [])].sort();
    if (!files.length) throw new Error('Snapshot manifest has no source file inventory.');
    const hash = require('crypto').createHash('sha256');
    for (const relativePath of files) {
        const file = resolveSnapshotPath(snapshotRoot, relativePath);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
            throw new Error(`Snapshot source file from manifest is missing: ${relativePath}`);
        }
        hash.update(String(relativePath).split(path.sep).join('/'));
        hash.update('\0');
        hash.update(sha256(fs.readFileSync(file)));
        hash.update('\n');
    }
    return hash.digest('hex');
}

function resolveSnapshotPath(snapshotRoot, relativePath) {
    if (path.isAbsolute(relativePath)) throw new Error(`Snapshot manifest path must be relative: ${relativePath}`);
    const resolvedRoot = path.resolve(snapshotRoot);
    const resolved = path.resolve(resolvedRoot, relativePath);
    if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(`Snapshot manifest path escapes snapshot root: ${relativePath}`);
    }
    let current = resolvedRoot;
    for (const segment of path.relative(resolvedRoot, resolved).split(path.sep)) {
        current = path.join(current, segment);
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
            throw new Error(`Snapshot manifest path contains a symlink: ${relativePath}`);
        }
    }
    const realRoot = fs.realpathSync(resolvedRoot);
    const realFile = fs.realpathSync(resolved);
    if (!realFile.startsWith(`${realRoot}${path.sep}`)) {
        throw new Error(`Snapshot manifest path resolves outside snapshot root: ${relativePath}`);
    }
    return realFile;
}

function assertGeneratorOutputPath(outputPath) {
    return assertScopedPath(outputPath, {
        repoRoot: REPO_ROOT,
        allowedRoot: path.join(REPO_ROOT, 'import', 'thetea'),
        allowedDescription: 'import/thetea/',
        label: 'Generated output',
    });
}

function productRelativePath(product, primary) {
    const categoryFolder = safeFolder(primary?.meta?.category_code || product.catalogs?.[0]?.category);
    return path.posix.join('04-products', categoryFolder, `${product.code}.json`);
}

function writeGeneratedBundle(stagingRoot, artifact) {
    writeJson(path.join(stagingRoot, '03-categories', 'categories.json'), artifact.categories);
    writeJson(
        path.join(stagingRoot, '02-specifications', 'specification_groups.json'),
        artifact.definitions.groups);
    writeJson(
        path.join(stagingRoot, '02-specifications', 'specification_attributes.json'),
        artifact.definitions.attributes);
    writeJson(
        path.join(stagingRoot, '02-specifications', 'specification_attribute_options.json'),
        artifact.definitions.options);
    writeJson(path.join(stagingRoot, '01-reference', 'catalogs.json'), [artifact.catalog]);
    writeJson(path.join(stagingRoot, '05-catalog-bindings', 'catalogs.json'), [artifact.catalogBinding]);
    writeRoutedRecords(stagingRoot, 'articles', artifact.routedContent.articles);
    writeRoutedRecords(stagingRoot, 'metaobjects', artifact.routedContent.metaobjects);

    for (const record of artifact.productRecords) {
        writeJson(path.join(stagingRoot, ...record.relativePath.split('/')), [record.product]);
    }

    const manifest = createArtifactManifest(stagingRoot, {
        snapshotId: artifact.snapshotId,
        sourceManifestSha256: artifact.sourceManifestSha256,
        sourceFilesSha256: artifact.sourceFilesSha256,
        catalogReferenceSha256: artifact.catalogReferenceSha256,
        baselineReferenceSha256: artifact.baselineReferenceSha256,
        generatedAt: artifact.generatedAt,
        requiredLocales: artifact.requiredLocales,
        productCodes: artifact.products.map(product => product.code),
        products: artifact.productRecords.map(record => ({
            code: record.product.code,
            path: record.relativePath,
        })),
        lossEvents: artifact.lossEvents,
        localization: artifact.definitions.localization,
    });
    const reloaded = readArtifactBundle(stagingRoot);
    if (!reloaded.valid) {
        throw new Error(`Staged artifact integrity validation failed:\n${reloaded.errors.join('\n')}`);
    }
    return manifest;
}

function writeRoutedRecords(stagingRoot, kind, records) {
    const index = [];
    for (const record of records) {
        const relativePath = path.posix.join(
            '06-routed-content',
            kind,
            'records',
            `${record.code}.json`);
        writeJson(path.join(stagingRoot, ...relativePath.split('/')), [record]);
        index.push({ code: record.code, path: relativePath });
    }
    writeJson(
        path.join(stagingRoot, '06-routed-content', kind, 'index.json'),
        index.sort((a, b) => a.code.localeCompare(b.code)));
}

function main() {
    const args = parseArgs();
    const snapshotId = requireArg(args, 'snapshot');
    const snapshotRoot = args['snapshot-root']
        ? path.resolve(REPO_ROOT, String(args['snapshot-root']))
        : path.join(REPO_ROOT, 'sources', 'thetea', 'snapshots', snapshotId);
    const manifestPath = path.join(snapshotRoot, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`Snapshot manifest not found: ${manifestPath}`);

    const outDir = assertGeneratorOutputPath(path.resolve(
        REPO_ROOT,
        args.out ? String(args.out) : path.join('import', 'thetea', snapshotId)));
    const catalogReferencePath = repoPath(args['catalog-ref'] || args['prod-ref']);
    const productReferencePath = repoPath(args['product-ref']);
    if (!catalogReferencePath && args['allow-missing-catalog-reference'] !== true) {
        throw new Error('Safe generation requires --catalog-ref=...; use --allow-missing-catalog-reference only for diagnostics.');
    }
    if (!productReferencePath && args['allow-missing-product-reference'] !== true) {
        throw new Error('Safe generation requires a full products DataExchange --product-ref=... to preserve replace-mode collections; use --allow-missing-product-reference only for diagnostics.');
    }

    const catalogReference = catalogReferencePath ? loadCatalogReference(catalogReferencePath) : null;
    if (catalogReference && !catalogReference.geography?.states?.length) {
        throw new Error('Production catalog reference has no geography snapshot. Re-fetch it with fetch-prod-reference.js before generation.');
    }
    const baselineReference = productReferencePath
        ? loadVerifiedProductReference(productReferencePath)
        : null;
    const baselineProducts = baselineReference?.products || [];
    const baselineByCode = new Map(baselineProducts.map(product => [normalizeCode(product.code), product]));
    const manifest = readJson(manifestPath);
    const requestedLangs = csv(args.langs);
    const langs = requestedLangs.length
        ? requestedLangs.map(canonicalLocale)
        : (manifest.langs || ['en']).map(canonicalLocale);
    const requiredLocales = [...new Set(langs.map(toProductLocale).filter(Boolean))];
    const allowMissingFieldDetails = args['allow-missing-field-details'] === true;
    if (!allowMissingFieldDetails && (manifest.includeFields === false || !manifest.fieldFiles?.length)) {
        throw new Error('Snapshot has no per-field endpoint details. Re-fetch without --skip-fields or pass --allow-missing-field-details for diagnostics only.');
    }
    if (!allowMissingFieldDetails && args['allow-partial-field-locales'] !== true) {
        assertCompleteFieldLocales({ langs, fieldLangs: manifest.fieldLangs });
    }
    const allowMissingMarkdown = args['allow-missing-markdown'] === true;
    if (!allowMissingMarkdown && manifest.includeMarkdown === false) {
        throw new Error('Snapshot has no markdown endpoint pages. Re-fetch without --skip-md or pass --allow-missing-markdown for diagnostics only.');
    }

    const warnings = [];
    const records = [];
    const slugs = new Set();
    const codes = new Set();
    for (const rawSlug of manifest.slugs || []) {
        const slug = assertSafeSlug(rawSlug);
        const slugKey = slug.toLowerCase();
        if (slugs.has(slugKey)) throw new Error(`Duplicate normalized slug '${slug}' in snapshot manifest.`);
        slugs.add(slugKey);

        const primary = loadPrimaryCard(snapshotRoot, langs, slug);
        if (!primary) {
            warnings.push(`No cards found for slug ${slug}; skipped.`);
            continue;
        }
        const code = productCodeForCardSet({ [primary.lang || 'en']: primary });
        if (codes.has(code)) throw new Error(`Duplicate generated product code ${code}.`);
        codes.add(code);
        records.push({
            slug,
            code,
            primary: { slug: primary.slug, meta: primary.meta, tags: primary.tags },
        });
    }
    if (!records.length) throw new Error('Snapshot did not produce any card sets.');
    records.sort((a, b) => a.code.localeCompare(b.code));

    if (baselineReference) {
        const baselineCodes = new Set(baselineProducts.map(product => normalizeCode(product.code)));
        const missingBaselineCodes = records
            .map(record => record.code)
            .filter(code => !baselineCodes.has(normalizeCode(code)));
        if (missingBaselineCodes.length) {
            throw new Error(
                `Full production baseline does not contain ${missingBaselineCodes.length} resync product(s): ${missingBaselineCodes.slice(0, 10).join(', ')}. New-product creation is outside this resync workflow.`);
        }
    }

    const productCodeBySlug = new Map(records.map(record => [record.slug.toLowerCase(), record.code]));
    const existingCategoryCodes = catalogReference
        ? new Set(flattenCategories(catalogReference.categories || [])
            .map(category => normalizeCode(category.code))
            .filter(Boolean))
        : null;
    const catalogCode = String(args.catalog || 'CATALOG-CHINESE-TEA').toUpperCase();
    const products = [];
    const primaryCards = [];
    const definitionObservationMap = new Map();
    const lossEvents = [];
    const routedContent = { articles: [], metaobjects: [] };
    const productRecords = [];

    for (const [index, record] of records.entries()) {
        const cardSet = loadCardSet({
            snapshotRoot,
            manifest,
            langs,
            slug: record.slug,
            allowMissingFieldDetails,
            allowMissingMarkdown,
            warnings,
        });
        const transformed = transformCardSet(cardSet, {
            publish: args.publish === true,
            publishExisting: args.publish === true,
            packages: args.packages || 'default',
            order: index + 1,
            productCodeBySlug,
            catalog: catalogCode,
            knownCategories: existingCategoryCodes || new Set(),
            geographyReference: catalogReference?.geography,
        });
        warnings.push(...transformed.warnings);
        collectDefinitionObservations(definitionObservationMap, transformed.definitionObservations);
        lossEvents.push(...transformed.lossEvents.map(event => ({
            ...event,
            product: transformed.product.code,
        })));
        routedContent.articles.push(...transformed.routedContent.articles);
        routedContent.metaobjects.push(...transformed.routedContent.metaobjects);

        const baseline = baselineByCode.get(normalizeCode(transformed.product.code));
        const product = overlayExistingProduct(transformed.product, baseline, {
            publishExisting: args.publish === true,
        });
        normalizeProductForImport(product);
        products.push(product);
        primaryCards.push(record.primary);
        productRecords.push({
            product,
            relativePath: productRelativePath(product, record.primary),
        });
    }

    const family = fs.existsSync(path.join(snapshotRoot, 'raw', 'family.json'))
        ? readJson(path.join(snapshotRoot, 'raw', 'family.json'))
        : null;
    const categories = buildTheTeaCategories(primaryCards, { family, existingCategoryCodes });
    const definitions = buildSpecificationDefinitions(products, {
        observations: [...definitionObservationMap.values()],
        locales: requiredLocales,
    });
    const catalogCurrency = args.currency || 'CNY';
    const catalogTranslations = defaultCatalogTranslations();
    const catalog = {
        code: catalogCode,
        currency: catalogCurrency,
        order: 0,
        published: true,
        translations: catalogTranslations,
    };
    const catalogBinding = buildCatalogBindingCatalog({
        catalogCode,
        currency: catalogCurrency,
        translations: catalogTranslations,
        categories,
        products,
    });

    const validation = validateArtifact({
        products,
        definitions,
        requiredLocales,
        lossEvents,
        routedContent,
        catalogReference,
        requiredCatalogCode: catalogCode,
        baselineProducts,
    });
    const generatedAt = new Date().toISOString();
    const sourceManifestSha256 = sha256(fs.readFileSync(manifestPath));
    const sourceFilesSha256 = hashSnapshotFiles(snapshotRoot, manifest);
    const baselineReferenceSha256 = hashInputPath(productReferencePath);
    const catalogReferenceSha256 = hashInputPath(catalogReferencePath);
    const summary = {
        snapshotId,
        generatedAt,
        outputDir: outDir,
        valid: validation.valid,
        productCount: validation.productCount,
        languageCoverage: validation.languageCoverage,
        specTypes: validation.specTypes,
        specificationDefinitionCounts: validation.definitionCounts,
        specificationLocalization: definitions.localization,
        localeCoverage: validation.localeCoverage,
        relations: validation.relationCounts,
        lossEvents,
        routedContentCounts: validation.routedContentCounts,
        catalogMapping: validation.catalogMapping,
        categoryDefinitionCount: categories.length,
        categoryDefinitionMode: existingCategoryCodes ? 'missing-from-catalog-ref' : 'full-generated-taxonomy',
        catalogBindingCategoryCount: catalogBinding.categories.length,
        catalogBindingProductAssignmentCount: catalogBinding.categories
            .reduce((sum, category) => sum + category.products.length, 0),
        fieldDetailFiles: manifest.fieldFiles?.length || 0,
        missingFieldDetailFiles: manifest.missingFieldDetailFiles?.length || 0,
        markdownFiles: manifest.markdownFiles?.length || 0,
        similarFiles: manifest.similarFiles?.length || 0,
        sourceManifestSha256,
        sourceFilesSha256,
        baselineReferenceSha256,
        catalogReferenceSha256,
        baselineProductCount: baselineProducts.length,
        overlaidProductCount: products.filter(product => baselineByCode.has(normalizeCode(product.code))).length,
        errors: validation.errors,
        warnings: [...warnings, ...validation.warnings],
    };

    let artifactManifest = null;
    if (summary.valid) {
        artifactManifest = withStagedOutput(outDir, stagingRoot => writeGeneratedBundle(stagingRoot, {
            snapshotId,
            generatedAt,
            sourceManifestSha256,
            sourceFilesSha256,
            baselineReferenceSha256,
            catalogReferenceSha256,
            requiredLocales,
            products,
            productRecords,
            definitions,
            categories,
            catalog,
            catalogBinding,
            lossEvents,
            routedContent,
        }));
        summary.artifactFileCount = artifactManifest.files.length;
    }

    const reportDir = path.join(REPO_ROOT, 'reports', 'thetea', snapshotId);
    writeReport(reportDir, summary);
    console.log(`Generated products: ${products.length}`);
    console.log(`Output: ${summary.valid ? outDir : 'not replaced (validation failed)'}`);
    console.log(`Report: ${reportDir}`);
    console.log(`Errors: ${summary.errors.length}`);
    console.log(`Warnings: ${summary.warnings.length}`);
    if (summary.errors.length) {
        for (const error of summary.errors.slice(0, 10)) console.log(`ERROR: ${error}`);
        process.exitCode = 1;
    }
    return { summary, artifactManifest };
}

function collectDefinitionObservations(target, observations) {
    for (const observation of observations || []) {
        const compact = Object.fromEntries(Object.entries(observation)
            .filter(([key, value]) => value !== undefined
                && !['value', 'valueMin', 'valueMax', 'showOnPage'].includes(key)));
        const key = [compact.group, compact.attribute, compact.option || '', compact.lang || '']
            .map(value => String(value || '').toUpperCase())
            .join('|');
        const existing = target.get(key);
        if (!existing) {
            target.set(key, compact);
            continue;
        }
        if (definitionObservationSignature(existing) !== definitionObservationSignature(compact)) {
            throw new Error(`Conflicting definition observation for ${key}.`);
        }
        if (Number.isInteger(compact.order)
            && (!Number.isInteger(existing.order) || compact.order < existing.order)) {
            existing.order = compact.order;
        }
    }
}

function definitionObservationSignature(value) {
    const comparable = { ...value };
    delete comparable.order;
    return JSON.stringify(Object.fromEntries(Object.entries(comparable).sort(([a], [b]) => a.localeCompare(b))));
}

function normalizeCode(value) {
    const code = value && typeof value === 'object' ? value.code : value;
    return String(code || '').trim().toUpperCase();
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = {
    assertGeneratorOutputPath,
    assertSafeSlug,
    hashSnapshotFiles,
    hashInputPath,
    main,
    productRelativePath,
    writeGeneratedBundle,
};
