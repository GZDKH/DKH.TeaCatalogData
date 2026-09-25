const { canonicalLocale } = require('./locales');

const ENTITY_KINDS = Object.freeze(['tea', 'category', 'infusion', 'unknown']);

function normalizeKind(value) {
    const kind = String(value || '').trim().toLowerCase();
    if (kind === 'tea' || kind === 'teas') return 'tea';
    if (kind === 'category' || kind === 'topic' || kind === 'landing') return 'category';
    if (kind === 'infusion' || kind === 'tisanes' || kind === 'tisane') return 'infusion';
    return 'unknown';
}

function kindClaims(record) {
    return [
        ['kind', record?.kind],
        ['article_type', record?.article_type],
        ['meta.kind', record?.meta?.kind],
        ['meta.article_type', record?.meta?.article_type],
    ]
        .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
        .map(([path, value]) => ({ path, value: String(value), kind: normalizeKind(value) }));
}

function classifySourceEntity(record, endpointKind = 'unknown') {
    const claims = kindClaims(record);
    const explicit = claims.filter(claim => claim.kind !== 'unknown');
    const distinct = [...new Set(explicit.map(claim => claim.kind))];
    const endpoint = normalizeKind(endpointKind);
    const kind = distinct.length === 1
        ? distinct[0]
        : (distinct.length > 1 ? 'unknown' : endpoint);

    return {
        kind: ENTITY_KINDS.includes(kind) ? kind : 'unknown',
        claims,
        evidence: explicit.length ? 'source-field' : (endpoint !== 'unknown' ? 'endpoint' : 'unclassified'),
        conflict: distinct.length > 1,
        endpointKind: endpoint,
    };
}

function normalizeEntity(record, endpoint, endpointKind) {
    const classification = classifySourceEntity(record, endpointKind);
    return {
        slug: String(record?.slug || '').trim(),
        entityKind: classification.kind,
        endpoint,
        sourceKind: record?.kind || record?.article_type || record?.meta?.kind || record?.meta?.article_type || null,
        classificationEvidence: classification.evidence,
        classificationConflict: classification.conflict,
        source: record,
    };
}

function buildEntityInventory({ teas = [], infusions = [] } = {}) {
    const entities = [
        ...teas.map(item => normalizeEntity(item, 'teas', 'tea')),
        ...infusions.map(item => normalizeEntity(item, 'infusions', 'infusion')),
    ].filter(item => item.slug);
    const byKey = new Map();
    const duplicates = [];

    for (const entity of entities) {
        const key = `${entity.entityKind}\0${entity.slug}`;
        const previous = byKey.get(key);
        if (previous) duplicates.push({ key, endpoints: [previous.endpoint, entity.endpoint] });
        byKey.set(key, entity);
    }

    const bySlug = new Map();
    for (const entity of byKey.values()) {
        const list = bySlug.get(entity.slug) || [];
        list.push(entity);
        bySlug.set(entity.slug, list);
    }
    const kindConflicts = [];
    for (const [slug, list] of bySlug.entries()) {
        const kinds = [...new Set(list.map(item => item.entityKind))];
        if (kinds.length < 2) continue;
        kindConflicts.push({ slug, kinds: kinds.sort() });
        for (const entity of list) entity.classificationConflict = true;
    }

    return {
        entities: [...byKey.values()].sort((a, b) => a.entityKind.localeCompare(b.entityKind) || a.slug.localeCompare(b.slug)),
        duplicates,
        kindConflicts,
    };
}

function validateCardLanguage(card, requestedLang) {
    const requested = canonicalLocale(requestedLang);
    const actual = canonicalLocale(card?.lang || card?.meta?.lang);
    if (!requested || !actual) return { ok: true, requested, actual: actual || null };
    return { ok: requested === actual, requested, actual };
}

module.exports = {
    ENTITY_KINDS,
    buildEntityInventory,
    classifySourceEntity,
    normalizeKind,
    validateCardLanguage,
};
