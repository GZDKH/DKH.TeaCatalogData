const { canonicalLocale } = require('./locales');

function resolveFieldLocales(requested, langs) {
    if (!requested?.length || requested.includes('all')) return null;

    const available = new Set((langs || []).map(canonicalLocale));
    const resolved = requested
        .map(canonicalLocale)
        .filter(lang => available.has(lang));

    return [...new Set(resolved)];
}

function shouldFetchFieldsForLang(lang, fieldLocales) {
    return !fieldLocales || fieldLocales.includes(canonicalLocale(lang));
}

function assertCompleteFieldLocales(manifest) {
    const langs = [...new Set((manifest?.langs || []).map(canonicalLocale).filter(Boolean))];
    const fieldLangs = manifest?.fieldLangs;
    if (!langs.length || fieldLangs === null || fieldLangs === undefined) return;
    if (!Array.isArray(fieldLangs)) return;

    const available = new Set(fieldLangs.map(canonicalLocale).filter(Boolean));
    const missing = langs.filter(lang => !available.has(lang));
    if (missing.length) {
        throw new Error(`Snapshot is missing per-field endpoint details for locales: ${missing.join(', ')}. Re-fetch with --field-langs=all --resume or pass --allow-partial-field-locales for diagnostics only.`);
    }
}

module.exports = {
    assertCompleteFieldLocales,
    resolveFieldLocales,
    shouldFetchFieldsForLang,
};
