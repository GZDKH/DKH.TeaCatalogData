function buildCatalogBindingCatalog(options = {}) {
    const catalogCode = options.catalogCode || 'CATALOG-CHINESE-TEA';
    const currency = options.currency || 'CNY';
    const translations = options.translations || defaultCatalogTranslations();
    const categories = options.categories || [];
    const products = options.products || [];

    const productsByCategory = new Map();
    for (const product of products) {
        for (const assignment of product.catalogs || []) {
            if (!sameCode(assignment.catalog, catalogCode) || !assignment.category) continue;
            const categoryCode = referenceCode(assignment.category);
            const list = productsByCategory.get(categoryCode) || [];
            list.push({
                product: product.code,
                order: Number.isFinite(product.order) ? product.order : list.length + 1,
                published: assignment.published !== false,
            });
            productsByCategory.set(categoryCode, list);
        }
    }

    return {
        code: catalogCode,
        currency,
        order: 0,
        published: true,
        translations,
        categories: categories
            .slice()
            .sort(compareCategories)
            .map(category => ({
                category: category.code,
                order: Number.isFinite(category.order) ? category.order : 0,
                published: category.published !== false,
                products: (productsByCategory.get(category.code) || [])
                    .slice()
                    .sort((left, right) => left.order - right.order || left.product.localeCompare(right.product)),
            })),
    };
}

function catalogBindingCategoriesFromReference(reference, catalogCode) {
    const source = reference?.data || reference || {};
    const catalogs = source.catalogs?.items || source.catalogs || [];
    const catalog = catalogs.find(item => sameCode(item?.code, catalogCode));
    return (catalog?.categories || [])
        .map(item => ({
            code: referenceCode(item?.category || item),
            order: Number.isFinite(item?.order) ? item.order : 0,
            published: item?.published !== false,
        }))
        .filter(item => item.code);
}

function catalogBindingCategoriesForProducts(products, catalogCode, categories) {
    const categoryIndex = new Map(
        flattenCategories(categories)
            .map(category => [referenceCode(category?.code).toUpperCase(), category])
            .filter(([code]) => code));
    const result = new Map();
    for (const product of products || []) {
        for (const assignment of product?.catalogs || []) {
            if (!sameCode(assignment?.catalog, catalogCode)) continue;
            const code = referenceCode(assignment?.category).toUpperCase();
            const category = categoryIndex.get(code);
            if (!code || !category) continue;
            result.set(code, {
                code: referenceCode(category.code),
                order: Number.isFinite(category.order) ? category.order : 0,
                published: category.published !== false,
            });
        }
    }
    return [...result.values()];
}

function mergeCatalogBindingCategories(...collections) {
    const merged = new Map();
    for (const categories of collections) {
        for (const category of categories || []) {
            const code = referenceCode(category?.code);
            if (!code) continue;
            merged.set(code.toUpperCase(), { ...merged.get(code.toUpperCase()), ...category, code });
        }
    }
    return [...merged.values()];
}

function summarizeCatalogPlacement(products, catalogBindings, requiredCatalogCode) {
    const catalogCode = referenceCode(requiredCatalogCode).toUpperCase();
    const binding = (catalogBindings || [])
        .find(item => referenceCode(item?.code).toUpperCase() === catalogCode);
    const categories = Array.isArray(binding?.categories) ? binding.categories : [];
    const boundPairs = new Set();
    let bindingAssignmentCount = 0;
    for (const category of categories) {
        const categoryCode = referenceCode(category?.category).toUpperCase();
        for (const product of Array.isArray(category?.products) ? category.products : []) {
            const productCode = referenceCode(product?.product).toUpperCase();
            if (!categoryCode || !productCode) continue;
            bindingAssignmentCount += 1;
            boundPairs.add(`${productCode}|${categoryCode}`);
        }
    }

    let assignedProductCount = 0;
    for (const product of products || []) {
        const productCode = referenceCode(product?.code).toUpperCase();
        const assigned = (product?.catalogs || []).some(assignment => {
            if (referenceCode(assignment?.catalog).toUpperCase() !== catalogCode) return false;
            const categoryCode = referenceCode(assignment?.category).toUpperCase();
            return categoryCode && boundPairs.has(`${productCode}|${categoryCode}`);
        });
        if (assigned) assignedProductCount += 1;
    }

    return {
        requiredCatalog: catalogCode,
        productCount: (products || []).length,
        bindingCategoryCount: categories.length,
        bindingAssignmentCount,
        assignedProductCount,
        unassignedProductCount: (products || []).length - assignedProductCount,
    };
}

function flattenCategories(categories) {
    const result = [];
    for (const category of categories || []) {
        result.push(category);
        result.push(...flattenCategories(category?.children));
    }
    return result;
}

function defaultCatalogTranslations() {
    return [
        {
            lang: 'en-US',
            name: 'Chinese Tea',
            description: 'TheTea Chinese tea catalog',
            seo: 'chinese-tea',
        },
        {
            lang: 'ru-RU',
            name: 'Китайский чай',
            description: 'Каталог китайского чая TheTea',
            seo: 'kitayskiy-chay',
        },
        {
            lang: 'zh-CN',
            name: '中国茶',
            description: 'TheTea 中国茶目录',
            seo: 'zhong-guo-cha',
        },
    ];
}

function compareCategories(left, right) {
    const leftParent = left.parent || '';
    const rightParent = right.parent || '';
    if (leftParent !== rightParent) return leftParent.localeCompare(rightParent);
    const leftOrder = Number.isFinite(left.order) ? left.order : 0;
    const rightOrder = Number.isFinite(right.order) ? right.order : 0;
    return leftOrder - rightOrder || String(left.code).localeCompare(String(right.code));
}

function sameCode(left, right) {
    return referenceCode(left).toUpperCase() === referenceCode(right).toUpperCase();
}

function referenceCode(value) {
    return String(value && typeof value === 'object' ? value.code : value || '');
}

module.exports = {
    buildCatalogBindingCatalog,
    catalogBindingCategoriesForProducts,
    catalogBindingCategoriesFromReference,
    defaultCatalogTranslations,
    mergeCatalogBindingCategories,
    summarizeCatalogPlacement,
};
