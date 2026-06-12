const LEGACY_JUNK_SPEC_PREFIXES = [
    'SPEC-TT-MARKDOWN-',
    'SPEC-TT-SIMILAR-',
];

const LEGACY_JUNK_GROUP_CODES = new Set([
    'SPEC-TT-GROUP-MARKDOWN',
    'SPEC-TT-GROUP-RELATED',
]);

const SYNTHETIC_FIELD_SPEC_PATTERN = /^SPEC-TT-FIELD(?:-DETAIL)?-.+-X\d+(?:$|-)/;
const SYNTHETIC_GROUP_PATTERN = /^SPEC-TT-GROUP-EXT-\d+$/;

function getCode(item) {
    return String(item?.code || item?.Code || '').trim();
}

function isLegacyJunkSpecificationAttribute(item) {
    const code = getCode(item);
    return LEGACY_JUNK_SPEC_PREFIXES.some(prefix => code.startsWith(prefix))
        || SYNTHETIC_FIELD_SPEC_PATTERN.test(code);
}

function isLegacyJunkSpecificationGroup(item) {
    const code = getCode(item);
    return LEGACY_JUNK_GROUP_CODES.has(code) || SYNTHETIC_GROUP_PATTERN.test(code);
}

function getDisplayName(item) {
    const translations = item?.translations || item?.Translations || [];
    return translations[0]?.name || translations[0]?.Name || item?.name || item?.Name || '';
}

function getId(item) {
    return String(item?.id || item?.Id || '').trim();
}

function isDeleted(item) {
    return Boolean(item?.isDeleted || item?.IsDeleted);
}

module.exports = {
    LEGACY_JUNK_GROUP_CODES,
    LEGACY_JUNK_SPEC_PREFIXES,
    SYNTHETIC_FIELD_SPEC_PATTERN,
    SYNTHETIC_GROUP_PATTERN,
    getCode,
    getDisplayName,
    getId,
    isDeleted,
    isLegacyJunkSpecificationAttribute,
    isLegacyJunkSpecificationGroup,
};
