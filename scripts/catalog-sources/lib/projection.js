'use strict';

const net = require('net');
const {
    sha256,
    stableJson,
} = require('./artifacts');

const ARTIFACT_SCHEMA = 'catalog-source-artifact-v1';
const ITEM_SCHEMA = 'catalog-source-item-v1';
const DIGEST = /^[0-9a-f]{64}$/;
const CODE = /^[a-z0-9][a-z0-9._-]*$/;
const RAW_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/;
const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;
const SOURCE_BOILERPLATE =
    /zzctea|找找茶|找茶.{0,16}出茶|(?:找茶|出茶)(?:\d+条|信息|线索|供需)|供需线索|茶友讨论|最新报价|价格走势|相关知识/iu;

function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
}

function requireObject(value, code, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail(code, `${label} must be an object.`);
    }
    return value;
}

function requireDigest(value, label) {
    if (typeof value !== 'string' || !DIGEST.test(value)) {
        fail('CATALOG_SOURCE_PROJECTION_DIGEST_INVALID', `${label} must be a lowercase SHA-256 digest.`);
    }
    return value;
}

function requireBoundedString(value, maximum, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
        fail('CATALOG_SOURCE_PROJECTION_VALUE_INVALID', `${label} must be a non-empty string of at most ${maximum} characters.`);
    }
    return value;
}

function requireTimestamp(value, label) {
    if (typeof value !== 'string' || !value ||
        !Number.isFinite(new Date(value).getTime()) ||
        new Date(value).toISOString() !== value) {
        fail('CATALOG_SOURCE_PROJECTION_TIMESTAMP_INVALID', `${label} must be a canonical ISO-8601 timestamp.`);
    }
    return value;
}

function normalizeDecimalText(value, options = {}) {
    const {
        allowNegative = true,
        maximumScale = 8,
        label = 'Decimal value',
    } = options;
    if (typeof value !== 'string' || !DECIMAL.test(value)) {
        fail('CATALOG_SOURCE_PROJECTION_DECIMAL_INVALID', `${label} must use plain decimal notation.`);
    }
    const negative = value.startsWith('-');
    if (negative && !allowNegative) {
        fail('CATALOG_SOURCE_PROJECTION_DECIMAL_INVALID', `${label} must not be negative.`);
    }
    const unsigned = negative ? value.slice(1) : value;
    const [rawWhole, rawFraction = ''] = unsigned.split('.');
    const whole = rawWhole.replace(/^0+(?=\d)/, '') || '0';
    const fraction = rawFraction.replace(/0+$/, '');
    if (fraction.length > maximumScale) {
        fail(
            'CATALOG_SOURCE_PROJECTION_DECIMAL_SCALE_INVALID',
            `${label} exceeds the maximum supported scale ${maximumScale}.`,
        );
    }
    const zero = whole === '0' && !fraction;
    return `${negative && !zero ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function decimalParts(value, options = {}) {
    const normalized = normalizeDecimalText(value, options);
    const negative = normalized.startsWith('-');
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [whole, fraction = ''] = unsigned.split('.');
    return {
        fraction,
        negative,
        normalized,
        scaledInteger: BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n),
        scale: fraction.length,
        whole: BigInt(whole) * (negative ? -1n : 1n),
    };
}

function toDecimalValue(value, options = {}) {
    const parts = decimalParts(value, options);
    if (parts.whole < INT64_MIN || parts.whole > INT64_MAX) {
        fail(
            'CATALOG_SOURCE_PROJECTION_DECIMAL_RANGE_INVALID',
            `${options.label || 'Decimal value'} exceeds DecimalValue int64 units.`,
        );
    }
    const fractionNanos = parts.fraction
        ? Number(BigInt(parts.fraction.padEnd(9, '0')))
        : 0;
    return {
        units: parts.whole.toString(),
        nanos: parts.negative ? -fractionNanos : fractionNanos,
    };
}

function greatestCommonDivisor(left, right) {
    left = left < 0n ? -left : left;
    right = right < 0n ? -right : right;
    while (right !== 0n) {
        [left, right] = [right, left % right];
    }
    return left;
}

function reduceFraction(numerator, denominator) {
    if (denominator === 0n) {
        fail('CATALOG_SOURCE_PROJECTION_FRACTION_INVALID', 'Exact fraction denominator must be positive.');
    }
    if (denominator < 0n) {
        numerator = -numerator;
        denominator = -denominator;
    }
    const divisor = greatestCommonDivisor(numerator, denominator);
    return {
        numerator: numerator / divisor,
        denominator: denominator / divisor,
    };
}

function decimalFraction(value, label) {
    const parts = decimalParts(value, { allowNegative: false, maximumScale: 8, label });
    return reduceFraction(parts.scaledInteger, 10n ** BigInt(parts.scale));
}

function parseExactFraction(value, label) {
    const fraction = requireObject(
        value,
        'CATALOG_SOURCE_PROJECTION_FRACTION_INVALID',
        label,
    );
    if (typeof fraction.numerator !== 'string' ||
        !UNSIGNED_INTEGER.test(fraction.numerator) ||
        typeof fraction.denominator !== 'string' ||
        !/^[1-9]\d*$/.test(fraction.denominator)) {
        fail(
            'CATALOG_SOURCE_PROJECTION_FRACTION_INVALID',
            `${label} must contain unsigned integer numerator and positive denominator strings.`,
        );
    }
    const numerator = BigInt(fraction.numerator);
    const denominator = BigInt(fraction.denominator);
    if (greatestCommonDivisor(numerator, denominator) !== 1n) {
        fail('CATALOG_SOURCE_PROJECTION_FRACTION_INVALID', `${label} must be reduced.`);
    }
    return { numerator, denominator };
}

function divideFractions(amount, divisor) {
    return reduceFraction(
        amount.numerator * divisor.denominator,
        amount.denominator * divisor.numerator,
    );
}

function formatScaledInteger(value, scale) {
    let digits = value.toString().padStart(scale + 1, '0');
    if (scale === 0) return digits;
    const whole = digits.slice(0, -scale);
    const fraction = digits.slice(-scale).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
}

function roundFractionHalfUp(fraction, scale) {
    const scaled = fraction.numerator * (10n ** BigInt(scale));
    let quotient = scaled / fraction.denominator;
    if ((scaled % fraction.denominator) * 2n >= fraction.denominator) {
        quotient += 1n;
    }
    return formatScaledInteger(quotient, scale);
}

function withoutObservationTime(item) {
    const projection = {
        ...item,
        provenance: {
            ...requireObject(
                item.provenance,
                'CATALOG_SOURCE_PROJECTION_PROVENANCE_INVALID',
                'Item provenance',
            ),
        },
    };
    delete projection.provenance.observedAt;
    return projection;
}

function semanticRevisionDigest(item) {
    requireObject(item, 'CATALOG_SOURCE_PROJECTION_ITEM_INVALID', 'Catalog source item');
    return sha256(stableJson(withoutObservationTime(item)));
}

function normalizeAttributeSegment(value) {
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
        fail(
            'CATALOG_SOURCE_PROJECTION_FACT_INVALID',
            `Factual attribute key '${String(value)}' is not a supported source-neutral identifier.`,
        );
    }
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase();
}

function normalizeFactValue(value, label) {
    if (typeof value === 'string') {
        const normalized = value.trim();
        if (!normalized || normalized.length > 1000) {
            fail('CATALOG_SOURCE_PROJECTION_FACT_INVALID', `${label} is empty or too long.`);
        }
        return normalized;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
            fail('CATALOG_SOURCE_PROJECTION_FACT_INVALID', `${label} must be a safe integer.`);
        }
        return String(value);
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    fail('CATALOG_SOURCE_PROJECTION_FACT_INVALID', `${label} has an unsupported value type.`);
}

function flattenFactualAttributes(facts) {
    requireObject(facts, 'CATALOG_SOURCE_PROJECTION_FACT_INVALID', 'Item facts');
    const attributes = [];

    function visit(value, segments) {
        if (value === null || value === undefined || value === '') return;
        if (Array.isArray(value)) {
            value.forEach((entry, index) => visit(entry, [...segments, String(index)]));
            return;
        }
        if (value && typeof value === 'object') {
            for (const key of Object.keys(value).sort()) {
                visit(value[key], [...segments, normalizeAttributeSegment(key)]);
            }
            return;
        }
        const attributeCode = segments.join('.');
        if (!CODE.test(attributeCode) || attributeCode.length > 96) {
            fail(
                'CATALOG_SOURCE_PROJECTION_FACT_INVALID',
                `Factual attribute code '${attributeCode}' is invalid.`,
            );
        }
        const normalizedValue = normalizeFactValue(value, `Fact ${attributeCode}`);
        attributes.push({
            attributeCode,
            normalizedValue,
            sourceValueDigest: sha256(stableJson(value)),
        });
    }

    for (const key of Object.keys(facts).sort()) {
        visit(facts[key], [normalizeAttributeSegment(key)]);
    }
    if (attributes.length > 128) {
        fail('CATALOG_SOURCE_PROJECTION_FACT_INVALID', 'Item contains too many factual attributes.');
    }
    return attributes.sort((left, right) => left.attributeCode.localeCompare(right.attributeCode));
}

function safeDescriptionFragment(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text ||
        /(?:https?:\/\/|www\.)/i.test(text) ||
        SOURCE_BOILERPLATE.test(text) ||
        /<(?:(?:\/?[A-Za-z])|!DOCTYPE|!--|\?xml)[^>]*>/i.test(text) ||
        /[\u0000-\u001F\u007F]/u.test(text)) {
        return null;
    }
    return text;
}

function packageSummary(packageFact, languageCode) {
    if (!packageFact?.isExact || !Array.isArray(packageFact.components)) return null;
    const units = languageCode === 'zh-CN'
        ? { g: '克', cake: '饼', bundle: '提', case: '件' }
        : { g: 'g', cake: 'cake', bundle: 'bundle', case: 'case' };
    const separator = languageCode === 'zh-CN' ? '，' : ', ';
    const transitions = packageFact.components.map(component => {
        const quantity = safeDescriptionFragment(component.quantity);
        const contained = units[component.containedUnitCode] || component.containedUnitCode;
        const container = units[component.containerUnitCode] || component.containerUnitCode;
        if (!quantity || !contained || !container) return null;
        return languageCode === 'zh-CN'
            ? `每${container}${quantity}${contained}`
            : `${quantity} ${contained} per ${container}`;
    }).filter(Boolean);
    return transitions.length ? transitions.join(separator) : null;
}

function generatedFactualDescriptions(item) {
    const facts = item.facts && typeof item.facts === 'object' ? item.facts : {};
    const brand = safeDescriptionFragment(facts.brand?.name);
    const year = safeDescriptionFragment(facts.yearLabel || facts.year);
    const batch = safeDescriptionFragment(facts.batch);
    const technology = safeDescriptionFragment(facts.productionTechnology);
    const shape = safeDescriptionFragment(facts.shape);
    const packageZh = packageSummary(item.package, 'zh-CN');
    const zhFacts = [
        brand && `品牌：${brand}`,
        year && `年份：${year}`,
        batch && `批次：${batch}`,
        technology && `工艺：${technology}`,
        shape && `形态：${shape}`,
        packageZh && `包装：${packageZh}`,
    ].filter(Boolean);
    const descriptions = {
        'zh-CN': zhFacts.length
            ? `茶品资料：${zhFacts.join('；')}。`
            : '具有可验证来源标识的茶品资料。',
    };
    for (const [languageCode, description] of Object.entries(descriptions)) {
        if (description.length > 8000) {
            fail(
                'CATALOG_SOURCE_PROJECTION_LOCALIZED_TEXT_INVALID',
                `Generated description ${languageCode} exceeds 8000 characters.`,
            );
        }
    }
    return descriptions;
}

function projectLocalizedText(item) {
    const { localizedFields } = item;
    requireObject(
        localizedFields,
        'CATALOG_SOURCE_PROJECTION_LOCALIZED_TEXT_INVALID',
        'Item localized fields',
    );
    const generatedDescriptions = generatedFactualDescriptions(item);
    const fields = requireObject(
        localizedFields['zh-CN'],
        'CATALOG_SOURCE_PROJECTION_LOCALIZED_TEXT_INVALID',
        'Localized fields zh-CN',
    );
    const title = fields.name === undefined ? fields.title : fields.name;
    requireBoundedString(title, 1000, 'Localized title zh-CN');
    let sourceDescription = null;
    if (fields.description !== undefined && fields.description !== null) {
        requireBoundedString(
            fields.description,
            4000,
            'Localized description zh-CN',
        );
        sourceDescription = safeDescriptionFragment(fields.description);
        if (!sourceDescription) {
            fail(
                'CATALOG_SOURCE_PROJECTION_LOCALIZED_TEXT_INVALID',
                'Localized description zh-CN is unsafe.',
            );
        }
    }
    const factualDescription = generatedDescriptions['zh-CN'];
    return [{
        languageCode: 'zh-CN',
        title: title.trim(),
        description: sourceDescription
            ? `${sourceDescription}\n\n${factualDescription}`
            : factualDescription,
    }];
}

function validatePublicHttpsUri(value, label) {
    let uri;
    try {
        uri = new URL(value);
    } catch {
        fail('CATALOG_SOURCE_PROJECTION_URI_INVALID', `${label} must be an absolute URL.`);
    }
    const host = uri.hostname.toLowerCase();
    if (uri.protocol !== 'https:' ||
        uri.username ||
        uri.password ||
        uri.port ||
        uri.hash ||
        !host.includes('.') ||
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host.endsWith('.local') ||
        net.isIP(host) !== 0 ||
        !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) ||
        host.split('.').some(part => !part || part.length > 63)) {
        fail('CATALOG_SOURCE_PROJECTION_URI_INVALID', `${label} is not a safe public HTTPS URL.`);
    }
    return uri.toString();
}

function projectSourceDestination(item, artifactSha256, observedAt) {
    const links = requireObject(
        item.sourceLinks,
        'CATALOG_SOURCE_PROJECTION_DESTINATION_INVALID',
        'Item source links',
    );
    const lookupUri = validatePublicHttpsUri(links.stableLookupUrl, 'Stable lookup URL');
    const destination = {
        lookupUri,
        observedAt,
        provenanceDigest: sha256(stableJson({
            artifactSha256,
            detailPayloadDigest: item.provenance.detailPayloadDigest,
            externalId: item.externalId,
            listPayloadDigest: item.provenance.listPayloadDigest,
            lookupUri,
            observedCanonicalUrl: links.observedCanonicalUrl || null,
        })),
    };
    if (links.observedCanonicalUrl !== null && links.observedCanonicalUrl !== undefined) {
        destination.canonicalUri = validatePublicHttpsUri(
            links.observedCanonicalUrl,
            'Observed canonical URL',
        );
    }
    return destination;
}

function projectPackage(packageFact) {
    const source = requireObject(
        packageFact,
        'CATALOG_SOURCE_PROJECTION_PACKAGE_INVALID',
        'Item package',
    );
    if (typeof source.isExact !== 'boolean' || !Array.isArray(source.components)) {
        fail(
            'CATALOG_SOURCE_PROJECTION_PACKAGE_INVALID',
            'Package must declare exactness and component array.',
        );
    }
    if (!source.isExact && source.components.length > 0) {
        fail(
            'CATALOG_SOURCE_PROJECTION_PACKAGE_INVALID',
            'Inexact packages must not project partial components.',
        );
    }
    if (source.components.length > 32) {
        fail('CATALOG_SOURCE_PROJECTION_PACKAGE_INVALID', 'Package contains too many components.');
    }
    if (source.rawText !== undefined && source.rawText !== null &&
        (typeof source.rawText !== 'string' || source.rawText.length > 4000)) {
        fail(
            'CATALOG_SOURCE_PROJECTION_PACKAGE_INVALID',
            'Package raw text must be a string of at most 4000 characters.',
        );
    }
    const pairs = new Set();
    const packageComponents = source.components.map((component, ordinal) => {
        requireObject(
            component,
            'CATALOG_SOURCE_PROJECTION_PACKAGE_INVALID',
            `Package component ${ordinal}`,
        );
        const containedUnitCode = requireBoundedString(
            component.containedUnitCode,
            32,
            `Package component ${ordinal} contained unit`,
        );
        const containerUnitCode = requireBoundedString(
            component.containerUnitCode,
            32,
            `Package component ${ordinal} container unit`,
        );
        if (!CODE.test(containedUnitCode) || !CODE.test(containerUnitCode) ||
            containedUnitCode === containerUnitCode) {
            fail(
                'CATALOG_SOURCE_PROJECTION_PACKAGE_INVALID',
                `Package component ${ordinal} unit codes are invalid.`,
            );
        }
        const pair = `${containedUnitCode}\0${containerUnitCode}`;
        if (pairs.has(pair)) {
            fail(
                'CATALOG_SOURCE_PROJECTION_PACKAGE_INVALID',
                `Package component ${ordinal} duplicates a unit transition.`,
            );
        }
        pairs.add(pair);
        const quantityText = normalizeDecimalText(component.quantity, {
            allowNegative: false,
            maximumScale: 6,
            label: `Package component ${ordinal} quantity`,
        });
        if (decimalParts(quantityText).scaledInteger <= 0n) {
            fail(
                'CATALOG_SOURCE_PROJECTION_PACKAGE_INVALID',
                `Package component ${ordinal} quantity must be positive.`,
            );
        }
        return {
            quantity: toDecimalValue(quantityText, {
                allowNegative: false,
                maximumScale: 6,
                label: `Package component ${ordinal} quantity`,
            }),
            containedUnitCode,
            containerUnitCode,
            ordinal,
        };
    });
    return {
        rawPackageText: typeof source.rawText === 'string' && source.rawText
            ? source.rawText
            : undefined,
        packageComponents,
        packageComponentsExact: source.isExact,
    };
}

function normalizeDiagnosticCode(value, sourceId) {
    if (typeof value !== 'string' || !RAW_CODE.test(value) || value.length > 128) {
        fail(
            'CATALOG_SOURCE_PROJECTION_DIAGNOSTIC_INVALID',
            `Diagnostic code '${String(value)}' cannot be normalized safely.`,
        );
    }
    let normalized = value.toLowerCase();
    const sourcePrefix = `${String(sourceId).toLowerCase().replace(/[^a-z0-9._-]/g, '_')}_`;
    if (normalized.startsWith(sourcePrefix)) {
        normalized = normalized.slice(sourcePrefix.length);
    }
    if (!CODE.test(normalized) || normalized.length > 64) {
        fail(
            'CATALOG_SOURCE_PROJECTION_DIAGNOSTIC_INVALID',
            `Diagnostic code '${value}' is invalid after normalization.`,
        );
    }
    return normalized;
}

function normalizeDiagnostics(values, sourceId) {
    if (!Array.isArray(values) || values.length > 32) {
        fail(
            'CATALOG_SOURCE_PROJECTION_DIAGNOSTIC_INVALID',
            'Item diagnostics must be an array of at most 32 codes.',
        );
    }
    return [...new Set(values.map(value => normalizeDiagnosticCode(value, sourceId)))].sort();
}

function deterministicPriceObservationKey(identity) {
    return `reference-price.${identity.derivationKind}.${sha256(stableJson(identity)).slice(0, 32)}`;
}

function priceProvenanceDigest(item, artifactSha256, price, observationKey) {
    return sha256(stableJson({
        artifactSha256,
        detailPayloadDigest: item.provenance.detailPayloadDigest,
        externalId: item.externalId,
        listPayloadDigest: item.provenance.listPayloadDigest,
        observationKey,
        price,
    }));
}

function projectReferencePrices(item, artifactSha256, observedAt) {
    if (!Array.isArray(item.referencePrices) || item.referencePrices.length > 32) {
        fail(
            'CATALOG_SOURCE_PROJECTION_PRICE_INVALID',
            'Item reference prices must be an array of at most 32 observations.',
        );
    }
    const sourcePrices = [];
    const derivedPrices = [];
    for (const price of item.referencePrices) {
        requireObject(price, 'CATALOG_SOURCE_PROJECTION_PRICE_INVALID', 'Reference price');
        if (price.retailPrice !== false) {
            fail(
                'CATALOG_SOURCE_PROJECTION_RETAIL_PRICE_FORBIDDEN',
                'Catalog source prices must explicitly be non-retail reference observations.',
            );
        }
        if (price.kind === 'source-reference') sourcePrices.push(price);
        else if (price.kind === 'derived-reference') derivedPrices.push(price);
        else {
            fail(
                'CATALOG_SOURCE_PROJECTION_PRICE_INVALID',
                `Unsupported reference price kind '${String(price.kind)}'.`,
            );
        }
    }

    const observations = [];
    const sourcesByIdentity = new Map();
    for (const price of sourcePrices) {
        const amountText = normalizeDecimalText(price.amount, {
            allowNegative: false,
            maximumScale: 8,
            label: 'Source reference price amount',
        });
        const currencyCode = requireBoundedString(
            price.currencyCode,
            8,
            'Source reference price currency',
        ).toUpperCase();
        const basisUnitCode = requireBoundedString(
            price.basisUnitCode,
            32,
            'Source reference price basis',
        );
        if (!/^[A-Z]{3}$/.test(currencyCode) || !CODE.test(basisUnitCode) ||
            price.roundingPolicy?.mode !== 'none' ||
            price.derivation !== undefined) {
            fail(
                'CATALOG_SOURCE_PROJECTION_PRICE_INVALID',
                'Source reference price currency, basis, or rounding policy is invalid.',
            );
        }
        const identityCode = `${currencyCode}\0${basisUnitCode}`;
        if (sourcesByIdentity.has(identityCode)) {
            fail(
                'CATALOG_SOURCE_PROJECTION_PRICE_DUPLICATE',
                'Duplicate source reference price identity.',
            );
        }
        const observationKey = deterministicPriceObservationKey({
            basisUnitCode,
            currencyCode,
            derivationKind: 'source',
        });
        const observation = {
            observationKey,
            state: 1,
            amount: toDecimalValue(amountText, {
                allowNegative: false,
                maximumScale: 8,
                label: 'Source reference price amount',
            }),
            currencyCode,
            basisUnitCode,
            derivationKind: 1,
            observedAt,
            provenanceDigest: priceProvenanceDigest(
                item,
                artifactSha256,
                price,
                observationKey,
            ),
            roundingMode: 'none',
        };
        if (price.observedSourceUpdatedAt !== null && price.observedSourceUpdatedAt !== undefined) {
            observation.sourceUpdatedAt = requireTimestamp(
                price.observedSourceUpdatedAt,
                'Source reference price updated time',
            );
        }
        sourcesByIdentity.set(identityCode, {
            amount: decimalFraction(amountText, 'Source reference price amount'),
            amountText,
            observation,
        });
        observations.push(observation);
    }

    const derivedIdentities = new Set();
    for (const price of derivedPrices) {
        const derivation = requireObject(
            price.derivation,
            'CATALOG_SOURCE_PROJECTION_PRICE_LINEAGE_INVALID',
            'Derived price lineage',
        );
        const amountText = normalizeDecimalText(price.amount, {
            allowNegative: false,
            maximumScale: 8,
            label: 'Derived reference price amount',
        });
        const sourceAmountText = normalizeDecimalText(derivation.sourceAmount, {
            allowNegative: false,
            maximumScale: 8,
            label: 'Derived price source amount',
        });
        const divisorText = normalizeDecimalText(derivation.cumulativeDivisor, {
            allowNegative: false,
            maximumScale: 8,
            label: 'Derived price cumulative divisor',
        });
        const divisor = decimalFraction(divisorText, 'Derived price cumulative divisor');
        if (divisor.numerator <= 0n) {
            fail(
                'CATALOG_SOURCE_PROJECTION_PRICE_LINEAGE_INVALID',
                'Derived price divisor must be positive.',
            );
        }
        const currencyCode = requireBoundedString(
            price.currencyCode,
            8,
            'Derived reference price currency',
        ).toUpperCase();
        const basisUnitCode = requireBoundedString(
            price.basisUnitCode,
            32,
            'Derived reference price basis',
        );
        const sourceBasisUnitCode = requireBoundedString(
            derivation.sourceBasisUnitCode,
            32,
            'Derived price source basis',
        );
        if (!/^[A-Z]{3}$/.test(currencyCode) ||
            !CODE.test(basisUnitCode) ||
            !CODE.test(sourceBasisUnitCode) ||
            derivation.roundingPolicy?.mode !== 'half-up' ||
            derivation.roundingPolicy?.scale !== 8) {
            fail(
                'CATALOG_SOURCE_PROJECTION_PRICE_LINEAGE_INVALID',
                'Derived price currency, basis, or half-up scale-8 policy is invalid.',
            );
        }
        const source = sourcesByIdentity.get(`${currencyCode}\0${sourceBasisUnitCode}`);
        if (!source || source.amountText !== sourceAmountText) {
            fail(
                'CATALOG_SOURCE_PROJECTION_PRICE_LINEAGE_INVALID',
                'Derived price does not identify one original source observation.',
            );
        }
        const expectedFraction = divideFractions(source.amount, divisor);
        const suppliedFraction = parseExactFraction(
            derivation.exactFraction,
            'Derived price exact fraction',
        );
        if (expectedFraction.numerator !== suppliedFraction.numerator ||
            expectedFraction.denominator !== suppliedFraction.denominator ||
            roundFractionHalfUp(expectedFraction, 8) !== amountText) {
            fail(
                'CATALOG_SOURCE_PROJECTION_PRICE_LINEAGE_INVALID',
                'Derived price fraction or rounded amount does not match its source lineage.',
            );
        }
        const identity = {
            basisUnitCode,
            currencyCode,
            derivationKind: 'derived',
            sourceObservationKey: source.observation.observationKey,
        };
        const observationKey = deterministicPriceObservationKey(identity);
        if (derivedIdentities.has(observationKey)) {
            fail(
                'CATALOG_SOURCE_PROJECTION_PRICE_DUPLICATE',
                'Duplicate derived reference price identity.',
            );
        }
        derivedIdentities.add(observationKey);
        const observation = {
            observationKey,
            state: 1,
            amount: toDecimalValue(amountText, {
                allowNegative: false,
                maximumScale: 8,
                label: 'Derived reference price amount',
            }),
            currencyCode,
            basisUnitCode,
            derivationKind: 2,
            derivedFromObservationKey: source.observation.observationKey,
            derivationDivisor: toDecimalValue(divisorText, {
                allowNegative: false,
                maximumScale: 8,
                label: 'Derived price cumulative divisor',
            }),
            observedAt,
            provenanceDigest: priceProvenanceDigest(
                item,
                artifactSha256,
                price,
                observationKey,
            ),
            exactFractionNumerator: suppliedFraction.numerator.toString(),
            exactFractionDenominator: suppliedFraction.denominator.toString(),
            roundingMode: 'half-up',
            roundingScale: 8,
        };
        if (price.observedSourceUpdatedAt !== null && price.observedSourceUpdatedAt !== undefined) {
            observation.sourceUpdatedAt = requireTimestamp(
                price.observedSourceUpdatedAt,
                'Derived reference price updated time',
            );
        }
        observations.push(observation);
    }
    return observations;
}

function validateArtifact(artifact, artifactSha256) {
    requireObject(artifact, 'CATALOG_SOURCE_PROJECTION_ARTIFACT_INVALID', 'Catalog source artifact');
    requireDigest(artifactSha256, 'Artifact SHA-256');
    if (sha256(stableJson(artifact)) !== artifactSha256) {
        fail(
            'CATALOG_SOURCE_PROJECTION_ARTIFACT_HASH_MISMATCH',
            'Catalog source artifact bytes do not match artifactSha256.',
        );
    }
    const source = requireObject(
        artifact.source,
        'CATALOG_SOURCE_PROJECTION_ARTIFACT_INVALID',
        'Artifact source',
    );
    const snapshot = requireObject(
        artifact.snapshot,
        'CATALOG_SOURCE_PROJECTION_ARTIFACT_INVALID',
        'Artifact snapshot',
    );
    if (artifact.schemaVersion !== ARTIFACT_SCHEMA ||
        source.referencePricesAreRetailPrices !== false ||
        source.kind !== 'public-reference-catalog' ||
        typeof source.id !== 'string' ||
        !CODE.test(source.id) ||
        typeof source.connectorVersion !== 'string' ||
        !source.connectorVersion ||
        source.connectorVersion.length > 64 ||
        typeof snapshot.id !== 'string' ||
        !snapshot.id ||
        snapshot.id.length > 200 ||
        typeof snapshot.parserVersion !== 'string' ||
        !snapshot.parserVersion ||
        snapshot.parserVersion.length > 64 ||
        snapshot.complete !== true ||
        snapshot.authoritativeForDeletion !== false ||
        !Array.isArray(artifact.deletions) ||
        artifact.deletions.length !== 0 ||
        !Array.isArray(artifact.items) ||
        !Number.isSafeInteger(artifact.itemCount) ||
        artifact.itemCount < 1 ||
        artifact.itemCount > 100_000 ||
        artifact.itemCount !== artifact.items.length) {
        fail(
            'CATALOG_SOURCE_PROJECTION_ARTIFACT_INVALID',
            'Artifact schema, safety flags, deletion policy, or item count is invalid.',
        );
    }
    requireTimestamp(snapshot.observedAt, 'Artifact observed time');
    requireDigest(snapshot.rawPayloadDigest, 'Artifact raw payload digest');
    requireDigest(artifact.semanticDigest, 'Artifact semantic digest');
    const semanticProjection = {
        ...artifact,
        snapshot: { ...snapshot },
        items: artifact.items.map(item => withoutObservationTime(item)),
    };
    delete semanticProjection.semanticDigest;
    delete semanticProjection.snapshot.observedAt;
    if (sha256(stableJson(semanticProjection)) !== artifact.semanticDigest) {
        fail(
            'CATALOG_SOURCE_PROJECTION_SEMANTIC_HASH_MISMATCH',
            'Artifact semantic digest does not match its observation-time-neutral projection.',
        );
    }
    return { snapshot, source };
}

function projectArtifactItem(item, context) {
    requireObject(item, 'CATALOG_SOURCE_PROJECTION_ITEM_INVALID', 'Catalog source item');
    if (item.schemaVersion !== ITEM_SCHEMA) {
        fail('CATALOG_SOURCE_PROJECTION_ITEM_INVALID', 'Catalog source item schema is unsupported.');
    }
    const externalId = requireBoundedString(item.externalId, 1000, 'Item external ID');
    const provenance = requireObject(
        item.provenance,
        'CATALOG_SOURCE_PROJECTION_PROVENANCE_INVALID',
        'Item provenance',
    );
    requireDigest(provenance.listPayloadDigest, 'Item list payload digest');
    requireDigest(provenance.detailPayloadDigest, 'Item detail payload digest');
    if (provenance.parserVersion !== context.parserVersion) {
        fail(
            'CATALOG_SOURCE_PROJECTION_PROVENANCE_INVALID',
            'Item parser version must match the complete snapshot parser version.',
        );
    }
    const observedAt = requireTimestamp(provenance.observedAt, 'Item observed time');
    if (observedAt !== context.snapshotObservedAt) {
        fail(
            'CATALOG_SOURCE_PROJECTION_PROVENANCE_INVALID',
            'Item observed time must match the complete snapshot observation time.',
        );
    }
    const packageProjection = projectPackage(item.package);
    const observation = {
        externalId,
        semanticRevisionDigest: semanticRevisionDigest(item),
        listPayloadDigest: provenance.listPayloadDigest,
        detailPayloadDigest: provenance.detailPayloadDigest,
        localizedText: projectLocalizedText(item),
        factualAttributes: flattenFactualAttributes(item.facts),
        sourceDestination: projectSourceDestination(
            item,
            context.artifactSha256,
            observedAt,
        ),
        packageComponents: packageProjection.packageComponents,
        packageComponentsExact: packageProjection.packageComponentsExact,
        imageUris: Array.isArray(item.images)
            ? item.images.map((image, index) => {
                requireObject(
                    image,
                    'CATALOG_SOURCE_PROJECTION_IMAGE_INVALID',
                    `Item image ${index}`,
                );
                return validatePublicHttpsUri(image.url, `Item image ${index} URL`);
            })
            : fail('CATALOG_SOURCE_PROJECTION_IMAGE_INVALID', 'Item images must be an array.'),
        referencePrices: projectReferencePrices(
            item,
            context.artifactSha256,
            observedAt,
        ),
        diagnosticCodes: normalizeDiagnostics(item.diagnostics, context.sourceId),
    };
    if (new Set(observation.imageUris).size !== observation.imageUris.length) {
        fail('CATALOG_SOURCE_PROJECTION_IMAGE_INVALID', 'Item contains duplicate image URLs.');
    }
    if (observation.imageUris.length > 32) {
        fail('CATALOG_SOURCE_PROJECTION_IMAGE_INVALID', 'Item contains too many image URLs.');
    }
    if (packageProjection.rawPackageText !== undefined) {
        observation.rawPackageText = packageProjection.rawPackageText;
    }
    if (item.sourceUpdatedAt !== null && item.sourceUpdatedAt !== undefined) {
        observation.sourceUpdatedAt = requireTimestamp(
            item.sourceUpdatedAt,
            'Item source updated time',
        );
    }
    return {
        externalId,
        idempotencyKey: `catalog-source.item.${sha256(stableJson({
            artifactSha256: context.artifactSha256,
            externalId,
            semanticRevisionDigest: observation.semanticRevisionDigest,
        }))}`,
        observation,
    };
}

function projectArtifactItems(artifact, options = {}) {
    const { artifactSha256 } = options;
    const { snapshot, source } = validateArtifact(artifact, artifactSha256);
    const seenExternalIds = new Set();
    return artifact.items.map(item => {
        const projected = projectArtifactItem(item, {
            artifactSha256,
            parserVersion: snapshot.parserVersion,
            snapshotObservedAt: snapshot.observedAt,
            sourceId: source.id,
        });
        if (seenExternalIds.has(projected.externalId)) {
            fail(
                'CATALOG_SOURCE_PROJECTION_ITEM_DUPLICATE',
                `Duplicate catalog source external ID '${projected.externalId}'.`,
            );
        }
        seenExternalIds.add(projected.externalId);
        return projected;
    });
}

module.exports = {
    deterministicPriceObservationKey,
    flattenFactualAttributes,
    normalizeDiagnosticCode,
    normalizeDiagnostics,
    projectArtifactItem,
    projectArtifactItems,
    projectReferencePrices,
    generatedFactualDescriptions,
    semanticRevisionDigest,
    toDecimalValue,
    validatePublicHttpsUri,
};
