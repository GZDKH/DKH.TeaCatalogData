const path = require('path');
const { isManagedSpecification } = require('./product-overlay');

const IMAGE_EXTENSIONS = new Set([
    '.avif',
    '.gif',
    '.jpeg',
    '.jpg',
    '.png',
    '.svg',
    '.webp',
]);
const ALLOWED_UNITS = new Set(['%', '°C', 'g', 'm', 'ml', 's']);
const UNIT_LIMITS = new Map([
    ['%', { min: 0, max: 100 }],
    ['°C', { min: -50, max: 200 }],
    ['g', { min: 0, max: 100000 }],
    ['m', { min: -500, max: 10000 }],
    ['ml', { min: 0, max: 100000 }],
    ['s', { min: 0, max: 31536000 }],
]);
const MAX_SPECIFICATION_DECIMALS = 3;
const MAX_COORDINATE_DECIMALS = 6;
const GENERIC_FALLBACK_PATTERNS = [
    { pattern: /\b(?:FIXME|TBD|TODO)\b/iu, label: 'editorial placeholder' },
    {
        pattern: /\b(?:missing translation|translation (?:is )?missing)\b/iu,
        label: 'missing-translation placeholder',
    },
    {
        pattern: /\b(?:i18n|translations?)\.[A-Za-z0-9_.-]+\b/u,
        label: 'localization key',
    },
    {
        pattern: /\{\{[^{}\n]*\|\s*(?:t|translate)\b[^{}\n]*\}\}/iu,
        label: 'unresolved localization template',
    },
    {
        pattern: /\?(?:\s*(?:g|ml|s)\b|°C)/u,
        label: 'unknown measurement placeholder',
    },
];
const NON_ENGLISH_INTERFACE_PATTERNS = [
    { pattern: /\*\*Tasting note:\*\*/u, label: 'English tasting-note label' },
    { pattern: /^## Brewing recipes\b/mu, label: 'English brewing heading' },
    { pattern: /\bsteeps\b/iu, label: 'English brewing interface word' },
];

function auditPublicationQuality(input = {}) {
    const products = [...(input.products || [])].sort((left, right) =>
        normalizeCode(left?.code).localeCompare(normalizeCode(right?.code)));
    const requiredLocales = sortedUnique(input.requiredLocales);
    const targetCatalog = normalizeCode(input.targetCatalog || 'CATALOG-CHINESE-TEA');
    const publicationRequested = input.publicationRequested === true;
    const attributeIndex = new Map((input.definitions?.attributes || [])
        .map(attribute => [normalizeCode(attribute?.code), attribute]));
    const mediaIndex = buildMediaIndex(input.productMedia);
    const catalogIndex = buildCatalogIndex(input.catalogBindings, targetCatalog);
    const findings = [];

    for (const product of products) {
        const productCode = normalizeCode(product?.code) || '<UNKNOWN>';
        const blocking = publicationRequested && product?.published === true;
        const add = (rule, field, message, locale) => findings.push({
            product: productCode,
            rule,
            field,
            ...(locale ? { locale } : {}),
            blocking,
            message,
        });

        auditTranslations(product, requiredLocales, add);
        auditSpecifications(product, attributeIndex, add);
        auditOrigin(product, add);
        auditCatalogMapping(product, targetCatalog, catalogIndex, add);
        if ((mediaIndex.get(productCode) || 0) === 0) {
            add(
                'IMAGE_COVERAGE',
                'media',
                'No product image is bound to an image file in the artifact.');
        }
    }

    findings.sort(compareFindings);
    const errors = findings
        .filter(finding => finding.blocking)
        .map(finding => `Publication blocked: ${formatFinding(finding)}`);
    const warnings = findings
        .filter(finding => !finding.blocking)
        .map(finding => `Draft quality: ${formatFinding(finding)}`);
    const affectedProducts = sortedUnique(findings.map(finding => finding.product));
    const publishedProductCount = products.filter(product => product?.published === true).length;
    const ruleCounts = {};
    for (const finding of findings) {
        ruleCounts[finding.rule] = (ruleCounts[finding.rule] || 0) + 1;
    }

    return {
        valid: findings.length === 0,
        gatePassed: errors.length === 0,
        draftEligible: true,
        publicationEligible: findings.length === 0,
        productCount: products.length,
        publishedProductCount,
        publicationCandidateCount: publicationRequested ? publishedProductCount : 0,
        affectedProductCount: affectedProducts.length,
        findingCount: findings.length,
        blockerCount: errors.length,
        warningCount: warnings.length,
        ruleCounts: Object.fromEntries(Object.entries(ruleCounts)
            .sort(([left], [right]) => left.localeCompare(right))),
        findings,
        errors,
        warnings,
    };
}

function publicationQualitySummaryMessages(quality, errorLimit = 20) {
    return {
        errors: quality.errors.length
            ? [
                `Publication quality gate has ${quality.blockerCount} blocker(s); `
                    + 'see publication-quality.json.',
                ...quality.errors.slice(0, errorLimit),
            ]
            : [],
        warnings: quality.warnings.length
            ? [
                `Publication quality has ${quality.warningCount} Draft finding(s); `
                    + 'see publication-quality.json.',
            ]
            : [],
    };
}

function auditTranslations(product, requiredLocales, add) {
    const translations = new Map((product?.translations || []).map(translation => [
        String(translation?.lang || '').trim().toLowerCase(),
        translation,
    ]));

    for (const locale of requiredLocales) {
        const translation = translations.get(locale.toLowerCase());
        if (!String(translation?.name || '').trim()) {
            add(
                'REQUIRED_LOCALE_TITLE',
                'translations.name',
                'Required locale has no publication title.',
                locale);
        }
        if (!String(translation?.description || '').trim()) {
            add(
                'REQUIRED_LOCALE_DESCRIPTION',
                'translations.description',
                'Required locale has no publication description.',
                locale);
        }
        if (!translation) continue;

        const text = [
            translation.name,
            translation.description,
            translation.metaTitle,
            translation.metaDescription,
        ].filter(value => typeof value === 'string').join('\n');
        const fallback = forbiddenFallback(text, locale);
        if (fallback) {
            add(
                'FORBIDDEN_INTERFACE_FALLBACK',
                'translations',
                `Required locale contains a forbidden ${fallback}.`,
                locale);
        }
    }
}

function forbiddenFallback(text, locale) {
    for (const candidate of GENERIC_FALLBACK_PATTERNS) {
        if (candidate.pattern.test(text)) return candidate.label;
    }
    if (!String(locale).toLowerCase().startsWith('en')) {
        for (const candidate of NON_ENGLISH_INTERFACE_PATTERNS) {
            if (candidate.pattern.test(text)) return candidate.label;
        }
    }
    return null;
}

function auditSpecifications(product, attributeIndex, add) {
    for (const specification of product?.specifications || []) {
        if (!isManagedSpecification(specification)) continue;
        const attributeCode = normalizeCode(specification?.attribute);
        const attribute = attributeIndex.get(attributeCode);
        const unit = String(
            specification?.unit ?? attribute?.unit ?? '',
        ).trim();
        const field = `specifications.${attributeCode || '<UNKNOWN>'}`;

        if (unit && !ALLOWED_UNITS.has(unit)) {
            add(
                'SPECIFICATION_UNIT',
                field,
                `Unit '${unit}' is not in the publication unit contract.`);
        }

        const values = specificationValues(specification);
        for (const { label, rawValue, value } of values) {
            if (!Number.isFinite(value)) continue;
            if (decimalPlaces(rawValue) > MAX_SPECIFICATION_DECIMALS) {
                add(
                    'SPECIFICATION_PRECISION',
                    `${field}.${label}`,
                    `Numeric value '${rawValue}' exceeds ${MAX_SPECIFICATION_DECIMALS} decimal places.`);
            }
            const limits = UNIT_LIMITS.get(unit);
            if (limits && (value < limits.min || value > limits.max)) {
                add(
                    'SPECIFICATION_RANGE',
                    `${field}.${label}`,
                    `Numeric value '${value} ${unit}' is outside ${limits.min}..${limits.max} ${unit}.`);
            }
        }
    }
}

function specificationValues(specification) {
    if (specification?.type === 'Number') {
        return [{
            label: 'value',
            rawValue: specification.value,
            value: Number(specification.value),
        }];
    }
    if (specification?.type === 'Range') {
        return [
            {
                label: 'valueMin',
                rawValue: specification.valueMin,
                value: Number(specification.valueMin),
            },
            {
                label: 'valueMax',
                rawValue: specification.valueMax,
                value: Number(specification.valueMax),
            },
        ];
    }
    if (specification?.type === 'Duration') {
        return [{
            label: 'value',
            rawValue: specification.value,
            value: Number(specification.value),
        }];
    }
    return [];
}

function auditOrigin(product, add) {
    const origins = Array.isArray(product?.origins) ? product.origins : [];
    const mapped = origins.some(origin => {
        const hasCountry = /^[A-Z]{2}$/.test(String(origin?.country || ''));
        const hasPlace = Boolean(
            String(origin?.state || '').trim()
            || String(origin?.city || '').trim()
            || (origin?.translations || []).some(translation =>
                String(translation?.place || '').trim())
            || validCoordinates(origin?.coordinates));
        return hasCountry && hasPlace;
    });
    if (!mapped) {
        add(
            'ORIGIN_MAPPING',
            'origins',
            'No origin combines an ISO country with a mapped place or coordinates.');
    }

    for (const [index, origin] of origins.entries()) {
        const altitude = origin?.altitude;
        if (altitude) {
            if (String(altitude.unit || '') !== 'm') {
                add(
                    'ORIGIN_UNIT',
                    `origins[${index}].altitude.unit`,
                    `Altitude unit '${altitude.unit || '<missing>'}' must be 'm'.`);
            }
            for (const field of ['min', 'max']) {
                const value = altitude[field];
                if (Number.isFinite(value) && (value < -500 || value > 10000)) {
                    add(
                        'ORIGIN_RANGE',
                        `origins[${index}].altitude.${field}`,
                        `Altitude '${value} m' is outside -500..10000 m.`);
                }
            }
        }

        for (const field of ['lat', 'lng']) {
            const value = origin?.coordinates?.[field];
            if (Number.isFinite(value) && decimalPlaces(value) > MAX_COORDINATE_DECIMALS) {
                add(
                    'ORIGIN_PRECISION',
                    `origins[${index}].coordinates.${field}`,
                    `Coordinate '${value}' exceeds ${MAX_COORDINATE_DECIMALS} decimal places.`);
            }
        }
    }
}

function auditCatalogMapping(product, targetCatalog, catalogIndex, add) {
    const productCode = normalizeCode(product?.code);
    const assignments = (product?.catalogs || [])
        .filter(assignment => normalizeCode(assignment?.catalog) === targetCatalog);
    const mapped = assignments.some(assignment => {
        const category = normalizeCode(assignment?.category);
        return category
            && catalogIndex.categories.has(category)
            && catalogIndex.productsByCategory.get(category)?.has(productCode);
    });
    if (!mapped) {
        add(
            'CATEGORY_MAPPING',
            'catalogs',
            `No ${targetCatalog} assignment is present in both the product and catalog binding.`);
    }
}

function buildCatalogIndex(catalogBindings, targetCatalog) {
    const categories = new Set();
    const productsByCategory = new Map();
    const binding = (catalogBindings || [])
        .find(item => normalizeCode(item?.code) === targetCatalog);
    for (const category of binding?.categories || []) {
        const categoryCode = normalizeCode(category?.category);
        if (!categoryCode) continue;
        categories.add(categoryCode);
        productsByCategory.set(categoryCode, new Set((category?.products || [])
            .map(product => normalizeCode(product?.product ?? product))
            .filter(Boolean)));
    }
    return { categories, productsByCategory };
}

function buildMediaIndex(productMedia = {}) {
    const files = sortedUnique([
        ...(productMedia.files || []),
        ...(productMedia.assets || []).map(asset => asset?.relativePath),
    ]).filter(file => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));
    const result = new Map();
    for (const record of productMedia.records || []) {
        const productCode = normalizeCode(record?.product);
        const prefix = `${String(record?.path || '').replace(/\/+$/u, '')}/`;
        const count = files.filter(file => file.startsWith(prefix)).length;
        result.set(productCode, (result.get(productCode) || 0) + count);
    }
    return result;
}

function validCoordinates(value) {
    return Number.isFinite(value?.lat)
        && value.lat >= -90
        && value.lat <= 90
        && Number.isFinite(value?.lng)
        && value.lng >= -180
        && value.lng <= 180;
}

function decimalPlaces(value) {
    const text = String(value);
    const exponent = /e-(\d+)$/iu.exec(text);
    if (exponent) return Number(exponent[1]);
    return (text.split('.')[1] || '').length;
}

function compareFindings(left, right) {
    return left.product.localeCompare(right.product)
        || left.rule.localeCompare(right.rule)
        || String(left.locale || '').localeCompare(String(right.locale || ''))
        || left.field.localeCompare(right.field)
        || left.message.localeCompare(right.message);
}

function formatFinding(finding) {
    const locale = finding.locale ? ` ${finding.locale}` : '';
    return `${finding.product} [${finding.rule}]${locale} ${finding.field}: ${finding.message}`;
}

function normalizeCode(value) {
    const code = value && typeof value === 'object' ? value.code : value;
    return String(code || '').trim().toUpperCase();
}

function sortedUnique(values) {
    return [...new Set((values || [])
        .map(value => String(value || '').trim())
        .filter(Boolean))].sort();
}

module.exports = {
    auditPublicationQuality,
    publicationQualitySummaryMessages,
};
