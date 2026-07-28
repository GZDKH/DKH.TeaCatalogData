'use strict';

const { stableJson } = require('./artifacts');

const PROJECTION_SCHEMA = 'catalog-source-observation-projection-v1';
const SOURCE_ID = 'zzctea';
const EXTERNAL_ID = /^[1-9]\d*$/;
const PRODUCT_CODE = /^ZZC-([1-9]\d*)$/;
const PRODUCT_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_LANGUAGES = Object.freeze(['zh-CN']);
const SOURCE_SPECIFICATION_GROUP = 'SPEC-TT-GROUP-ATOMIC';
const TEA_TYPE_SPECIFICATION_GROUP =
    'SPEC-TT-GROUP-CLASSIFICATION-ORIGIN';
const SOURCE_SPECIFICATIONS = Object.freeze({
    teaType: 'SPEC-TT-CLASSIFICATION-ORIGIN-TEA-TYPE',
    year: 'SPEC-06609725785E48F',
    processing: 'SPEC-PUERH-PROCESSING',
    shape: 'SPEC-4304F36A0BF94F7',
    rawPackage: 'SPEC-PUERH-PACKAGING-SPECIFICATION',
    unitWeight: 'SPEC-PUERH-UNIT-WEIGHT-G',
    referencePriceBasis: 'SPEC-PUERH-REFERENCE-PRICE-UNIT',
});
const SOURCE_SPECIFICATION_CODES = new Set(Object.values(SOURCE_SPECIFICATIONS));
const BATCH_ATTRIBUTE_NAMES = new Set(['batch', '批次']);
const FACT_CODE = /^[a-z0-9][a-z0-9._-]*$/;
const DECIMAL_UNITS = /^(?:0|[1-9]\d*)$/;
const PROCESSING_OPTIONS = Object.freeze({
    '生茶': 'OPT-PUERH-PROCESSING-SHENG',
    '熟茶': 'OPT-PUERH-PROCESSING-SHU',
    '生熟套装': 'OPT-PUERH-PROCESSING-MIXED',
    '红茶': 'OPT-PUERH-PROCESSING-RED',
    '白茶': 'OPT-PUERH-PROCESSING-WHITE',
});
const SHAPE_OPTIONS = Object.freeze({
    '饼': 'OPT-D902FEC129A64389',
    '饼茶': 'OPT-D902FEC129A64389',
    '茶饼': 'OPT-D902FEC129A64389',
    '饼形': 'OPT-D902FEC129A64389',
    '砖': 'OPT-3FDFAEB0AEB14D52',
    '砖茶': 'OPT-3FDFAEB0AEB14D52',
    '茶砖': 'OPT-3FDFAEB0AEB14D52',
    '沱': 'OPT-E9939A4B758741B3',
    '沱茶': 'OPT-E9939A4B758741B3',
    '散茶': 'OPT-BF841D77083049E6',
});
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

function validateFactualText(value, label, maximum = 1000) {
    if (typeof value !== 'string' || !value.trim()) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_FACT_INVALID',
            `${label} must be a non-empty string.`,
        );
    }
    const text = value.trim();
    if (text.length > maximum ||
        /[\u0000-\u001F\u007F]/u.test(text) ||
        /<(?:(?:\/?[A-Za-z])|!DOCTYPE|!--|\?xml)[^>]*>/i.test(text) ||
        SOURCE_DESCRIPTION_CONTENT.test(text)) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_FACT_INVALID',
            `${label} is unsafe or contains source boilerplate.`,
        );
    }
    return text;
}

function projectedContent(projectedItem) {
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
    if (localized.size !== 1 || !localized.has('zh-CN')) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
            `Projection item ${externalId} must contain only the zh-CN source language.`,
        );
    }
    const descriptions = Object.fromEntries(TARGET_LANGUAGES.map(languageCode => {
        const text = localized.get(languageCode);
        return [
            languageCode,
            validateDescription(text?.description, languageCode),
        ];
    }));
    const titles = Object.fromEntries(TARGET_LANGUAGES.map(languageCode => {
        const text = localized.get(languageCode);
        return [
            languageCode,
            validateFactualText(
                text?.title,
                `Projected ${languageCode} factual title`,
                256,
            ),
        ];
    }));
    const sourceLinks = {
        stableLookupUrl: observation.sourceDestination.lookupUri,
        ...(observation.sourceDestination.canonicalUri
            ? {
                observedCanonicalUrl:
                    observation.sourceDestination.canonicalUri,
            }
            : {}),
    };
    return { descriptions, observation, sourceLinks, titles };
}

function projectedDescriptions(projectedItem) {
    return projectedContent(projectedItem).descriptions;
}

function projectedFacts(observation, externalId) {
    if (!Array.isArray(observation.factualAttributes)) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
            `Projection item ${externalId} factual attributes must be an array.`,
        );
    }
    const facts = new Map();
    for (const fact of observation.factualAttributes) {
        requireObject(
            fact,
            'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
            `Projection item ${externalId} factual attribute`,
        );
        if (typeof fact.attributeCode !== 'string' ||
            !FACT_CODE.test(fact.attributeCode) ||
            facts.has(fact.attributeCode)) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
                `Projection item ${externalId} has a duplicate or invalid factual attribute.`,
            );
        }
        facts.set(
            fact.attributeCode,
            validateFactualText(
                fact.normalizedValue,
                `Projection item ${externalId} fact ${fact.attributeCode}`,
            ),
        );
    }
    return facts;
}

function decimalValueText(value, label) {
    const decimal = requireObject(
        value,
        'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
        label,
    );
    if (typeof decimal.units !== 'string' ||
        !DECIMAL_UNITS.test(decimal.units) ||
        !Number.isInteger(decimal.nanos) ||
        decimal.nanos < 0 ||
        decimal.nanos > 999999999) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
            `${label} is not a positive DecimalValue.`,
        );
    }
    const fraction = String(decimal.nanos).padStart(9, '0').replace(/0+$/, '');
    const text = `${decimal.units}${fraction ? `.${fraction}` : ''}`;
    if (text === '0') {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
            `${label} must be positive.`,
        );
    }
    return text;
}

function decimalAsFixedSix(value, multiplier = 1n) {
    const [whole, fraction = ''] = value.split('.');
    if (fraction.length > 6) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
            'Exact unit weight exceeds the ProductCatalog six-decimal scale.',
        );
    }
    const scaled =
        (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0') || '0')) *
        multiplier;
    const resultWhole = scaled / 1000000n;
    const resultFraction = (scaled % 1000000n).toString().padStart(6, '0');
    return `${resultWhole}.${resultFraction}`;
}

function projectedPackage(observation, externalId) {
    if (typeof observation.packageComponentsExact !== 'boolean' ||
        !Array.isArray(observation.packageComponents)) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
            `Projection item ${externalId} package evidence is invalid.`,
        );
    }
    const rawPackageText = observation.rawPackageText === undefined
        ? null
        : validateFactualText(
            observation.rawPackageText,
            `Projection item ${externalId} raw package text`,
            4000,
        );
    if (!observation.packageComponentsExact) {
        if (observation.packageComponents.length !== 0) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
                `Projection item ${externalId} inexact package must not contain structured components.`,
            );
        }
        return {
            components: [],
            exact: false,
            rawPackageText,
            unitWeight: null,
        };
    }
    const pairs = new Set();
    const ordinals = new Set();
    const components = observation.packageComponents.map((component, index) => {
        requireObject(
            component,
            'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
            `Projection item ${externalId} package component ${index}`,
        );
        if (!Number.isSafeInteger(component.ordinal) ||
            component.ordinal < 0 ||
            ordinals.has(component.ordinal) ||
            typeof component.containedUnitCode !== 'string' ||
            !FACT_CODE.test(component.containedUnitCode) ||
            typeof component.containerUnitCode !== 'string' ||
            !FACT_CODE.test(component.containerUnitCode)) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
                `Projection item ${externalId} package component ${index} is invalid.`,
            );
        }
        const pair =
            `${component.containedUnitCode}\0${component.containerUnitCode}`;
        if (pairs.has(pair)) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
                `Projection item ${externalId} has duplicate package unit transitions.`,
            );
        }
        pairs.add(pair);
        ordinals.add(component.ordinal);
        return {
            ordinal: component.ordinal,
            quantity: decimalValueText(
                component.quantity,
                `Projection item ${externalId} package component ${index} quantity`,
            ),
            containedUnitCode: component.containedUnitCode,
            containerUnitCode: component.containerUnitCode,
        };
    }).sort((left, right) => left.ordinal - right.ordinal);
    if (components.some((component, index) => component.ordinal !== index)) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
            `Projection item ${externalId} package component ordinals must be contiguous.`,
        );
    }
    const massComponent = components.find(component =>
        component.containedUnitCode === 'g' ||
        component.containedUnitCode === 'kg',
    );
    const unitWeight = massComponent
        ? decimalAsFixedSix(
            massComponent.quantity,
            massComponent.containedUnitCode === 'kg' ? 1000n : 1n,
        )
        : null;
    return {
        components,
        exact: true,
        rawPackageText,
        unitWeight,
    };
}

function projectedPriceBases(observation, externalId) {
    if (!Array.isArray(observation.referencePrices)) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
            `Projection item ${externalId} reference prices must be an array.`,
        );
    }
    return [...new Set(observation.referencePrices.map((price, index) => {
        requireObject(
            price,
            'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
            `Projection item ${externalId} reference price ${index}`,
        );
        if (typeof price.basisUnitCode !== 'string' ||
            !FACT_CODE.test(price.basisUnitCode)) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_PROJECTION_INVALID',
                `Projection item ${externalId} reference price ${index} basis is invalid.`,
            );
        }
        return price.basisUnitCode;
    }))].sort();
}

function optionSpecification(
    attribute,
    option,
    order,
    group = SOURCE_SPECIFICATION_GROUP,
) {
    return {
        group,
        attribute,
        option,
        type: 'Option',
        showOnPage: true,
        order,
    };
}

function textSpecification(
    attribute,
    value,
    order,
    type = 'CustomText',
    group = SOURCE_SPECIFICATION_GROUP,
) {
    return {
        group,
        attribute,
        type,
        value,
        showOnPage: true,
        order,
    };
}

function resolveBatchSpecification(options = {}) {
    if (options === undefined) return null;
    const reconciliationOptions = requireObject(
        options,
        'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
        'Reconciliation options',
    );
    if (reconciliationOptions.catalogReference === undefined) return null;
    const catalogReference = requireObject(
        reconciliationOptions.catalogReference,
        'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
        'Catalog reference',
    );
    if (!Array.isArray(catalogReference.specificationGroups) ||
        !Array.isArray(catalogReference.specificationAttributes)) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
            'Catalog reference specification groups and attributes must be arrays.',
        );
    }
    const publishedGroups = new Set(catalogReference.specificationGroups
        .filter(group =>
            group?.published === true &&
            typeof group.code === 'string' &&
            group.code.trim() === group.code &&
            group.code)
        .map(group => group.code));
    const candidates = catalogReference.specificationAttributes.flatMap(attribute => {
        if (!attribute ||
            attribute.published !== true ||
            attribute.type !== 'CustomText' ||
            typeof attribute.code !== 'string' ||
            !attribute.code ||
            attribute.code.trim() !== attribute.code ||
            !Array.isArray(attribute.translations)) {
            return [];
        }
        const names = attribute.translations.map(translation =>
            typeof translation?.name === 'string'
                ? translation.name.trim().toLocaleLowerCase('en-US')
                : '',
        );
        if (!names.some(name => BATCH_ATTRIBUTE_NAMES.has(name))) return [];
        const group = typeof attribute.group === 'string' && attribute.group
            ? attribute.group
            : SOURCE_SPECIFICATION_GROUP;
        if (!publishedGroups.has(group)) return [];
        return [{
            attribute: attribute.code,
            group,
            type: attribute.type,
        }];
    });
    if (candidates.length > 1) {
        fail(
            'CATALOG_SOURCE_RECONCILIATION_BATCH_DEFINITION_AMBIGUOUS',
            'Catalog reference contains more than one published CustomText batch definition.',
        );
    }
    return candidates[0] || null;
}

function sourceSpecifications(observation, externalId, batchSpecification = null) {
    const facts = projectedFacts(observation, externalId);
    const packageEvidence = projectedPackage(observation, externalId);
    const priceBases = projectedPriceBases(observation, externalId);
    const specifications = [optionSpecification(
        SOURCE_SPECIFICATIONS.teaType,
        'SPEC-TT-OPT-CLASSIFICATION-ORIGIN-TEA-TYPE-PUER',
        10,
        TEA_TYPE_SPECIFICATION_GROUP,
    )];
    const year = facts.get('year') || facts.get('year-label');
    const canonicalYear = year?.match(/^(19|20)\d{2}(?:年)?$/u)?.[0]
        ?.replace(/年$/u, '');
    if (canonicalYear) {
        specifications.push(optionSpecification(
            SOURCE_SPECIFICATIONS.year,
            `OPT-PUERH-VINTAGE-${canonicalYear}`,
            20,
        ));
    }
    const batch = facts.get('batch');
    if (batch && batchSpecification) {
        specifications.push(textSpecification(
            batchSpecification.attribute,
            batch,
            25,
            batchSpecification.type,
            batchSpecification.group,
        ));
    }
    const processing = PROCESSING_OPTIONS[facts.get('production-technology')];
    if (processing) {
        specifications.push(optionSpecification(
            SOURCE_SPECIFICATIONS.processing,
            processing,
            30,
        ));
    }
    const shape = SHAPE_OPTIONS[facts.get('shape')];
    if (shape) {
        specifications.push(optionSpecification(
            SOURCE_SPECIFICATIONS.shape,
            shape,
            40,
        ));
    }
    if (packageEvidence.rawPackageText) {
        specifications.push(textSpecification(
            SOURCE_SPECIFICATIONS.rawPackage,
            packageEvidence.rawPackageText,
            50,
        ));
    }
    if (packageEvidence.unitWeight) {
        specifications.push(textSpecification(
            SOURCE_SPECIFICATIONS.unitWeight,
            packageEvidence.unitWeight,
            60,
            'Number',
        ));
    }
    if (priceBases.length) {
        specifications.push(textSpecification(
            SOURCE_SPECIFICATIONS.referencePriceBasis,
            priceBases.join(','),
            70,
        ));
    }
    return specifications;
}

function assertSafeOutputDescriptions(product) {
    for (const translation of product.translations) {
        if (!TARGET_LANGUAGES.includes(translation?.lang)) continue;
        for (const field of ['description']) {
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

function mergeSourceSpecifications(baseline, projected, batchSpecification = null) {
    const sourceSpecificationCodes = new Set(SOURCE_SPECIFICATION_CODES);
    if (batchSpecification) {
        sourceSpecificationCodes.add(batchSpecification.attribute);
    }
    return [
        ...baseline.filter(specification =>
            !sourceSpecificationCodes.has(specification?.attribute)),
        ...projected,
    ];
}

function patchMatchedProduct(product, content, batchSpecification = null) {
    const rollbackProduct = deepClone(product);
    const productPatch = deepClone(product);
    const targetCounts = Object.fromEntries(TARGET_LANGUAGES.map(languageCode => [
        languageCode,
        0,
    ]));
    productPatch.nativeName = content.titles['zh-CN'];
    productPatch.translations = productPatch.translations.flatMap(translation => {
        requireObject(
            translation,
            'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
            `${product.code} translation`,
        );
        if (!TARGET_LANGUAGES.includes(translation.lang)) return [];
        targetCounts[translation.lang] += 1;
        const sourceTranslation = {
            ...translation,
            name: content.titles[translation.lang],
            description: content.descriptions[translation.lang],
        };
        delete sourceTranslation.seo;
        delete sourceTranslation.seoTitle;
        delete sourceTranslation.metaTitle;
        delete sourceTranslation.metaDescription;
        return [sourceTranslation];
    });
    for (const languageCode of TARGET_LANGUAGES) {
        if (targetCounts[languageCode] !== 1) {
            fail(
                'CATALOG_SOURCE_RECONCILIATION_REFERENCE_INVALID',
                `${product.code} must contain exactly one ${languageCode} translation.`,
            );
        }
    }
    productPatch.specifications = mergeSourceSpecifications(
        productPatch.specifications,
        sourceSpecifications(
            content.observation,
            product.code.slice(4),
            batchSpecification,
        ),
        batchSpecification,
    );
    assertSafeOutputDescriptions(productPatch);
    return { productPatch, rollbackProduct };
}

function sourceOwnedProductState(product, batchSpecification = null) {
    const sourceSpecificationCodes = new Set(SOURCE_SPECIFICATION_CODES);
    if (batchSpecification) {
        sourceSpecificationCodes.add(batchSpecification.attribute);
    }
    const translations = (product.translations || [])
        .filter(translation => TARGET_LANGUAGES.includes(translation?.lang))
        .map(translation => ({
            lang: translation.lang,
            name: translation.name,
            description: translation.description,
        }))
        .sort((left, right) => left.lang.localeCompare(right.lang));
    const specifications = (product.specifications || [])
        .filter(specification =>
            sourceSpecificationCodes.has(specification?.attribute))
        .map(specification => deepClone(specification))
        .sort((left, right) =>
            stableJson(left).localeCompare(stableJson(right)));
    return {
        nativeName: product.nativeName,
        translations,
        specifications,
    };
}

function draftProduct(productCode, content, externalId, batchSpecification = null) {
    const facts = projectedFacts(content.observation, externalId);
    const categories = new Set(['CAT-PUER-TEA']);
    const processingCategory = {
        '生茶': 'CAT-PUER-SHENG',
        '熟茶': 'CAT-PUER-SHU',
    }[facts.get('production-technology')];
    if (processingCategory) categories.add(processingCategory);
    const shapeCategory = {
        '饼': 'CAT-SHAPE-CAKE',
        '饼茶': 'CAT-SHAPE-CAKE',
        '砖': 'CAT-SHAPE-BRICK',
        '砖茶': 'CAT-SHAPE-BRICK',
        '沱': 'CAT-SHAPE-TUO',
        '沱茶': 'CAT-SHAPE-TUO',
    }[facts.get('shape')];
    if (shapeCategory) categories.add(shapeCategory);
    const productPatch = {
        code: productCode,
        sku: productCode,
        nativeName: content.titles['zh-CN'],
        published: false,
        translations: TARGET_LANGUAGES.map(languageCode => ({
            lang: languageCode,
            name: content.titles[languageCode],
            description: content.descriptions[languageCode],
        })),
        specifications: sourceSpecifications(
            content.observation,
            externalId,
            batchSpecification,
        ),
        tags: [],
        tierPrices: [],
        catalogPrices: [],
        storePriceOverrides: [],
        packages: [],
        catalogs: [...categories].map(category => ({
            catalog: {
                code: 'CATALOG-PUERH',
                currency: 'CNY',
                translations: [],
            },
            category: {
                code: category,
                parent: null,
                translations: [],
            },
            order: 0,
            published: false,
        })),
        origins: [],
        related: [],
        crossSells: [],
    };
    assertSafeOutputDescriptions(productPatch);
    return productPatch;
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

function reconcileProjection(projection, products, options = {}) {
    const projectedItems = validateProjection(projection);
    const productsByCode = validateProducts(products);
    const batchSpecification = resolveBatchSpecification(options);
    const entries = projectedItems.map(projectedItem => {
        const externalId = requireExternalId(projectedItem.externalId);
        const productCode = exactProductCode(externalId);
        const content = projectedContent(projectedItem);
        const product = productsByCode.get(productCode);
        if (!product) {
            return {
                externalId,
                productCode,
                sourceLinks: content.sourceLinks,
                status: 'missing-create-draft',
                published: false,
                productPatch: draftProduct(
                    productCode,
                    content,
                    externalId,
                    batchSpecification,
                ),
            };
        }
        const { productPatch, rollbackProduct } = patchMatchedProduct(
            product,
            content,
            batchSpecification,
        );
        const changed =
            stableJson(sourceOwnedProductState(
                productPatch,
                batchSpecification,
            )) !==
            stableJson(sourceOwnedProductState(
                rollbackProduct,
                batchSpecification,
            ));
        return {
            externalId,
            productId: product.id,
            productCode,
            sourceLinks: content.sourceLinks,
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
    SOURCE_SPECIFICATION_GROUP,
    SOURCE_SPECIFICATIONS,
    deepClone,
    draftProduct,
    exactProductCode,
    patchMatchedProduct,
    projectedDescriptions,
    resolveBatchSpecification,
    sourceOwnedProductState,
    sourceSpecifications,
    reconcileProjection,
    validateDescription,
};
