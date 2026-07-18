const ATTRIBUTE_TYPES = Object.freeze([
    'Option',
    'CustomText',
    'CustomHtmlText',
    'CustomMarkdownText',
    'Hyperlink',
    'Number',
    'Range',
    'List',
    'Boolean',
    'Date',
    'Duration',
]);

const ATTRIBUTE_TYPE_SET = new Set(ATTRIBUTE_TYPES);

function normalizeScalarList(values) {
    if (!Array.isArray(values)) {
        throw new Error('List specification value must be an array.');
    }

    const result = [];
    const seen = new Set();
    for (const value of values) {
        if (value === null || value === undefined) continue;
        if (!['string', 'number', 'boolean'].includes(typeof value)) {
            throw new Error(`List specification contains a non-scalar ${typeof value} value.`);
        }

        const normalized = String(value).trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }

    return result;
}

function encodeListValue(values) {
    return JSON.stringify(normalizeScalarList(values));
}

function normalizeBoolean(value) {
    if (value === true || value === 1 || value === '1') return true;
    if (value === false || value === 0 || value === '0') return false;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === 'yes') return true;
        if (normalized === 'false' || normalized === 'no') return false;
    }
    throw new Error(`Invalid Boolean specification value '${value}'.`);
}

function normalizeDurationSeconds(value) {
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds) || seconds < 0) {
        throw new Error(`Invalid Duration specification value '${value}'.`);
    }
    return seconds;
}

function normalizeSpecifications(specifications, productCode = '<unknown>') {
    const byAttribute = new Map();

    for (const input of specifications || []) {
        if (!input || typeof input !== 'object') continue;
        const attribute = String(input.attribute || '').trim().toUpperCase();
        if (!attribute) {
            throw new Error(`${productCode}: specification has no attribute code.`);
        }

        const spec = { ...input, attribute };
        if (!ATTRIBUTE_TYPE_SET.has(spec.type)) {
            throw new Error(`${productCode}: ${attribute} has unsupported type '${spec.type}'.`);
        }

        const existing = byAttribute.get(attribute);
        if (!existing) {
            byAttribute.set(attribute, spec);
            continue;
        }

        if (specificationValueSignature(existing) !== specificationValueSignature(spec)) {
            throw new Error(`${productCode}: conflicting values for specification attribute ${attribute}.`);
        }

        if (definitionSignature(existing) !== definitionSignature(spec)) {
            throw new Error(`${productCode}: conflicting definition metadata for specification attribute ${attribute}.`);
        }

        byAttribute.set(attribute, preferredSpecification(existing, spec));
    }

    return [...byAttribute.values()].sort((a, b) =>
        numericOrder(a.order) - numericOrder(b.order)
        || a.attribute.localeCompare(b.attribute));
}

function uniqueRepeatedObjects(items, discriminator, label) {
    const result = [];
    const seen = new Map();

    for (const item of items || []) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error(`${label} entries must be objects.`);
        }

        const rawKey = discriminator(item);
        const key = String(rawKey ?? '').trim();
        if (!key) throw new Error(`${label} entry is missing its stable discriminator.`);

        const normalized = stableStringify(item);
        if (seen.has(key)) {
            if (seen.get(key) !== normalized) {
                throw new Error(`${label} contains conflicting entries for discriminator '${key}'.`);
            }
            continue;
        }

        seen.set(key, normalized);
        result.push({ key, item });
    }

    return result;
}

function stripDefinitionMetadata(specification) {
    const {
        unit,
        groupKey,
        attributeKey,
        optionKey,
        labelSources,
        ...productSpecification
    } = specification;
    return productSpecification;
}

function specificationValueSignature(spec) {
    return stableStringify({
        type: spec.type,
        option: spec.option ?? null,
        value: spec.value ?? null,
        valueMin: spec.valueMin ?? null,
        valueMax: spec.valueMax ?? null,
    });
}

function definitionSignature(spec) {
    return stableStringify({
        group: String(spec.group || '').toUpperCase(),
        groupName: spec.groupName ?? null,
        groupKey: spec.groupKey ?? null,
        attributeName: spec.attributeName ?? null,
        attributeKey: spec.attributeKey ?? null,
        type: spec.type,
        unit: spec.unit ?? null,
        optionAttribute: spec.option ? String(spec.attribute || '').toUpperCase() : null,
        optionName: spec.optionName ?? null,
        optionKey: spec.optionKey ?? null,
    });
}

function preferredSpecification(a, b) {
    const orderA = numericOrder(a.order);
    const orderB = numericOrder(b.order);
    if (orderA !== orderB) return orderA < orderB ? a : b;
    return stableStringify(a).localeCompare(stableStringify(b)) <= 0 ? a : b;
}

function numericOrder(value) {
    return Number.isInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key =>
            `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

module.exports = {
    ATTRIBUTE_TYPES,
    ATTRIBUTE_TYPE_SET,
    encodeListValue,
    normalizeBoolean,
    normalizeDurationSeconds,
    normalizeScalarList,
    normalizeSpecifications,
    stripDefinitionMetadata,
    uniqueRepeatedObjects,
};
