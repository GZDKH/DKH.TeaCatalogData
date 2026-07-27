'use strict';

const { reject } = require('../lib/errors');
const { divideDecimal, decimalParts, multiplyDecimal } = require('./decimal');
const { decodeEnvelope } = require('./decoder');
const { normalizeDecimal, normalizeUnit, parsePackage } = require('./package-parser');

const PARSER_VERSION = 'zzctea-public-catalog-js-v1';
const MAXIMUM_TOTAL_COUNT = 100_000;
const SAFE_IMAGE_HOSTS = new Set(['oss.yf-gz.cn']);
const FORBIDDEN_KEYS =
    /(?:phone|mobile|customer|avatar|contact|wechat|weixin)|^(?:sell|buy)(?!Count$)|^(?:seller|buyer)|(?:UserId|CustomerId)$/i;
const PHONE = /(?<!\d)1[3-9]\d{9}(?!\d)/;

function assertPublicCatalogPayload(value) {
    function visit(current) {
        if (typeof current === 'string' && PHONE.test(current)) {
            reject('ZZCTEA_PUBLIC_PAYLOAD_PII_DETECTED');
        }
        if (!current || typeof current !== 'object') return;
        for (const [key, child] of Object.entries(current)) {
            if (FORBIDDEN_KEYS.test(key)) {
                reject('ZZCTEA_PUBLIC_PAYLOAD_PII_DETECTED');
            }
            visit(child);
        }
    }
    visit(value);
}

function intValue(value) {
    if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
}

function positiveDecimal(value) {
    if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
    const normalized = normalizeDecimal(value);
    return decimalParts(normalized).integer > 0n ? normalized : null;
}

function optionalString(source, key) {
    return typeof source[key] === 'string' ? source[key].trim() || null : null;
}

function sourceTimestamp(value, diagnostics) {
    if (value === undefined || value === null) return null;
    let parsed;
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        const milliseconds = Number(value);
        if (Number.isSafeInteger(milliseconds)) parsed = new Date(milliseconds);
    } else if (typeof value === 'string') {
        parsed = new Date(value);
    }
    if (!parsed || !Number.isFinite(parsed.getTime())) {
        diagnostics.push('ZZCTEA_SOURCE_TIMESTAMP_INVALID');
        return null;
    }
    return parsed.toISOString();
}

function normalizeImages(source, diagnostics) {
    const images = [];
    for (const propertyName of ['img1', 'img2', 'imageUrl1']) {
        const raw = optionalString(source, propertyName);
        if (!raw) continue;
        let url;
        try {
            url = new URL(raw);
        } catch {
            diagnostics.push('ZZCTEA_IMAGE_URL_INVALID');
            continue;
        }
        if (url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.port ||
            !SAFE_IMAGE_HOSTS.has(url.hostname.toLowerCase())) {
            diagnostics.push('ZZCTEA_IMAGE_URL_INVALID');
            continue;
        }
        if (!images.some(image => image.url === url.toString())) {
            images.push({
                url: url.toString(),
                role: images.length === 0 ? 'primary-source-reference' : 'source-reference',
            });
        }
    }
    return images;
}

function normalizePrices(source, packageFact, sourceUpdatedAt, diagnostics) {
    const amount = positiveDecimal(source.price);
    const displayStatus = intValue(source.priceDisplayStatus);
    if (displayStatus !== null && displayStatus !== 1) {
        if (amount) diagnostics.push('ZZCTEA_REFERENCE_PRICE_HIDDEN');
        return [];
    }
    if (!amount) return [];

    const basisUnitCode = normalizeUnit(source.unit);
    if (!basisUnitCode) {
        diagnostics.push('ZZCTEA_REFERENCE_PRICE_BASIS_UNKNOWN');
        return [];
    }

    const sourceObservation = {
        amount,
        currencyCode: 'CNY',
        basisUnitCode,
        observedSourceUpdatedAt: sourceUpdatedAt,
        kind: 'source-reference',
        retailPrice: false,
        roundingPolicy: { mode: 'none' },
    };
    const observations = [sourceObservation];
    if (!packageFact.isExact) return observations;

    const packageContainsBasis = packageFact.components.some(component =>
        component.containedUnitCode === basisUnitCode ||
        component.containerUnitCode === basisUnitCode);
    if (!packageContainsBasis) {
        diagnostics.push('ZZCTEA_REFERENCE_PRICE_BASIS_NOT_IN_PACKAGE');
        return observations;
    }

    let currentUnit = basisUnitCode;
    let cumulativeDivisor = '1';
    const visited = new Set([currentUnit]);
    while (true) {
        const candidates = packageFact.components.filter(
            component => component.containerUnitCode === currentUnit,
        );
        if (candidates.length === 0) break;
        if (candidates.length !== 1 || visited.has(candidates[0].containedUnitCode)) {
            diagnostics.push('ZZCTEA_REFERENCE_PRICE_DERIVATION_AMBIGUOUS');
            break;
        }
        const component = candidates[0];
        visited.add(component.containedUnitCode);
        if (component.containedUnitCode === 'g' || component.containedUnitCode === 'kg') {
            break;
        }
        cumulativeDivisor = multiplyDecimal(cumulativeDivisor, component.quantity);
        const derived = divideDecimal(amount, cumulativeDivisor, 8);
        observations.push({
            amount: derived.amount,
            currencyCode: 'CNY',
            basisUnitCode: component.containedUnitCode,
            observedSourceUpdatedAt: sourceUpdatedAt,
            kind: 'derived-reference',
            retailPrice: false,
            derivation: {
                sourceAmount: amount,
                sourceBasisUnitCode: basisUnitCode,
                cumulativeDivisor,
                exactFraction: derived.exactFraction,
                roundingPolicy: derived.roundingPolicy,
            },
        });
        currentUnit = component.containedUnitCode;
    }
    return observations;
}

function normalizeRelease(source, basisUnitCode, diagnostics) {
    const amount = positiveDecimal(source.distributionPrice);
    if (!amount) return null;
    const quantity = positiveDecimal(source.distributionCount);
    if (source.distributionCount !== undefined &&
        source.distributionCount !== null &&
        !quantity) {
        diagnostics.push('ZZCTEA_RELEASE_QUANTITY_INVALID');
    }
    if (!basisUnitCode) diagnostics.push('ZZCTEA_RELEASE_PRICE_BASIS_UNKNOWN');
    return {
        amount,
        currencyCode: 'CNY',
        quantity,
        basisUnitCode,
        kind: 'factory-release-fact',
        retailPrice: false,
    };
}

function normalizeProduct(source) {
    if (!source || Array.isArray(source) || typeof source !== 'object') {
        reject('ZZCTEA_PRODUCT_SHAPE_INVALID');
    }
    const id = intValue(source.id);
    if (!id || id <= 0) reject('ZZCTEA_PRODUCT_ID_INVALID');
    const name = optionalString(source, 'name');
    if (!name || name.length > 500) reject('ZZCTEA_PRODUCT_NAME_INVALID');

    const diagnostics = [];
    const rawPackageText = optionalString(source, 'specification');
    const parsedPackage = parsePackage(rawPackageText);
    if (!parsedPackage.isExact && parsedPackage.diagnosticCode) {
        diagnostics.push(parsedPackage.diagnosticCode);
    }
    const packageFact = parsedPackage.isExact
        ? parsedPackage
        : { ...parsedPackage, components: [] };
    const sourceUpdatedAt = sourceTimestamp(source.date, diagnostics);
    const basisUnitCode = normalizeUnit(source.unit);
    const yearLabel = optionalString(source, 'year');
    let year = intValue(source.yearInt);
    if (year === null && yearLabel) {
        const match = yearLabel.match(/\d{4}/);
        year = match ? Number(match[0]) : null;
    }
    if (year !== null && (year < 1800 || year > 2200)) {
        year = null;
        diagnostics.push('ZZCTEA_PRODUCT_YEAR_INVALID');
    }
    const marketStatus = intValue(source.marketStatus);
    if (marketStatus !== null && marketStatus !== 1) {
        diagnostics.push('ZZCTEA_PRODUCT_NOT_MARKET_ACTIVE');
    }
    const brandId = intValue(source.brandId);
    const brandName = optionalString(source, 'brand');

    return {
        schemaVersion: 'catalog-source-item-v1',
        externalId: String(id),
        localizedFields: {
            'zh-CN': {
                name,
            },
        },
        facts: {
            year,
            yearLabel,
            batch: optionalString(source, 'batch'),
            productionTechnology: optionalString(source, 'productionTechnology'),
            shape: optionalString(source, 'shape'),
            brand: brandId || brandName
                ? {
                    externalId: brandId === null
                        ? null
                        : String(brandId),
                    name: brandName,
                }
                : null,
            release: normalizeRelease(source, basisUnitCode, diagnostics),
        },
        images: normalizeImages(source, diagnostics),
        sourceLinks: {
            stableLookupUrl: `https://zzctea.com/teaDetail/${id}.html`,
            observedCanonicalUrl: null,
        },
        package: packageFact,
        referencePrices: normalizePrices(source, packageFact, sourceUpdatedAt, diagnostics),
        sourceUpdatedAt,
        diagnostics: [...new Set(diagnostics)].sort(),
    };
}

function validateEnvelope(root) {
    assertPublicCatalogPayload(root);
    if (intValue(root.status) !== 1) {
        reject('ZZCTEA_RESPONSE_STATUS_UNSUCCESSFUL');
    }
}

function normalizeDetail(responseBody) {
    const root = decodeEnvelope(responseBody);
    validateEnvelope(root);
    if (!root.data || Array.isArray(root.data) || typeof root.data !== 'object') {
        reject('ZZCTEA_DETAIL_DATA_MISSING');
    }
    return normalizeProduct(root.data);
}

function normalizeListPage(responseBody, requestedPageSize) {
    if (!Number.isSafeInteger(requestedPageSize) ||
        requestedPageSize <= 0 ||
        requestedPageSize > 250) {
        throw new Error('Requested page size must be between 1 and 250.');
    }
    const root = decodeEnvelope(responseBody);
    validateEnvelope(root);
    if (!Array.isArray(root.data)) reject('ZZCTEA_LIST_DATA_MISSING');
    const totalCount = intValue(root.extra?.count);
    if (!totalCount || totalCount > MAXIMUM_TOTAL_COUNT) {
        reject('ZZCTEA_LIST_TOTAL_COUNT_IMPLAUSIBLE');
    }
    const items = root.data.map(normalizeProduct);
    if (items.length > requestedPageSize || items.length > totalCount) {
        reject('ZZCTEA_LIST_PAGE_COUNT_INVALID');
    }
    if (new Set(items.map(item => item.externalId)).size !== items.length) {
        reject('ZZCTEA_LIST_DUPLICATE_PRODUCT_ID');
    }
    return { totalCount, items };
}

module.exports = {
    MAXIMUM_TOTAL_COUNT,
    PARSER_VERSION,
    assertPublicCatalogPayload,
    normalizeDetail,
    normalizeListPage,
    normalizeProduct,
};
