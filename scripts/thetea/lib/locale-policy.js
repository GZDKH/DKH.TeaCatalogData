const fs = require('fs');
const crypto = require('crypto');
const { canonicalLocale, toProductLocale } = require('./locales');

const DEFAULT_POLICY = require('../../../docs/thetea-locale-policy.json');

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function policyHash(policy = DEFAULT_POLICY) {
    return sha256(stable(policy));
}

function normalizeDestinationRegistry(registry = []) {
    return [...new Set(registry.map(item => canonicalLocale(item?.cultureName || item?.locale || item?.code || item)).filter(Boolean))];
}

function sourceRow(policy, sourceLocale) {
    const canonical = canonicalLocale(sourceLocale);
    return (policy.rows || []).find(row => canonicalLocale(row.sourceBcp47) === canonical)
        || (policy.rows || []).find(row => String(row.sourceCode).toLowerCase() === String(sourceLocale).toLowerCase())
        || null;
}

function hasReviewFlag(row) {
    return /review|verify|ambiguous|not an automatic/i.test(String(row?.disposition || ''));
}

function resolveSourceLocale(sourceLocale, { policy = DEFAULT_POLICY, destinationRegistry = [] } = {}) {
    const row = sourceRow(policy, sourceLocale);
    const sourceBcp47 = canonicalLocale(sourceLocale);
    if (!row) {
        return {
            sourceLocale: sourceBcp47,
            sourceBcp47,
            sourceCode: null,
            targetLocales: [],
            status: 'review',
            reason: 'source language is absent from the versioned policy',
            derivation: null,
        };
    }
    const destination = normalizeDestinationRegistry(destinationRegistry);
    const candidates = [...new Set((row.candidateTargetLocales || []).map(canonicalLocale).filter(Boolean))];
    const selected = destination.length ? candidates.filter(candidate => destination.includes(candidate)) : candidates;
    const exact = candidates.length === 1 && canonicalLocale(candidates[0]) === sourceBcp47;
    const unavailable = destination.length > 0 && selected.length === 0;
    const review = hasReviewFlag(row);
    return {
        sourceLocale: sourceBcp47,
        sourceBcp47: canonicalLocale(row.sourceBcp47),
        sourceCode: row.sourceCode,
        targetLocales: selected,
        candidates,
        status: unavailable || review ? 'review' : 'ready',
        reason: unavailable
            ? 'none of the proposed target cultures exists in the supplied destination registry'
            : review ? row.disposition : null,
        derivation: exact ? 'exact-source-locale' : 'inherited-language',
        direction: row.direction,
        sourceDisposition: row.disposition,
    };
}

function resolveLocalePolicy({ sourceLocales, destinationRegistry = [], policy = DEFAULT_POLICY } = {}) {
    const requested = [...new Set((sourceLocales || policy.rows.map(row => row.sourceBcp47)).map(canonicalLocale).filter(Boolean))];
    const resolutions = requested.map(locale => resolveSourceLocale(locale, { policy, destinationRegistry }));
    const targetLocales = [...new Set(resolutions.flatMap(item => item.targetLocales))].sort();
    return {
        schemaVersion: 1,
        mappingVersion: policy.mappingVersion,
        policyHash: policyHash(policy),
        sourceRegistry: policy.policy.sourceRegistry,
        destinationRegistry: policy.policy.destinationRegistry,
        sourceLocales: requested,
        targetLocales,
        resolutions,
        reviewRequired: resolutions.filter(item => item.status === 'review').map(item => ({
            sourceLocale: item.sourceLocale,
            reason: item.reason,
        })),
        fallbackSemantics: {
            inheritedLanguageIsNotNative: true,
            fallbackLabel: policy.policy.fallbackLabel,
            preserveRegionalOverride: true,
        },
    };
}

function buildLocaleCoverage({ sourceRecords = [], fields = [], localePolicy } = {}) {
    if (!localePolicy || !Array.isArray(localePolicy.resolutions)) throw new Error('localePolicy with resolutions is required.');
    const bySource = new Map(sourceRecords.map(record => [canonicalLocale(record.locale || record.lang), record]));
    const rows = [];
    for (const resolution of localePolicy.resolutions) {
        const source = bySource.get(resolution.sourceBcp47) || bySource.get(resolution.sourceLocale);
        for (const targetLocale of resolution.targetLocales) {
            const regional = canonicalLocale(targetLocale) === canonicalLocale(resolution.sourceBcp47)
                || toProductLocale(resolution.sourceBcp47) === canonicalLocale(targetLocale);
            for (const field of fields) {
                const present = source?.fields?.[field] !== undefined && source?.fields?.[field] !== null;
                rows.push({
                    sourceLocale: resolution.sourceLocale,
                    targetLocale,
                    field,
                    status: regional && present ? 'native' : present ? 'inherited-language' : 'missing-source',
                    native: regional && present,
                    derivation: regional ? 'exact-source-locale' : 'inherited-language',
                });
            }
        }
    }
    return {
        sourceLocaleCount: localePolicy.sourceLocales.length,
        targetLocaleCount: localePolicy.targetLocales.length,
        fieldCount: fields.length,
        rows,
        counts: rows.reduce((acc, row) => {
            acc[row.status] = (acc[row.status] || 0) + 1;
            return acc;
        }, {}),
    };
}

function roundTripLocalizedPayload(payload, localePolicy) {
    if (!payload || typeof payload !== 'object') throw new Error('payload must be an object.');
    const clone = JSON.parse(JSON.stringify(payload));
    const locales = new Set(localePolicy?.targetLocales || []);
    for (const collection of ['translations', 'localizedContent', 'seo', 'origins']) {
        if (!Array.isArray(clone[collection])) continue;
        for (const item of clone[collection]) {
            const locale = canonicalLocale(item.lang || item.locale || item.cultureName);
            if (locale && locales.size && !locales.has(locale)) {
                item.localeReview = 'destination-locale-not-selected';
            }
            if (locale) item.lang = toProductLocale(locale);
        }
    }
    return clone;
}

function loadLocalePolicy(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

module.exports = {
    DEFAULT_POLICY,
    buildLocaleCoverage,
    loadLocalePolicy,
    policyHash,
    resolveLocalePolicy,
    resolveSourceLocale,
    roundTripLocalizedPayload,
};
