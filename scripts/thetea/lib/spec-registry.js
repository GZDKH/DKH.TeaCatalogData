const crypto = require('crypto');
const { toProductLocale } = require('./locales');
const {
    encodeListValue,
    normalizeBoolean,
    normalizeDurationSeconds,
    normalizeSpecifications,
    uniqueRepeatedObjects,
} = require('./spec-contract');
const { localizeSpecLabel } = require('./spec-labels');

const GROUPS = {
    classification_origin: 'Classification and Origin',
    atomic: 'Core Tea Facts',
    botany_material: 'Botany and Raw Material',
    terroir: 'Terroir',
    production: 'Production',
    organoleptic: 'Organoleptic Profile',
    chemistry: 'Chemical Composition',
    brewing: 'Brewing',
    storage: 'Storage',
    harvest: 'Harvest',
    recipe: 'Brewing Recipe',
    sensory: 'Sensory Intensity',
    enrichment: 'Enrichment',
    source: 'Source Metadata',
    facts: 'Facts',
    comparison: 'Comparison',
    health: 'Health Notes',
    contraindications: 'Contraindications',
    conclusion: 'Conclusion',
    history_culture: 'History and Culture',
    price_counterfeit: 'Price and Authenticity',
};

const FIELD_NAMES = {
    tea_type: 'Tea Type',
    category_code: 'TheTea Category',
    origin_country: 'Origin Country',
    province: 'Province',
    city: 'City',
    county: 'County',
    oxidation: 'Oxidation',
    oxidation_min: 'Oxidation Minimum',
    oxidation_max: 'Oxidation Maximum',
    brew_temp: 'Brewing Temperature',
    brew_temp_min: 'Brewing Temperature Minimum',
    brew_temp_max: 'Brewing Temperature Maximum',
    altitude: 'Altitude',
    altitude_min: 'Altitude Minimum',
    altitude_max: 'Altitude Maximum',
    roast_level: 'Roast Level',
    processing: 'Processing',
    shape: 'Leaf Shape',
    gi_status: 'Geographical Indication Status',
    gi_standard: 'Geographical Indication Standard',
    water_temp: 'Water Temperature',
    tea_amount: 'Tea Amount',
    tea_grams: 'Tea Amount',
    water_ml: 'Water Volume',
    steep_sec: 'Steep Duration',
    increment_sec: 'Steep Increment',
    max_steeps: 'Maximum Infusions',
    rinse: 'Rinse Required',
    teaware: 'Teaware',
    taste: 'Taste',
    liquor_color: 'Liquor Color',
    liquor_aroma: 'Liquor Aroma',
    dry_leaf_aroma: 'Dry Leaf Aroma',
    dry_leaf_appearance: 'Dry Leaf Appearance',
    spent_leaves: 'Spent Leaves',
    cultivar: 'Cultivar',
    picking: 'Picking',
    pluck_standard: 'Pluck Standard',
    raw_material: 'Raw Material',
    climate: 'Climate',
    soil: 'Soil',
    caffeine_level: 'Caffeine Level',
    difficulty: 'Brewing Difficulty',
    price_tier: 'Price Tier',
    best_season: 'Best Season',
    occasion: 'Occasion',
    flavor_tags: 'Flavor Tag',
    food_pairings: 'Food Pairings',
    one_liner: 'One-line Summary',
    summary: 'Summary',
    tasting_note: 'Tasting Note',
    similar_teas: 'Similar Teas',
    last_updated: 'TheTea Last Updated',
    review_status: 'TheTea Review Status',
    version: 'TheTea Version',
};

const RAW_FIELD_CONTRACTS = new Map([
    ['atomic.gi_status', { type: 'Boolean' }],
    ['brewing.water_temp', { type: 'Number', unit: '°C' }],
    ['storage.temperature', { type: 'Number', unit: '°C' }],
]);

const ORIGIN_FIELD_KEYS = new Set([
    'atomic.altitude_core',
    'atomic.altitude_min',
    'atomic.altitude_max',
    'atomic.lat',
    'atomic.lng',
    'classification_origin.coordinates',
    'classification_origin.origin',
    'classification_origin.origin_country',
    'classification_origin.province',
    'terroir.altitude',
]);

const META_OWNED_FIELD_KEYS = new Set([
    'atomic.brew_temp_max',
    'atomic.brew_temp_min',
    'atomic.gi_status',
    'atomic.oxidation_max',
    'atomic.oxidation_min',
    'atomic.processing',
    'atomic.roast_level',
    'atomic.shape',
    'atomic.tea_type',
    'classification_origin.category',
    'classification_origin.type',
    'brewing.water_temp',
]);

const ROUTED_NARRATIVE_MIN_LENGTH = 300;

function normalizeCodePart(value) {
    const ascii = String(value ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');

    const normalized = ascii
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');

    return normalized || 'UNKNOWN';
}

function makeCode(...parts) {
    const code = parts.map(normalizeCodePart).join('-');
    if (code.length <= 100) return code;

    const hash = crypto.createHash('sha1').update(code).digest('hex').slice(0, 8).toUpperCase();
    return `${code.slice(0, 91)}-${hash}`.replace(/-+$/g, '');
}

function titleize(value) {
    return String(value ?? '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, c => c.toUpperCase());
}

function groupCode(section) {
    return makeCode('SPEC-TT-GROUP', section);
}

function groupName(section, lang = 'en-US') {
    const fallbackName = GROUPS[section]
        || (/^ext_\d+$/.test(section) ? `Extended Section ${section.slice(4)}` : titleize(section));
    return localizeSpecLabel('group', section, lang, fallbackName).name;
}

function fieldName(section, field, lang = 'en-US') {
    let fallbackName;
    if (FIELD_NAMES[field]) fallbackName = FIELD_NAMES[field];
    const match = /^(.+)_x(\d+)$/.exec(field);
    if (!fallbackName && match) fallbackName = `TheTea ${titleize(match[1])} Field ${Number(match[2]) + 1}`;
    if (!fallbackName) fallbackName = titleize(field);
    return localizeSpecLabel('attribute', `${section}.${field}`, lang, fallbackName).name;
}

function isSyntheticTheTeaField(section, field) {
    return /^ext_\d+$/i.test(String(section || '')) || /(?:^|_)x\d+$/i.test(String(field || ''));
}

function isRoutedTheTeaField(section, field, payload) {
    if (isSyntheticTheTeaField(section, field)) return true;
    const values = [
        payload && typeof payload === 'object' ? payload.value : payload,
        payload?.endpoint?.value_md,
    ]
        .filter(value => value !== null && value !== undefined)
        .map(value => String(value).trim())
        .filter(Boolean);
    if (!values.length) return false;
    if (META_OWNED_FIELD_KEYS.has(`${section}.${field}`)) return true;
    return values.some(value => value.length > ROUTED_NARRATIVE_MIN_LENGTH);
}

function specBase(section, field, type, order, options = {}) {
    const attributePrefix = options.attributePrefix || ['SPEC-TT'];
    const attributeParts = options.attributeParts || [section, field];
    const lang = toProductLocale(options.lang || 'en-US');

    return {
        lang,
        group: groupCode(section),
        groupName: groupName(section, lang),
        attribute: makeCode(...attributePrefix, ...attributeParts),
        attributeName: localizeSpecLabel(
            'attribute',
            options.semanticAttributeKey || `${section}.${field}`,
            lang,
            options.attributeFallbackName || FIELD_NAMES[field] || titleize(field)).name,
        type,
        unit: options.unit,
        showOnPage: section !== 'source',
        order,
        groupKey: section,
        attributeKey: options.semanticAttributeKey || `${section}.${field}`,
    };
}

function optionSpec(section, field, value, order, optionName = value, options = {}) {
    if (value === null || value === undefined || value === '') return null;
    const optionPrefix = options.optionPrefix || ['SPEC-TT-OPT'];
    const optionParts = options.optionParts || [section, field, value];
    const lang = toProductLocale(options.lang || 'en-US');
    const optionKey = options.semanticOptionKey || `${section}.${field}.${value}`;

    return {
        ...specBase(section, field, 'Option', order, options),
        option: makeCode(...optionPrefix, ...optionParts),
        optionName: localizeSpecLabel('option', optionKey, lang, String(optionName)).name,
        optionKey,
    };
}

function textSpec(section, field, value, order, type = 'CustomMarkdownText', options = {}) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    return {
        ...specBase(section, field, type, order, options),
        value: String(value),
    };
}

function numberSpec(section, field, value, order, options = {}) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
    return {
        ...specBase(section, field, 'Number', order, options),
        value: String(value),
    };
}

function booleanSpec(section, field, value, order, options = {}) {
    if (value === null || value === undefined || value === '') return null;
    return {
        ...specBase(section, field, 'Boolean', order, options),
        value: String(normalizeBoolean(value)),
    };
}

function durationSpec(section, field, value, order, options = {}) {
    if (value === null || value === undefined || value === '') return null;
    return {
        ...specBase(section, field, 'Duration', order, options),
        value: String(normalizeDurationSeconds(value)),
    };
}

function rangeSpec(section, field, min, max, order, options = {}) {
    if (min === null && max === null) return null;
    if (min === undefined && max === undefined) return null;
    const normalizedMin = min === null || min === undefined ? Number(max) : Number(min);
    const normalizedMax = max === null || max === undefined ? Number(min) : Number(max);
    return {
        ...specBase(section, field, 'Range', order, options),
        valueMin: normalizedMin,
        valueMax: normalizedMax,
    };
}

function listSpec(section, field, values, order, options = {}) {
    const items = Array.isArray(values) ? values : [];
    const encoded = encodeListValue(items);
    if (encoded === '[]') return null;
    return textSpec(section, field, encoded, order, 'List', options);
}

function sectionFieldOptions(section, field, value, lang) {
    return {
        attributePrefix: ['SPEC-TT-FIELD'],
        attributeParts: [section, field],
        optionPrefix: ['SPEC-TT-FIELD-OPT'],
        optionParts: [section, field, value],
        lang,
    };
}

function sectionFieldDetailOptions(section, field, lang) {
    return {
        attributePrefix: ['SPEC-TT-FIELD-DETAIL'],
        attributeParts: [section, field],
        semanticAttributeKey: `${section}.${field}.detail`,
        lang,
    };
}

function fieldDetailSpec(section, field, value, order, lang) {
    const spec = textSpec(
        section,
        field,
        value,
        order,
        'CustomMarkdownText',
        sectionFieldDetailOptions(section, field, lang));
    if (spec) {
        const fallbackName = `${FIELD_NAMES[field] || titleize(field)} Detail`;
        spec.attributeName = localizeSpecLabel(
            'attribute',
            `${section}.${field}.detail`,
            toProductLocale(lang || 'en-US'),
            fallbackName).name;
    }
    return spec;
}

function specFromTheTeaField(section, field, payload, order, context = {}) {
    const fieldKey = `${section}.${field}`;
    if (ORIGIN_FIELD_KEYS.has(fieldKey)) return [];

    const value = payload && typeof payload === 'object' ? payload.value : payload;
    const num = payload && typeof payload === 'object' ? payload.num : null;
    const lang = context.lang || 'en-US';
    const options = sectionFieldOptions(section, field, value, lang);
    const endpointValue = payload?.endpoint?.value_md;
    const routeNarrative = context.routeNarrative === true
        || isRoutedTheTeaField(section, field, payload);

    const canonicalMetaOwnsField = META_OWNED_FIELD_KEYS.has(fieldKey)
        && !(fieldKey === 'brewing.water_temp' && context.canonicalBrewTempPresent !== true);
    if (canonicalMetaOwnsField) {
        return [];
    }

    if (['shape', 'processing', 'roast_level'].includes(field) && value) {
        const detail = !routeNarrative && endpointValue && endpointValue !== value
            ? fieldDetailSpec(section, field, endpointValue, order + 10000, lang)
            : null;
        return [optionSpec(section, field, value, order, titleize(value), options), detail];
    }

    const contract = RAW_FIELD_CONTRACTS.get(fieldKey);
    if (contract?.type === 'Boolean') {
        const booleanValue = num ?? value;
        const detail = !routeNarrative
            && endpointValue && String(endpointValue).trim() !== String(value ?? '').trim()
            ? fieldDetailSpec(section, field, endpointValue, order + 10000, lang)
            : null;
        return [booleanSpec(section, field, booleanValue, order, options), detail];
    }

    if (contract?.type === 'Number' && num !== null && num !== undefined && Number.isFinite(Number(num))) {
        options.unit = contract.unit || payload?.unit || payload?.endpoint?.unit;
        const detail = !routeNarrative && endpointValue
            ? fieldDetailSpec(section, field, endpointValue, order + 10000, lang)
            : null;
        return [numberSpec(section, field, num, order, options), detail];
    }

    if (contract?.type === 'Number') {
        return routeNarrative
            ? []
            : fieldDetailSpec(section, field, endpointValue || value, order + 10000, lang);
    }

    return routeNarrative ? [] : textSpec(section, field, value, order, 'CustomMarkdownText', options);
}

function push(specs, spec) {
    if (Array.isArray(spec)) {
        for (const item of spec) push(specs, item);
        return;
    }
    if (spec) specs.push(stripUndefined(spec));
}

function stripUndefined(value) {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function buildSpecs(card, context = {}) {
    const specs = [];
    let order = 1;
    const meta = card.meta || {};
    const lang = toProductLocale(card.lang || context.lang || 'en-US');
    const options = { lang };

    push(specs, optionSpec('classification_origin', 'tea_type', meta.tea_type, order++, titleize(meta.tea_type), options));
    push(specs, optionSpec('source', 'category_code', meta.category_code, order++, meta.category_code, options));
    push(specs, rangeSpec('atomic', 'oxidation', meta.oxidation_min, meta.oxidation_max, order++, { ...options, unit: '%' }));
    push(specs, rangeSpec('brewing', 'brew_temp', meta.brew_temp_min, meta.brew_temp_max, order++, { ...options, unit: '°C' }));
    push(specs, optionSpec('atomic', 'shape', meta.shape, order++, titleize(meta.shape), options));
    push(specs, optionSpec('atomic', 'processing', meta.processing, order++, titleize(meta.processing), options));
    push(specs, optionSpec('atomic', 'roast_level', meta.roast_level, order++, titleize(meta.roast_level), options));
    push(specs, booleanSpec('classification_origin', 'gi_status', meta.gi_status, order++, options));
    push(specs, textSpec('classification_origin', 'gi_standard', meta.gi_standard, order++, 'CustomText', options));
    push(specs, textSpec('source', 'version', meta.version, order++, 'CustomText', options));
    push(specs, textSpec('source', 'last_updated', meta.last_updated, order++, 'Date', options));
    push(specs, optionSpec('source', 'review_status', meta.review_status, order++, titleize(meta.review_status), options));

    for (const [section, fields] of Object.entries(card.sections || {})) {
        for (const [field, payload] of Object.entries(fields || {})) {
            if (isSyntheticTheTeaField(section, field)) {
                continue;
            }
            push(specs, specFromTheTeaField(section, field, payload, order++, {
                lang,
                canonicalBrewTempPresent: (meta.brew_temp_min !== null
                    && meta.brew_temp_min !== undefined)
                    || (meta.brew_temp_max !== null && meta.brew_temp_max !== undefined),
                routeNarrative: context.routedFieldKeys?.has(`${section}.${field}`) === true,
            }));
        }
    }

    for (const { key: rawStyle, item: recipe } of uniqueRepeatedObjects(
        card.recipe || [],
        item => item.style,
        'recipe')) {
        const style = normalizeCodePart(rawStyle).toLowerCase();
        const label = titleize(rawStyle);
        const recipeFields = [
            ['water_temp', recipe.water_temp, 'Number', '°C'],
            ['tea_grams', recipe.tea_grams, 'Number', 'g'],
            ['water_ml', recipe.water_ml, 'Number', 'ml'],
            ['steep_sec', recipe.steep_sec, 'Duration', 's'],
            ['increment_sec', recipe.increment_sec, 'Duration', 's'],
            ['max_steeps', recipe.max_steeps, 'Number'],
            ['rinse', recipe.rinse, 'Boolean'],
        ];

        for (const [field, value, type, unit] of recipeFields) {
            const attributeField = `${style}_${field}`;
            const fieldOptions = {
                lang,
                unit,
                semanticAttributeKey: `recipe.${attributeField}`,
            };
            const spec = type === 'Duration'
                ? durationSpec('recipe', attributeField, value, order++, fieldOptions)
                : type === 'Boolean'
                    ? booleanSpec('recipe', attributeField, value, order++, fieldOptions)
                    : numberSpec('recipe', attributeField, value, order++, fieldOptions);
            if (spec) {
                const fallbackName = `${label} ${FIELD_NAMES[field] || titleize(field)}`;
                spec.attributeName = localizeSpecLabel(
                    'attribute',
                    `recipe.${attributeField}`,
                    lang,
                    fallbackName).name;
                push(specs, spec);
            }
        }
    }

    for (const { key: rawPhase, item: harvest } of uniqueRepeatedObjects(
        card.harvest || [],
        item => item.phase,
        'harvest')) {
        const phase = normalizeCodePart(rawPhase).toLowerCase();
        const attributeField = `${phase}_months`;
        const spec = listSpec(
            'harvest',
            attributeField,
            harvestMonths(harvest.months),
            order++,
            { lang, semanticAttributeKey: `harvest.${attributeField}` });
        if (spec) {
            const fallbackName = `${titleize(rawPhase)} Harvest Months`;
            spec.attributeName = localizeSpecLabel(
                'attribute',
                `harvest.${attributeField}`,
                lang,
                fallbackName).name;
            push(specs, spec);
        }
    }

    for (const { key: rawDescriptor, item: sensory } of uniqueRepeatedObjects(
        card.sensory || [],
        item => item.descriptor_id || item.descriptor,
        'sensory')) {
        const canonicalDescriptor = context.canonicalSensoryLabels?.[rawDescriptor]
            || sensory.descriptor;
        const descriptor = normalizeCodePart(rawDescriptor).toLowerCase();
        const attributeField = `descriptor_${descriptor}_intensity`;
        const fallbackName = canonicalDescriptor
            ? `Sensory ${titleize(canonicalDescriptor)} Intensity`
            : `Sensory Source Descriptor ${sourceDescriptorCode(rawDescriptor)} Intensity`;
        const semanticAttributeKey = canonicalDescriptor
            ? `sensory.${attributeField}`
            : `sensory.source_${attributeField}`;
        const spec = numberSpec(
            'sensory',
            attributeField,
            sensory.intensity,
            order++,
            { lang, semanticAttributeKey, attributeFallbackName: fallbackName });
        if (spec) {
            spec.attributeName = localizeSpecLabel(
                'attribute',
                semanticAttributeKey,
                lang,
                fallbackName).name;
            push(specs, spec);
        }
    }

    const enrichment = card.enrichment || {};
    push(specs, optionSpec('enrichment', 'caffeine_level', enrichment.caffeine_level, order++, titleize(enrichment.caffeine_level), options));
    push(specs, optionSpec('enrichment', 'difficulty', enrichment.difficulty, order++, titleize(enrichment.difficulty), options));
    push(specs, optionSpec('enrichment', 'price_tier', enrichment.price_tier, order++, titleize(enrichment.price_tier), options));
    push(specs, listSpec('enrichment', 'best_season', enrichment.best_season, order++, options));
    push(specs, listSpec('enrichment', 'occasion', enrichment.occasion, order++, options));
    push(specs, listSpec('enrichment', 'flavor_tags', enrichment.flavor_tags, order++, options));
    push(specs, listSpec('enrichment', 'food_pairings', enrichment.food_pairings, order++, options));
    return normalizeSpecifications(specs, context.productCode || card.slug || '<unknown>');
}

function sourceDescriptorCode(rawDescriptor) {
    const normalized = String(rawDescriptor || '').trim().toLowerCase();
    return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : normalized;
}

function harvestMonths(value) {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined) return [];
    return String(value).split(/[,;\s]+/).filter(Boolean);
}

module.exports = {
    GROUPS,
    FIELD_NAMES,
    makeCode,
    normalizeCodePart,
    titleize,
    isRoutedTheTeaField,
    isSyntheticTheTeaField,
    buildSpecs,
};
