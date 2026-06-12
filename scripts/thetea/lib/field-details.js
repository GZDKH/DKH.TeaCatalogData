function extractFieldRefs(card) {
    const refs = [];
    const seen = new Set();

    for (const [section, fields] of Object.entries(card?.sections || {})) {
        for (const field of Object.keys(fields || {})) {
            const key = `${section}\0${field}`;
            if (seen.has(key)) continue;
            seen.add(key);
            refs.push({ section, field });
        }
    }

    return refs;
}

function normalizeFieldPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const hasValueMd = Object.prototype.hasOwnProperty.call(payload, 'value_md');
    const hasValueNum = Object.prototype.hasOwnProperty.call(payload, 'value_num');
    const hasUnit = Object.prototype.hasOwnProperty.call(payload, 'unit');
    return {
        value: hasValueMd ? payload.value_md : payload.value,
        num: hasValueNum ? payload.value_num : payload.num,
        unit: hasUnit ? payload.unit : undefined,
    };
}

function applyFieldDetails(card, details) {
    const enriched = JSON.parse(JSON.stringify(card || {}));
    if (!enriched.sections) enriched.sections = {};

    for (const item of details || []) {
        const payload = item?.payload || item;
        const normalized = normalizeFieldPayload(payload);
        const section = payload?.section_code || item?.section;
        const field = item?.field;
        if (!section || !field || !normalized) continue;

        if (!enriched.sections[section]) enriched.sections[section] = {};
        const current = enriched.sections[section][field] || {};
        enriched.sections[section][field] = {
            ...current,
            value: normalized.value !== undefined ? normalized.value : current.value,
            num: normalized.num !== undefined ? normalized.num : current.num,
            unit: normalized.unit !== undefined ? normalized.unit : current.unit ?? null,
            endpoint: payload,
        };
    }

    return enriched;
}

module.exports = {
    applyFieldDetails,
    extractFieldRefs,
    normalizeFieldPayload,
};
