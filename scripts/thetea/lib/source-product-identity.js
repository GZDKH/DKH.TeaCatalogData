function baselineSourceIndex(products) {
    const index = new Map();
    for (const product of products) {
        if (!String(product.code || '').startsWith('TEA-')) continue;
        const slugs = new Set((product.translations || []).map(item => item.seo).filter(Boolean).map(slug => String(slug).toLowerCase()));
        for (const slug of slugs) {
            if (!index.has(slug)) index.set(slug, []);
            index.get(slug).push(product);
        }
    }
    return index;
}

function resolveSourceProductCode(slug, expectedCode, baselineByCode, index) {
    const exact = baselineByCode.get(String(expectedCode).toUpperCase());
    const candidates = index.get(String(slug).toLowerCase()) || [];
    if (candidates.length > 1 || (exact && candidates.length === 1 && candidates[0] !== exact)) {
        throw new Error(`${slug}: ambiguous existing TheTea product identity.`);
    }
    if (exact) {
        const knownSlugs = (exact.translations || []).map(item => item.seo).filter(Boolean);
        if (knownSlugs.length && !knownSlugs.some(value => String(value).toLowerCase() === String(slug).toLowerCase())) {
            throw new Error(`${expectedCode}: existing product SEO identity conflicts with source slug ${slug}.`);
        }
        return exact.code;
    }
    return candidates.length === 1 ? candidates[0].code : expectedCode;
}

module.exports = { baselineSourceIndex, resolveSourceProductCode };
