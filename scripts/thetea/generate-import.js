#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, loadDotEnv, parseArgs, csv, requireArg } = require('./lib/env');
const { transformCardSet } = require('./lib/transform');
const { validateProducts, writeReport } = require('./lib/report');
const { flattenCategories, loadCatalogReference } = require('./lib/catalog-mapping');
const { canonicalLocale } = require('./lib/locales');
const { applyFieldDetails } = require('./lib/field-details');
const { buildTheTeaCategories } = require('./lib/category-taxonomy');
const { buildCatalogBindingCatalog, defaultCatalogTranslations } = require('./lib/catalog-bindings');
const { assertCompleteFieldLocales } = require('./lib/snapshot-options');
const { buildSpecificationDefinitions } = require('./lib/spec-definitions');

loadDotEnv();

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, ''));
}

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function safeFolder(value) {
    return String(value || 'UNCATEGORIZED')
        .toUpperCase()
        .replace(/[^A-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function repoPath(value) {
    if (!value) return null;
    return path.isAbsolute(String(value)) ? String(value) : path.join(REPO_ROOT, String(value));
}

function walkJson(dir) {
    if (!fs.existsSync(dir)) return [];
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walkJson(full));
        else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full);
    }
    return files.sort();
}

function readFieldDetails(snapshotRoot, lang, slug) {
    const dir = path.join(snapshotRoot, 'raw', 'fields', lang, slug);
    return walkJson(dir).map(file => {
        const rel = path.relative(dir, file).split(path.sep);
        const field = path.basename(file, '.json');
        const section = rel.length > 1 ? rel[0] : undefined;
        return {
            section,
            field,
            payload: readJson(file),
        };
    });
}

function readTextIfExists(file) {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

function readSimilar(snapshotRoot, lang, slug) {
    const file = path.join(snapshotRoot, 'raw', 'similar', lang, `${slug}.json`);
    return fs.existsSync(file) ? readJson(file) : null;
}

function truncateText(value, maxLength) {
    if (typeof value !== 'string' || value.length <= maxLength) return value;
    return value.slice(0, maxLength).replace(/\s+\S*$/, '').trimEnd();
}

function normalizeAltitudeValue(value) {
    if (value === null || value === undefined || value === '') return undefined;
    const numeric = typeof value === 'number'
        ? value
        : Number(String(value).replace(/,/g, '').trim());
    if (!Number.isFinite(numeric)) return undefined;

    const meters = Math.abs(numeric) > 0 && Math.abs(numeric) < 10
        ? numeric * 1000
        : numeric;
    const rounded = Math.round(meters);
    if (rounded < -2147483648 || rounded > 2147483647) return undefined;
    return rounded;
}

function normalizeProductForImport(product) {
    product.code = truncateText(product.code, 100);
    product.sku = truncateText(product.sku, 100);
    product.mpn = truncateText(product.mpn, 100);
    product.gtin = truncateText(product.gtin, 100);
    product.nativeName = truncateText(product.nativeName, 500);
    product.transcription = truncateText(product.transcription, 500);

    for (const translation of product.translations || []) {
        translation.lang = truncateText(translation.lang, 10);
        translation.name = truncateText(translation.name, 256);
        translation.transcription = truncateText(translation.transcription, 500);
        translation.seo = truncateText(translation.seo, 256);
        translation.metaTitle = truncateText(translation.metaTitle, 128);
        translation.metaDescription = truncateText(translation.metaDescription, 1024);
        translation.description = truncateText(translation.description, 2000);
    }

    for (const origin of product.origins || []) {
        origin.country = truncateText(origin.country, 10);
        origin.state = truncateText(origin.state, 50);
        origin.city = truncateText(origin.city, 50);

        if (origin.altitude) {
            const min = normalizeAltitudeValue(origin.altitude.min);
            const max = normalizeAltitudeValue(origin.altitude.max);
            if (min === undefined && max === undefined) {
                delete origin.altitude;
            } else {
                origin.altitude.min = min;
                origin.altitude.max = max;
                origin.altitude.unit = truncateText(origin.altitude.unit, 10);
            }
        }

        for (const translation of origin.translations || []) {
            translation.lang = truncateText(translation.lang, 10);
            translation.place = truncateText(translation.place, 500);
        }
    }

    const specs = [];
    const seenAttributes = new Set();
    const seenAttributeNames = new Set();
    for (const spec of product.specifications || []) {
        const attribute = String(spec.attribute || '').toUpperCase();
        const lang = String(spec.lang || '').trim().toLowerCase();
        const attributeName = String(spec.attributeName || '').trim().toLowerCase();
        const attributeNameKey = attributeName ? `${lang}|${attributeName}` : '';
        if (!attribute || seenAttributes.has(attribute) || (attributeNameKey && seenAttributeNames.has(attributeNameKey))) {
            continue;
        }
        seenAttributes.add(attribute);
        if (attributeNameKey) seenAttributeNames.add(attributeNameKey);
        if (typeof spec.value === 'string') {
            spec.value = truncateText(spec.value, 4000);
        }
        specs.push(spec);
    }
    product.specifications = specs;

    return product;
}

function main() {
    const args = parseArgs();
    const snapshotId = requireArg(args, 'snapshot');
    const snapshotRoot = path.join(REPO_ROOT, 'sources', 'thetea', 'snapshots', snapshotId);
    const manifestPath = path.join(snapshotRoot, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Snapshot manifest not found: ${manifestPath}`);
    }

    const outDir = path.resolve(REPO_ROOT, args.out ? String(args.out) : path.join('import', 'thetea', snapshotId));
    const catalogReferencePath = args['catalog-ref'] || args['prod-ref'];
    const catalogReference = catalogReferencePath ? loadCatalogReference(repoPath(catalogReferencePath)) : null;
    const manifest = readJson(manifestPath);
    const requestedLangs = csv(args.langs);
    const langs = requestedLangs.length
        ? requestedLangs.map(canonicalLocale)
        : (manifest.langs || ['en']);
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
    const products = [];
    const primaryCards = [];
    const warnings = [];
    const family = fs.existsSync(path.join(snapshotRoot, 'raw', 'family.json'))
        ? readJson(path.join(snapshotRoot, 'raw', 'family.json'))
        : null;

    for (const slug of manifest.slugs || []) {
        const cardSet = {};
        for (const lang of langs) {
            const file = path.join(snapshotRoot, 'raw', 'cards', lang, `${slug}.json`);
            if (fs.existsSync(file)) {
                const card = readJson(file);
                const fieldDetails = readFieldDetails(snapshotRoot, lang, slug);
                const fieldLangs = Array.isArray(manifest.fieldLangs) ? manifest.fieldLangs : null;
                const fieldsExpectedForLang = fieldLangs === null || fieldLangs.includes(lang);
                if (!fieldDetails.length && !allowMissingFieldDetails && fieldsExpectedForLang) {
                    warnings.push(`No field detail endpoint files found for ${slug}/${lang}.`);
                }
                const enriched = fieldDetails.length ? applyFieldDetails(card, fieldDetails) : card;
                const markdown = readTextIfExists(path.join(snapshotRoot, 'raw', 'markdown', lang, `${slug}.md`));
                if (markdown) enriched.markdown = markdown;
                else if (!allowMissingMarkdown) warnings.push(`No markdown endpoint file found for ${slug}/${lang}.`);

                const similar = readSimilar(snapshotRoot, lang, slug);
                if (similar) enriched.similarEndpoint = similar;
                cardSet[lang] = enriched;
            }
        }

        if (!cardSet.en && Object.keys(cardSet).length === 0) {
            warnings.push(`No cards found for slug ${slug}; skipped.`);
            continue;
        }

        const { product, warnings: productWarnings } = transformCardSet(cardSet, {
            publish: args.publish === true,
            packages: args.packages || 'default',
            order: products.length + 1,
        });
        warnings.push(...productWarnings);
        normalizeProductForImport(product);
        products.push(product);
        primaryCards.push(cardSet.en || cardSet[langs[0]] || Object.values(cardSet)[0]);

        const categoryFolder = safeFolder(cardSet.en?.meta?.category_code || product.catalogs?.[0]?.category);
        const file = path.join(outDir, '04-products', categoryFolder, `${slug}.json`);
        writeJson(file, [product]);
    }

    const existingCategoryCodes = catalogReference
        ? new Set(flattenCategories(catalogReference.categories || [])
            .map(category => String(category.code || '').toUpperCase())
            .filter(Boolean))
        : null;
    const categories = buildTheTeaCategories(primaryCards, { family, existingCategoryCodes });
    writeJson(path.join(outDir, '03-categories', 'categories.json'), categories);
    const specificationDefinitions = buildSpecificationDefinitions(products);
    writeJson(
        path.join(outDir, '02-specifications', 'specification_groups.json'),
        specificationDefinitions.groups);
    writeJson(
        path.join(outDir, '02-specifications', 'specification_attributes.json'),
        specificationDefinitions.attributes);
    writeJson(
        path.join(outDir, '02-specifications', 'specification_attribute_options.json'),
        specificationDefinitions.options);

    const catalogCode = args.catalog || 'CATALOG-CHINESE-TEA';
    const catalogCurrency = args.currency || 'CNY';
    const catalogTranslations = defaultCatalogTranslations();
    writeJson(path.join(outDir, '01-reference', 'catalogs.json'), [{
        code: catalogCode,
        currency: catalogCurrency,
        order: 0,
        published: true,
        translations: catalogTranslations,
    }]);
    const catalogBinding = buildCatalogBindingCatalog({
        catalogCode,
        currency: catalogCurrency,
        translations: catalogTranslations,
        categories,
        products,
    });
    writeJson(path.join(outDir, '05-catalog-bindings', 'catalogs.json'), [catalogBinding]);

    const validation = validateProducts(products, {
        catalogReference,
        requiredCatalogCode: args.catalog || 'CATALOG-CHINESE-TEA',
    });
    const summary = {
        snapshotId,
        generatedAt: new Date().toISOString(),
        outputDir: outDir,
        valid: validation.valid,
        productCount: products.length,
        languageCoverage: validation.languageCoverage,
        specTypes: validation.specTypes,
        specificationDefinitionCounts: {
            groups: specificationDefinitions.groups.length,
            attributes: specificationDefinitions.attributes.length,
            options: specificationDefinitions.options.length,
        },
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
        errors: validation.errors,
        warnings: [...warnings, ...validation.warnings],
    };

    const reportDir = path.join(REPO_ROOT, 'reports', 'thetea', snapshotId);
    writeReport(reportDir, summary);

    console.log(`Generated products: ${products.length}`);
    console.log(`Output: ${outDir}`);
    console.log(`Report: ${reportDir}`);
    console.log(`Errors: ${summary.errors.length}`);
    console.log(`Warnings: ${summary.warnings.length}`);

    if (summary.errors.length) {
        for (const error of summary.errors.slice(0, 10)) console.log(`ERROR: ${error}`);
        process.exit(1);
    }
}

try {
    main();
} catch (error) {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
}
