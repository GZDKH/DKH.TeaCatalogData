const crypto = require('crypto');
const { extractFieldRefs } = require('./field-details');
const coverageIndexes = new WeakMap();

function coverageKey({ slug, lang, entityKind }) {
    return `${entityKind}\0${slug}\0${lang}`;
}

function indexCoverage(manifest) {
    if (coverageIndexes.has(manifest)) return coverageIndexes.get(manifest);
    const index = new Map();
    for (const row of manifest.fieldCoverage || []) {
        const key = coverageKey(row);
        if (index.has(key)) throw new Error(`Duplicate canonical API card field evidence for ${row.slug}/${row.lang}.`);
        index.set(key, row);
    }
    coverageIndexes.set(manifest, index);
    return index;
}

function cardSectionDetails({ card, bytes, file, manifest, slug, lang, entityKind }) {
    const coverage = indexCoverage(manifest).get(coverageKey({ slug, lang, entityKind }));
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const refs = extractFieldRefs(card);
    const countsMatch = coverage?.expectedCount === refs.length && coverage?.fetchedCount === refs.length;
    const compactEvidence = Object.hasOwn(coverage || {}, 'expectedCount') || Object.hasOwn(coverage || {}, 'fetchedCount');
    const legacyLeavesMatch = JSON.stringify(coverage?.expected) === JSON.stringify(refs)
        && JSON.stringify(coverage?.fetched) === JSON.stringify(refs);
    if (coverage?.source !== 'api-card-sections' || coverage.sourceFile !== file
        || coverage.sha256 !== hash || (compactEvidence ? !countsMatch : !legacyLeavesMatch) || coverage.missing?.length) {
        throw new Error(`Incomplete or changed canonical API card field evidence for ${slug}/${lang}.`);
    }
    return refs.map(({section, field}) => ({ section, field, payload: card.sections[section][field] }));
}
module.exports = { cardSectionDetails };
