const crypto = require('crypto');

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

const NARRATIVE_NOTE_NAMES = {
    atomic: 'Core Tea Notes',
    botany_material: 'Botany and Raw Material Notes',
    brewing: 'Brewing Notes',
    chemical_composition: 'Chemical Composition Notes',
    chemistry: 'Chemical Composition Notes',
    classification_origin: 'Classification and Origin Notes',
    comparison: 'Comparison Notes',
    conclusion: 'Conclusion',
    contraindications: 'Contraindications',
    facts: 'Facts',
    health: 'Health Notes',
    history_culture: 'History and Culture Notes',
    organoleptic: 'Organoleptic Profile Notes',
    price_counterfeit: 'Price and Authenticity Notes',
    production: 'Production Notes',
    storage: 'Storage Notes',
    terroir: 'Terroir Notes',
};

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

function groupName(section) {
    if (GROUPS[section]) return GROUPS[section];
    if (/^ext_\d+$/.test(section)) return `Extended Section ${section.slice(4)}`;
    return titleize(section);
}

function fieldName(section, field) {
    if (FIELD_NAMES[field]) return FIELD_NAMES[field];
    const match = /^(.+)_x(\d+)$/.exec(field);
    if (match) return `TheTea ${titleize(match[1])} Field ${Number(match[2]) + 1}`;
    return titleize(field);
}

function isSyntheticTheTeaField(section, field) {
    return /^ext_\d+$/i.test(String(section || '')) || /(?:^|_)x\d+$/i.test(String(field || ''));
}

function syntheticFieldOrder(field) {
    const match = /(?:^|_)x(\d+)$/i.exec(String(field || ''));
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function narrativeNoteName(section) {
    if (NARRATIVE_NOTE_NAMES[section]) return NARRATIVE_NOTE_NAMES[section];
    const group = groupName(section);
    return /\bnotes?$/i.test(group) ? group : `${group} Notes`;
}

function specBase(section, field, type, order, options = {}) {
    const attributePrefix = options.attributePrefix || ['SPEC-TT'];
    const attributeParts = options.attributeParts || [section, field];

    return {
        lang: 'en-US',
        group: groupCode(section),
        groupName: groupName(section),
        attribute: makeCode(...attributePrefix, ...attributeParts),
        attributeName: fieldName(section, field),
        type,
        showOnPage: true,
        order,
    };
}

function optionSpec(section, field, value, order, optionName = value, options = {}) {
    if (value === null || value === undefined || value === '') return null;
    const optionPrefix = options.optionPrefix || ['SPEC-TT-OPT'];
    const optionParts = options.optionParts || [section, field, value];

    return {
        ...specBase(section, field, 'Option', order, options),
        option: makeCode(...optionPrefix, ...optionParts),
        optionName: String(optionName),
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

function rangeSpec(section, field, min, max, order, options = {}) {
    if (min === null && max === null) return null;
    if (min === undefined && max === undefined) return null;
    return {
        ...specBase(section, field, 'Range', order, options),
        valueMin: min === null || min === undefined ? undefined : Number(min),
        valueMax: max === null || max === undefined ? undefined : Number(max),
    };
}

function listSpec(section, field, values, order, options = {}) {
    const items = (values || []).filter(Boolean);
    if (items.length === 0) return null;
    return textSpec(section, field, items.join(', '), order, 'List', options);
}

function narrativeNotesSpec(section, values, order) {
    const markdown = values
        .slice()
        .sort((a, b) => syntheticFieldOrder(a.field) - syntheticFieldOrder(b.field))
        .map(item => String(item.value || '').trim())
        .filter(Boolean)
        .join('\n\n');
    const spec = textSpec(section, 'notes', markdown, order, 'CustomMarkdownText', {
        attributePrefix: ['SPEC-TT-NOTES'],
        attributeParts: [section],
    });
    if (spec) spec.attributeName = narrativeNoteName(section);
    return spec;
}

function sectionFieldOptions(section, field, value) {
    return {
        attributePrefix: ['SPEC-TT-FIELD'],
        attributeParts: [section, field],
        optionPrefix: ['SPEC-TT-FIELD-OPT'],
        optionParts: [section, field, value],
    };
}

function sectionFieldDetailOptions(section, field) {
    return {
        attributePrefix: ['SPEC-TT-FIELD-DETAIL'],
        attributeParts: [section, field],
    };
}

function fieldDetailSpec(section, field, value, order) {
    const spec = textSpec(section, field, value, order, 'CustomMarkdownText', sectionFieldDetailOptions(section, field));
    if (spec) spec.attributeName = `${fieldName(section, field)} Detail`;
    return spec;
}

function specFromTheTeaField(section, field, payload, order) {
    const value = payload && typeof payload === 'object' ? payload.value : payload;
    const num = payload && typeof payload === 'object' ? payload.num : null;
    const options = sectionFieldOptions(section, field, value);
    const endpointValue = payload?.endpoint?.value_md;

    if (['shape', 'processing', 'roast_level'].includes(field) && value) {
        const detail = endpointValue && endpointValue !== value
            ? fieldDetailSpec(section, field, endpointValue, order + 10000)
            : null;
        return [optionSpec(section, field, value, order, titleize(value), options), detail];
    }

    if (num !== null && num !== undefined && Number.isFinite(Number(num))) {
        const detail = endpointValue
            ? fieldDetailSpec(section, field, endpointValue, order + 10000)
            : null;
        return [numberSpec(section, field, num, order, options), detail];
    }

    return textSpec(section, field, value, order, 'CustomMarkdownText', options);
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

function buildSpecs(card) {
    const specs = [];
    let order = 1;
    const meta = card.meta || {};
    const syntheticNarratives = new Map();

    push(specs, optionSpec('classification_origin', 'tea_type', meta.tea_type, order++, titleize(meta.tea_type)));
    push(specs, optionSpec('source', 'category_code', meta.category_code, order++, meta.category_code));
    push(specs, optionSpec('classification_origin', 'origin_country', meta.origin_country, order++, meta.origin_country));
    push(specs, optionSpec('classification_origin', 'province', meta.province, order++, meta.province));
    push(specs, rangeSpec('atomic', 'oxidation', meta.oxidation_min, meta.oxidation_max, order++));
    push(specs, rangeSpec('brewing', 'brew_temp', meta.brew_temp_min, meta.brew_temp_max, order++));
    push(specs, rangeSpec('terroir', 'altitude', meta.altitude_min, meta.altitude_max, order++));
    push(specs, optionSpec('atomic', 'shape', meta.shape, order++, titleize(meta.shape)));
    push(specs, optionSpec('atomic', 'processing', meta.processing, order++, titleize(meta.processing)));
    push(specs, optionSpec('atomic', 'roast_level', meta.roast_level, order++, titleize(meta.roast_level)));
    push(specs, textSpec('classification_origin', 'gi_status', meta.gi_status, order++, 'CustomText'));
    push(specs, textSpec('classification_origin', 'gi_standard', meta.gi_standard, order++, 'CustomText'));
    push(specs, textSpec('source', 'version', meta.version, order++, 'CustomText'));
    push(specs, textSpec('source', 'last_updated', meta.last_updated, order++, 'Date'));
    push(specs, optionSpec('source', 'review_status', meta.review_status, order++, titleize(meta.review_status)));

    for (const [section, fields] of Object.entries(card.sections || {})) {
        for (const [field, payload] of Object.entries(fields || {})) {
            if (isSyntheticTheTeaField(section, field)) {
                const value = payload && typeof payload === 'object' ? payload.value : payload;
                if (value !== null && value !== undefined && String(value).trim() !== '') {
                    if (!syntheticNarratives.has(section)) syntheticNarratives.set(section, []);
                    syntheticNarratives.get(section).push({ field, value });
                }
                continue;
            }
            push(specs, specFromTheTeaField(section, field, payload, order++));
        }
    }

    for (const [section, values] of syntheticNarratives.entries()) {
        push(specs, narrativeNotesSpec(section, values, order++));
    }

    for (const recipe of card.recipe || []) {
        const style = normalizeCodePart(recipe.style).toLowerCase();
        const label = titleize(recipe.style);
        const recipeFields = [
            ['water_temp', recipe.water_temp],
            ['tea_grams', recipe.tea_grams],
            ['water_ml', recipe.water_ml],
            ['steep_sec', recipe.steep_sec],
            ['increment_sec', recipe.increment_sec],
            ['max_steeps', recipe.max_steeps],
            ['rinse', recipe.rinse],
        ];

        for (const [field, value] of recipeFields) {
            const spec = numberSpec('recipe', `${style}_${field}`, value, order++);
            if (spec) {
                spec.attributeName = `${label} ${fieldName('recipe', field)}`;
                push(specs, spec);
            }
        }
    }

    for (const harvest of card.harvest || []) {
        if (!harvest.phase) continue;
        push(specs, optionSpec('harvest', 'phase', harvest.phase, order++, titleize(harvest.phase)));
        push(specs, textSpec('harvest', `${harvest.phase}_months`, harvest.months, order++, 'CustomText'));
    }

    for (const sensory of card.sensory || []) {
        const descriptor = sensory.descriptor_id || sensory.descriptor || 'unknown';
        const spec = numberSpec('sensory', `descriptor_${descriptor}_intensity`, sensory.intensity, order++);
        if (spec) {
            spec.attributeName = `Sensory ${sensory.descriptor || descriptor} Intensity`;
            push(specs, spec);
        }
    }

    const enrichment = card.enrichment || {};
    push(specs, optionSpec('enrichment', 'caffeine_level', enrichment.caffeine_level, order++, titleize(enrichment.caffeine_level)));
    push(specs, optionSpec('enrichment', 'difficulty', enrichment.difficulty, order++, titleize(enrichment.difficulty)));
    push(specs, optionSpec('enrichment', 'price_tier', enrichment.price_tier, order++, titleize(enrichment.price_tier)));
    for (const value of enrichment.best_season || []) push(specs, optionSpec('enrichment', 'best_season', value, order++, titleize(value)));
    for (const value of enrichment.occasion || []) push(specs, optionSpec('enrichment', 'occasion', value, order++, titleize(value)));
    for (const value of enrichment.flavor_tags || []) push(specs, optionSpec('enrichment', 'flavor_tags', value, order++, titleize(value)));
    push(specs, listSpec('enrichment', 'food_pairings', enrichment.food_pairings, order++));
    push(specs, textSpec('enrichment', 'tasting_note', enrichment.tasting_note, order++));
    push(specs, listSpec('enrichment', 'similar_teas', enrichment.similar_teas, order++));

    return specs;
}

module.exports = {
    GROUPS,
    FIELD_NAMES,
    makeCode,
    normalizeCodePart,
    titleize,
    isSyntheticTheTeaField,
    buildSpecs,
};
