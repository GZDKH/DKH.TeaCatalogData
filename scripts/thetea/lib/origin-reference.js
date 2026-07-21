const { PROVINCE_CODE } = require('./category-taxonomy');

const CITY_MAX_LENGTH = 50;

function normalizePlaceName(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .toLowerCase();
}

function extractCityCandidate(card) {
    const raw = String(card?.sections?.classification_origin?.origin?.value || '')
        .replace(/\s+/g, ' ')
        .trim();
    const patterns = [
        /(?:^|,\s*)([\p{L}\p{M}'’.-]+(?:\s+[\p{L}\p{M}'’.-]+){0,3})\s+(?:Prefecture-level\s+City|City\/Prefecture|City)(?=\s*(?:\(|,|\.|—|-|$))/giu,
        /(?:^|,\s*)([\p{L}\p{M}'’.-]+(?:\s+[\p{L}\p{M}'’.-]+){0,3})\s+Prefecture(?=\s*(?:\(|,|\.|—|-|$))/giu,
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(raw);
        if (match?.[1]) return displayPlaceName(match[1]);
    }
    const province = normalizePlaceName(card?.meta?.province);
    const simpleParts = raw.split(/[,.]/u)
        .map(displayPlaceName)
        .filter(Boolean);
    const provinceIndex = simpleParts.findIndex(part => normalizePlaceName(part) === province);
    if (provinceIndex >= 0 && simpleParts[provinceIndex + 1]) {
        const candidate = simpleParts[provinceIndex + 1];
        const words = candidate.split(/\s+/u).filter(Boolean);
        if (candidate.length <= CITY_MAX_LENGTH && words.length <= 4 && !/[;:.!?]/u.test(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

function displayPlaceName(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim() || undefined;
}

function resolveOriginLocation(card, geography, warnings = []) {
    const meta = card?.meta || {};
    const country = String(meta.origin_country || 'CN').toUpperCase();
    const rawProvince = String(meta.province || '').trim();
    const staticStateCode = country === 'CN' ? PROVINCE_CODE[rawProvince] : undefined;
    const states = geographyStates(geography, country);
    const state = states.find(item => normalizePlaceName(item.code) === normalizePlaceName(staticStateCode)
        || normalizePlaceName(item.name) === normalizePlaceName(rawProvince));
    const stateCode = state?.code || staticStateCode;

    if (geography && rawProvince && !state) {
        throw new Error(`Province '${rawProvince}' is absent from the production geography reference (${card?.slug || 'unknown'}).`);
    }
    if (rawProvince && !stateCode) {
        throw new Error(`No ProductOrigin state/province code mapping for '${rawProvince}' (${card?.slug || 'unknown'}).`);
    }

    const rawCity = meta.city || extractCityCandidate(card);
    let city;
    if (rawCity && state?.cities?.length) {
        const normalizedCity = normalizePlaceName(rawCity);
        const matches = state.cities.filter(item =>
            normalizePlaceName(item.name) === normalizedCity
            || normalizePlaceName(item.code) === normalizedCity);
        if (matches.length === 1) city = matches[0].name || matches[0].code;
        else if (matches.length > 1) {
            warnings.push(`Ambiguous ProductOrigin city '${rawCity}' in ${stateCode} (${card.slug}); city omitted.`);
        } else {
            warnings.push(`ProductOrigin city '${rawCity}' was not found in ${stateCode} reference (${card.slug}); city omitted.`);
        }
    } else if (rawCity && geography) {
        warnings.push(`ProductOrigin city '${rawCity}' has no ${stateCode || rawProvince} city reference (${card.slug}); city omitted.`);
    } else if (rawCity) {
        const candidate = displayPlaceName(rawCity);
        if (candidate && candidate.length <= CITY_MAX_LENGTH) city = candidate;
        else warnings.push(`ProductOrigin city candidate exceeds the ${CITY_MAX_LENGTH}-character import limit (${card.slug}); city omitted.`);
    }

    return { country, state: stateCode, city };
}

function geographyStates(geography, country) {
    if (!geography) return [];
    const source = geography.data || geography;
    const referenceCountry = String(source.countryCode || source.country || 'CN').toUpperCase();
    return referenceCountry === country && Array.isArray(source.states) ? source.states : [];
}

module.exports = {
    extractCityCandidate,
    normalizePlaceName,
    resolveOriginLocation,
};
