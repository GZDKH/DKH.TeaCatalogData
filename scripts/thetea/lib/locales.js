const PRODUCT_LOCALE_ALIASES = {
    en: 'en-US',
    ru: 'ru-RU',
    zh: 'zh-CN',
    'zh-cn': 'zh-CN',
};

const D1_TO_API_LOCALE_ALIASES = {
    no: 'nb',
    zh: 'zh-CN',
    'zh-hk': 'zh-HK',
    'zh-tw': 'zh-TW',
};

function canonicalLocale(value) {
    const raw = String(value || '').trim().replace(/_/g, '-');
    if (!raw) return '';

    return raw
        .split('-')
        .filter(Boolean)
        .map((part, index) => {
            if (index === 0) return part.toLowerCase();
            if (part.length === 2 || part.length === 3) return part.toUpperCase();
            if (part.length === 4) return part[0].toUpperCase() + part.slice(1).toLowerCase();
            return part.toLowerCase();
        })
        .join('-');
}

function localesFromMeta(meta) {
    const source = meta?.data || meta || {};
    const locales = Array.isArray(source.locales) ? source.locales : [];
    const result = [];
    const seen = new Set();

    for (const locale of locales) {
        const code = canonicalLocale(locale.bcp47 || locale.code);
        if (!code || seen.has(code)) continue;
        seen.add(code);
        result.push(code);
    }

    return result;
}

function resolveRequestedLocales(requested, meta) {
    const requestedList = (requested || [])
        .map(canonicalLocale)
        .filter(Boolean);

    if (!requestedList.length || requestedList.some(x => x.toLowerCase() === 'all')) {
        const all = localesFromMeta(meta);
        if (!all.length) {
            throw new Error('TheTea /meta did not return locales; cannot resolve --langs=all.');
        }
        return all;
    }

    return [...new Set(requestedList)];
}

function toProductLocale(sourceLocale) {
    const source = canonicalLocale(sourceLocale);
    const alias = PRODUCT_LOCALE_ALIASES[source] || PRODUCT_LOCALE_ALIASES[source.toLowerCase()];
    return alias || source;
}

function toApiLocale(sourceLocale) {
    const source = canonicalLocale(sourceLocale);
    return D1_TO_API_LOCALE_ALIASES[source.toLowerCase()] || source;
}

function d1LocaleCandidates(apiLocale) {
    const target = toApiLocale(apiLocale);
    const aliases = Object.entries(D1_TO_API_LOCALE_ALIASES)
        .filter(([, value]) => value.toLowerCase() === target.toLowerCase())
        .map(([value]) => value);
    return [...new Set([
        target,
        target.toLowerCase(),
        ...aliases,
    ])];
}

module.exports = {
    canonicalLocale,
    d1LocaleCandidates,
    localesFromMeta,
    resolveRequestedLocales,
    toApiLocale,
    toProductLocale,
};
