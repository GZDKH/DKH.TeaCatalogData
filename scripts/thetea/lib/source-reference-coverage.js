function referenceCoverage(endpoint, lang, limit, payload, collection) {
    const returnedCount = Array.isArray(payload?.[collection]) ? payload[collection].length : 0;
    return { endpoint, lang, requestedLimit: limit, reportedCount: payload?.count ?? null,
        returnedCount, possiblyTruncated: returnedCount >= limit };
}

function assertCurrentSourceReferences(manifest) {
    if (manifest.fieldSource === 'cloudflare-d1-packs'
        && manifest.d1Files?.length && manifest.fieldPackFiles?.length) return;
    const coverage = manifest.referenceCoverage || [];
    const gaps = [];
    for (const lang of manifest.langs || []) {
        for (const endpoint of ['glossary', 'places']) {
            const item = coverage.find(value => value.lang === lang && value.endpoint === endpoint);
            if (!item || item.possiblyTruncated) gaps.push(`${endpoint}/${lang}`);
        }
    }
    if (!manifest.langs?.length || gaps.length) {
        throw new Error(`Current production projection requires complete source references; ${gaps.length} missing or capped reference(s). Resolve the source reference coverage gaps before production generation.`);
    }
}

module.exports = { referenceCoverage, assertCurrentSourceReferences };
