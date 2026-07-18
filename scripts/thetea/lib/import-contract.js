function normalizeProductForImport(product) {
    assertTextLimit(product.code, 100, `${product.code || '<product>'}.code`);
    assertTextLimit(product.sku, 100, `${product.code}.sku`);
    assertTextLimit(product.mpn, 100, `${product.code}.mpn`);
    assertTextLimit(product.gtin, 100, `${product.code}.gtin`);
    assertTextLimit(product.nativeName, 500, `${product.code}.nativeName`);
    assertTextLimit(product.transcription, 500, `${product.code}.transcription`);

    for (const [index, translation] of (product.translations || []).entries()) {
        const prefix = `${product.code}.translations[${index}]`;
        assertTextLimit(translation.lang, 10, `${prefix}.lang`);
        assertTextLimit(translation.name, 256, `${prefix}.name`);
        assertTextLimit(translation.transcription, 500, `${prefix}.transcription`);
        assertTextLimit(translation.seo, 256, `${prefix}.seo`);
        assertTextLimit(translation.metaTitle, 128, `${prefix}.metaTitle`);
        assertTextLimit(translation.metaDescription, 1024, `${prefix}.metaDescription`);
        assertTextLimit(translation.description, 2000, `${prefix}.description`);
    }

    for (const [index, origin] of (product.origins || []).entries()) {
        const prefix = `${product.code}.origins[${index}]`;
        assertTextLimit(origin.country, 10, `${prefix}.country`);
        assertTextLimit(origin.state, 50, `${prefix}.state`);
        assertTextLimit(origin.city, 50, `${prefix}.city`);
        if (origin.altitude) {
            origin.altitude.min = normalizeAltitudeValue(origin.altitude.min, `${prefix}.altitude.min`);
            origin.altitude.max = normalizeAltitudeValue(origin.altitude.max, `${prefix}.altitude.max`);
            assertTextLimit(origin.altitude.unit, 10, `${prefix}.altitude.unit`);
        }
        for (const [translationIndex, translation] of (origin.translations || []).entries()) {
            const translationPrefix = `${prefix}.translations[${translationIndex}]`;
            assertTextLimit(translation.lang, 10, `${translationPrefix}.lang`);
            assertTextLimit(translation.place, 500, `${translationPrefix}.place`);
        }
    }

    const seenAttributes = new Set();
    for (const [index, spec] of (product.specifications || []).entries()) {
        const attribute = String(spec.attribute || '').trim().toUpperCase();
        if (!attribute) throw new Error(`${product.code}.specifications[${index}] has no attribute.`);
        if (seenAttributes.has(attribute)) {
            throw new Error(`${product.code}: specification attribute ${attribute} occurs more than once.`);
        }
        seenAttributes.add(attribute);
        assertTextLimit(spec.value, 4000, `${product.code}.specifications[${index}].value`);
    }

    return product;
}

function normalizeAltitudeValue(value, field = 'altitude') {
    if (value === null || value === undefined || value === '') return undefined;
    const numeric = typeof value === 'number'
        ? value
        : Number(String(value).replace(/,/g, '').trim());
    if (!Number.isFinite(numeric)) throw new Error(`${field} must be a finite number.`);
    const rounded = Math.round(numeric);
    if (rounded < -2147483648 || rounded > 2147483647) {
        throw new Error(`${field} is outside the supported Int32 range.`);
    }
    return rounded;
}

function assertTextLimit(value, maxLength, field) {
    if (value === null || value === undefined) return;
    if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
    if (value.length > maxLength) {
        throw new Error(`${field} exceeds the ${maxLength}-character import limit; data was not truncated.`);
    }
}

module.exports = {
    normalizeAltitudeValue,
    normalizeProductForImport,
};
