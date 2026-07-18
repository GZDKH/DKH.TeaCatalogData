const {
    isLegacyJunkSpecificationAttribute,
    isLegacyJunkSpecificationGroup,
} = require('./cleanup-junk');
const { buildLocalizedTranslations } = require('./spec-labels');
const { toProductLocale } = require('./locales');
const { isManagedSpecification } = require('./product-overlay');

const DEFAULT_LANGUAGE = 'en-US';

const GROUP_ORDER = [
    'SPEC-TT-GROUP-CLASSIFICATION-ORIGIN',
    'SPEC-TT-GROUP-ATOMIC',
    'SPEC-TT-GROUP-BOTANY-MATERIAL',
    'SPEC-TT-GROUP-TERROIR',
    'SPEC-TT-GROUP-PRODUCTION',
    'SPEC-TT-GROUP-HISTORY-CULTURE',
    'SPEC-TT-GROUP-ORGANOLEPTIC',
    'SPEC-TT-GROUP-CHEMISTRY',
    'SPEC-TT-GROUP-BREWING',
    'SPEC-TT-GROUP-RECIPE',
    'SPEC-TT-GROUP-HARVEST',
    'SPEC-TT-GROUP-STORAGE',
    'SPEC-TT-GROUP-PRICE-COUNTERFEIT',
    'SPEC-TT-GROUP-SENSORY',
    'SPEC-TT-GROUP-ENRICHMENT',
    'SPEC-TT-GROUP-FACTS',
    'SPEC-TT-GROUP-COMPARISON',
    'SPEC-TT-GROUP-HEALTH',
    'SPEC-TT-GROUP-CONTRAINDICATIONS',
    'SPEC-TT-GROUP-CONCLUSION',
    'SPEC-TT-GROUP-SOURCE',
];

const GROUP_ICONS = {
    'SPEC-TT-GROUP-CLASSIFICATION-ORIGIN': 'map-pin',
    'SPEC-TT-GROUP-ATOMIC': 'list-checks',
    'SPEC-TT-GROUP-BOTANY-MATERIAL': 'sprout',
    'SPEC-TT-GROUP-TERROIR': 'mountain',
    'SPEC-TT-GROUP-HISTORY-CULTURE': 'book-open',
    'SPEC-TT-GROUP-ORGANOLEPTIC': 'sparkles',
    'SPEC-TT-GROUP-CHEMISTRY': 'flask-conical',
    'SPEC-TT-GROUP-BREWING': 'thermometer',
    'SPEC-TT-GROUP-RECIPE': 'timer',
    'SPEC-TT-GROUP-HARVEST': 'calendar-days',
    'SPEC-TT-GROUP-STORAGE': 'archive',
    'SPEC-TT-GROUP-PRICE-COUNTERFEIT': 'shield-check',
    'SPEC-TT-GROUP-SENSORY': 'activity',
    'SPEC-TT-GROUP-ENRICHMENT': 'badge-plus',
    'SPEC-TT-GROUP-SOURCE': 'database',
};

const FILTERABLE_TYPES = new Set(['Option', 'Number', 'Range', 'Boolean']);
const COMPARABLE_TYPES = new Set(['Option', 'Number', 'Range', 'Boolean']);

function buildSpecificationDefinitions(products, options = {}) {
    const groups = new Map();
    const attributes = new Map();
    const attributeOptions = new Map();
    const referencedGroups = new Set();
    const referencedAttributes = new Set();
    const referencedOptions = new Set();
    const canonicalSpecs = [];

    for (const product of products || []) {
        for (const spec of product.specifications || []) {
            if (!isImportableSpec(spec)) continue;
            const groupCode = normalizeCode(spec.group);
            const attributeCode = normalizeCode(spec.attribute);
            if (!groupCode || !attributeCode) continue;
            referencedGroups.add(groupCode);
            referencedAttributes.add(attributeCode);
            if (spec.option) referencedOptions.add(normalizeCode(spec.option));
            canonicalSpecs.push(spec);
        }
    }

    for (const spec of canonicalSpecs) {
        mergeSpecificationDefinition(groups, attributes, attributeOptions, spec);
    }

    for (const spec of options.observations || []) {
        if (!isImportableSpec(spec)) continue;
        const groupCode = normalizeCode(spec.group);
        const attributeCode = normalizeCode(spec.attribute);
        const optionCode = normalizeCode(spec.option);
        if (!referencedGroups.has(groupCode) || !referencedAttributes.has(attributeCode)) continue;
        if (optionCode && !referencedOptions.has(optionCode)) continue;
        mergeSpecificationDefinition(groups, attributes, attributeOptions, spec);
    }

    for (const code of referencedGroups) {
        if (!groups.has(code)) throw new Error(`Missing specification group definition observation for ${code}.`);
    }
    for (const code of referencedAttributes) {
        if (!attributes.has(code)) throw new Error(`Missing specification attribute definition observation for ${code}.`);
    }
    for (const code of referencedOptions) {
        if (code && !isLegacyOptionCode(code) && !attributeOptions.has(code)) {
            throw new Error(`Missing specification option definition observation for ${code}.`);
        }
    }

    const localeSummary = createLocaleSummary(options.locales || []);
    const sortedGroups = [...groups.values()]
        .map(state => finalizeGroupDefinition(state, localeSummary))
        .sort(compareGroups);
    const sortedAttributes = [...attributes.values()]
        .map(state => finalizeAttributeDefinition(state, localeSummary))
        .sort((a, b) =>
        compareGroupCodes(a.group, b.group) || a.order - b.order || a.code.localeCompare(b.code));
    const sortedOptions = [...attributeOptions.values()]
        .map(state => finalizeOptionDefinition(state, localeSummary))
        .sort((a, b) =>
        a.attribute.localeCompare(b.attribute) || a.order - b.order || a.code.localeCompare(b.code));

    return {
        groups: sortedGroups.map((group, index) => ({ ...group, order: index + 1 })),
        attributes: sortedAttributes,
        options: sortedOptions,
        localization: finalizeLocaleSummary(localeSummary),
    };
}

function mergeSpecificationDefinition(groups, attributes, options, spec) {
    const groupCode = normalizeCode(spec.group);
    const attributeCode = normalizeCode(spec.attribute);
    if (!groupCode || !attributeCode) return;

    const group = getOrCreateGroup(groups, groupCode, spec);
    mergeName(group, spec.lang, spec.groupName || groupCode, 'group');
    mergeSemanticKey(group, spec.groupKey);

    const attribute = getOrCreateAttribute(attributes, attributeCode, groupCode, spec);
    mergeInvariant(attribute, 'group', groupCode, `attribute ${attributeCode}`);
    mergeInvariant(attribute, 'type', spec.type, `attribute ${attributeCode}`);
    mergeOptionalInvariant(attribute, 'unit', spec.unit, `attribute ${attributeCode}`);
    mergeName(attribute, spec.lang, spec.attributeName || attributeCode, 'attribute');
    mergeSemanticKey(attribute, spec.attributeKey);
    attribute.order = Math.min(attribute.order, definitionOrder(spec.order));

    const optionCode = normalizeCode(spec.option);
    if (!optionCode || isLegacyOptionCode(optionCode)) return;
    const option = getOrCreateOption(options, optionCode, attributeCode, spec);
    mergeInvariant(option, 'attribute', attributeCode, `option ${optionCode}`);
    mergeName(option, spec.lang, spec.optionName || optionCode, 'option');
    mergeSemanticKey(option, spec.optionKey);
    option.order = Math.min(option.order, definitionOrder(spec.order));
}

function isImportableSpec(spec) {
    if (!spec || typeof spec !== 'object') return false;
    if (!isManagedSpecification(spec)) return false;
    if (isLegacyJunkSpecificationGroup({ code: spec.group })) return false;
    if (isLegacyJunkSpecificationAttribute({ code: spec.attribute })) return false;
    return true;
}

function getOrCreateGroup(groups, code, spec) {
    if (groups.has(code)) return groups.get(code);
    const state = {
        code,
        icon: GROUP_ICONS[code] || 'tag',
        order: groupOrder(code),
        published: true,
        collapsible: true,
        expanded: groupOrder(code) <= 6,
        semanticKey: spec.groupKey || null,
        names: new Map(),
    };
    groups.set(code, state);
    return state;
}

function getOrCreateAttribute(attributes, code, group, spec) {
    if (attributes.has(code)) return attributes.get(code);
    if (!spec.type) throw new Error(`Specification attribute ${code} has no type.`);
    const state = {
        code,
        group,
        type: spec.type,
        unit: normalizeOptional(spec.unit),
        order: definitionOrder(spec.order),
        semanticKey: spec.attributeKey || null,
        names: new Map(),
    };
    attributes.set(code, state);
    return state;
}

function getOrCreateOption(options, code, attribute, spec) {
    if (options.has(code)) return options.get(code);
    const state = {
        code,
        attribute,
        order: definitionOrder(spec.order),
        semanticKey: spec.optionKey || null,
        names: new Map(),
    };
    options.set(code, state);
    return state;
}

function finalizeGroupDefinition(state, localeSummary) {
    return {
        code: state.code,
        icon: state.icon,
        order: state.order,
        published: true,
        collapsible: true,
        expanded: state.expanded,
        translations: finalizeTranslations(state, 'group', localeSummary),
    };
}

function finalizeAttributeDefinition(state, localeSummary) {
    const productFacing = state.group !== 'SPEC-TT-GROUP-SOURCE'
        && !state.code.startsWith('SPEC-TT-FIELD-DETAIL-');

    return stripUndefined({
        code: state.code,
        group: state.group,
        type: state.type,
        unit: state.unit,
        order: state.order,
        published: true,
        filterable: productFacing && FILTERABLE_TYPES.has(state.type),
        comparable: productFacing && COMPARABLE_TYPES.has(state.type),
        translations: finalizeTranslations(state, 'attribute', localeSummary),
    });
}

function finalizeOptionDefinition(state, localeSummary) {
    return {
        code: state.code,
        attribute: state.attribute,
        order: state.order,
        published: true,
        translations: finalizeTranslations(state, 'option', localeSummary),
    };
}

function finalizeTranslations(state, kind, localeSummary) {
    const fallbackName = state.names.get(DEFAULT_LANGUAGE)
        || [...state.names.values()][0]
        || state.code;
    const requestedLocales = localeSummary.requiredLocales.length
        ? localeSummary.requiredLocales
        : [...state.names.keys()];
    const localized = buildLocalizedTranslations({
        kind,
        semanticKey: state.semanticKey || state.code,
        fallbackName,
        locales: requestedLocales,
    });

    const names = new Map(localized.translations.map(item => [item.lang, item.name]));
    for (const [lang, name] of state.names) {
        if (names.has(lang) && names.get(lang) !== name) {
            throw new Error(`Conflicting ${kind} translation for ${state.code}/${lang}.`);
        }
        names.set(lang, name);
    }

    localeSummary.definitionCount += 1;
    localeSummary.translationCount += names.size;
    for (const lang of localized.fallbackLocales) {
        localeSummary.fallbackCount += 1;
        localeSummary.fallbackLocales.add(lang);
    }

    return [...names.entries()]
        .sort(([langA], [langB]) => localeOrder(langA) - localeOrder(langB)
            || langA.localeCompare(langB))
        .map(([lang, name]) => ({ lang, name }));
}

function normalizeLanguage(lang) {
    return toProductLocale(String(lang || '').trim()) || DEFAULT_LANGUAGE;
}

function mergeName(state, lang, name, kind) {
    const normalizedLang = normalizeLanguage(lang);
    const normalizedName = String(name || '').trim();
    if (!normalizedName) throw new Error(`${kind} ${state.code} has an empty ${normalizedLang} label.`);
    if (state.names.has(normalizedLang) && state.names.get(normalizedLang) !== normalizedName) {
        throw new Error(`Conflicting ${kind} translation for ${state.code}/${normalizedLang}.`);
    }
    state.names.set(normalizedLang, normalizedName);
}

function mergeInvariant(state, key, value, context) {
    const normalized = String(value || '').trim();
    if (!normalized) throw new Error(`${context} has no ${key}.`);
    if (state[key] && state[key] !== normalized) {
        throw new Error(`${context} has conflicting ${key}: '${state[key]}' vs '${normalized}'.`);
    }
    state[key] = normalized;
}

function mergeOptionalInvariant(state, key, value, context) {
    const normalized = normalizeOptional(value);
    if (!normalized) return;
    if (state[key] && state[key] !== normalized) {
        throw new Error(`${context} has conflicting ${key}: '${state[key]}' vs '${normalized}'.`);
    }
    state[key] = normalized;
}

function mergeSemanticKey(state, value) {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    if (state.semanticKey && state.semanticKey !== normalized) {
        throw new Error(`${state.code} has conflicting semantic keys '${state.semanticKey}' and '${normalized}'.`);
    }
    state.semanticKey = normalized;
}

function createLocaleSummary(locales) {
    return {
        requiredLocales: [...new Set((locales || []).map(normalizeLanguage))],
        definitionCount: 0,
        translationCount: 0,
        fallbackCount: 0,
        fallbackLocales: new Set(),
    };
}

function finalizeLocaleSummary(summary) {
    return {
        requiredLocales: summary.requiredLocales,
        definitionCount: summary.definitionCount,
        translationCount: summary.translationCount,
        fallbackCount: summary.fallbackCount,
        fallbackLocales: [...summary.fallbackLocales].sort(),
    };
}

function definitionOrder(value) {
    return Number.isInteger(value) ? value : 2_000_000_000;
}

function normalizeOptional(value) {
    const normalized = String(value ?? '').trim();
    return normalized || undefined;
}

function localeOrder(lang) {
    return lang === DEFAULT_LANGUAGE ? 0 : 1;
}

function stripUndefined(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
}

function isLegacyOptionCode(code) {
    return /MARKDOWN|SIMILAR|SPEC-TT-GROUP-EXT-\d+|-X\d+(?:$|-)/.test(code);
}

function compareGroups(a, b) {
    return compareGroupCodes(a.code, b.code) || a.code.localeCompare(b.code);
}

function compareGroupCodes(a, b) {
    return groupOrder(a) - groupOrder(b);
}

function groupOrder(code) {
    const index = GROUP_ORDER.indexOf(code);
    return index === -1 ? GROUP_ORDER.length + 1 : index + 1;
}

module.exports = {
    GROUP_ORDER,
    buildSpecificationDefinitions,
};
