const fs = require('fs');
const path = require('path');
const { analyzeCatalogMapping } = require('./catalog-mapping');

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,99}$/;
const KNOWN_PACKAGES = new Set([
    'PKG-25G',
    'PKG-50G',
    'PKG-75G',
    'PKG-100G',
    'PKG-150G',
    'PKG-250G',
    'PKG-300G',
    'PKG-500G',
    'PKG-600G',
    'PKG-BASKET-1KG',
]);

function validateProducts(products, options = {}) {
    const knownPackages = options.knownPackages || KNOWN_PACKAGES;
    const catalogReference = options.catalogReference || null;
    const requiredCatalogCode = options.requiredCatalogCode || 'CATALOG-CHINESE-TEA';
    const errors = [];
    const warnings = [];
    const codes = new Map();
    const languageCoverage = {};
    const specTypes = {};

    for (const product of products) {
        if (!CODE_RE.test(product.code || '')) {
            errors.push(`${product.code || '<missing>'}: invalid product code`);
        }

        if (codes.has(product.code)) {
            errors.push(`${product.code}: duplicate product code also seen in ${codes.get(product.code)}`);
        }
        codes.set(product.code, product.sku || product.code);

        const translations = product.translations || [];
        if (!translations.some(t => t.lang === 'en-US' && t.name)) {
            errors.push(`${product.code}: missing en-US translation with name`);
        }
        for (const t of translations) {
            languageCoverage[t.lang] = (languageCoverage[t.lang] || 0) + 1;
        }

        if (!Array.isArray(product.catalogs) || product.catalogs.length === 0) {
            errors.push(`${product.code}: no catalog/category assignments`);
        }
        for (const pkg of product.packages || []) {
            if (pkg.package && !knownPackages.has(pkg.package)) {
                warnings.push(`${product.code}: package ${pkg.package} is not in known package set`);
            }
        }

        const customAttributeSeen = new Set();
        for (const spec of product.specifications || []) {
            if (!CODE_RE.test(spec.group || '')) errors.push(`${product.code}: invalid spec group code ${spec.group}`);
            if (!CODE_RE.test(spec.attribute || '')) errors.push(`${product.code}: invalid spec attribute code ${spec.attribute}`);
            if (spec.option && !CODE_RE.test(spec.option)) errors.push(`${product.code}: invalid spec option code ${spec.option}`);

            specTypes[spec.type] = (specTypes[spec.type] || 0) + 1;
            if (spec.type !== 'Option') {
                const key = spec.attribute;
                if (customAttributeSeen.has(key)) {
                    errors.push(`${product.code}: repeated non-option spec attribute ${key}; ProductCatalog keeps one custom value per attribute`);
                }
                customAttributeSeen.add(key);
            }
        }
    }

    const catalogMapping = catalogReference
        ? analyzeCatalogMapping(products, catalogReference, { requiredCatalogCode })
        : null;
    if (catalogMapping) {
        errors.push(...catalogMapping.errors);
        warnings.push(...catalogMapping.warnings);
    }

    return {
        valid: errors.length === 0,
        productCount: products.length,
        languageCoverage,
        specTypes,
        catalogMapping,
        errors,
        warnings,
    };
}

function writeReport(reportDir, summary) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(reportDir, 'summary.md'), toMarkdown(summary));
}

function toMarkdown(summary) {
    const lines = [
        '# TheTea ETL Summary',
        '',
        `- Valid: ${summary.valid ? 'yes' : 'no'}`,
        `- Products: ${summary.productCount}`,
        `- Category definitions: ${summary.categoryDefinitionCount ?? 0}`,
        `- Field detail files: ${summary.fieldDetailFiles ?? 0}`,
        `- Missing field detail files: ${summary.missingFieldDetailFiles ?? 0}`,
        `- Markdown files: ${summary.markdownFiles ?? 0}`,
        `- Similar files: ${summary.similarFiles ?? 0}`,
        `- Errors: ${summary.errors.length}`,
        `- Warnings: ${summary.warnings.length}`,
        '',
        '## Language Coverage',
        '',
        ...Object.entries(summary.languageCoverage || {}).map(([lang, count]) => `- ${lang}: ${count}`),
        '',
        '## Specification Types',
        '',
        ...Object.entries(summary.specTypes || {}).map(([type, count]) => `- ${type}: ${count}`),
    ];

    if (summary.catalogMapping) {
        const mapping = summary.catalogMapping;
        lines.push(
            '',
            '## Prod Catalog Mapping',
            '',
            `- Required catalog: ${mapping.catalog.code}`,
            `- Catalog found: ${mapping.catalog.found ? 'yes' : 'no'}`,
            `- Catalog published: ${mapping.catalog.published === null ? 'n/a' : mapping.catalog.published ? 'yes' : 'no'}`,
            `- Prod categories in snapshot: ${mapping.totals.categories}`,
            `- Mapped categories used: ${mapping.totals.mappedCategories}`,
            `- Missing categories: ${mapping.missingCategories.length}`,
            `- Unpublished categories: ${mapping.unpublishedCategories.length}`);

        if (mapping.categoryUsage.length) {
            lines.push('', '### Category Usage', '');
            for (const item of mapping.categoryUsage) {
                lines.push(`- ${item.code}: ${item.productCount} product(s), ${item.published ? 'published' : 'unpublished'}, ${item.name}`);
            }
        }

        if (mapping.missingCategories.length) {
            lines.push('', '### Missing Categories', '', ...mapping.missingCategories.map(x => `- ${x}`));
        }
    }

    if (summary.errors.length) {
        lines.push('', '## Errors', '', ...summary.errors.map(e => `- ${e}`));
    }

    if (summary.warnings.length) {
        lines.push('', '## Warnings', '', ...summary.warnings.map(w => `- ${w}`));
    }

    return `${lines.join('\n')}\n`;
}

module.exports = {
    KNOWN_PACKAGES,
    validateProducts,
    writeReport,
};
