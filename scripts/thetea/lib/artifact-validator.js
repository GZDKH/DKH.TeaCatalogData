const { analyzeCatalogMapping, DEFAULT_CATALOG_CODE } = require('./catalog-mapping');
const { ATTRIBUTE_TYPES } = require('./spec-contract');
const { isManagedSpecification, validateBaselinePreservation } = require('./product-overlay');

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,99}$/;
const ATTRIBUTE_TYPE_SET = new Set(ATTRIBUTE_TYPES);
const TEXT_TYPES = new Set([
    'CustomText',
    'CustomHtmlText',
    'CustomMarkdownText',
    'Hyperlink',
]);
const MAX_DURATION_SECONDS = 9223372036854775807n;
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

function validateArtifact(input = {}) {
    const errors = [];
    const warnings = [];
    const products = arrayInput(input.products, 'products', errors);
    const definitions = objectInput(input.definitions, 'definitions', errors);
    const groups = arrayInput(definitions.groups, 'definitions.groups', errors);
    const attributes = arrayInput(definitions.attributes, 'definitions.attributes', errors);
    const options = arrayInput(definitions.options, 'definitions.options', errors);
    const requiredLocales = normalizeRequiredLocales(input.requiredLocales, errors);
    const lossEvents = arrayInput(input.lossEvents, 'lossEvents', errors, true);
    const languageCoverage = {};
    const specTypes = {};
    const localeCoverage = {};
    const relationCounts = { related: 0, crossSells: 0, total: 0 };

    for (const locale of requiredLocales) ensureLocaleCoverage(localeCoverage, locale);

    if (products.length === 0) errors.push('Artifact must contain at least one product.');

    const groupIndex = buildDefinitionIndex(groups, 'group', errors);
    const attributeIndex = buildDefinitionIndex(attributes, 'attribute', errors);
    const optionIndex = buildDefinitionIndex(options, 'option', errors);

    validateGroupDefinitions(groups, requiredLocales, localeCoverage, errors);
    validateAttributeDefinitions(
        attributes,
        groupIndex,
        requiredLocales,
        localeCoverage,
        errors);
    validateOptionDefinitions(
        options,
        attributeIndex,
        requiredLocales,
        localeCoverage,
        errors);

    const productIndex = new Map();
    const usedGroups = new Set();
    const usedAttributes = new Set();
    const usedOptions = new Set();

    for (const [productIndexNumber, product] of products.entries()) {
        if (!isPlainObject(product)) {
            errors.push(`products[${productIndexNumber}] must be an object.`);
            continue;
        }

        const productLabel = product.code || `<product:${productIndexNumber}>`;
        const productCode = validateCode(product.code, `${productLabel}: product code`, errors);
        if (productCode) {
            if (productIndex.has(productCode)) {
                errors.push(`${productLabel}: duplicate product code ${productCode}.`);
            } else {
                productIndex.set(productCode, product);
            }
        }

        collectProductLanguageCoverage(product, languageCoverage);
        validateProductTranslations(product, productLabel, requiredLocales, errors);
        validateCatalogAssignments(product, productLabel, errors);
        validatePackages(product, productLabel, input.knownPackages || KNOWN_PACKAGES, warnings, errors);
        validateProductSpecifications({
            product,
            productLabel,
            groupIndex,
            attributeIndex,
            optionIndex,
            specTypes,
            usedGroups,
            usedAttributes,
            usedOptions,
            errors,
        });
        validateOrigins(product, productLabel, errors);
    }

    const knownProductCodes = new Set([
        ...productIndex.keys(),
        ...(input.baselineProducts || []).map(product => normalizeCode(product?.code)).filter(Boolean),
    ]);
    for (const product of products) {
        if (!isPlainObject(product)) continue;
        validateProductRelations(product, knownProductCodes, relationCounts, errors);
    }

    validateDefinitionParity({
        groups,
        attributes,
        options,
        usedGroups,
        usedAttributes,
        usedOptions,
        errors,
    });

    const routedContentCounts = validateRoutedContent(
        input.routedContent,
        productIndex,
        requiredLocales,
        lossEvents,
        errors);
    validateLossEvents(lossEvents, errors, warnings);
    errors.push(...validateBaselinePreservation(products, input.baselineProducts || []));

    let catalogMapping = null;
    if (input.catalogReference !== null && input.catalogReference !== undefined) {
        try {
            catalogMapping = analyzeCatalogMapping(products, input.catalogReference, {
                requiredCatalogCode: input.requiredCatalogCode || DEFAULT_CATALOG_CODE,
            });
            errors.push(...catalogMapping.errors);
            warnings.push(...catalogMapping.warnings);
        } catch (error) {
            errors.push(`Catalog mapping analysis failed: ${error.message}`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        productCount: products.length,
        languageCoverage,
        specTypes,
        catalogMapping,
        definitionCounts: {
            groups: groups.length,
            attributes: attributes.length,
            options: options.length,
        },
        localeCoverage,
        relationCounts,
        routedContentCounts,
        lossEvents: lossEvents.slice(),
    };
}

function arrayInput(value, label, errors, optional = false) {
    if (value === undefined && optional) return [];
    if (!Array.isArray(value)) {
        errors.push(`${label} must be an array.`);
        return [];
    }
    return value;
}

function objectInput(value, label, errors) {
    if (!isPlainObject(value)) {
        errors.push(`${label} must be an object.`);
        return {};
    }
    return value;
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRequiredLocales(value, errors) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        errors.push('requiredLocales must be an array.');
        return [];
    }

    const result = [];
    const seen = new Set();
    for (const [index, rawLocale] of value.entries()) {
        const locale = String(rawLocale || '').trim();
        if (!locale) {
            errors.push(`requiredLocales[${index}] must be a non-empty locale.`);
            continue;
        }
        const key = locale.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(locale);
    }
    return result;
}

function buildDefinitionIndex(definitions, label, errors) {
    const index = new Map();
    for (const [position, definition] of definitions.entries()) {
        if (!isPlainObject(definition)) {
            errors.push(`definitions.${label}s[${position}] must be an object.`);
            continue;
        }

        const code = validateCode(
            definition.code,
            `definitions.${label}s[${position}].code`,
            errors);
        if (!code) continue;
        if (index.has(code)) {
            errors.push(`Duplicate ${label} definition code ${code}.`);
            continue;
        }
        index.set(code, definition);
    }
    return index;
}

function validateGroupDefinitions(groups, requiredLocales, localeCoverage, errors) {
    for (const [index, group] of groups.entries()) {
        if (!isPlainObject(group)) continue;
        validateDefinitionTranslations(
            group,
            `group ${group.code || index}`,
            'groups',
            requiredLocales,
            localeCoverage,
            errors);
    }
}

function validateAttributeDefinitions(
    attributes,
    groupIndex,
    requiredLocales,
    localeCoverage,
    errors) {
    for (const [index, attribute] of attributes.entries()) {
        if (!isPlainObject(attribute)) continue;
        const label = `attribute ${attribute.code || index}`;
        const groupCode = validateCode(attribute.group, `${label}: group`, errors);
        if (groupCode && !groupIndex.has(groupCode)) {
            errors.push(`${label}: references undefined group ${groupCode}.`);
        }

        if (!ATTRIBUTE_TYPE_SET.has(attribute.type)) {
            errors.push(`${label}: unsupported type '${attribute.type}'.`);
        }

        if (attribute.unit !== undefined && attribute.unit !== null
            && (typeof attribute.unit !== 'string' || !attribute.unit.trim())) {
            errors.push(`${label}: unit must be a non-empty string when present.`);
        }

        validateDefinitionTranslations(
            attribute,
            label,
            'attributes',
            requiredLocales,
            localeCoverage,
            errors);
    }
}

function validateOptionDefinitions(
    options,
    attributeIndex,
    requiredLocales,
    localeCoverage,
    errors) {
    for (const [index, option] of options.entries()) {
        if (!isPlainObject(option)) continue;
        const label = `option ${option.code || index}`;
        const attributeCode = validateCode(option.attribute, `${label}: attribute`, errors);
        const attribute = attributeCode ? attributeIndex.get(attributeCode) : null;
        if (attributeCode && !attribute) {
            errors.push(`${label}: references undefined attribute ${attributeCode}.`);
        } else if (attribute && attribute.type !== 'Option') {
            errors.push(`${label}: parent attribute ${attributeCode} has type ${attribute.type}, not Option.`);
        }

        validateDefinitionTranslations(
            option,
            label,
            'options',
            requiredLocales,
            localeCoverage,
            errors);
    }
}

function validateDefinitionTranslations(
    definition,
    label,
    kind,
    requiredLocales,
    localeCoverage,
    errors) {
    if (!Array.isArray(definition.translations)) {
        errors.push(`${label}: translations must be an array.`);
        for (const locale of requiredLocales) {
            errors.push(`${label}: missing required ${locale} translation.`);
        }
        return;
    }

    const translatedLocales = new Map();
    for (const [index, translation] of definition.translations.entries()) {
        if (!isPlainObject(translation)) {
            errors.push(`${label}: translations[${index}] must be an object.`);
            continue;
        }
        const locale = String(translation.lang || '').trim();
        if (!locale) {
            errors.push(`${label}: translations[${index}] has no locale.`);
            continue;
        }
        const key = locale.toLowerCase();
        if (translatedLocales.has(key)) {
            errors.push(`${label}: duplicate ${locale} translation.`);
            continue;
        }
        translatedLocales.set(key, locale);
        if (typeof translation.name !== 'string' || !translation.name.trim()) {
            errors.push(`${label}: ${locale} translation has no name.`);
            continue;
        }
        ensureLocaleCoverage(localeCoverage, locale)[kind] += 1;
    }

    for (const locale of requiredLocales) {
        if (!translatedLocales.has(locale.toLowerCase())) {
            errors.push(`${label}: missing required ${locale} translation.`);
        }
    }
}

function ensureLocaleCoverage(localeCoverage, locale) {
    const existingKey = Object.keys(localeCoverage)
        .find(key => key.toLowerCase() === locale.toLowerCase());
    const key = existingKey || locale;
    if (!localeCoverage[key]) {
        localeCoverage[key] = { groups: 0, attributes: 0, options: 0 };
    }
    return localeCoverage[key];
}

function collectProductLanguageCoverage(product, languageCoverage) {
    if (!Array.isArray(product.translations)) return;
    const seen = new Set();
    for (const translation of product.translations) {
        const locale = String(translation?.lang || '').trim();
        const key = locale.toLowerCase();
        if (!locale || seen.has(key)) continue;
        seen.add(key);
        languageCoverage[locale] = (languageCoverage[locale] || 0) + 1;
    }
}

function validateProductTranslations(product, productLabel, requiredLocales, errors) {
    if (!Array.isArray(product.translations)) {
        errors.push(`${productLabel}: translations must be an array.`);
        return;
    }

    const locales = new Set();
    for (const [index, translation] of product.translations.entries()) {
        if (!isPlainObject(translation)) {
            errors.push(`${productLabel}: translations[${index}] must be an object.`);
            continue;
        }
        const locale = String(translation.lang || '').trim();
        const key = locale.toLowerCase();
        if (!locale) {
            errors.push(`${productLabel}: translations[${index}] has no locale.`);
            continue;
        }
        if (locales.has(key)) errors.push(`${productLabel}: duplicate ${locale} product translation.`);
        locales.add(key);
        if (typeof translation.name !== 'string' || !translation.name.trim()) {
            errors.push(`${productLabel}: ${locale} product translation has no name.`);
        }
    }

    if (!locales.has('en-us')) errors.push(`${productLabel}: missing en-US translation with name.`);
    for (const locale of requiredLocales) {
        if (!locales.has(locale.toLowerCase())) {
            errors.push(`${productLabel}: missing required ${locale} product translation.`);
        }
    }
}

function validateCatalogAssignments(product, productLabel, errors) {
    if (!Array.isArray(product.catalogs) || product.catalogs.length === 0) {
        errors.push(`${productLabel}: no catalog/category assignments.`);
        return;
    }

    const seen = new Set();
    for (const [index, assignment] of product.catalogs.entries()) {
        const prefix = `${productLabel}: catalogs[${index}]`;
        if (!isPlainObject(assignment)) {
            errors.push(`${prefix} must be an object.`);
            continue;
        }
        const catalog = validateCode(assignment.catalog, `${prefix}.catalog`, errors);
        const category = validateCode(assignment.category, `${prefix}.category`, errors);
        const key = `${catalog}|${category}`;
        if (seen.has(key)) errors.push(`${prefix}: duplicate catalog/category assignment.`);
        seen.add(key);
    }
}

function validatePackages(product, productLabel, knownPackages, warnings, errors) {
    if (!Array.isArray(product.packages)) {
        errors.push(`${productLabel}: packages must be an array.`);
        return;
    }
    const seen = new Set();
    for (const [index, item] of product.packages.entries()) {
        if (!isPlainObject(item)) {
            errors.push(`${productLabel}: packages[${index}] must be an object.`);
            continue;
        }
        const code = validateCode(item.package, `${productLabel}: packages[${index}].package`, errors);
        if (seen.has(code)) errors.push(`${productLabel}: duplicate package ${code}.`);
        seen.add(code);
        if (code && !knownPackages.has(code)) {
            warnings.push(`${productLabel}: package ${code} is not in known package set.`);
        }
    }
}

function validateProductSpecifications(context) {
    const {
        product,
        productLabel,
        groupIndex,
        attributeIndex,
        optionIndex,
        specTypes,
        usedGroups,
        usedAttributes,
        usedOptions,
        errors,
    } = context;

    if (product.specifications === undefined) return;
    if (!Array.isArray(product.specifications)) {
        errors.push(`${productLabel}: specifications must be an array.`);
        return;
    }

    const seenAttributes = new Set();
    for (const [index, spec] of product.specifications.entries()) {
        const prefix = `${productLabel}: specifications[${index}]`;
        if (!isPlainObject(spec)) {
            errors.push(`${prefix} must be an object.`);
            continue;
        }

        const attributeCode = validateCode(spec.attribute, `${prefix}.attribute`, errors);
        const groupCode = validateCode(spec.group, `${prefix}.group`, errors);
        const type = spec.type;
        if (ATTRIBUTE_TYPE_SET.has(type)) {
            specTypes[type] = (specTypes[type] || 0) + 1;
        } else {
            specTypes[String(type)] = (specTypes[String(type)] || 0) + 1;
            errors.push(`${prefix}: unsupported type '${type}'.`);
        }

        const managed = isManagedSpecification(spec);
        if (attributeCode && managed) {
            if (seenAttributes.has(attributeCode)) {
                errors.push(`${productLabel}: specification attribute ${attributeCode} occurs more than once.`);
            }
            seenAttributes.add(attributeCode);
            usedAttributes.add(attributeCode);
        }
        if (groupCode && managed) usedGroups.add(groupCode);

        const group = managed && groupCode ? groupIndex.get(groupCode) : null;
        const attribute = managed && attributeCode ? attributeIndex.get(attributeCode) : null;
        if (managed && groupCode && !group) errors.push(`${prefix}: references undefined group ${groupCode}.`);
        if (managed && attributeCode && !attribute) {
            errors.push(`${prefix}: references undefined attribute ${attributeCode}.`);
        }

        if (attribute) {
            const attributeGroup = normalizeCode(attribute.group);
            if (groupCode && attributeGroup !== groupCode) {
                errors.push(
                    `${prefix}: group ${groupCode} differs from attribute definition group ${attributeGroup}.`);
            }
            if (type !== attribute.type) {
                errors.push(
                    `${prefix}: type ${type} differs from attribute definition type ${attribute.type}.`);
            }
            if (hasDefined(spec, 'unit')) {
                const productUnit = String(spec.unit);
                const definitionUnit = attribute.unit === undefined || attribute.unit === null
                    ? null
                    : String(attribute.unit);
                if (productUnit !== definitionUnit) {
                    errors.push(
                        `${prefix}: unit '${productUnit}' differs from attribute definition unit '${definitionUnit}'.`);
                }
            }
        }

        validateSpecificationValue({
            spec,
            prefix,
            attributeCode,
            optionIndex,
            usedOptions,
            managed,
            errors,
        });
    }
}

function validateSpecificationValue({
    spec,
    prefix,
    attributeCode,
    optionIndex,
    usedOptions,
    managed,
    errors,
}) {
    const type = spec.type;
    const hasValue = hasDefined(spec, 'value');
    const hasMin = hasDefined(spec, 'valueMin');
    const hasMax = hasDefined(spec, 'valueMax');
    const hasOption = hasDefined(spec, 'option');
    const hasOptionName = hasDefined(spec, 'optionName');

    if (type === 'Option') {
        const optionCode = validateCode(spec.option, `${prefix}.option`, errors);
        if (optionCode && managed) {
            usedOptions.add(optionCode);
            const option = optionIndex.get(optionCode);
            if (!option) {
                errors.push(`${prefix}: references undefined option ${optionCode}.`);
            } else if (normalizeCode(option.attribute) !== attributeCode) {
                errors.push(
                    `${prefix}: option ${optionCode} belongs to attribute ${option.attribute}, not ${attributeCode}.`);
            }
        }
        if (hasValue || hasMin || hasMax) {
            errors.push(`${prefix}: Option cannot contain custom or range values.`);
        }
        return;
    }

    if (hasOption || hasOptionName) {
        errors.push(`${prefix}: ${type} cannot contain an option value.`);
    }

    if (type === 'Range') {
        if (hasValue) errors.push(`${prefix}: Range must use valueMin/valueMax, not value.`);
        if (!hasMin || !hasMax
            || !isFiniteNumber(spec.valueMin)
            || !isFiniteNumber(spec.valueMax)
            || spec.valueMin > spec.valueMax) {
            errors.push(`${prefix}: Range requires finite valueMin <= valueMax.`);
        }
        return;
    }

    if (hasMin || hasMax) {
        errors.push(`${prefix}: ${type} cannot contain range bounds.`);
    }

    if (TEXT_TYPES.has(type)) {
        if (typeof spec.value !== 'string' || !spec.value.trim()) {
            errors.push(`${prefix}: ${type} requires a non-empty text value.`);
            return;
        }
        if (type === 'Hyperlink' && !isHttpUrl(spec.value)) {
            errors.push(`${prefix}: Hyperlink requires an absolute http(s) URL.`);
        }
        return;
    }

    if (type === 'Number') {
        if (typeof spec.value !== 'string' || !isDecimal(spec.value)) {
            errors.push(`${prefix}: Number requires a finite invariant decimal string.`);
        }
        return;
    }

    if (type === 'List') {
        validateListValue(spec.value, prefix, errors);
        return;
    }

    if (type === 'Boolean') {
        if (spec.value !== 'true' && spec.value !== 'false') {
            errors.push(`${prefix}: Boolean value must be exactly 'true' or 'false'.`);
        }
        return;
    }

    if (type === 'Date') {
        if (typeof spec.value !== 'string' || !isIsoDate(spec.value)) {
            errors.push(`${prefix}: Date value must be a valid ISO date (YYYY-MM-DD).`);
        }
        return;
    }

    if (type === 'Duration') {
        if (typeof spec.value !== 'string' || !isDuration(spec.value)) {
            errors.push(`${prefix}: Duration value must be non-negative integral seconds.`);
        }
    }
}

function validateListValue(value, prefix, errors) {
    if (typeof value !== 'string') {
        errors.push(`${prefix}: List value must be a JSON string containing an array of strings.`);
        return;
    }

    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)
            || parsed.length === 0
            || parsed.some(item => typeof item !== 'string' || !item.trim())) {
            throw new Error('invalid list');
        }
    } catch {
        errors.push(`${prefix}: List value must be a non-empty JSON array of non-empty strings.`);
    }
}

function validateOrigins(product, productLabel, errors) {
    if (product.origins === undefined) return;
    if (!Array.isArray(product.origins)) {
        errors.push(`${productLabel}: origins must be an array.`);
        return;
    }

    for (const [index, origin] of product.origins.entries()) {
        const prefix = `${productLabel}: origins[${index}]`;
        if (!isPlainObject(origin)) {
            errors.push(`${prefix} must be an object.`);
            continue;
        }

        if (typeof origin.country !== 'string' || !/^[A-Z]{2}$/.test(origin.country)) {
            errors.push(`${prefix}: country must be an uppercase ISO 3166-1 alpha-2 code.`);
        }

        validateAltitude(origin.altitude, prefix, errors);
        validateCoordinates(origin.coordinates, prefix, errors);
        validateOriginTranslations(origin.translations, prefix, errors);
    }
}

function validateAltitude(altitude, prefix, errors) {
    if (altitude === undefined || altitude === null) return;
    if (!isPlainObject(altitude)) {
        errors.push(`${prefix}: altitude must be an object.`);
        return;
    }

    const hasMin = hasDefined(altitude, 'min');
    const hasMax = hasDefined(altitude, 'max');
    if (!hasMin && !hasMax) {
        errors.push(`${prefix}: altitude must contain min or max.`);
        return;
    }
    if (hasMin && !Number.isInteger(altitude.min)) {
        errors.push(`${prefix}: altitude.min must be an integer.`);
    }
    if (hasMax && !Number.isInteger(altitude.max)) {
        errors.push(`${prefix}: altitude.max must be an integer.`);
    }
    if (hasMin && hasMax
        && Number.isInteger(altitude.min)
        && Number.isInteger(altitude.max)
        && altitude.min > altitude.max) {
        errors.push(`${prefix}: altitude.min must be <= altitude.max.`);
    }
    if (hasDefined(altitude, 'unit')
        && (typeof altitude.unit !== 'string' || !altitude.unit.trim())) {
        errors.push(`${prefix}: altitude.unit must be a non-empty string.`);
    }
}

function validateCoordinates(coordinates, prefix, errors) {
    if (coordinates === undefined || coordinates === null) return;
    if (!isPlainObject(coordinates)) {
        errors.push(`${prefix}: coordinates must be an object.`);
        return;
    }

    if (!hasDefined(coordinates, 'lat') || !hasDefined(coordinates, 'lng')) {
        errors.push(`${prefix}: coordinates must contain both lat and lng.`);
        return;
    }
    if (!isFiniteNumber(coordinates.lat) || coordinates.lat < -90 || coordinates.lat > 90) {
        errors.push(`${prefix}: latitude must be between -90 and 90.`);
    }
    if (!isFiniteNumber(coordinates.lng) || coordinates.lng < -180 || coordinates.lng > 180) {
        errors.push(`${prefix}: longitude must be between -180 and 180.`);
    }
}

function validateOriginTranslations(translations, prefix, errors) {
    if (translations === undefined) return;
    if (!Array.isArray(translations)) {
        errors.push(`${prefix}: translations must be an array.`);
        return;
    }

    const seen = new Set();
    for (const [index, translation] of translations.entries()) {
        if (!isPlainObject(translation)) {
            errors.push(`${prefix}: translations[${index}] must be an object.`);
            continue;
        }
        const locale = String(translation.lang || '').trim();
        if (!locale) {
            errors.push(`${prefix}: translations[${index}] has no locale.`);
            continue;
        }
        const key = locale.toLowerCase();
        if (seen.has(key)) errors.push(`${prefix}: duplicate ${locale} translation.`);
        seen.add(key);
    }
}

function validateProductRelations(product, knownProductCodes, relationCounts, errors) {
    const productCode = normalizeCode(product.code);
    const productLabel = product.code || '<product>';
    validateRelationCollection({
        product,
        productCode,
        productLabel,
        field: 'related',
        requireOrder: true,
        knownProductCodes,
        relationCounts,
        errors,
    });
    validateRelationCollection({
        product,
        productCode,
        productLabel,
        field: 'crossSells',
        requireOrder: false,
        knownProductCodes,
        relationCounts,
        errors,
    });
}

function validateRelationCollection({
    product,
    productCode,
    productLabel,
    field,
    requireOrder,
    knownProductCodes,
    relationCounts,
    errors,
}) {
    if (product[field] === undefined) return;
    if (!Array.isArray(product[field])) {
        errors.push(`${productLabel}: ${field} must be an array.`);
        return;
    }

    relationCounts[field] += product[field].length;
    relationCounts.total += product[field].length;
    const seenRelations = new Set();
    const seenOrders = new Set();
    let previousOrder = -1;

    for (const [index, relation] of product[field].entries()) {
        const prefix = `${productLabel}: ${field}[${index}]`;
        if (!isPlainObject(relation)) {
            errors.push(`${prefix} must be an object.`);
            continue;
        }

        const targetCode = validateCode(relation.product, `${prefix}.product`, errors);
        const catalogCode = relation.catalog === undefined || relation.catalog === null
            ? ''
            : validateCode(relation.catalog, `${prefix}.catalog`, errors);
        if (targetCode) {
            if (targetCode === productCode) errors.push(`${prefix}: self relation is not allowed.`);
            if (!knownProductCodes.has(targetCode)) {
                errors.push(`${prefix}: target product ${targetCode} is missing from the artifact.`);
            }
            const relationKey = `${targetCode}|${catalogCode}`;
            if (seenRelations.has(relationKey)) {
                errors.push(`${prefix}: duplicate relation to ${targetCode}.`);
            }
            seenRelations.add(relationKey);
        }

        if (requireOrder) {
            if (!Number.isInteger(relation.order) || relation.order < 0) {
                errors.push(`${prefix}: order must be a non-negative integer.`);
                continue;
            }
            if (seenOrders.has(relation.order)) {
                errors.push(`${prefix}: duplicate relation order ${relation.order}.`);
            }
            if (relation.order < previousOrder) {
                errors.push(`${prefix}: relations must be sorted by ascending order.`);
            }
            seenOrders.add(relation.order);
            previousOrder = relation.order;
        }
    }
}

function validateDefinitionParity({
    groups,
    attributes,
    options,
    usedGroups,
    usedAttributes,
    usedOptions,
    errors,
}) {
    const groupsReferencedByAttributes = new Set(
        attributes
            .filter(isPlainObject)
            .map(attribute => normalizeCode(attribute.group))
            .filter(Boolean));

    for (const group of groups) {
        if (!isPlainObject(group)) continue;
        const code = normalizeCode(group.code);
        if (code && !groupsReferencedByAttributes.has(code)) {
            errors.push(`Group definition ${code} is not referenced by any attribute.`);
        }
        if (code && groupsReferencedByAttributes.has(code) && !usedGroups.has(code)) {
            errors.push(`Group definition ${code} is not referenced by any product specification.`);
        }
    }
    for (const attribute of attributes) {
        if (!isPlainObject(attribute)) continue;
        const code = normalizeCode(attribute.code);
        if (code && !usedAttributes.has(code)) {
            errors.push(`Attribute definition ${code} is not referenced by any product specification.`);
        }
    }
    for (const option of options) {
        if (!isPlainObject(option)) continue;
        const code = normalizeCode(option.code);
        if (code && !usedOptions.has(code)) {
            errors.push(`Option definition ${code} is not referenced by any product specification.`);
        }
    }
}

function validateLossEvents(lossEvents, errors, warnings) {
    for (const [index, event] of lossEvents.entries()) {
        if (!isPlainObject(event)) {
            errors.push(`lossEvents[${index}] must be an object.`);
            continue;
        }
        const severity = String(event.severity || '').trim().toLowerCase();
        const message = String(event.message || event.reason || event.path || `event ${index}`).trim();
        if (event.target && Number(event.count) > 0 && event.routed !== true) {
            errors.push(`Loss event is not backed by a routed artifact: ${message}`);
        }
        if (severity === 'error' || severity === 'fatal' || event.fatal === true) {
            errors.push(`Loss event: ${message}`);
        } else if (severity === 'warning' || severity === 'warn') {
            warnings.push(`Loss event: ${message}`);
        }
    }
}

function validateRoutedContent(value, productIndex, requiredLocales, lossEvents, errors) {
    const routed = value === undefined ? { articles: [], metaobjects: [] } : value;
    if (!isPlainObject(routed)) {
        errors.push('routedContent must be an object.');
        return emptyRoutedContentCounts();
    }
    const articles = arrayInput(routed.articles, 'routedContent.articles', errors);
    const metaobjects = arrayInput(routed.metaobjects, 'routedContent.metaobjects', errors);
    const counts = emptyRoutedContentCounts();
    counts.articles = articles.length;
    counts.metaobjects = metaobjects.length;
    const sourceCounts = new Map();
    const articleCodes = new Set();
    const metaobjectCodes = new Set();

    for (const [index, article] of articles.entries()) {
        const prefix = `routedContent.articles[${index}]`;
        if (!isPlainObject(article)) {
            errors.push(`${prefix} must be an object.`);
            continue;
        }
        const code = validateCode(article.code, `${prefix}.code`, errors);
        if (code && articleCodes.has(code)) errors.push(`${prefix}: duplicate article code ${code}.`);
        articleCodes.add(code);
        const product = validateCode(article.product, `${prefix}.product`, errors);
        if (product && !productIndex.has(product)) errors.push(`${prefix}: unknown product ${product}.`);
        if (!Array.isArray(article.translations)) {
            errors.push(`${prefix}.translations must be an array.`);
            continue;
        }
        const locales = new Set();
        for (const [translationIndex, translation] of article.translations.entries()) {
            const translationPrefix = `${prefix}.translations[${translationIndex}]`;
            if (!isPlainObject(translation)) {
                errors.push(`${translationPrefix} must be an object.`);
                continue;
            }
            const locale = String(translation.lang || '').trim();
            const localeKey = locale.toLowerCase();
            if (!locale) errors.push(`${translationPrefix} has no locale.`);
            else if (locales.has(localeKey)) errors.push(`${translationPrefix}: duplicate locale ${locale}.`);
            locales.add(localeKey);
            counts.articleTranslations += 1;
            if (typeof translation.markdown === 'string' && translation.markdown.trim()) {
                counts.markdown += 1;
                incrementSourceCount(sourceCounts, product, 'markdown', 1);
            }
            const narrativeTotal = countNarratives(translation.narratives, translationPrefix, errors);
            counts.narratives += narrativeTotal;
            incrementSourceCount(sourceCounts, product, 'localized-section-narratives', narrativeTotal);
            if (!(typeof translation.markdown === 'string' && translation.markdown.trim())
                && narrativeTotal === 0) {
                errors.push(`${translationPrefix} has no routed article content.`);
            }
        }
        for (const locale of requiredLocales) {
            if (!locales.has(locale.toLowerCase())) {
                errors.push(`${prefix}: missing required ${locale} article translation.`);
            }
        }
    }

    for (const [index, metaobject] of metaobjects.entries()) {
        const prefix = `routedContent.metaobjects[${index}]`;
        if (!isPlainObject(metaobject)) {
            errors.push(`${prefix} must be an object.`);
            continue;
        }
        const code = validateCode(metaobject.code, `${prefix}.code`, errors);
        if (code && metaobjectCodes.has(code)) errors.push(`${prefix}: duplicate metaobject code ${code}.`);
        metaobjectCodes.add(code);
        if (metaobject.type !== 'product_faq') errors.push(`${prefix}: unsupported type '${metaobject.type}'.`);
        const product = validateCode(metaobject.product, `${prefix}.product`, errors);
        if (product && !productIndex.has(product)) errors.push(`${prefix}: unknown product ${product}.`);
        if (!Array.isArray(metaobject.locales)) {
            errors.push(`${prefix}.locales must be an array.`);
            continue;
        }
        const locales = new Set();
        for (const [localeIndex, localeEntry] of metaobject.locales.entries()) {
            const localePrefix = `${prefix}.locales[${localeIndex}]`;
            if (!isPlainObject(localeEntry)) {
                errors.push(`${localePrefix} must be an object.`);
                continue;
            }
            const locale = String(localeEntry.lang || '').trim();
            const localeKey = locale.toLowerCase();
            if (!locale) errors.push(`${localePrefix} has no locale.`);
            else if (locales.has(localeKey)) errors.push(`${localePrefix}: duplicate locale ${locale}.`);
            locales.add(localeKey);
            if (!Array.isArray(localeEntry.items) || localeEntry.items.length === 0) {
                errors.push(`${localePrefix}.items must be a non-empty array.`);
                continue;
            }
            for (const [itemIndex, item] of localeEntry.items.entries()) {
                if (!isPlainObject(item)
                    || typeof item.question !== 'string' || !item.question.trim()
                    || typeof item.answer !== 'string' || !item.answer.trim()) {
                    errors.push(`${localePrefix}.items[${itemIndex}] must contain question and answer.`);
                    continue;
                }
                counts.faqItems += 1;
                incrementSourceCount(sourceCounts, product, 'enrichment.faq', 1);
            }
        }
        for (const locale of requiredLocales) {
            if (!locales.has(locale.toLowerCase())) {
                errors.push(`${prefix}: missing required ${locale} FAQ locale.`);
            }
        }
    }

    for (const event of lossEvents) {
        if (!['enrichment.faq', 'localized-section-narratives', 'markdown'].includes(event?.source)) continue;
        const expected = Number(event.count) || 0;
        const actual = sourceCounts.get(sourceCountKey(event.product, event.source)) || 0;
        if (actual !== expected) {
            errors.push(`${event.product || '<product>'}: routed ${event.source} count ${actual} differs from loss event count ${expected}.`);
        }
    }
    return counts;
}

function countNarratives(value, prefix, errors) {
    if (value === undefined) return 0;
    if (!isPlainObject(value)) {
        errors.push(`${prefix}.narratives must be an object.`);
        return 0;
    }
    let count = 0;
    for (const [section, fields] of Object.entries(value)) {
        if (!isPlainObject(fields)) {
            errors.push(`${prefix}.narratives.${section} must be an object.`);
            continue;
        }
        for (const [field, content] of Object.entries(fields)) {
            if (typeof content !== 'string' || !content.trim()) {
                errors.push(`${prefix}.narratives.${section}.${field} must be non-empty text.`);
                continue;
            }
            count += 1;
        }
    }
    return count;
}

function incrementSourceCount(counts, product, source, amount) {
    const key = sourceCountKey(product, source);
    counts.set(key, (counts.get(key) || 0) + amount);
}

function sourceCountKey(product, source) {
    return `${normalizeCode(product)}|${source}`;
}

function emptyRoutedContentCounts() {
    return {
        articles: 0,
        articleTranslations: 0,
        markdown: 0,
        narratives: 0,
        metaobjects: 0,
        faqItems: 0,
    };
}

function validateCode(value, label, errors) {
    const rawCode = value && typeof value === 'object' ? value.code : value;
    const code = normalizeCode(rawCode);
    if (!CODE_RE.test(String(rawCode || ''))) {
        errors.push(`${label} must match ${CODE_RE}.`);
        return code || null;
    }
    return code;
}

function normalizeCode(value) {
    const code = value && typeof value === 'object' ? value.code : value;
    return String(code || '').trim().toUpperCase();
}

function hasDefined(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key)
        && object[key] !== undefined
        && object[key] !== null;
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isDecimal(value) {
    const normalized = value.trim();
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)
        && Number.isFinite(Number(normalized));
}

function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function isIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const daysInMonth = [
        31,
        isLeapYear(year) ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    return day <= daysInMonth[month - 1];
}

function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isDuration(value) {
    if (!/^\d+$/.test(value)) return false;
    try {
        return BigInt(value) <= MAX_DURATION_SECONDS;
    } catch {
        return false;
    }
}

module.exports = {
    KNOWN_PACKAGES,
    validateArtifact,
};
