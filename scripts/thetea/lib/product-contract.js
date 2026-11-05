const CURRENT_PRODUCT_COLLECTIONS = Object.freeze([
    'translations', 'specifications', 'tags', 'packageBindings', 'catalogs', 'related', 'crossSells',
]);
const RETIRED_PRODUCT_FIELDS = Object.freeze([
    'packages', 'origins', 'tierPrices', 'catalogPrices', 'storePriceOverrides',
    'pricing', 'enteredPrice', 'price', 'oldPrice', 'catalogPrice', 'productCost',
    'callForPrice', 'minEnteredPrice', 'maxEnteredPrice', 'samplePrice',
]);

function usesCurrentProductContract(product) {
    return Object.hasOwn(product || {}, 'packageBindings');
}

function validateCurrentProductContract(product, label = product?.code || '<product>') {
    for (const field of CURRENT_PRODUCT_COLLECTIONS) {
        if (!Array.isArray(product?.[field])) {
            throw new Error(`${label} is not a complete nested products export: ${field} must be an array.`);
        }
    }
    for (const field of RETIRED_PRODUCT_FIELDS) {
        if (Object.hasOwn(product, field)) {
            throw new Error(`${label}: retired product field ${field} cannot be combined with packageBindings.`);
        }
    }
    for (const binding of product.packageBindings) {
        if (!binding || typeof binding !== 'object' || Array.isArray(binding)
            || typeof binding.package !== 'string' || !binding.package.trim()) {
            throw new Error(`${label}: packageBindings require a scalar package code.`);
        }
        if (['quantity', 'default', 'isDefault'].some(field => Object.hasOwn(binding || {}, field))) {
            throw new Error(`${label}: packageBindings must not contain retired quantity/default fields.`);
        }
    }
    return product;
}

// Package quantity/defaults and production-origin facts have separate current
// owners. Retain their original source in the immutable snapshot/routed content;
// never recreate them as retired ProductCatalog fields or commerce assertions.
function toCurrentProductContract(generated) {
    const product = structuredClone(generated);
    product.packageBindings = (generated.packages || []).map(binding => ({
        package: binding.package,
        packageName: binding.packageName,
        packageUnit: binding.packageUnit,
    }));
    for (const field of RETIRED_PRODUCT_FIELDS) delete product[field];
    return validateCurrentProductContract(product);
}

module.exports = {
    CURRENT_PRODUCT_COLLECTIONS,
    RETIRED_PRODUCT_FIELDS,
    usesCurrentProductContract,
    validateCurrentProductContract,
    toCurrentProductContract,
};
