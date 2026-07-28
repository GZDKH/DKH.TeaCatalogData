'use strict';

const { reject } = require('../lib/errors');
const { divideDecimal, decimalParts, multiplyDecimal } = require('./decimal');
const {
    assertPublicCatalogPayload,
    validatePublicImageUrl,
} = require('./policy');
const { decodeSanitizedEnvelope } = require('./sanitized-envelope');
const { normalizeDecimal, normalizeUnit, parsePackage } = require('./package-parser');

const PARSER_VERSION = 'zzctea-public-html-nuxt-v5';
const MAXIMUM_TOTAL_PAGES = 10_000;
const MAXIMUM_SOURCE_DESCRIPTION_LENGTH = 4_000;
const MAXIMUM_MARKET_DECIMAL_DIGITS = 48;
const MAXIMUM_MARKET_DECIMAL_SCALE = 18;
const SOURCE_DESCRIPTION_CONTROL =
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const SOURCE_DESCRIPTION_HTML = /<(?:(?:\/?[A-Za-z])|!DOCTYPE|!--|\?xml)[^>]*>/i;
const SOURCE_DESCRIPTION_URL = /\b(?:https?:\/\/|www\.)\S+/iu;
const SOURCE_DESCRIPTION_DOMAIN = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\b/iu;
const SOURCE_DESCRIPTION_BOILERPLATE =
    /zzctea|找找茶|找茶.{0,16}出茶|(?:找茶|出茶)(?:\d+条|信息|线索|供需)|供需线索|茶友讨论|最新报价|价格走势|相关知识/iu;

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

function marketDecimal(
    value,
    { allowNegative = true, allowZero = true } = {},
) {
    if (typeof value !== 'string' ||
        !/^-?(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+)$/.test(value)) {
        return null;
    }
    const negative = value.startsWith('-');
    if (negative && !allowNegative) return null;
    const unsigned = negative ? value.slice(1) : value;
    const [rawWhole = '0', rawFraction = ''] = unsigned.split('.');
    if (rawWhole.length + rawFraction.length > MAXIMUM_MARKET_DECIMAL_DIGITS ||
        rawFraction.length > MAXIMUM_MARKET_DECIMAL_SCALE) {
        return null;
    }
    const whole = rawWhole.replace(/^0+(?=\d)/, '') || '0';
    const fraction = rawFraction.replace(/0+$/, '');
    const zero = whole === '0' && !fraction;
    if (zero && !allowZero) return null;
    return `${negative && !zero ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function scaledMarketDecimal(value) {
    const normalized = marketDecimal(value);
    if (normalized === null) return null;
    const negative = normalized.startsWith('-');
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [whole, fraction = ''] = unsigned.split('.');
    return {
        integer: BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n),
        normalized,
        scale: fraction.length,
    };
}

function formatSignedScaled(integer, scale) {
    const negative = integer < 0n;
    let digits = (negative ? -integer : integer).toString();
    if (scale > 0) {
        digits = digits.padStart(scale + 1, '0');
        const whole = digits.slice(0, -scale);
        const fraction = digits.slice(-scale).replace(/0+$/, '');
        digits = fraction ? `${whole}.${fraction}` : whole;
    }
    return `${negative && digits !== '0' ? '-' : ''}${digits}`;
}

function subtractMarketDecimal(left, right) {
    const leftParts = scaledMarketDecimal(left);
    const rightParts = scaledMarketDecimal(right);
    if (!leftParts || !rightParts) return null;
    const scale = Math.max(leftParts.scale, rightParts.scale);
    const leftInteger =
        leftParts.integer * (10n ** BigInt(scale - leftParts.scale));
    const rightInteger =
        rightParts.integer * (10n ** BigInt(scale - rightParts.scale));
    return formatSignedScaled(leftInteger - rightInteger, scale);
}

function optionalString(source, key) {
    return typeof source[key] === 'string' ? source[key].trim() || null : null;
}

function normalizeSourceDescription(source, diagnostics) {
    const raw = source.description;
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'string') {
        diagnostics.push('ZZCTEA_SOURCE_DESCRIPTION_UNSAFE');
        return null;
    }

    const normalized = raw.trim().replace(/\s+/gu, ' ');
    if (!normalized) return null;
    if (normalized.length > MAXIMUM_SOURCE_DESCRIPTION_LENGTH ||
        SOURCE_DESCRIPTION_CONTROL.test(raw) ||
        SOURCE_DESCRIPTION_HTML.test(normalized) ||
        SOURCE_DESCRIPTION_URL.test(normalized) ||
        SOURCE_DESCRIPTION_DOMAIN.test(normalized) ||
        SOURCE_DESCRIPTION_BOILERPLATE.test(normalized)) {
        diagnostics.push('ZZCTEA_SOURCE_DESCRIPTION_UNSAFE');
        return null;
    }

    return normalized;
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
    for (const propertyName of ['img1', 'img2', 'imageUrl1', 'imgUrl']) {
        const raw = optionalString(source, propertyName);
        if (!raw) continue;
        let url;
        try {
            url = validatePublicImageUrl(raw);
        } catch {
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

function marketCount(source, key, diagnostics) {
    if (source[key] === undefined || source[key] === null ||
        source[key] === '') {
        return null;
    }
    const value = intValue(source[key]);
    if (value === null || value < 0) {
        diagnostics.push('ZZCTEA_MARKET_COUNT_INVALID');
        return null;
    }
    return value;
}

function marketDecimalField(source, key, diagnostics, options = {}) {
    if (source[key] === undefined || source[key] === null ||
        source[key] === '') {
        return null;
    }
    const value = marketDecimal(source[key], options);
    if (value === null) diagnostics.push('ZZCTEA_MARKET_DECIMAL_INVALID');
    return value;
}

function marketRange(source, minimumKey, maximumKey, diagnostics) {
    const minimum = marketDecimalField(source, minimumKey, diagnostics, {
        allowNegative: false,
        allowZero: false,
    });
    const maximum = marketDecimalField(source, maximumKey, diagnostics, {
        allowNegative: false,
        allowZero: false,
    });
    const minimumPresent = source[minimumKey] !== undefined &&
        source[minimumKey] !== null &&
        source[minimumKey] !== '';
    const maximumPresent = source[maximumKey] !== undefined &&
        source[maximumKey] !== null &&
        source[maximumKey] !== '';
    if (!minimumPresent && !maximumPresent) return null;
    if (!minimum || !maximum) {
        diagnostics.push('ZZCTEA_MARKET_PRICE_RANGE_INVALID');
        return null;
    }
    const difference = subtractMarketDecimal(maximum, minimum);
    if (difference === null || difference.startsWith('-')) {
        diagnostics.push('ZZCTEA_MARKET_PRICE_RANGE_INVALID');
        return null;
    }
    return {
        minimumAmount: minimum,
        maximumAmount: maximum,
    };
}

function normalizeMarketFacts(
    source,
    basisUnitCode,
    sourceUpdatedAt,
    diagnostics,
) {
    const aggregates = Object.fromEntries(Object.entries({
        demandCount: marketCount(source, 'buyCount', diagnostics),
        supplyCount: marketCount(source, 'sellCount', diagnostics),
        followerCount: marketCount(source, 'interestedCount', diagnostics),
        commentCount: marketCount(source, 'commentCount', diagnostics),
        forumCount: marketCount(source, 'forumCount', diagnostics),
        demandParticipantCount:
            marketCount(source, 'demandParticipantCount', diagnostics),
        supplyParticipantCount:
            marketCount(source, 'supplyParticipantCount', diagnostics),
    }).filter(([, value]) => value !== null));

    const displayStatus = intValue(source.priceDisplayStatus);
    let pricing = null;
    if (displayStatus === null || displayStatus === 1) {
        const currentAmount = marketDecimalField(
            source,
            'price',
            diagnostics,
            {
                allowNegative: false,
                allowZero: false,
            },
        );
        const absoluteChangeAmount = marketDecimalField(
            source,
            'rise',
            diagnostics,
        );
        const directPreviousAmount = marketDecimalField(
            source,
            'lastWeekPrice',
            diagnostics,
            {
                allowNegative: false,
                allowZero: false,
            },
        );
        let previousAmount = directPreviousAmount;
        let previousAmountDerivation = directPreviousAmount
            ? 'source-last-week-price'
            : null;
        const derivedPrevious = currentAmount && absoluteChangeAmount
            ? subtractMarketDecimal(currentAmount, absoluteChangeAmount)
            : null;
        if (derivedPrevious && !derivedPrevious.startsWith('-') &&
            derivedPrevious !== '0') {
            if (!previousAmount) {
                previousAmount = derivedPrevious;
                previousAmountDerivation = 'current-minus-source-absolute-change';
            } else if (previousAmount !== derivedPrevious) {
                diagnostics.push('ZZCTEA_PREVIOUS_PRICE_MISMATCH');
            }
        }
        const periodRatios = Object.fromEntries(Object.entries({
            week: marketDecimalField(
                source,
                'weekPercent',
                diagnostics,
            ),
            month: marketDecimalField(
                source,
                'monthPercent',
                diagnostics,
            ),
            threeMonth: marketDecimalField(
                source,
                'threeMonthPercent',
                diagnostics,
            ),
            halfYear: marketDecimalField(
                source,
                'halfYearPercent',
                diagnostics,
            ),
            year: marketDecimalField(
                source,
                'yearPercent',
                diagnostics,
            ),
        }).filter(([, value]) => value !== null));
        const trends = Object.fromEntries(Object.entries({
            absoluteChangeAmount,
            displayPercentChange: marketDecimalField(
                source,
                'risePercent',
                diagnostics,
            ),
            periodRatios: Object.keys(periodRatios).length > 0
                ? periodRatios
                : null,
        }).filter(([, value]) => value !== null));
        const ranges = Object.fromEntries(Object.entries({
            source: marketRange(
                source,
                'minPrice',
                'maxPrice',
                diagnostics,
            ),
            week: marketRange(
                source,
                'thisWeekMinPrice',
                'thisWeekMaxPrice',
                diagnostics,
            ),
            year: marketRange(
                source,
                'thisYearMinPrice',
                'thisYearMaxPrice',
                diagnostics,
            ),
        }).filter(([, value]) => value !== null));
        if ((currentAmount || previousAmount ||
            Object.keys(trends).length > 0 ||
            Object.keys(ranges).length > 0) &&
            !basisUnitCode) {
            diagnostics.push('ZZCTEA_MARKET_PRICE_BASIS_UNKNOWN');
        } else if (basisUnitCode) {
            pricing = {
                currencyCode: 'CNY',
                basisUnitCode,
                ...(currentAmount ? { currentAmount } : {}),
                ...(previousAmount ? {
                    previousAmount,
                    previousAmountDerivation,
                } : {}),
                ...(Object.keys(ranges).length > 0 ? { ranges } : {}),
                ...(Object.keys(trends).length > 0 ? { trends } : {}),
            };
        }
    }

    if (!pricing && Object.keys(aggregates).length === 0) return null;
    return {
        ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
        ...(pricing ? { pricing } : {}),
        ...(Object.keys(aggregates).length > 0 ? { aggregates } : {}),
    };
}

function normalizeProduct(source, options = {}) {
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
    const sourceUpdatedAt = sourceTimestamp(
        source.updatedAt ?? source.date,
        diagnostics,
    );
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
    const description = options.includeDescription
        ? normalizeSourceDescription(source, diagnostics)
        : null;
    const market = normalizeMarketFacts(
        source,
        basisUnitCode,
        sourceUpdatedAt,
        diagnostics,
    );

    return {
        schemaVersion: 'catalog-source-item-v1',
        externalId: String(id),
        localizedFields: {
            'zh-CN': {
                name,
                ...(description ? { description } : {}),
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
            market,
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

function normalizeDetail(responseBody) {
    const root = decodeSanitizedEnvelope(responseBody);
    if (root.kind !== 'detail') reject('ZZCTEA_DETAIL_ENVELOPE_KIND_INVALID');
    if (!root.data || Array.isArray(root.data) || typeof root.data !== 'object') {
        reject('ZZCTEA_DETAIL_DATA_MISSING');
    }
    return normalizeProduct(root.data, { includeDescription: true });
}

function normalizeListPage(responseBody, requestedPageSize) {
    if (!Number.isSafeInteger(requestedPageSize) ||
        requestedPageSize <= 0 ||
        requestedPageSize > 36) {
        throw new Error('Requested page size must be between 1 and 36.');
    }
    const root = decodeSanitizedEnvelope(responseBody);
    if (root.kind !== 'list') reject('ZZCTEA_LIST_ENVELOPE_KIND_INVALID');
    if (!Array.isArray(root.data)) reject('ZZCTEA_LIST_DATA_MISSING');
    const page = intValue(root.page);
    const pageSize = intValue(root.pageSize);
    const totalPages = intValue(root.totalPages);
    if (!page || pageSize !== requestedPageSize ||
        !totalPages || totalPages > MAXIMUM_TOTAL_PAGES ||
        page > totalPages) {
        reject('ZZCTEA_LIST_PAGING_INVALID');
    }
    const items = root.data.map(normalizeProduct);
    if (items.length === 0 || items.length > requestedPageSize ||
        (page < totalPages && items.length !== requestedPageSize)) {
        reject('ZZCTEA_LIST_PAGE_COUNT_INVALID');
    }
    if (new Set(items.map(item => item.externalId)).size !== items.length) {
        reject('ZZCTEA_LIST_DUPLICATE_PRODUCT_ID');
    }
    return {
        page,
        pageSize,
        totalCount: null,
        totalPages,
        items,
    };
}

module.exports = {
    MAXIMUM_TOTAL_PAGES,
    MAXIMUM_MARKET_DECIMAL_DIGITS,
    MAXIMUM_MARKET_DECIMAL_SCALE,
    PARSER_VERSION,
    assertPublicCatalogPayload,
    marketDecimal,
    marketDecimalField,
    normalizeDetail,
    normalizeListPage,
    normalizeMarketFacts,
    normalizeProduct,
    subtractMarketDecimal,
};
