const MANAGED_SPEC_PREFIX = 'SPEC-TT-';

function overlayExistingProduct(generated, baseline, options = {}) {
    if (!baseline) return generated;
    if (normalizeCode(generated.code) !== normalizeCode(baseline.code)) {
        throw new Error(`Cannot overlay ${generated.code} onto baseline product ${baseline.code}.`);
    }

    const result = {
        ...generated,
        ...baseline,
        code: generated.code,
        nativeName: generated.nativeName,
        transcription: generated.transcription,
        translations: mergeByKey(
            baseline.translations,
            generated.translations,
            item => String(item.lang || '').toLowerCase()),
        tags: mergeByKey(baseline.tags, generated.tags, item => normalizeCode(item.code)),
        specifications: [
            ...collection(baseline.specifications, 'baseline specifications')
                .filter(spec => !isManagedSpecification(spec)),
            ...collection(generated.specifications, 'generated specifications'),
        ],
        catalogs: mergeByKey(
            baseline.catalogs,
            generated.catalogs,
            catalogAssignmentKey),
        origins: collection(generated.origins, 'generated origins'),
        related: mergeRelations(generated.related, baseline.related),
        crossSells: collection(baseline.crossSells, 'baseline crossSells'),
        packages: collection(baseline.packages, 'baseline packages').length
            ? baseline.packages
            : generated.packages,
    };

    if (options.publishExisting === true) result.published = generated.published;
    assertUniqueSpecificationAttributes(result.specifications, result.code);
    return result;
}

function validateBaselinePreservation(products, baselineProducts) {
    const errors = [];
    const generatedByCode = new Map((products || []).map(product => [normalizeCode(product.code), product]));

    for (const baseline of baselineProducts || []) {
        const generated = generatedByCode.get(normalizeCode(baseline.code));
        if (!generated) continue;

        assertKeySubset(errors, baseline, generated, 'crossSells', crossSellKey);
        assertStructuralSubset(errors, baseline, generated, 'related');
        assertKeySubset(errors, baseline, generated, 'catalogs', catalogAssignmentKey);
        assertKeySubset(errors, baseline, generated, 'tags', item => normalizeCode(item.code));
        assertKeySubset(errors, baseline, generated, 'packages', packageKey);
        assertStructuralSubset(errors, baseline, generated, 'tierPrices');
        assertStructuralSubset(errors, baseline, generated, 'catalogPrices');
        assertStructuralSubset(errors, baseline, generated, 'storePriceOverrides');

        const preservedSpecs = collection(baseline.specifications, 'baseline specifications')
            .filter(spec => !isManagedSpecification(spec));
        const generatedSpecs = new Map(collection(generated.specifications, 'generated specifications')
            .map(spec => [specificationKey(spec), stableStringify(spec)]));
        for (const spec of preservedSpecs) {
            const key = specificationKey(spec);
            if (!generatedSpecs.has(key)) {
                errors.push(`${baseline.code}: unrelated specification ${spec.attribute || '<missing>'} would be removed.`);
            } else if (generatedSpecs.get(key) !== stableStringify(spec)) {
                errors.push(`${baseline.code}: unrelated specification ${spec.attribute || '<missing>'} would be changed.`);
            }
        }
    }

    return errors;
}

function mergeRelations(generatedRelations, baselineRelations) {
    const baseline = collection(baselineRelations, 'baseline related');
    if (!baseline.length) return collection(generatedRelations, 'generated related');

    const result = baseline.map(relation => ({ ...relation }));
    const seen = new Set(result.map(relationKey));
    let nextOrder = result.reduce((max, relation) => {
        const order = Number(relation.order);
        return Number.isFinite(order) ? Math.max(max, order) : max;
    }, 0);
    for (const relation of collection(generatedRelations, 'generated related')) {
        const key = relationKey(relation);
        if (seen.has(key)) continue;
        seen.add(key);
        nextOrder += 1;
        result.push({ ...relation, order: nextOrder });
    }
    return result;
}

function mergeByKey(baseItems, overridingItems, keyFn) {
    const result = new Map();
    for (const item of collection(baseItems, 'baseline collection')) {
        const key = keyFn(item);
        if (!key) throw new Error('Baseline collection item has no stable key.');
        result.set(key, item);
    }
    for (const item of collection(overridingItems, 'generated collection')) {
        const key = keyFn(item);
        if (!key) throw new Error('Generated collection item has no stable key.');
        result.set(key, item);
    }
    return [...result.values()];
}

function assertKeySubset(errors, baseline, generated, field, keyFn) {
    const generatedKeys = new Set(collection(generated[field], `generated ${field}`).map(keyFn));
    for (const item of collection(baseline[field], `baseline ${field}`)) {
        const key = keyFn(item);
        if (!generatedKeys.has(key)) {
            errors.push(`${baseline.code}: unrelated ${field} association ${key || '<missing>'} would be removed.`);
        }
    }
}

function assertStructuralSubset(errors, baseline, generated, field) {
    const counts = multiset(collection(generated[field], `generated ${field}`).map(stableStringify));
    for (const item of collection(baseline[field], `baseline ${field}`)) {
        const signature = stableStringify(item);
        const remaining = counts.get(signature) || 0;
        if (!remaining) {
            errors.push(`${baseline.code}: unrelated ${field} entry would be removed or changed.`);
            continue;
        }
        counts.set(signature, remaining - 1);
    }
}

function assertUniqueSpecificationAttributes(specifications, productCode) {
    const seen = new Set();
    for (const spec of specifications || []) {
        const attribute = normalizeCode(spec.attribute);
        if (!attribute) throw new Error(`${productCode}: specification has no attribute code.`);
        if (seen.has(attribute)) {
            throw new Error(`${productCode}: specification attribute ${attribute} occurs more than once after baseline overlay.`);
        }
        seen.add(attribute);
    }
}

function isManagedSpecification(spec) {
    return normalizeCode(spec?.attribute).startsWith(MANAGED_SPEC_PREFIX)
        || normalizeCode(spec?.group).startsWith(`${MANAGED_SPEC_PREFIX}GROUP-`);
}

function catalogAssignmentKey(item) {
    return `${normalizeCode(item?.catalog)}|${normalizeCode(item?.category)}`;
}

function relationKey(item) {
    return `${normalizeCode(item?.product)}|${normalizeCode(item?.catalog)}`;
}

function crossSellKey(item) {
    return `${normalizeCode(item?.product)}|${normalizeCode(item?.catalog)}`;
}

function packageKey(item) {
    return normalizeCode(item?.package);
}

function specificationKey(item) {
    return `${normalizeCode(item?.attribute)}|${normalizeCode(item?.option)}`;
}

function collection(value, label) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
    return value;
}

function normalizeCode(value) {
    const code = value && typeof value === 'object' ? value.code : value;
    return String(code || '').trim().toUpperCase();
}

function multiset(values) {
    const result = new Map();
    for (const value of values) result.set(value, (result.get(value) || 0) + 1);
    return result;
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
    isManagedSpecification,
    overlayExistingProduct,
    validateBaselinePreservation,
};
