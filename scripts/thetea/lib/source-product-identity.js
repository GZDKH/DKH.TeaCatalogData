function baselineSourceIndex(products) {
    const index = new Map();
    for (const product of products) {
        if (!String(product.code || '').startsWith('TEA-')) continue;
        const slugs = new Set((product.translations || []).map(item => item.seo).filter(Boolean));
        for (const slug of slugs) {
            const key = String(slug).toLowerCase();
            if (!index.has(key)) index.set(key, []);
            index.get(key).push(product);
        }
    }
    return index;
}

function resolveSourceProductCode(slug, expectedCode, baselineByCode, index) {
    const exact = baselineByCode.get(String(expectedCode).toUpperCase());
    const candidates = index.get(String(slug).toLowerCase()) || [];
    if (exact) {
        const knownSlugs = (exact.translations || []).map(item => item.seo).filter(Boolean);
        if (knownSlugs.length && !knownSlugs.some(value => String(value).toLowerCase() === String(slug).toLowerCase())) {
            throw new Error(`${expectedCode}: existing product SEO identity conflicts with source slug ${slug}.`);
        }
        return exact.code;
    }
    if (candidates.length > 1) throw new Error(`${slug}: ambiguous existing TheTea product identity.`);
    return candidates.length === 1 ? candidates[0].code : expectedCode;
}

module.exports = { baselineSourceIndex, resolveSourceProductCode };
