const crypto = require('crypto');
const { extractFieldRefs } = require('./field-details');
function cardSectionDetails({ card, bytes, file, manifest, slug, lang, entityKind }) {
    const coverage = (manifest.fieldCoverage || []).filter(row => row.slug === slug && row.lang === lang && row.entityKind === entityKind);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const refs = extractFieldRefs(card);
    const countsMatch = coverage[0]?.expectedCount === refs.length && coverage[0]?.fetchedCount === refs.length;
    const compactEvidence = Object.hasOwn(coverage[0] || {}, 'expectedCount') || Object.hasOwn(coverage[0] || {}, 'fetchedCount');
    const legacyLeavesMatch = JSON.stringify(coverage[0]?.expected) === JSON.stringify(refs)
        && JSON.stringify(coverage[0]?.fetched) === JSON.stringify(refs);
    if (coverage.length !== 1 || coverage[0].source !== 'api-card-sections' || coverage[0].sourceFile !== file
        || coverage[0].sha256 !== hash || (compactEvidence ? !countsMatch : !legacyLeavesMatch) || coverage[0].missing?.length) {
        throw new Error(`Incomplete or changed canonical API card field evidence for ${slug}/${lang}.`);
    }
    return refs.map(({section, field}) => ({ section, field, payload: card.sections[section][field] }));
}
module.exports = { cardSectionDetails };
