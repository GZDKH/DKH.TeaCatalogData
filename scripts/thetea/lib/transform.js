const {
    buildSpecs,
    isRoutedTheTeaField,
    isSyntheticTheTeaField,
    makeCode,
    normalizeCodePart,
    titleize,
} = require('./spec-registry');
const { stripDefinitionMetadata } = require('./spec-contract');
const { toProductLocale } = require('./locales');
const { buildCategoryAssignments, PROVINCE_CATEGORY, TEA_TYPE_CATEGORY } = require('./category-taxonomy');

const FALLBACK_SOURCE_LOCALES = ['en', 'ru', 'zh'];

const DEFAULT_PACKAGES = [
    { package: 'PKG-50G', packageName: '50g', packageUnit: 'g', quantity: 1, default: true },
];

const STANDARD_PACKAGES = [
    { package: 'PKG-25G', packageName: '25g', packageUnit: 'g', quantity: 1, default: false },
    ...DEFAULT_PACKAGES,
    { package: 'PKG-100G', packageName: '100g', packageUnit: 'g', quantity: 1, default: false },
    { package: 'PKG-250G', packageName: '250g', packageUnit: 'g', quantity: 1, default: false },
    { package: 'PKG-500G', packageName: '500g', packageUnit: 'g', quantity: 1, default: false },
];

function transformCardSet(cardSet, options = {}) {
    const primary = cardSet.en || cardSet['en-US'] || cardSet['en-us'] || Object.values(cardSet)[0];
    if (!primary) throw new Error('cardSet must contain at least one TeaCard');

    const meta = primary.meta || {};
    const warnings = [];
    const code = productCodeForCardSet(cardSet);
    const canonicalSensoryLabels = Object.fromEntries((primary.sensory || [])
        .filter(item => item?.descriptor_id || item?.descriptor)
        .map(item => [String(item.descriptor_id || item.descriptor), item.descriptor || item.descriptor_id]));
    const fieldRouting = collectFieldRouting(cardSet);
    const localizedSpecificationSets = Object.entries(cardSet)
        .filter(([, card]) => Boolean(card))
        .map(([sourceLang, card]) => ({
            sourceLang,
            lang: toProductLocale(card.lang || sourceLang),
            specifications: buildSpecs(
                { ...card, lang: card.lang || sourceLang },
                {
                    productCode: code,
                    canonicalSensoryLabels,
                    routedFieldKeys: fieldRouting.suppressedSpecificationKeys,
                }),
        }))
        .sort(compareSpecificationLocales);
    const definitionObservations = localizedSpecificationSets
        .flatMap(item => item.specifications);
    const selectedSpecifications = selectCanonicalSpecifications(localizedSpecificationSets, code);
    const relationCandidates = collectRelationCandidates(cardSet, primary, warnings);
    const routed = buildRoutedContent(cardSet, code, fieldRouting.routedContentKeys, primary.slug);
    const product = {
        code,
        sku: `${normalizeCodePart(primary.slug)}-${normalizeCodePart(meta.origin_country || 'CN')}`,
        order: options.order || 0,
        published: options.publish === true,
        nativeName: extractNativeName(primary),
        transcription: extractTranscription(primary.name),
        translations: buildTranslations(cardSet, primary, warnings),
        catalogs: buildCatalogAssignments(
            primary,
            options.knownCategories || new Set(),
            warnings,
            options.catalog),
        packages: options.packages === 'standard' ? STANDARD_PACKAGES : DEFAULT_PACKAGES,
        tags: buildTags(primary),
        specifications: selectedSpecifications.specifications.map(stripDefinitionMetadata),
        origins: buildOrigins(cardSet, primary, warnings),
        related: resolveRelatedProducts(relationCandidates, code, options, warnings),
        crossSells: [],
    };

    return {
        product,
        warnings,
        definitionObservations,
        relationCandidates,
        lossEvents: [...routed.events, ...selectedSpecifications.events],
        routedContent: routed.content,
    };
}

function collectRelationCandidates(cardSet, primary, warnings) {
    const candidates = [];
    const seen = new Set();
    const selfSlug = normalizeSlug(primary.slug);

    const add = (value, source) => {
        const slug = normalizeSlug(typeof value === 'string' ? value : value?.slug);
        if (!slug) return;
        if (slug === selfSlug) {
            warnings.push(`Ignored self-related tea '${slug}' for ${primary.slug}.`);
            return;
        }
        if (seen.has(slug)) return;
        seen.add(slug);
        candidates.push({
            slug,
            source,
            score: typeof value === 'object' && Number.isFinite(Number(value?.score))
                ? Number(value.score)
                : undefined,
        });
    };

    for (const value of primary.enrichment?.similar_teas || []) add(value, 'enrichment.similar_teas');

    const localizedCards = Object.entries(cardSet)
        .filter(([, card]) => Boolean(card))
        .sort(([langA], [langB]) => localeRelationOrder(langA) - localeRelationOrder(langB)
            || langA.localeCompare(langB));
    for (const [sourceLang, card] of localizedCards) {
        const payload = card.similarEndpoint;
        const similar = Array.isArray(payload)
            ? payload
            : payload?.similar || payload?.data?.similar || [];
        for (const value of similar) add(value, `similar.${sourceLang}`);
    }

    return candidates;
}

function resolveRelatedProducts(candidates, selfCode, options, warnings) {
    const productCodeBySlug = options.productCodeBySlug;
    if (!productCodeBySlug) return [];

    const catalog = options.catalog || 'CATALOG-CHINESE-TEA';
    const related = [];
    for (const candidate of candidates) {
        const product = lookupProductCode(productCodeBySlug, candidate.slug);
        if (!product) {
            warnings.push(`Unresolved related tea '${candidate.slug}' for ${selfCode}.`);
            continue;
        }
        if (String(product).toUpperCase() === String(selfCode).toUpperCase()) continue;
        related.push({ product, catalog, order: related.length + 1 });
        if (related.length >= 12) break;
    }
    return related;
}

function collectFieldRouting(cardSet) {
    const routedContentKeys = new Set();
    const suppressedSpecificationKeys = new Set();
    for (const card of Object.values(cardSet).filter(Boolean)) {
        for (const [section, fields] of Object.entries(card.sections || {})) {
            for (const [field, payload] of Object.entries(fields || {})) {
                const key = `${section}.${field}`;
                const value = payload && typeof payload === 'object'
                    ? payload.endpoint?.value_md ?? payload.value
                    : payload;
                if (value !== null && value !== undefined && String(value).trim()) {
                    routedContentKeys.add(key);
                }
                if (isRoutedTheTeaField(section, field, payload)) {
                    suppressedSpecificationKeys.add(key);
                }
            }
        }
    }
    return { routedContentKeys, suppressedSpecificationKeys };
}

function buildRoutedContent(cardSet, productCode, routedFieldKeys = new Set(), productSlug = '') {
    const articleTranslations = [];
    const faqByLocale = new Map();
    const productLocales = [];
    let markdownCount = 0;
    let narrativeCount = 0;

    for (const [sourceLang, card] of Object.entries(cardSet)
        .filter(([, value]) => Boolean(value))
        .sort(([langA], [langB]) => localeRelationOrder(langA) - localeRelationOrder(langB)
            || langA.localeCompare(langB))) {
        const lang = toProductLocale(card.lang || sourceLang);
        if (!productLocales.some(locale => locale.toLowerCase() === lang.toLowerCase())) {
            productLocales.push(lang);
        }
        const narratives = {};
        for (const [section, fields] of Object.entries(card.sections || {})) {
            for (const [field, payload] of Object.entries(fields || {})) {
                if (!routedFieldKeys.has(`${section}.${field}`)
                    && !isSyntheticTheTeaField(section, field)) continue;
                const value = payload && typeof payload === 'object'
                    ? payload.endpoint?.value_md ?? payload.value
                    : payload;
                if (value === null || value === undefined || String(value).trim() === '') continue;
                if (!narratives[section]) narratives[section] = {};
                narratives[section][field] = String(value);
                narrativeCount += 1;
            }
        }

        const markdown = typeof card.markdown === 'string' && card.markdown.trim()
            ? card.markdown
            : undefined;
        if (markdown) markdownCount += 1;
        if (markdown || Object.keys(narratives).length) {
            articleTranslations.push(stripUndefined({ lang, markdown, narratives }));
        }

        const faq = Array.isArray(card.enrichment?.faq) ? card.enrichment.faq : [];
        if (faq.length) {
            const items = normalizeFaqItems(faq, `${productCode}/${lang}`);
            if (!faqByLocale.has(lang.toLowerCase())) faqByLocale.set(lang.toLowerCase(), { lang, items });
        }
    }

    const faqLocales = [];
    const faqFallbackLocales = [];
    const faqFallback = faqByLocale.values().next().value;
    if (faqFallback) {
        for (const lang of productLocales) {
            const existing = faqByLocale.get(lang.toLowerCase());
            if (existing) {
                faqLocales.push(existing);
                continue;
            }
            faqFallbackLocales.push({ lang, from: faqFallback.lang });
            faqLocales.push({
                lang,
                items: faqFallback.items.map(item => ({ ...item })),
            });
        }
    }
    const faqCount = faqLocales.reduce((sum, locale) => sum + locale.items.length, 0);

    const events = [];
    if (faqCount) {
        events.push({
            severity: 'warning',
            source: 'enrichment.faq',
            target: 'storefront-metaobject',
            count: faqCount,
            routed: true,
            message: 'FAQ records are routed to Storefront metaobjects, not ProductCatalog specifications.',
        });
    }
    if (faqFallbackLocales.length) {
        events.push({
            severity: 'warning',
            source: 'enrichment.faq-fallback',
            target: 'storefront-metaobject',
            count: faqFallbackLocales.length,
            routed: true,
            locales: faqFallbackLocales,
            message: 'Missing localized FAQ payloads use an explicit deterministic locale fallback.',
        });
    }
    if (narrativeCount) {
        events.push({
            severity: 'warning',
            source: 'localized-section-narratives',
            target: 'localized-article',
            count: narrativeCount,
            routed: true,
            message: 'Localized section prose, including synthetic, canonical-detail, and long narratives, is routed to article content.',
        });
    }
    if (markdownCount) {
        events.push({
            severity: 'warning',
            source: 'markdown',
            target: 'localized-article',
            count: markdownCount,
            routed: true,
            message: 'Full localized Markdown is routed to article content.',
        });
    }

    return {
        events,
        content: {
            articles: articleTranslations.length ? [{
                code: makeCode('ARTICLE-TT', productCode, 'DETAIL'),
                product: productCode,
                slug: seoSlug(productSlug),
                translations: articleTranslations,
            }] : [],
            metaobjects: faqLocales.length ? [{
                code: makeCode('METAOBJECT-TT', productCode, 'FAQ'),
                type: 'product_faq',
                product: productCode,
                slug: seoSlug(productSlug),
                locales: faqLocales,
            }] : [],
        },
    };
}

function normalizeFaqItems(faq, context) {
    const result = [];
    let pendingQuestion = null;
    for (const [index, item] of faq.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error(`${context}: FAQ item ${index} must be an object.`);
        }
        const question = String(item.q || item.question || '').trim();
        const answer = String(item.a || item['а'] || item.answer || '').trim();
        if (question && answer) {
            if (pendingQuestion) {
                throw new Error(`${context}: FAQ question '${pendingQuestion}' has no answer before item ${index}.`);
            }
            result.push({ question, answer });
            continue;
        }
        if (question) {
            if (pendingQuestion) {
                throw new Error(`${context}: consecutive FAQ questions without an answer at item ${index}.`);
            }
            pendingQuestion = question;
            continue;
        }
        if (answer && pendingQuestion) {
            result.push({ question: pendingQuestion, answer });
            pendingQuestion = null;
            continue;
        }
        throw new Error(`${context}: FAQ item ${index} cannot be paired into a question and answer.`);
    }
    if (pendingQuestion) throw new Error(`${context}: final FAQ question has no answer.`);
    return result.map((item, index) => ({ order: index + 1, ...item }));
}

function compareSpecificationLocales(left, right) {
    return specificationLocaleOrder(left.lang) - specificationLocaleOrder(right.lang)
        || left.lang.localeCompare(right.lang)
        || left.sourceLang.localeCompare(right.sourceLang);
}

function specificationLocaleOrder(value) {
    const locale = String(value || '').toLowerCase();
    if (locale === 'en' || locale === 'en-us') return 0;
    if (locale === 'ru' || locale === 'ru-ru') return 1;
    if (locale === 'zh' || locale === 'zh-cn') return 2;
    return 3;
}

function selectCanonicalSpecifications(localizedSets, productCode) {
    const selected = new Map();
    const fallbackAttributes = [];
    const canonicalLang = localizedSets[0]?.lang;
    for (const set of localizedSets) {
        for (const spec of set.specifications) {
            const attribute = String(spec.attribute || '').toUpperCase();
            if (selected.has(attribute)) continue;
            selected.set(attribute, spec);
            if (set.lang !== canonicalLang) fallbackAttributes.push({ attribute, lang: set.lang });
        }
    }

    const events = fallbackAttributes.length ? [{
        severity: 'warning',
        source: 'localized-only-specifications',
        target: 'product-specification',
        count: fallbackAttributes.length,
        routed: true,
        fields: fallbackAttributes,
        message: `${productCode}: specifications absent from the canonical locale used deterministic locale fallbacks.`,
    }] : [];
    return {
        specifications: [...selected.values()].sort((a, b) =>
            specificationOrder(a.order) - specificationOrder(b.order)
            || a.attribute.localeCompare(b.attribute)),
        events,
    };
}

function specificationOrder(value) {
    return Number.isInteger(value) ? value : 2_000_000_000;
}

function lookupProductCode(index, slug) {
    if (index instanceof Map) return index.get(slug);
    return index[slug];
}

function normalizeSlug(value) {
    return String(value || '').trim().toLowerCase();
}

function localeRelationOrder(value) {
    const locale = String(value || '').toLowerCase();
    return locale === 'en' || locale === 'en-us' ? 0 : 1;
}

function buildTranslations(cardSet, primary, warnings) {
    const translations = new Map();

    for (const [sourceLang, card] of Object.entries(cardSet)) {
        if (!card) continue;
        const bcp47 = toProductLocale(card.lang || sourceLang);
        if (!bcp47 || translations.has(bcp47)) continue;
        const rawName = localizedName(card, sourceLang, primary);
        const displayName = cleanDisplayName(rawName);

        translations.set(bcp47, {
            name: displayName,
            transcription: extractTranscription(rawName || card.name || primary.name),
            description: buildDescription(card),
            seo: seoSlug(card.slug || primary.slug),
            metaTitle: card.seo?.title,
            metaDescription: card.seo?.description,
        });
    }

    for (const lang of FALLBACK_SOURCE_LOCALES) {
        const bcp47 = toProductLocale(lang);
        if (translations.has(bcp47)) continue;
        const fallbackName = nameFallback(primary, lang);
        if (fallbackName) {
            translations.set(bcp47, {
                name: cleanDisplayName(fallbackName),
                transcription: extractTranscription(primary.name),
                seo: seoSlug(primary.slug),
            });
            warnings.push(`Missing localized ${lang} card for ${primary.slug}; generated name-only ${bcp47} translation.`);
        }
    }

    return [...translations.entries()]
        .map(([lang, value]) => ({ lang, ...value }))
        .filter(t => t.name);
}

function buildDescription(card) {
    const enrichment = card.enrichment || {};
    const chunks = [];
    if (enrichment.one_liner) chunks.push(`**${enrichment.one_liner}**`);
    if (enrichment.summary) chunks.push(enrichment.summary);
    if (enrichment.tasting_note) chunks.push(`**Tasting note:** ${enrichment.tasting_note}`);

    const recipes = (card.recipe || []).map(r => {
        const present = value => value !== null && value !== undefined && value !== '';
        const grams = present(r.tea_grams) ? `${r.tea_grams} g` : '? g';
        const water = present(r.water_ml) ? `${r.water_ml} ml` : '? ml';
        const temp = present(r.water_temp) ? `${r.water_temp}°C` : '?°C';
        const steep = present(r.steep_sec) ? `${r.steep_sec}s` : '?s';
        const maxSteeps = present(r.max_steeps) ? r.max_steeps : '?';
        return `- **${r.style}:** ${temp}, ${grams} / ${water}, ${steep}, ${maxSteeps} steeps`;
    });
    if (recipes.length) chunks.push(`## Brewing recipes\n${recipes.join('\n')}`);

    return chunks.filter(Boolean).join('\n\n');
}

function buildCatalogAssignments(card, knownCategories, warnings, catalog = 'CATALOG-CHINESE-TEA') {
    const categoryCodes = buildCategoryAssignments(card, warnings);

    return [...new Set(categoryCodes)]
        .filter(code => {
            if (!knownCategories.size || knownCategories.has(code)) return true;
            warnings.push(`Category '${code}' is not present in local categories.json (${card.slug}).`);
            return true;
        })
        .map((category, index) => ({
            catalog,
            catalogCurrency: 'CNY',
            category,
            order: index + 1,
            published: true,
        }));
}

function buildTags(card) {
    const tags = [];
    for (const tag of card.tags || []) {
        tags.push({
            code: makeCode('TAG-TT', tag),
            name: titleize(tag),
            lang: 'en-US',
        });
    }

    for (const tag of card.enrichment?.flavor_tags || []) {
        tags.push({
            code: makeCode('TAG-FLAVOR', tag),
            name: titleize(tag),
            lang: 'en-US',
        });
    }

    return dedupeBy(tags, t => t.code);
}

function buildOrigins(cardSet, primary, warnings) {
    const meta = primary.meta || {};
    const altitude = normalizeAltitudeRange(
        meta.altitude_min,
        meta.altitude_max,
        primary.sections?.terroir?.altitude?.value);
    if (altitude.scaled) {
        warnings.push(`Normalized fractional-thousand altitude values to meters for ${primary.slug}.`);
    }
    const origin = {
        country: meta.origin_country || 'CN',
        state: meta.province,
        city: meta.city || meta.county,
        altitude: altitude.min !== undefined || altitude.max !== undefined
            ? { min: altitude.min, max: altitude.max, unit: 'm' }
            : undefined,
        coordinates: (meta.lat !== null && meta.lat !== undefined)
            || (meta.lng !== null && meta.lng !== undefined)
            ? { lat: meta.lat, lng: meta.lng }
            : undefined,
        translations: [],
    };

    const seen = new Set();
    for (const [sourceLang, card] of Object.entries(cardSet)) {
        if (!card) continue;
        const bcp47 = toProductLocale(card.lang || sourceLang);
        if (!bcp47 || seen.has(bcp47)) continue;
        seen.add(bcp47);

        origin.translations.push({
            lang: bcp47,
            place: buildOriginPlace(card, meta),
            notes: buildOriginNotes(card),
        });
    }

    return [stripUndefined(origin)];
}

function normalizeAltitudeRange(rawMin, rawMax, narrative) {
    let min = optionalNumber(rawMin);
    let max = optionalNumber(rawMax);
    let scaled = false;
    if (isFractionalThousand(min) && isFractionalThousand(max)) {
        min *= 1000;
        max *= 1000;
        scaled = true;
    } else if (min !== undefined && max !== undefined && min > max && isFractionalThousand(max)) {
        max *= 1000;
        scaled = true;
    } else if (min === undefined && isFractionalThousand(max) && narrativeConfirmsThousands(max, narrative)) {
        max *= 1000;
        scaled = true;
    } else if (max === undefined && isFractionalThousand(min) && narrativeConfirmsThousands(min, narrative)) {
        min *= 1000;
        scaled = true;
    }
    return { min, max, scaled };
}

function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error(`Invalid altitude value '${value}'.`);
    return numeric;
}

function isFractionalThousand(value) {
    return value !== undefined && Math.abs(value) > 0 && Math.abs(value) < 10;
}

function narrativeConfirmsThousands(value, narrative) {
    const meters = String(Math.round(value * 1000));
    const withThousandsSeparator = meters.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return String(narrative || '').includes(withThousandsSeparator);
}

function buildOriginNotes(card) {
    const notes = [];
    appendPlain(notes, card, 'classification_origin', 'origin', 'Origin');
    appendPlain(notes, card, 'terroir', 'altitude', 'Altitude');
    appendPlain(notes, card, 'terroir', 'climate', 'Climate');
    appendPlain(notes, card, 'terroir', 'soil', 'Soil');
    appendPlain(notes, card, 'classification_origin', 'coordinates', 'Coordinates');
    return notes.join('\n\n');
}

function buildOriginPlace(card, meta) {
    const raw = String(card.sections?.classification_origin?.origin?.value || '')
        .replace(/\s+/g, ' ')
        .trim();
    const firstSentence = raw.split(/[.。\n]/u)[0]?.trim();
    if (firstSentence && firstSentence.length <= 500) return firstSentence;

    return [...new Set([
        meta.city || meta.county,
        meta.province,
        meta.origin_country,
    ].map(value => String(value || '').trim()).filter(Boolean))].join(', ') || undefined;
}

function appendPlain(chunks, card, section, field, title) {
    const value = card.sections?.[section]?.[field]?.value;
    if (value) chunks.push(`**${title}:** ${value}`);
}

function nameFallback(primary, lang) {
    const normalized = String(lang || '').toLowerCase();
    const base = normalized.split('-')[0];
    return primary.names?.[normalized] || primary.names?.[base] || (base === 'en' ? primary.name : null);
}

function localizedName(card, sourceLang, primary) {
    return nameFallback(card, card.lang || sourceLang)
        || card.name
        || nameFallback(primary, sourceLang);
}

function cleanDisplayName(name) {
    if (!name) return name;
    const original = String(name).trim();
    let value = original;
    while (true) {
        const next = value.replace(/\s*\((?=[^)]*[\u3400-\u9fff])[^)]*\)\s*$/u, '').trim();
        if (!next || next === value) return value || original;
        value = next;
    }
}

function extractNativeName(card) {
    const zh = card.names?.zh || card.names?.['zh-CN'];
    if (!zh) return undefined;
    return cleanDisplayName(zh) || undefined;
}

function extractTranscription(name) {
    if (!name) return undefined;
    const match = /\((?:[^,()]+,\s*)?([^()]+)\)\s*$/.exec(name);
    return match ? match[1].trim() : undefined;
}

function seoSlug(slug) {
    return String(slug || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function dedupeBy(items, keyFn) {
    const map = new Map();
    for (const item of items) map.set(keyFn(item), item);
    return [...map.values()];
}

function stripUndefined(value) {
    if (Array.isArray(value)) return value.map(stripUndefined);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, stripUndefined(v)]));
    }
    return value;
}

function productCodeForCardSet(cardSet) {
    const primary = cardSet.en || cardSet['en-US'] || cardSet['en-us'] || Object.values(cardSet)[0];
    if (!primary) throw new Error('cardSet must contain at least one TeaCard');
    return makeCode('TEA', primary.meta?.origin_country || 'CN', primary.slug);
}

module.exports = {
    TEA_TYPE_CATEGORY,
    PROVINCE_CATEGORY,
    DEFAULT_PACKAGES,
    STANDARD_PACKAGES,
    transformCardSet,
    buildDescription,
    cleanDisplayName,
    extractNativeName,
    extractTranscription,
    productCodeForCardSet,
};
