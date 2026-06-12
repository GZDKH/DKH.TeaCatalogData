const {
    isLegacyJunkSpecificationAttribute,
    isLegacyJunkSpecificationGroup,
} = require('./cleanup-junk');

const DEFAULT_LANGUAGE = 'en-US';

const GROUP_ORDER = [
    'SPEC-TT-GROUP-CLASSIFICATION-ORIGIN',
    'SPEC-TT-GROUP-ATOMIC',
    'SPEC-TT-GROUP-BOTANY-MATERIAL',
    'SPEC-TT-GROUP-TERROIR',
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

function buildSpecificationDefinitions(products) {
    const groups = new Map();
    const attributes = new Map();
    const options = new Map();

    for (const product of products || []) {
        for (const spec of product.specifications || []) {
            if (!isImportableSpec(spec)) continue;

            const groupCode = normalizeCode(spec.group);
            const attributeCode = normalizeCode(spec.attribute);
            if (!groupCode || !attributeCode) continue;

            if (!groups.has(groupCode)) {
                groups.set(groupCode, createGroupDefinition(groupCode, spec));
            }

            if (!attributes.has(attributeCode)) {
                attributes.set(attributeCode, createAttributeDefinition(attributeCode, groupCode, spec));
            }

            if (spec.option) {
                const optionCode = normalizeCode(spec.option);
                if (optionCode && !isLegacyOptionCode(optionCode) && !options.has(optionCode)) {
                    options.set(optionCode, createOptionDefinition(optionCode, attributeCode, spec));
                }
            }
        }
    }

    const sortedGroups = [...groups.values()].sort(compareGroups);
    const sortedAttributes = [...attributes.values()].sort((a, b) =>
        compareGroupCodes(a.group, b.group) || a.order - b.order || a.code.localeCompare(b.code));
    const sortedOptions = [...options.values()].sort((a, b) =>
        a.attribute.localeCompare(b.attribute) || a.order - b.order || a.code.localeCompare(b.code));

    return {
        groups: sortedGroups.map((group, index) => ({ ...group, order: index + 1 })),
        attributes: sortedAttributes,
        options: sortedOptions,
    };
}

function isImportableSpec(spec) {
    if (!spec || typeof spec !== 'object') return false;
    if (isLegacyJunkSpecificationGroup({ code: spec.group })) return false;
    if (isLegacyJunkSpecificationAttribute({ code: spec.attribute })) return false;
    return true;
}

function createGroupDefinition(code, spec) {
    return {
        code,
        icon: GROUP_ICONS[code] || 'tag',
        order: groupOrder(code),
        published: true,
        collapsible: true,
        expanded: groupOrder(code) <= 6,
        translations: [
            translation(spec.lang, spec.groupName || code),
        ],
    };
}

function createAttributeDefinition(code, group, spec) {
    const type = spec.type || 'Option';
    const productFacing = group !== 'SPEC-TT-GROUP-SOURCE' && !code.startsWith('SPEC-TT-FIELD-DETAIL-');

    return {
        code,
        group,
        order: Number.isInteger(spec.order) ? spec.order : 0,
        published: true,
        filterable: productFacing && FILTERABLE_TYPES.has(type),
        comparable: productFacing && COMPARABLE_TYPES.has(type),
        translations: [
            translation(spec.lang, spec.attributeName || code),
        ],
    };
}

function createOptionDefinition(code, attribute, spec) {
    return {
        code,
        attribute,
        order: Number.isInteger(spec.order) ? spec.order : 0,
        published: true,
        translations: [
            translation(spec.lang, spec.optionName || code),
        ],
    };
}

function translation(lang, name) {
    return {
        lang: normalizeLanguage(lang),
        name: String(name || '').trim(),
    };
}

function normalizeLanguage(lang) {
    return String(lang || '').trim() || DEFAULT_LANGUAGE;
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
