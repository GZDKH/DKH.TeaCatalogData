const fs = require('fs');
const path = require('path');

const DEFAULT_CATALOG_CODE = 'CATALOG-CHINESE-TEA';

function flattenCategories(categories = []) {
    const result = [];
    for (const category of categories || []) {
        result.push(category);
        if (Array.isArray(category.children) && category.children.length) {
            result.push(...flattenCategories(category.children));
        }
    }
    return result;
}

function normalizeCode(value) {
    const code = value && typeof value === 'object' ? value.code : value;
    return String(code || '').trim().toUpperCase();
}

function itemName(item, preferredLang = 'en-US') {
    const translations = item.translations || [];
    const preferred = translations.find(t => langOf(t) === preferredLang);
    const en = translations.find(t => langOf(t) === 'en-US');
    const first = translations[0];
    return preferred?.name || en?.name || first?.name || item.name || item.code;
}

function langOf(translation) {
    return translation.lang || translation.languageCode || translation.language_code;
}

function buildIndex(items) {
    const map = new Map();
    for (const item of items || []) {
        const code = normalizeCode(item.code);
        if (code) map.set(code, item);
    }
    return map;
}

function loadCatalogReference(filePath) {
    if (!filePath) return null;
    const fullPath = path.resolve(filePath);
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8').replace(/^\uFEFF/, ''));
    return normalizeReference(data);
}

function normalizeReference(reference) {
    const source = reference.data || reference;
    return {
        ...source,
        catalogs: source.catalogs?.items || source.catalogs || [],
        categories: source.categories?.items || source.categories || [],
    };
}

function analyzeCatalogMapping(products, reference, options = {}) {
    const refs = normalizeReference(reference || {});
    const requiredCatalogCode = normalizeCode(options.requiredCatalogCode || DEFAULT_CATALOG_CODE);
    const preferredLang = options.lang || 'en-US';
    const catalogs = refs.catalogs || [];
    const categories = flattenCategories(refs.categories || []);
    const catalogIndex = buildIndex(catalogs);
    const categoryIndex = buildIndex(categories);
    const errors = [];
    const warnings = [];

    const requiredCatalog = catalogIndex.get(requiredCatalogCode);
    if (!requiredCatalog) {
        errors.push(`Required prod catalog ${requiredCatalogCode} was not found.`);
    } else if (requiredCatalog.published === false) {
        warnings.push(`Required prod catalog ${requiredCatalogCode} exists but is unpublished.`);
    }

    const categoryUsage = new Map();
    const unknownCatalogs = new Set();

    for (const product of products || []) {
        const assignments = product.catalogs || [];
        if (!assignments.some(x => normalizeCode(x.catalog) === requiredCatalogCode)) {
            errors.push(`${product.code}: no assignment to required catalog ${requiredCatalogCode}.`);
        }

        for (const assignment of assignments) {
            const catalogCode = normalizeCode(assignment.catalog);
            const categoryCode = normalizeCode(assignment.category);
            if (catalogCode && !catalogIndex.has(catalogCode)) unknownCatalogs.add(catalogCode);
            if (!categoryCode) continue;

            if (!categoryUsage.has(categoryCode)) categoryUsage.set(categoryCode, new Set());
            categoryUsage.get(categoryCode).add(product.code);
        }
    }

    for (const catalogCode of [...unknownCatalogs].sort()) {
        errors.push(`Assigned catalog ${catalogCode} was not found in prod catalog snapshot.`);
    }

    const missingCategories = [];
    const unpublishedCategories = [];
    const usage = [];

    for (const [categoryCode, productCodes] of [...categoryUsage.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const category = categoryIndex.get(categoryCode);
        if (!category) {
            missingCategories.push(categoryCode);
            errors.push(`Assigned category ${categoryCode} was not found in prod category snapshot.`);
            continue;
        }

        if (category.published === false) {
            unpublishedCategories.push(categoryCode);
            warnings.push(`Assigned category ${categoryCode} exists but is unpublished.`);
        }

        usage.push({
            code: categoryCode,
            name: itemName(category, preferredLang),
            published: category.published !== false,
            productCount: productCodes.size,
            products: [...productCodes].sort(),
        });
    }

    return {
        valid: errors.length === 0,
        catalog: {
            code: requiredCatalogCode,
            found: Boolean(requiredCatalog),
            name: requiredCatalog ? itemName(requiredCatalog, preferredLang) : null,
            published: requiredCatalog ? requiredCatalog.published !== false : null,
        },
        totals: {
            catalogs: catalogs.length,
            categories: categories.length,
            mappedCategories: usage.length,
            products: (products || []).length,
        },
        categoryUsage: usage,
        missingCategories,
        unpublishedCategories,
        errors,
        warnings,
    };
}

module.exports = {
    DEFAULT_CATALOG_CODE,
    flattenCategories,
    loadCatalogReference,
    analyzeCatalogMapping,
};
