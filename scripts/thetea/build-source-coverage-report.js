#!/usr/bin/env node
/**
 * Build a read-only reconciliation report between the TheTea D1 field packs,
 * the latest ProductCatalog export, and the definitions observed in Admin.
 *
 * This script never mutates a catalog or creates definitions. The generated
 * JSON/Markdown is an evidence artifact for deciding which existing typed
 * definitions and sections can be used by an import.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

function arg(name, fallback = null) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function populated(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
}

function sourcePackRoot(snapshotRoot) {
    return path.join(snapshotRoot, 'raw', 'd1', 'field-packs');
}

function emptySection() {
    return { rowCount: 0, nonEmptyRowCount: 0, slugCount: 0, localeCount: 0, fieldCount: 0, fields: {} };
}

function addRow(section, field, value, slug, locale, sectionSlugs, sectionLocales) {
    section.rowCount += 1;
    if (populated(value.value_md) || populated(value.value_num)) section.nonEmptyRowCount += 1;
    section.fields[field] = (section.fields[field] || 0) + 1;
    sectionSlugs.add(slug);
    sectionLocales.add(locale);
}

function sourceCoverage(snapshotRoot, targetSlugs) {
    const manifest = readJson(path.join(snapshotRoot, 'manifest.json'));
    const root = sourcePackRoot(snapshotRoot);
    const sections = {};
    const fields = {};
    const slugs = {};
    const localeCounts = {};
    const sectionSlugSets = {};
    const sectionLocaleSets = {};
    let totalRows = 0;
    let totalNonEmptyRows = 0;
    let packsRead = 0;
    const files = fs.readdirSync(root).filter(name => name.endsWith('.json.gz')).sort();
    for (const filename of files) {
        const slug = filename.replace(/\.json\.gz$/, '');
        const pack = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, filename))).toString('utf8'));
        packsRead += 1;
        let slugRows = 0;
        let slugNonEmptyRows = 0;
        const slugSections = {};
        const slugLocales = Object.keys(pack.locales || {});
        for (const [locale, rows] of Object.entries(pack.locales || {})) {
            localeCounts[locale] = (localeCounts[locale] || 0) + rows.length;
            for (const row of rows) {
                const sectionName = row.section || row.payload?.section_code || 'unknown';
                const fieldName = row.field || row.payload?.field_code || 'unknown';
                const payload = row.payload || row;
                if (!sections[sectionName]) {
                    sections[sectionName] = emptySection();
                    sectionSlugSets[sectionName] = new Set();
                    sectionLocaleSets[sectionName] = new Set();
                }
                addRow(sections[sectionName], fieldName, payload, slug, locale,
                    sectionSlugSets[sectionName], sectionLocaleSets[sectionName]);
                fields[`${sectionName}.${fieldName}`] = (fields[`${sectionName}.${fieldName}`] || 0) + 1;
                slugRows += 1;
                if (populated(payload.value_md) || populated(payload.value_num)) {
                    slugNonEmptyRows += 1;
                    totalNonEmptyRows += 1;
                }
                totalRows += 1;
                slugSections[sectionName] = (slugSections[sectionName] || 0) + 1;
            }
        }
        slugs[slug] = { rowCount: slugRows, nonEmptyRowCount: slugNonEmptyRows, locales: slugLocales.length, sections: slugSections };
    }
    for (const [name, section] of Object.entries(sections)) {
        section.slugCount = sectionSlugSets[name].size;
        section.localeCount = sectionLocaleSets[name].size;
        section.fieldCount = Object.keys(section.fields).length;
        delete sectionSlugSets[name];
        delete sectionLocaleSets[name];
    }
    const matched = [...targetSlugs].filter(slug => slugs[slug]).sort();
    return {
        snapshotId: manifest.snapshotId || null,
        createdAt: manifest.createdAt || null,
        completedAt: manifest.completedAt || null,
        manifestHashes: manifest.validationReport?.hashes || null,
        manifestSlugCount: Array.isArray(manifest.slugs) ? manifest.slugs.length : null,
        manifestSlugs: Array.isArray(manifest.slugs) ? [...manifest.slugs].sort() : Object.keys(slugs).sort(),
        fieldPackCount: files.length,
        packsRead,
        totalRows,
        totalNonEmptyRows,
        localeCount: Array.isArray(manifest.availableLocales) ? manifest.availableLocales.length : Object.keys(localeCounts).length,
        partialFieldDataSlugs: manifest.partialFieldDataSlugs || [],
        sections,
        localeRowCounts: localeCounts,
        productSlugMatches: { matchedCount: matched.length, matched },
        slugs,
        targetSlugs: [...targetSlugs].sort(),
    };
}

function productCoverage(products, template) {
    const attributes = {};
    const groups = {};
    const types = {};
    const optionCodes = {};
    const slugs = new Map();
    for (const product of products) {
        for (const translation of product.translations || []) {
            if (translation.seo) slugs.set(translation.seo, product.code);
        }
        for (const spec of product.specifications || []) {
            attributes[spec.attribute || '?'] = (attributes[spec.attribute || '?'] || 0) + 1;
            groups[spec.group || '?'] = (groups[spec.group || '?'] || 0) + 1;
            types[spec.type || '?'] = (types[spec.type || '?'] || 0) + 1;
            if (spec.option) optionCodes[spec.option] = (optionCodes[spec.option] || 0) + 1;
        }
    }
    return {
        productCount: products.length,
        productCodeHash: products.map(product => String(product.code || '').toUpperCase()).sort().join('\n'),
        specificationRowCount: products.reduce((sum, product) => sum + (product.specifications || []).length, 0),
        distinctSpecificationAttributes: Object.keys(attributes).length,
        specificationAttributes: attributes,
        specificationGroups: groups,
        specificationTypes: types,
        distinctSpecificationOptions: Object.keys(optionCodes).length,
        productSlugs: [...slugs.keys()].sort(),
        templateColumnCount: template && template[0] ? Object.keys(template[0]).length : null,
    };
}

function reconcile(productReport, sourceReport, live) {
    const sourceSlugs = new Set(sourceReport.manifestSlugs || sourceReport.targetSlugs || []);
    const productSlugs = new Set(productReport.productSlugs);
    const exactMatches = [...productSlugs].filter(slug => sourceSlugs.has(slug)).sort();
    const sourceOnly = [...sourceSlugs].filter(slug => !productSlugs.has(slug)).sort();
    const productOnly = [...productSlugs].filter(slug => !sourceSlugs.has(slug)).sort();
    const liveCodes = new Set((live?.specificationDefinitions || []).map(item => item.code).filter(Boolean));
    const usedCodes = new Set(Object.keys(productReport.specificationAttributes));
    const typedOverlap = [...usedCodes].filter(code => liveCodes.has(code)).sort();
    return {
        exactProductSourceSlugMatches: exactMatches.length,
        productSlugCount: productSlugs.size,
        sourceSlugCount: sourceSlugs.size,
        productOnlySlugs: productOnly,
        sourceOnlySlugs: sourceOnly,
        productSpecificationAttributesUsed: usedCodes.size,
        liveSpecificationDefinitionCount: liveCodes.size,
        productAttributesWithLiveDefinition: typedOverlap.length,
        productAttributesWithoutLiveDefinition: [...usedCodes].filter(code => !liveCodes.has(code)).sort(),
        productAttributesWithLiveDefinitionCodes: typedOverlap,
        liveProductAttributeCount: live?.productAttributeCount ?? null,
        liveCatalogTemplate: live?.catalogTemplate || null,
    };
}

function markdown(report) {
    const lines = [
        '# TheTea source and ProductCatalog coverage',
        '',
        `Generated: ${report.generatedAt}`,
        '',
        'This is a read-only evidence report. It does not create definitions, change a catalog, or import products.',
        '',
        '## Current counts',
        '',
        `- ProductCatalog products: ${report.productCatalog.productCount}`,
        `- ProductCatalog specification rows: ${report.productCatalog.specificationRowCount}`,
        `- ProductCatalog distinct specification attributes used: ${report.productCatalog.distinctSpecificationAttributes}`,
        `- ProductCatalog export columns: ${report.productCatalog.templateColumnCount}`,
        `- TheTea source slugs: ${report.source.manifestSlugCount}`,
        `- TheTea field packs read: ${report.source.packsRead}`,
        `- TheTea field rows: ${report.source.totalRows} (${report.source.totalNonEmptyRows} non-empty)`,
        `- Exact product/source slug matches: ${report.reconciliation.exactProductSourceSlugMatches}`,
        `- Product slugs without an exact source pack: ${report.reconciliation.productOnlySlugs.length}`,
        `- Source slugs without an exact ProductCatalog product: ${report.reconciliation.sourceOnlySlugs.length}`,
        '',
        '## Source sections',
        '',
        '| Section | Rows | Non-empty rows | Slugs | Fields | Locales |',
        '| --- | ---: | ---: | ---: | ---: | ---: |',
    ];
    for (const [name, section] of Object.entries(report.source.sections).sort((a, b) => b[1].rowCount - a[1].rowCount)) {
        lines.push(`| ${name} | ${section.rowCount} | ${section.nonEmptyRowCount} | ${section.slugCount} | ${section.fieldCount} | ${section.localeCount} |`);
    }
    lines.push('', '## Live Admin observation', '');
    lines.push(`- Published specification definitions observed: ${report.liveAdmin.specificationDefinitionCount}`);
    lines.push(`- Published product attributes observed: ${report.liveAdmin.productAttributeCount}`);
    const teaType = report.liveAdmin.teaTypeDefinitionId
        || report.liveAdmin.specificationDefinitions?.find(item => item.code === 'SPEC-TT-CLASSIFICATION-ORIGIN-TEA-TYPE')?.id;
    lines.push(`- Tea type definition: ${teaType || 'not observed'}`);
    lines.push(`- Catalog template specifications: ${report.liveAdmin.catalogTemplate.specifications}`);
    lines.push(`- Catalog template variant attributes: ${report.liveAdmin.catalogTemplate.variantAttributes}`);
    lines.push('', '## Reconciliation result', '');
    lines.push(`- Product specification attributes with a live definition: ${report.reconciliation.productAttributesWithLiveDefinition}`);
    lines.push(`- Product specification attributes without a live definition: ${report.reconciliation.productAttributesWithoutLiveDefinition.length}`);
    lines.push('', 'The unresolved list is a controlled review queue. Import values must reference existing definition IDs/codes; this report does not recommend auto-creating definitions from source fields.', '');
    lines.push('## Yueyang Huangcha source example', '');
    const example = report.examples.yueyangHuangcha;
    lines.push(`- Exact source slug: ${example.slug || 'not found'}`);
    lines.push(`- Product code: ${example.productCode || 'not matched'}`);
    lines.push(`- Source locales: ${example.localeCount}`);
    lines.push(`- Source field rows: ${example.rowCount} (${example.nonEmptyRowCount} non-empty)`);
    lines.push(`- Source sections: ${Object.keys(example.sections || {}).join(', ') || 'none'}`);
    lines.push('', 'The complete example is retained in the JSON artifact so typed mapping can be reviewed without embedding source content in runtime code.', '');
    return `${lines.join('\n')}\n`;
}

function main() {
    const productsFile = arg('products');
    const sourceRoot = arg('source-root');
    const outputJson = arg('output-json', 'docs/source-coverage-2026-09-21.json');
    const outputMd = arg('output-md', 'docs/source-coverage-2026-09-21.md');
    const liveFile = arg('live-observation', 'docs/live-definition-observation.json');
    if (!productsFile || !sourceRoot) throw new Error('Usage: build-source-coverage-report.js --products FILE --source-root SNAPSHOT_DIR [--output-json FILE] [--output-md FILE]');
    const products = readJson(productsFile);
    const templateFile = path.join(path.dirname(productsFile), 'template.json');
    const template = fs.existsSync(templateFile) ? readJson(templateFile) : null;
    const productSlugs = new Set(products.flatMap(product => (product.translations || []).map(translation => translation.seo).filter(Boolean)));
    const source = sourceCoverage(sourceRoot, productSlugs);
    const productCatalog = productCoverage(products, template);
    const liveAdmin = fs.existsSync(liveFile) ? readJson(liveFile) : {
        observationSource: 'authenticated-admin-ui',
        specificationDefinitionCount: null,
        specificationDefinitions: [],
        productAttributeCount: null,
        catalogTemplate: { specifications: 'not observed', variantAttributes: 'not observed' },
    };
    const yueyangProduct = products.find(product => (product.translations || []).some(translation => translation.seo === 'yueyang-huangcha'));
    const yueyangSlug = source.slugs['yueyang-huangcha'];
    const example = yueyangSlug ? {
        slug: 'yueyang-huangcha',
        productCode: yueyangProduct?.code || null,
        localeCount: yueyangSlug.locales,
        rowCount: yueyangSlug.rowCount,
        nonEmptyRowCount: yueyangSlug.nonEmptyRowCount,
        sections: yueyangSlug.sections,
    } : { slug: null, productCode: yueyangProduct?.code || null, localeCount: 0, rowCount: 0, nonEmptyRowCount: 0, sections: {} };
    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        evidenceOnly: true,
        productCatalog: {
            ...productCatalog,
            productsFileSha256: sha256(productsFile),
            templateFileSha256: fs.existsSync(templateFile) ? sha256(templateFile) : null,
            productCodeHash: crypto.createHash('sha256').update(productCatalog.productCodeHash).digest('hex'),
        },
        source,
        liveAdmin,
        reconciliation: reconcile(productCatalog, source, liveAdmin),
        examples: { yueyangHuangcha: example },
    };
    fs.mkdirSync(path.dirname(outputJson), { recursive: true });
    fs.mkdirSync(path.dirname(outputMd), { recursive: true });
    fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(outputMd, markdown(report));
    console.log(JSON.stringify({ outputJson, outputMd, productCount: products.length, sourcePacks: source.packsRead, exactMatches: report.reconciliation.exactProductSourceSlugMatches }, null, 2));
}

if (require.main === module) main();

module.exports = { sourceCoverage, productCoverage, reconcile, markdown };
