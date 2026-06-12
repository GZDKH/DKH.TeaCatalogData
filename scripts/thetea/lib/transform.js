const { buildSpecs, makeCode, normalizeCodePart, titleize } = require('./spec-registry');
const { toProductLocale } = require('./locales');
const { buildCategoryAssignments, PROVINCE_CATEGORY, TEA_TYPE_CATEGORY } = require('./category-taxonomy');

const FALLBACK_SOURCE_LOCALES = ['en', 'ru', 'zh'];

const DEFAULT_PACKAGES = [
    { package: 'PKG-50G', packageName: '50g', packageUnit: 'g', quantity: 1, default: true },
];

const STANDARD_PACKAGES = [
    { package: 'PKG-25G', packageName: '25g', packageUnit: 'g', quantity: 1, default: false },
    ...DEFAULT_PACKAGES,
    { package: 'PKG-100G', packageName: '100g', packageUnit: 'g', quantity: 1, default: false },
    { package: 'PKG-250G', packageName: '250g', packageUnit: 'g', quantity: 1, default: false },
    { package: 'PKG-500G', packageName: '500g', packageUnit: 'g', quantity: 1, default: false },
];

function transformCardSet(cardSet, options = {}) {
    const primary = cardSet.en || cardSet['en-US'] || cardSet['en-us'] || Object.values(cardSet)[0];
    if (!primary) throw new Error('cardSet must contain at least one TeaCard');

    const meta = primary.meta || {};
    const warnings = [];
    const product = {
        code: makeCode('TEA', meta.origin_country || 'CN', primary.slug),
        sku: `${normalizeCodePart(primary.slug)}-${normalizeCodePart(meta.origin_country || 'CN')}`,
        order: options.order || 0,
        published: options.publish === true,
        nativeName: extractNativeName(primary),
        transcription: extractTranscription(primary.name),
        translations: buildTranslations(cardSet, primary, warnings),
        catalogs: buildCatalogAssignments(primary, options.knownCategories || new Set(), warnings),
        packages: options.packages === 'standard' ? STANDARD_PACKAGES : DEFAULT_PACKAGES,
        tags: buildTags(primary),
        specifications: buildSpecs(primary),
        origins: buildOrigins(cardSet, primary),
    };

    return { product, warnings };
}

function buildTranslations(cardSet, primary, warnings) {
    const translations = new Map();

    for (const [sourceLang, card] of Object.entries(cardSet)) {
        if (!card) continue;
        const bcp47 = toProductLocale(card.lang || sourceLang);
        if (!bcp47 || translations.has(bcp47)) continue;
        const rawName = localizedName(card, sourceLang, primary);
        const displayName = cleanDisplayName(rawName);

        translations.set(bcp47, {
            name: displayName,
            transcription: extractTranscription(rawName || card.name || primary.name),
            description: buildDescription(card),
            seo: seoSlug(card.slug || primary.slug),
            metaTitle: card.seo?.title,
            metaDescription: card.seo?.description,
        });
    }

    for (const lang of FALLBACK_SOURCE_LOCALES) {
        const bcp47 = toProductLocale(lang);
        if (translations.has(bcp47)) continue;
        const fallbackName = nameFallback(primary, lang);
        if (fallbackName) {
            translations.set(bcp47, {
                name: cleanDisplayName(fallbackName),
                transcription: extractTranscription(primary.name),
                seo: seoSlug(primary.slug),
            });
            warnings.push(`Missing localized ${lang} card for ${primary.slug}; generated name-only ${bcp47} translation.`);
        }
    }

    return [...translations.entries()]
        .map(([lang, value]) => ({ lang, ...value }))
        .filter(t => t.name);
}

function buildDescription(card) {
    const enrichment = card.enrichment || {};
    const chunks = [];
    if (enrichment.one_liner) chunks.push(`**${enrichment.one_liner}**`);
    if (enrichment.summary) chunks.push(enrichment.summary);
    if (enrichment.tasting_note) chunks.push(`**Tasting note:** ${enrichment.tasting_note}`);

    const recipes = (card.recipe || []).map(r => {
        const grams = r.tea_grams ? `${r.tea_grams} g` : '? g';
        const water = r.water_ml ? `${r.water_ml} ml` : '? ml';
        const temp = r.water_temp ? `${r.water_temp}°C` : '?°C';
        const steep = r.steep_sec ? `${r.steep_sec}s` : '?s';
        return `- **${r.style}:** ${temp}, ${grams} / ${water}, ${steep}, ${r.max_steeps || '?'} steeps`;
    });
    if (recipes.length) chunks.push(`## Brewing recipes\n${recipes.join('\n')}`);

    return chunks.filter(Boolean).join('\n\n');
}

function buildCatalogAssignments(card, knownCategories, warnings) {
    const categoryCodes = buildCategoryAssignments(card, warnings);

    return [...new Set(categoryCodes)]
        .filter(code => {
            if (!knownCategories.size || knownCategories.has(code)) return true;
            warnings.push(`Category '${code}' is not present in local categories.json (${card.slug}).`);
            return true;
        })
        .map((category, index) => ({
            catalog: 'CATALOG-CHINESE-TEA',
            catalogCurrency: 'CNY',
            category,
            order: index + 1,
            published: true,
        }));
}

function buildTags(card) {
    const tags = [];
    for (const tag of card.tags || []) {
        tags.push({
            code: makeCode('TAG-TT', tag),
            name: titleize(tag),
            lang: 'en-US',
        });
    }

    for (const tag of card.enrichment?.flavor_tags || []) {
        tags.push({
            code: makeCode('TAG-FLAVOR', tag),
            name: titleize(tag),
            lang: 'en-US',
        });
    }

    return dedupeBy(tags, t => t.code);
}

function buildOrigins(cardSet, primary) {
    const meta = primary.meta || {};
    const origin = {
        country: meta.origin_country || 'CN',
        state: meta.province,
        city: meta.city || meta.county,
        altitude: meta.altitude_min || meta.altitude_max
            ? { min: meta.altitude_min ?? undefined, max: meta.altitude_max ?? undefined, unit: 'm' }
            : undefined,
        coordinates: meta.lat || meta.lng ? { lat: meta.lat, lng: meta.lng } : undefined,
        translations: [],
    };

    const seen = new Set();
    for (const [sourceLang, card] of Object.entries(cardSet)) {
        if (!card) continue;
        const bcp47 = toProductLocale(card.lang || sourceLang);
        if (!bcp47 || seen.has(bcp47)) continue;
        seen.add(bcp47);

        origin.translations.push({
            lang: bcp47,
            place: card.sections?.classification_origin?.origin?.value || meta.province,
            notes: buildOriginNotes(card),
        });
    }

    return [stripUndefined(origin)];
}

function buildOriginNotes(card) {
    const notes = [];
    appendPlain(notes, card, 'terroir', 'altitude', 'Altitude');
    appendPlain(notes, card, 'terroir', 'climate', 'Climate');
    appendPlain(notes, card, 'terroir', 'soil', 'Soil');
    appendPlain(notes, card, 'classification_origin', 'coordinates', 'Coordinates');
    return notes.join('\n\n');
}

function appendPlain(chunks, card, section, field, title) {
    const value = card.sections?.[section]?.[field]?.value;
    if (value) chunks.push(`**${title}:** ${value}`);
}

function nameFallback(primary, lang) {
    const normalized = String(lang || '').toLowerCase();
    const base = normalized.split('-')[0];
    return primary.names?.[normalized] || primary.names?.[base] || (base === 'en' ? primary.name : null);
}

function localizedName(card, sourceLang, primary) {
    return nameFallback(card, card.lang || sourceLang)
        || card.name
        || nameFallback(primary, sourceLang);
}

function cleanDisplayName(name) {
    if (!name) return name;
    const original = String(name).trim();
    let value = original;
    while (true) {
        const next = value.replace(/\s*\((?=[^)]*[\u3400-\u9fff])[^)]*\)\s*$/u, '').trim();
        if (!next || next === value) return value || original;
        value = next;
    }
}

function extractNativeName(card) {
    const zh = card.names?.zh || card.names?.['zh-CN'];
    if (!zh) return undefined;
    return cleanDisplayName(zh) || undefined;
}

function extractTranscription(name) {
    if (!name) return undefined;
    const match = /\((?:[^,()]+,\s*)?([^()]+)\)\s*$/.exec(name);
    return match ? match[1].trim() : undefined;
}

function seoSlug(slug) {
    return String(slug || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function dedupeBy(items, keyFn) {
    const map = new Map();
    for (const item of items) map.set(keyFn(item), item);
    return [...map.values()];
}

function stripUndefined(value) {
    if (Array.isArray(value)) return value.map(stripUndefined);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, stripUndefined(v)]));
    }
    return value;
}

module.exports = {
    TEA_TYPE_CATEGORY,
    PROVINCE_CATEGORY,
    DEFAULT_PACKAGES,
    STANDARD_PACKAGES,
    transformCardSet,
    buildDescription,
    cleanDisplayName,
    extractNativeName,
    extractTranscription,
};
