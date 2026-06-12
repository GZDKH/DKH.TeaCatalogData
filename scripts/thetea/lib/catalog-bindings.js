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
            const list = productsByCategory.get(assignment.category) || [];
            list.push({
                product: product.code,
                order: Number.isFinite(product.order) ? product.order : list.length + 1,
                published: assignment.published !== false,
            });
            productsByCategory.set(assignment.category, list);
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
    return String(left || '').toUpperCase() === String(right || '').toUpperCase();
}

module.exports = {
    buildCatalogBindingCatalog,
    defaultCatalogTranslations,
};
