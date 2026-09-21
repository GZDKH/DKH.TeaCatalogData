const crypto = require('crypto');
const fs = require('fs');
const { transformCardSet } = require('./transform');
const { makeCode } = require('./spec-registry');
const { buildReconciliation, stableStringify } = require('../reconcile-generated');
const { hashInputPath } = require('../generate-import');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function hashFile(file) {
    return sha256(fs.readFileSync(file));
}

function hasValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

// This source field describes a range spanning multiple tea variants. It is
// useful evidence for an operator, but cannot be treated as a fact of the
// single product being reconciled without a product-specific price source.
const REVIEW_ONLY_SOURCE_PATHS = new Map([
    ['/sections/price_counterfeit/price_category', 'non-product-specific-narrative'],
]);

function sourceRevision(card, metadata = {}) {
    const parts = [
        metadata.snapshotId,
        card?.meta?.version,
        card?.meta?.last_updated,
    ].filter(value => value !== undefined && value !== null && String(value).trim() !== '');
    return parts.length ? parts.join(':') : 'unversioned-source';
}

function sourceUrl(card, metadata = {}) {
    if (metadata.articleUrl) return String(metadata.articleUrl);
    const locale = String(card?.lang || 'ru').toLowerCase();
    const productLocale = locale === 'en' ? 'en-US' : locale === 'zh' ? 'zh-CN' : locale;
    return `https://tea.community/${productLocale}/products/${encodeURIComponent(card?.slug || '')}`;
}

function pointerValue(card, pointer) {
    const parts = String(pointer || '').replace(/^\//, '').split('/').filter(Boolean);
    let value = card;
    for (const part of parts) {
        if (value === null || value === undefined) return undefined;
        const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
        value = value[key];
    }
    return value;
}

function excerpt(value) {
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

function evidence(card, metadata, pointer, value = pointerValue(card, pointer)) {
    return {
        sourceSystem: metadata.sourceSystem || 'thetea',
        articleUrl: sourceUrl(card, metadata),
        sourceRevision: sourceRevision(card, metadata),
        sourcePath: pointer,
        excerpt: excerpt(value === undefined ? null : value),
        sourceSha256: metadata.sourceSha256 || null,
        fieldPackSha256: metadata.fieldPackSha256 || null,
    };
}

function candidateSourceIndex(card) {
    const index = new Map();
    const add = (attribute, pointer, value) => {
        if (!attribute) return;
        index.set(normalizeCode(attribute), { pointer, value });
    };
    const metaMap = {
        'SPEC-TT-CLASSIFICATION-ORIGIN-TEA-TYPE': 'tea_type',
        'SPEC-TT-SOURCE-CATEGORY-CODE': 'category_code',
        'SPEC-TT-ATOMIC-OXIDATION': null,
        'SPEC-TT-BREWING-BREW-TEMP': null,
        'SPEC-TT-ATOMIC-SHAPE': 'shape',
        'SPEC-TT-ATOMIC-PROCESSING': 'processing',
        'SPEC-TT-ATOMIC-ROAST-LEVEL': 'roast_level',
        'SPEC-TT-CLASSIFICATION-ORIGIN-GI-STATUS': 'gi_status',
        'SPEC-TT-CLASSIFICATION-ORIGIN-GI-STANDARD': 'gi_standard',
        'SPEC-TT-SOURCE-VERSION': 'version',
        'SPEC-TT-SOURCE-LAST-UPDATED': 'last_updated',
        'SPEC-TT-SOURCE-REVIEW-STATUS': 'review_status',
    };
    for (const [attribute, field] of Object.entries(metaMap)) {
        if (field) add(attribute, `/meta/${field}`, card?.meta?.[field]);
    }
    add('SPEC-TT-ATOMIC-OXIDATION', '/meta/oxidation', {
        min: card?.meta?.oxidation_min,
        max: card?.meta?.oxidation_max,
    });
    add('SPEC-TT-BREWING-BREW-TEMP', '/meta/brew_temp', {
        min: card?.meta?.brew_temp_min,
        max: card?.meta?.brew_temp_max,
    });

    for (const [section, fields] of Object.entries(card?.sections || {})) {
        for (const [field, payload] of Object.entries(fields || {})) {
            const value = payload && typeof payload === 'object' ? payload.value : payload;
            add(makeCode('SPEC-TT-FIELD', section, field), `/sections/${section}/${field}`, value);
            add(makeCode('SPEC-TT-FIELD-DETAIL', section, field), `/sections/${section}/${field}`, payload);
        }
    }
    for (const [index, item] of (card?.recipe || []).entries()) {
        const style = String(item?.style || '').trim().toLowerCase();
        for (const field of ['water_temp', 'tea_grams', 'water_ml', 'steep_sec', 'increment_sec', 'max_steeps', 'rinse']) {
            add(
                makeCode('SPEC-TT-RECIPE', style, field),
                `/recipe/${index}/${field}`,
                item?.[field],
            );
        }
    }
    for (const [index, item] of (card?.harvest || []).entries()) {
        const phase = String(item?.phase || '').trim().toLowerCase();
        add(makeCode('SPEC-TT-HARVEST', `${phase}_months`), `/harvest/${index}/months`, item?.months);
    }
    for (const [index, item] of (card?.sensory || []).entries()) {
        const descriptor = String(item?.descriptor_id || item?.descriptor || '').trim().toLowerCase();
        add(
            makeCode('SPEC-TT-SENSORY', `descriptor_${descriptor}_intensity`),
            `/sensory/${index}/intensity`,
            item?.intensity,
        );
    }
    return index;
}

function specificationSignature(spec) {
    const type = String(spec?.type || '').trim();
    let value = spec?.value ?? null;
    if (['Number', 'Duration'].includes(type) && value !== null) {
        const number = Number(value);
        value = Number.isFinite(number) ? number : value;
    } else if (type === 'Boolean' && value !== null) {
        const normalized = String(value).trim().toLowerCase();
        value = normalized === 'true' || normalized === '1'
            ? true
            : normalized === 'false' || normalized === '0'
                ? false
                : value;
    } else if (type === 'List' && typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) value = parsed;
        } catch {
            // Keep malformed list values distinct so they cannot be silently accepted.
        }
    }
    return {
        type: type || null,
        value,
        valueMin: spec?.valueMin === undefined ? null : Number(spec.valueMin),
        valueMax: spec?.valueMax === undefined ? null : Number(spec.valueMax),
        option: normalizeCode(spec?.option) || null,
        unit: spec?.unit || null,
    };
}

function sameSpecification(left, right) {
    return stableStringify(specificationSignature(left))
        === stableStringify(specificationSignature(right));
}

function isRangeTruncated(before, after) {
    return after?.type === 'Range'
        && (after.valueMin !== undefined || after.valueMax !== undefined)
        && (before?.valueMin === undefined || before?.valueMin === null
            || before?.valueMax === undefined || before?.valueMax === null);
}

function proposalRecord({ path, action, reason, before, after, card, metadata, pointer, excerptValue }) {
    const record = {
        path,
        action,
        before: before === undefined ? null : clone(before),
        after: after === undefined ? null : clone(after),
        evidence: evidence(card, metadata, pointer, excerptValue),
    };
    if (reason) record.reason = reason;
    return record;
}

function mergeFillMissingProduct(baseline, candidate, card, metadata) {
    const desired = clone(baseline);
    const proposals = [];
    const reviewQueue = [];
    const index = candidateSourceIndex(card);
    const add = record => {
        proposals.push(record);
        if (record.action === 'review') reviewQueue.push(record);
    };

    const baselineSpecs = new Map((baseline.specifications || [])
        .map(spec => [normalizeCode(spec.attribute), spec]));
    for (const spec of candidate.specifications || []) {
        const attribute = normalizeCode(spec.attribute);
        const before = baselineSpecs.get(attribute);
        const source = index.get(attribute) || {
            pointer: '/specifications',
            value: spec,
        };
        const reviewReason = REVIEW_ONLY_SOURCE_PATHS.get(source.pointer);
        if (!before) {
            if (!reviewReason) {
                desired.specifications = [...(desired.specifications || []), clone(spec)];
            }
            add(proposalRecord({
                path: `specifications[attribute=${attribute}]`,
                action: reviewReason ? 'review' : 'apply',
                reason: reviewReason,
                before,
                after: spec,
                card,
                metadata,
                pointer: source.pointer,
                excerptValue: source.value,
            }));
            continue;
        }
        if (sameSpecification(before, spec)) {
            add(proposalRecord({
                path: `specifications[attribute=${attribute}]`,
                action: 'unchanged',
                before,
                after: spec,
                card,
                metadata,
                pointer: source.pointer,
                excerptValue: source.value,
            }));
            continue;
        }
        add(proposalRecord({
            path: `specifications[attribute=${attribute}]`,
            action: 'review',
            reason: isRangeTruncated(before, spec) ? 'range-truncation' : 'existing-value-conflict',
            before,
            after: spec,
            card,
            metadata,
            pointer: source.pointer,
            excerptValue: source.value,
        }));
    }

    const baselineTags = new Set((baseline.tags || []).map(tag => normalizeCode(tag.code)));
    for (const [index, tag] of (candidate.tags || []).entries()) {
        const code = normalizeCode(tag.code);
        const pointer = `/tags/${index}`;
        if (baselineTags.has(code)) {
            add(proposalRecord({ path: `tags[code=${code}]`, action: 'unchanged', before: tag, after: tag, card, metadata, pointer, excerptValue: card.tags?.[index] }));
            continue;
        }
        desired.tags = [...(desired.tags || []), clone(tag)];
        baselineTags.add(code);
        add(proposalRecord({ path: `tags[code=${code}]`, action: 'apply', before: undefined, after: tag, card, metadata, pointer, excerptValue: card.tags?.[index] }));
    }

    const candidateOrigin = candidate.origins?.[0];
    const baselineOrigin = baseline.origins?.[0];
    if (candidateOrigin) {
        if (!baselineOrigin) {
            desired.origins = [clone(candidateOrigin)];
            add(proposalRecord({ path: 'origins[0]', action: 'apply', before: undefined, after: candidateOrigin, card, metadata, pointer: '/meta', excerptValue: card.meta }));
        } else {
            const mergedOrigin = clone(baselineOrigin);
            const originSource = card.sections?.classification_origin?.origin;
            const originPointer = originSource
                ? '/sections/classification_origin/origin'
                : '/meta';
            const originExcerpt = originSource || card.meta;
            for (const field of ['country', 'state', 'city', 'altitude', 'coordinates']) {
                const after = candidateOrigin[field];
                const before = baselineOrigin[field];
                if (!hasValue(after)) continue;
                if (!hasValue(before)) {
                    mergedOrigin[field] = clone(after);
                    add(proposalRecord({
                        path: `origins[0].${field}`,
                        action: 'apply',
                        before,
                        after,
                        card,
                        metadata,
                        pointer: originPointer,
                        excerptValue: originExcerpt,
                    }));
                } else if (stableStringify(before) !== stableStringify(after)) {
                    add(proposalRecord({
                        path: `origins[0].${field}`,
                        action: 'review',
                        reason: 'existing-value-conflict',
                        before,
                        after,
                        card,
                        metadata,
                        pointer: originPointer,
                        excerptValue: originExcerpt,
                    }));
                }
            }
            const translations = [...(baselineOrigin.translations || [])];
            const knownLocales = new Set(translations.map(item => String(item.lang || '').toLowerCase()));
            for (const [index, translation] of (candidateOrigin.translations || []).entries()) {
                const locale = String(translation.lang || '').toLowerCase();
                if (!locale || knownLocales.has(locale)) continue;
                translations.push(clone(translation));
                knownLocales.add(locale);
                add(proposalRecord({
                    path: `origins[0].translations[lang=${translation.lang}]`,
                    action: 'apply',
                    before: undefined,
                    after: translation,
                    card,
                    metadata,
                    pointer: card.sections?.classification_origin?.origin
                        ? '/sections/classification_origin/origin'
                        : '/meta',
                    excerptValue: card.sections?.classification_origin?.origin || card.meta,
                }));
            }
            if (translations.length) mergedOrigin.translations = translations;
            desired.origins = [mergedOrigin, ...(desired.origins || []).slice(1)];
        }
    }

    const candidateTranslations = candidate.translations || [];
    const knownTranslations = new Set((baseline.translations || []).map(item => String(item.lang || '').toLowerCase()));
    for (const [index, translation] of candidateTranslations.entries()) {
        const locale = String(translation.lang || '').toLowerCase();
        const pointer = `/names/${String(card.lang || 'en').toLowerCase()}`;
        if (!locale) continue;
        if (knownTranslations.has(locale)) continue;
        desired.translations = [...(desired.translations || []), clone(translation)];
        knownTranslations.add(locale);
        add(proposalRecord({ path: `translations[lang=${translation.lang}]`, action: 'apply', before: undefined, after: translation, card, metadata, pointer, excerptValue: card.names?.[card.lang] || card.name }));
    }

    return { desired, proposals, reviewQueue };
}

function buildSourceBackedProposal({ sourceCard, baselineProduct, sourceMetadata = {} }) {
    if (!sourceCard || typeof sourceCard !== 'object') throw new Error('sourceCard must be an object.');
    if (!baselineProduct || typeof baselineProduct !== 'object') throw new Error('baselineProduct must be an object.');
    const sourceCode = `TEA-${normalizeCode(sourceCard.meta?.origin_country || 'CN')}-${String(sourceCard.slug || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`;
    const expectedCode = normalizeCode(sourceMetadata.productCode || sourceCode);
    const baselineCode = normalizeCode(baselineProduct.code);
    const metadata = {
        ...sourceMetadata,
        sourceSha256: sourceMetadata.sourceSha256 || null,
        sourceRevision: sourceRevision(sourceCard, sourceMetadata),
    };
    if (!baselineCode || baselineCode !== expectedCode) {
        return {
            schemaVersion: 1,
            eligible: false,
            status: 'review-required',
            productCode: expectedCode,
            source: {
                externalId: sourceCard.slug || null,
                articleUrl: sourceUrl(sourceCard, metadata),
                revision: metadata.sourceRevision,
                sourceSha256: metadata.sourceSha256,
                sourceManifestSha256: metadata.sourceManifestSha256 || null,
                fieldPackSha256: metadata.fieldPackSha256 || null,
            },
            proposals: [],
            reviewQueue: [{
                path: 'product.code',
                action: 'review',
                reason: 'exact-product-match-required',
                before: baselineProduct.code || null,
                after: expectedCode,
                evidence: evidence(sourceCard, metadata, '/slug', sourceCard.slug),
            }],
            desiredProduct: clone(baselineProduct),
            reconciliation: null,
        };
    }

    let transformed;
    try {
        transformed = transformCardSet(
            { [sourceCard.lang || 'en']: sourceCard },
            {
                catalog: sourceMetadata.catalog || 'CATALOG-CHINESE-TEA',
                knownCategories: new Set(),
                inferCatalogTaxonomy: false,
            });
    } catch (error) {
        const reason = /conflicting entries for discriminator '([^']+)'/.test(error.message)
            ? 'conflicting-repeated-source-value'
            : 'source-transform-error';
        const match = error.message.match(/discriminator '([^']+)'/);
        const label = error.message.match(/^(recipe|harvest|sensory) contains conflicting entries/iu)?.[1]?.toLowerCase();
        const discriminator = match?.[1];
        const sourceEntries = label === 'recipe'
            ? sourceCard.recipe || []
            : label === 'harvest'
                ? sourceCard.harvest || []
                : label === 'sensory'
                    ? sourceCard.sensory || []
                    : [];
        const sourceIndex = sourceEntries.findIndex(item => String(
            label === 'sensory' ? item?.descriptor_id || item?.descriptor : item?.style || item?.phase || '',
        ).trim() === String(discriminator || '').trim());
        const pointer = sourceIndex >= 0 ? `/${label}/${sourceIndex}` : '/';
        return {
            schemaVersion: 1,
            eligible: false,
            status: 'review-required',
            productCode: expectedCode,
            source: {
                externalId: sourceCard.slug || null,
                articleUrl: sourceUrl(sourceCard, metadata),
                revision: metadata.sourceRevision,
                sourceSha256: metadata.sourceSha256,
                sourceManifestSha256: metadata.sourceManifestSha256 || null,
                fieldPackSha256: metadata.fieldPackSha256 || null,
            },
            proposals: [],
            reviewQueue: [{
                path: 'source',
                action: 'review',
                reason,
                detail: error.message,
                before: null,
                after: null,
                evidence: evidence(sourceCard, metadata, pointer, pointerValue(sourceCard, pointer) || sourceCard),
            }],
            desiredProduct: clone(baselineProduct),
            reconciliation: null,
        };
    }

    const merged = mergeFillMissingProduct(baselineProduct, transformed.product, sourceCard, metadata);
    const reconciliation = buildReconciliation([merged.desired], [baselineProduct]);
    return {
        schemaVersion: 1,
        eligible: merged.reviewQueue.length === 0 && reconciliation.eligible,
        status: merged.reviewQueue.length ? 'review-required' : 'ready-for-review',
        productCode: expectedCode,
        source: {
            externalId: sourceCard.slug || null,
            articleUrl: sourceUrl(sourceCard, metadata),
            revision: metadata.sourceRevision,
            sourceSha256: metadata.sourceSha256,
            sourceManifestSha256: metadata.sourceManifestSha256 || null,
            fieldPackSha256: metadata.fieldPackSha256 || null,
        },
        proposals: merged.proposals,
        reviewQueue: merged.reviewQueue,
        desiredProduct: merged.desired,
        reconciliation,
    };
}

function assertFreshInputs(proposal, { sourcePath, sourceManifestPath, fieldPackPath, baselinePath } = {}) {
    const errors = [];
    if (sourcePath && proposal?.source?.sourceSha256) {
        const actual = hashInputPath(sourcePath);
        if (actual !== proposal.source.sourceSha256) errors.push('source hash changed since proposal preparation');
    }
    if (sourceManifestPath && proposal?.source?.sourceManifestSha256) {
        const actual = hashInputPath(sourceManifestPath);
        if (actual !== proposal.source.sourceManifestSha256) errors.push('source manifest hash changed since proposal preparation');
    }
    if (fieldPackPath && proposal?.source?.fieldPackSha256) {
        const actual = hashInputPath(fieldPackPath);
        if (actual !== proposal.source.fieldPackSha256) errors.push('field-pack hash changed since proposal preparation');
    }
    if (baselinePath && proposal?.inputs?.baselineSha256) {
        const actual = hashInputPath(baselinePath);
        if (actual !== proposal.inputs.baselineSha256) errors.push('baseline hash changed since proposal preparation');
    }
    if (errors.length) throw new Error(`Stale source-backed proposal: ${errors.join('; ')}.`);
    return true;
}

module.exports = {
    assertFreshInputs,
    buildSourceBackedProposal,
    candidateSourceIndex,
    hashFile,
    hasValue,
    isRangeTruncated,
    sameSpecification,
    sourceRevision,
};
