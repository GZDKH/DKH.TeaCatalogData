'use strict';

const { stableJson } = require('./artifacts');

const PROJECTION_SCHEMA = 'catalog-source-observation-projection-v1';
const SOURCE_ID = 'zzctea';
const EXTERNAL_ID = /^[1-9]\d*$/;
const PRODUCT_CODE = /^ZZC-([1-9]\d*)$/;
const PRODUCT_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_LANGUAGES = Object.freeze(['en-US', 'zh-CN']);
const COMPLETE_PRODUCT_COLLECTIONS = Object.freeze([
    'translations',
    'specifications',
    'tags',
    'tierPrices',
    'catalogPrices',
    'storePriceOverrides',
    'packages',
    'catalogs',
    'origins',
    'related',
    'crossSells',
]);
const SOURCE_DESCRIPTION_CONTENT =
    /(?:zzctea(?:\.com)?|找找茶|供需线索|最新报价|价格走势|茶友讨论|https?:\/\/|www\.|(?:^|[\s(])(?:[a-z0-9-]+\.)+(?:com|cn|net|org)(?:[\/\s)]|$))/iu;

function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
}

function requireObject(value, code, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail(code, `${label} must be an object.`);
    }
    return value;
}

function deepClone(value, seen = new WeakMap()) {
    if (value === null || typeof value !== 'object') {
        if (typeof value === 'number' && !Number.isFinite(value)) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
                'Product reference contains a non-JSON numeric value.',
            );
        }
        if (typeof value === 'bigint' ||
            typeof value === 'function' ||
            typeof value === 'symbol') {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
                'Product reference contains a non-JSON value.',
            );
        }
        return value;
    }
    if (seen.has(value)) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
            'Product reference must not contain cycles.',
        );
    }
    seen.set(value, true);
    if (Array.isArray(value)) {
        const result = value.map(entry => deepClone(entry, seen));
        seen.delete(value);
        return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
            'Product reference must contain only plain JSON objects.',
        );
    }
    const result = {};
    for (const key of Object.keys(value)) {
        result[key] = deepClone(value[key], seen);
    }
    seen.delete(value);
    return result;
}

function requireExternalId(value, label = 'Projection external ID') {
    if (typeof value !== 'string' || !EXTERNAL_ID.test(value)) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_EXTERNAL_ID_INVALID',
            `${label} must be a canonical positive integer string.`,
        );
    }
    return value;
}

function exactProductCode(externalId) {
    return `ZZC-${requireExternalId(externalId)}`;
}

function validateDescription(value, languageCode) {
    if (typeof value !== 'string' || !value.trim()) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_DESCRIPTION_INVALID',
            `Projected ${languageCode} factual description is missing.`,
        );
    }
    const description = value.trim();
    if (description.length > 1024 ||
        /[\u0000-\u001F\u007F]/u.test(description) ||
        /<(?:(?:\/?[A-Za-z])|!DOCTYPE|!--|\?xml)[^>]*>/i.test(description) ||
        SOURCE_DESCRIPTION_CONTENT.test(description)) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_DESCRIPTION_INVALID',
            `Projected ${languageCode} description is unsafe or contains source boilerplate.`,
        );
    }
    return description;
}

function projectedDescriptions(projectedItem) {
    const item = requireObject(
        projectedItem,
        'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
        'Projected item',
    );
    const externalId = requireExternalId(item.externalId);
    const observation = requireObject(
        item.observation,
        'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
        `Projection item ${externalId} observation`,
    );
    if (observation.externalId !== externalId || !Array.isArray(observation.localizedText)) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
            `Projection item ${externalId} identity or localized text is invalid.`,
        );
    }
    const localized = new Map();
    for (const text of observation.localizedText) {
        requireObject(
            text,
            'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
            `Projection item ${externalId} localized text`,
        );
        if (typeof text.languageCode !== 'string' || localized.has(text.languageCode)) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
                `Projection item ${externalId} has duplicate or invalid localized text.`,
            );
        }
        localized.set(text.languageCode, text);
    }
    return Object.fromEntries(TARGET_LANGUAGES.map(languageCode => {
        const text = localized.get(languageCode);
        return [
            languageCode,
            validateDescription(text?.description, languageCode),
        ];
    }));
}

function assertSafeOutputDescriptions(product) {
    for (const translation of product.translations) {
        if (!TARGET_LANGUAGES.includes(translation?.lang)) continue;
        for (const field of ['description', 'metaDescription']) {
            const value = translation?.[field];
            if (value !== undefined && value !== null && value !== '' &&
                (typeof value !== 'string' || SOURCE_DESCRIPTION_CONTENT.test(value))) {
                fail(
                    'CATALOG_SOURCE_RECONCILIATION_DESCRIPTION_INVALID',
                    `${product.code} ${translation?.lang || '<unknown>'} ${field} contains source boilerplate or a domain.`,
                );
            }
        }
    }
}

function patchMatchedProduct(product, descriptions) {
    const rollbackProduct = deepClone(product);
    const productPatch = deepClone(product);
    const targetCounts = Object.fromEntries(TARGET_LANGUAGES.map(languageCode => [
        languageCode,
        0,
    ]));
    productPatch.translations = productPatch.translations.map(translation => {
        requireObject(
            translation,
            'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
            `${product.code} translation`,
        );
        if (!TARGET_LANGUAGES.includes(translation.lang)) return translation;
        targetCounts[translation.lang] += 1;
        return {
            ...translation,
            description: descriptions[translation.lang],
            metaDescription: descriptions[translation.lang],
        };
    });
    for (const languageCode of TARGET_LANGUAGES) {
        if (targetCounts[languageCode] !== 1) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
                `${product.code} must contain exactly one ${languageCode} translation.`,
            );
        }
    }
    assertSafeOutputDescriptions(productPatch);
    return { productPatch, rollbackProduct };
}

function validateProducts(products) {
    if (!Array.isArray(products) || products.length === 0) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
            'Complete product reference must contain products.',
        );
    }
    const byCode = new Map();
    const ids = new Set();
    for (const [index, product] of products.entries()) {
        requireObject(
            product,
            'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
            `Product reference item ${index}`,
        );
        if (typeof product.id !== 'string' || !PRODUCT_ID.test(product.id)) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
                `Product reference item ${index} has no immutable UUID product ID.`,
            );
        }
        if (typeof product.code !== 'string' ||
            !product.code ||
            product.code.trim() !== product.code) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_PRODUCT_CODE_INVALID',
                `Product reference item ${index} has an invalid product code.`,
            );
        }
        for (const field of COMPLETE_PRODUCT_COLLECTIONS) {
            if (!Array.isArray(product[field])) {
                fail(
                    'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
                    `${product.code} is not a complete product reference: ${field} must be an array.`,
                );
            }
        }
        const normalizedId = product.id.toLowerCase();
        const normalizedCode = product.code.toUpperCase();
        if (ids.has(normalizedId)) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_PRODUCT_ID_DUPLICATE',
                `Product reference contains duplicate product ID '${product.id}'.`,
            );
        }
        if (byCode.has(normalizedCode)) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_PRODUCT_CODE_DUPLICATE',
                `Product reference contains duplicate product code '${product.code}'.`,
            );
        }
        ids.add(normalizedId);
        byCode.set(normalizedCode, product);

        if (/^ZZC/i.test(product.code) && !PRODUCT_CODE.test(product.code)) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_PRODUCT_CODE_INVALID',
                `Malformed ZZCTea product code '${product.code}'.`,
            );
        }
    }
    return byCode;
}

function validateProjection(projection) {
    requireObject(
        projection,
        'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
        'Dry-run projection',
    );
    if (projection.schemaVersion !== PROJECTION_SCHEMA ||
        projection.source?.id !== SOURCE_ID ||
        projection.productionWrites !== false ||
        projection.authoritativeReferencesIncluded !== false ||
        projection.reconciliationComplete !== false ||
        !Array.isArray(projection.deletions) ||
        projection.deletions.length !== 0 ||
        !Array.isArray(projection.items) ||
        !Number.isSafeInteger(projection.itemCount) ||
        projection.itemCount !== projection.items.length) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
            'Input must be a complete source-neutral ZZCTea dry-run projection without writes or deletions.',
        );
    }
    const seen = new Set();
    for (const item of projection.items) {
        const externalId = requireExternalId(item?.externalId);
        if (seen.has(externalId)) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_EXTERNAL_ID_DUPLICATE',
                `Projection contains duplicate external ID '${externalId}'.`,
            );
        }
        seen.add(externalId);
    }
    return projection.items;
}

function numericExternalIdOrder(left, right) {
    const leftId = BigInt(left.externalId);
    const rightId = BigInt(right.externalId);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function reconcileProjection(projection, products) {
    const projectedItems = validateProjection(projection);
    const productsByCode = validateProducts(products);
    const entries = projectedItems.map(projectedItem => {
        const externalId = requireExternalId(projectedItem.externalId);
        const productCode = exactProductCode(externalId);
        const descriptions = projectedDescriptions(projectedItem);
        const product = productsByCode.get(productCode);
        if (!product) {
            return {
                externalId,
                productCode,
                status: 'missing-create-draft',
                published: false,
            };
        }
        const { productPatch, rollbackProduct } = patchMatchedProduct(product, descriptions);
        const changed = stableJson(productPatch) !== stableJson(rollbackProduct);
        return {
            externalId,
            productId: product.id,
            productCode,
            status: changed ? 'matched-update' : 'matched-noop',
            commerceSourceIncarnationId: null,
            commerceMappingStatus: 'blocked-authoritative-reference',
            productPatch,
            rollbackProduct,
        };
    }).sort(numericExternalIdOrder);

    const matched = entries
        .filter(entry => entry.status.startsWith('matched-'))
        .map(entry => ({
            externalId: entry.externalId,
            productId: entry.productId,
            productCode: entry.productCode,
            status: entry.status,
        }));
    const missing = entries
        .filter(entry => entry.status === 'missing-create-draft')
        .map(entry => ({
            externalId: entry.externalId,
            productCode: entry.productCode,
        }));
    const ambiguous = [];
    return {
        sourceId: SOURCE_ID,
        entries,
        report: {
            matched,
            missing,
            ambiguous,
            counts: {
                matched: matched.length,
                missing: missing.length,
                ambiguous: ambiguous.length,
            },
        },
    };
}

module.exports = {
    SOURCE_ID,
    deepClone,
    exactProductCode,
    patchMatchedProduct,
    projectedDescriptions,
    reconcileProjection,
    validateDescription,
};
