const fs = require('fs');
const path = require('path');
const { analyzeCatalogMapping } = require('./catalog-mapping');

function walkJson(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkJson(full));
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            files.push(full);
        }
    }

    return files.sort();
}

function readProductsFromDir(dir) {
    const productsDir = fs.existsSync(path.join(dir, '04-products'))
        ? path.join(dir, '04-products')
        : dir;
    const products = [];
    for (const file of walkJson(productsDir)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, ''));
        if (!Array.isArray(data)) {
            throw new Error(`${file} is not a JSON array`);
        }

        products.push(...data);
    }

    return { productsDir, products };
}

function analyzeSeedReadiness(products, options = {}) {
    const requiredCatalogCode = options.requiredCatalogCode || 'CATALOG-CHINESE-TEA';
    const requiredLocales = options.requiredLocales || ['en-US', 'ru-RU', 'zh-CN'];
    const minProducts = Number(options.minProducts || 1);
    const minCategories = Number(options.minCategories || 1);
    const errors = [];
    const warnings = [];
    const localeCoverage = {};
    const categoryCodes = new Set();
    let publishedProductCount = 0;

    for (const product of products || []) {
        if (product.published === true) {
            publishedProductCount += 1;
        }

        for (const translation of product.translations || []) {
            if (translation.lang && translation.name) {
                localeCoverage[translation.lang] = (localeCoverage[translation.lang] || 0) + 1;
            }
        }

        for (const assignment of product.catalogs || []) {
            if (assignment.catalog === requiredCatalogCode && assignment.category) {
                categoryCodes.add(assignment.category);
            }
        }
    }

    if ((products || []).length < minProducts) {
        errors.push(`Need at least ${minProducts} generated products, found ${(products || []).length}.`);
    }

    if (publishedProductCount < minProducts) {
        errors.push(`Need at least ${minProducts} published products for POS browsing, found ${publishedProductCount}.`);
    }

    if (categoryCodes.size < minCategories) {
        errors.push(`Need at least ${minCategories} POS category assignment(s), found ${categoryCodes.size}.`);
    }

    for (const locale of requiredLocales) {
        if ((localeCoverage[locale] || 0) < minProducts) {
            errors.push(`Locale ${locale} covers ${localeCoverage[locale] || 0}/${minProducts} required product(s).`);
        }
    }

    const catalogMapping = options.catalogReference
        ? analyzeCatalogMapping(products || [], options.catalogReference, { requiredCatalogCode })
        : null;
    if (!catalogMapping) {
        errors.push('Production catalog reference is required for POS seed readiness.');
    } else {
        errors.push(...catalogMapping.errors);
        warnings.push(...catalogMapping.warnings);
        if (!catalogMapping.catalog.published) {
            errors.push(`Catalog ${requiredCatalogCode} is not published.`);
        }
    }

    return {
        ready: errors.length === 0,
        productCount: (products || []).length,
        publishedProductCount,
        requiredCatalogCode,
        requiredLocales,
        localeCoverage,
        categoryCount: categoryCodes.size,
        catalog: catalogMapping?.catalog || {
            code: requiredCatalogCode,
            found: false,
            published: null,
        },
        catalogMapping,
        errors,
        warnings,
    };
}

function toMarkdown(summary) {
    const lines = [
        '# TheTea POS Seed Readiness',
        '',
        `- Ready: ${summary.ready ? 'yes' : 'no'}`,
        `- Products: ${summary.productCount}`,
        `- Published products: ${summary.publishedProductCount}`,
        `- Required catalog: ${summary.requiredCatalogCode}`,
        `- Catalog found: ${summary.catalog.found ? 'yes' : 'no'}`,
        `- Catalog published: ${summary.catalog.published === null ? 'n/a' : summary.catalog.published ? 'yes' : 'no'}`,
        `- POS category assignments: ${summary.categoryCount}`,
        '',
        '## Required Locale Coverage',
        '',
        ...summary.requiredLocales.map(locale => `- ${locale}: ${summary.localeCoverage[locale] || 0}`),
    ];

    if (summary.catalogMapping?.missingCategories?.length) {
        lines.push('', '## Missing Categories', '', ...summary.catalogMapping.missingCategories.map(code => `- ${code}`));
    }

    if (summary.errors.length) {
        lines.push('', '## Errors', '', ...summary.errors.map(error => `- ${error}`));
    }

    if (summary.warnings.length) {
        lines.push('', '## Warnings', '', ...summary.warnings.map(warning => `- ${warning}`));
    }

    return `${lines.join('\n')}\n`;
}

function writeSeedReadinessReport(reportDir, summary) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'seed-readiness.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(reportDir, 'seed-readiness.md'), toMarkdown(summary));
}

module.exports = {
    analyzeSeedReadiness,
    readProductsFromDir,
    writeSeedReadinessReport,
};
