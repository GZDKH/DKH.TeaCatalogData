'use strict';

const { sha256, stableJson } = require('../lib/artifacts');

const PLAN_SCHEMA = 'thetea-shop-tieguanyin-import-plan-v1';
const RECEIPT_SCHEMA = 'thetea-shop-tieguanyin-import-receipt-v1';
const EXPECTED_PRODUCT_CODE = 'TEA-CN-TIE-GUANYIN';
const EXPECTED_CATALOG_CODE = 'CATALOG-CHINESE-TEA-SHOP';
const GRADE_PROMPTS = new Set(['grade', 'tier', '等级', '等级/级别']);

function fail(code, detail = '') {
    const error = new Error(detail ? `${code}: ${detail}` : code);
    error.code = code;
    throw error;
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function text(value) {
    return String(value || '').trim();
}

function guidValue(value) {
    return typeof value === 'string' ? value : value?.value;
}

function decimalNumber(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number(value);
    const units = Number(value.units || 0);
    const nanos = Number(value.nanos || 0);
    return units + nanos / 1_000_000_000;
}

function exactOne(items, predicate, code) {
    const matches = asArray(items).filter(predicate);
    if (matches.length !== 1) fail(code, `expected 1, found ${matches.length}`);
    return matches[0];
}

function itemId(item, ...keys) {
    for (const key of keys) {
        const value = guidValue(item?.[key]);
        if (value) return value;
    }
    return '';
}

function normalizeState(manifest, raw) {
    if (manifest?.target?.productCode !== EXPECTED_PRODUCT_CODE ||
        manifest?.target?.catalogCode !== EXPECTED_CATALOG_CODE) {
        fail('TGY_IMPORT_TARGET_INVALID');
    }

    const product = exactOne(
        raw.products,
        item => text(item.code).toUpperCase() === EXPECTED_PRODUCT_CODE,
        'TGY_IMPORT_PRODUCT_NOT_EXACT',
    );
    const catalog = exactOne(
        raw.catalogs,
        item => text(item.code).toUpperCase() === EXPECTED_CATALOG_CODE,
        'TGY_IMPORT_CATALOG_NOT_EXACT',
    );
    const productId = itemId(product, 'id', 'productId');
    const catalogId = itemId(catalog, 'id', 'catalogId');
    if (!productId || !catalogId) fail('TGY_IMPORT_TARGET_ID_MISSING');

    const attributes = asArray(raw.variantAttributes).filter(
        item => itemId(item, 'productId') === productId && !item.isDeleted,
    );
    const gradeAttribute = exactOne(
        attributes,
        item => {
            const prompt = text(item.textPrompt).toLowerCase();
            const values = asArray(item.values);
            return GRADE_PROMPTS.has(prompt) ||
                values.some(value => text(value.customValue).toLowerCase() === 'everyday');
        },
        'TGY_IMPORT_GRADE_AXIS_NOT_EXACT',
    );
    const gradeAttributeId = itemId(gradeAttribute, 'id', 'productVariantAttributeId');
    const productAttributeId = itemId(gradeAttribute, 'productAttributeId');
    if (!gradeAttributeId || !productAttributeId) fail('TGY_IMPORT_GRADE_AXIS_ID_MISSING');

    const values = asArray(gradeAttribute.values).filter(item => !item.isDeleted);
    const duplicateLabels = new Set();
    const labels = new Set();
    for (const value of values) {
        const label = text(value.customValue);
        if (!label) continue;
        if (labels.has(label)) duplicateLabels.add(label);
        labels.add(label);
    }
    if (duplicateLabels.size > 0) fail('TGY_IMPORT_DUPLICATE_GRADE_VALUES');

    const sellables = asArray(raw.sellables).filter(
        item => itemId(item, 'productId') === productId,
    );
    const baselineSellable = exactOne(
        sellables,
        item => text(item.lifecycleState).toLowerCase() === 'active' &&
            decimalNumber(item.unitQuantity) === 50 &&
            Boolean(itemId(item, 'packageId')) &&
            Boolean(itemId(item, 'unitId')) &&
            Number(item.unitAuthorityVersion) > 0,
        'TGY_IMPORT_BASELINE_SELLABLE_NOT_EXACT',
    );

    const baselinePlacement = exactOne(
        asArray(raw.placementDetails),
        item => itemId(item?.placement, 'catalogId') === catalogId &&
            itemId(item?.placement, 'sellableUnitId') ===
                itemId(baselineSellable, 'sellableUnitId', 'id'),
        'TGY_IMPORT_BASELINE_PLACEMENT_NOT_EXACT',
    );
    const sourcePolicy = baselinePlacement.sourcePolicy;
    if (!text(sourcePolicy?.policyKind)) fail('TGY_IMPORT_SOURCE_POLICY_MISSING');

    return {
        product,
        catalog,
        productId,
        catalogId,
        gradeAttribute,
        gradeAttributeId,
        productAttributeId,
        gradeValues: values,
        combinations: asArray(raw.combinations),
        sellables,
        placements: asArray(raw.placements),
        baselineSellable,
        sourcePolicy,
    };
}

function buildPlan(manifest, rawState) {
    const state = normalizeState(manifest, rawState);
    const candidates = asArray(manifest.exactCandidates);
    if (candidates.length !== 25 ||
        candidates.some(item => item.productCode !== EXPECTED_PRODUCT_CODE ||
            item.catalogCode !== EXPECTED_CATALOG_CODE ||
            item.package?.quantity !== '500' ||
            item.package?.unitCode !== 'g' ||
            item.publicationMode !== 'request-only')) {
        fail('TGY_IMPORT_MANIFEST_SCOPE_INVALID');
    }

    const valuesByLabel = new Map(
        state.gradeValues
            .filter(value => text(value.customValue))
            .map(value => [text(value.customValue), value]),
    );
    const sellablesByCode = new Map(
        state.sellables
            .filter(item => text(item.internalCode))
            .map(item => [text(item.internalCode), item]),
    );
    const placementsBySellable = new Map(
        state.placements.map(item => [itemId(item, 'sellableUnitId'), item]),
    );
    const placementDetailsById = new Map(
        asArray(rawState.placementDetails).map(item => [
            itemId(item?.placement, 'catalogSellableId'),
            item,
        ]),
    );

    const rows = candidates.map((candidate, index) => {
        const value = valuesByLabel.get(candidate.gradeLabel) || null;
        const valueId = itemId(value, 'id', 'productVariantAttributeValueId');
        const combination = valueId
            ? state.combinations.find(item => {
                const ids = asArray(item.attributeValueIds).map(guidValue);
                return ids.length === 1 && ids[0] === valueId;
            }) || null
            : null;
        const sellable = sellablesByCode.get(candidate.sellableInternalCode) || null;
        if (sellable && itemId(sellable, 'productId') !== state.productId) {
            fail('TGY_IMPORT_SELLABLE_CODE_COLLISION');
        }
        const placement = sellable
            ? placementsBySellable.get(itemId(sellable, 'sellableUnitId', 'id')) || null
            : null;
        if (placement) {
            const placementDetail = placementDetailsById.get(
                itemId(placement, 'catalogSellableId'),
            );
            if (placement.isVisible !== true ||
                text(placement.presentationMode).toLowerCase() !== 'grouped' ||
                !placementDetail ||
                text(placementDetail.sourcePolicy?.policyDigest) !==
                    text(state.sourcePolicy.policyDigest)) {
                fail('TGY_IMPORT_EXISTING_PLACEMENT_CONFLICT');
            }
        }
        return {
            sourceOrder: index + 1,
            gradeLabel: candidate.gradeLabel,
            gradeValueCode: candidate.gradeValueCode,
            sellableInternalCode: candidate.sellableInternalCode,
            gradeValueStatus: value ? 'present' : 'create',
            combinationStatus: combination ? 'present' : 'generate',
            sellableStatus: sellable ? 'present' : 'create',
            activationStatus: sellable && text(sellable.lifecycleState).toLowerCase() === 'active'
                ? 'present'
                : 'activate',
            publicationStatus: sellable?.publicationEligible === true ? 'present' : 'enable',
            placementStatus: placement ? 'present' : 'curate',
        };
    });

    const counts = {
        candidateCount: rows.length,
        createGradeValueCount: rows.filter(row => row.gradeValueStatus === 'create').length,
        generateCombinationCount: rows.filter(row => row.combinationStatus === 'generate').length,
        createSellableCount: rows.filter(row => row.sellableStatus === 'create').length,
        activateSellableCount: rows.filter(row => row.activationStatus === 'activate').length,
        enablePublicationCount: rows.filter(row => row.publicationStatus === 'enable').length,
        curatePlacementCount: rows.filter(row => row.placementStatus === 'curate').length,
    };
    const binding = {
        manifestSha256: manifest.manifestSha256,
        productCode: EXPECTED_PRODUCT_CODE,
        catalogCode: EXPECTED_CATALOG_CODE,
        sourcePolicyKind: text(state.sourcePolicy.policyKind),
        baselineReferenceUnitKind: text(state.baselineSellable.referenceUnitKind),
        baselineUnitQuantity: decimalNumber(state.baselineSellable.unitQuantity),
        targetUnitQuantity: 500,
        rows,
        counts,
    };
    return {
        schemaVersion: PLAN_SCHEMA,
        mode: 'dry-run',
        complete: true,
        networkReadsPerformed: true,
        remoteMutationAttempted: false,
        ...binding,
        planSha256: sha256(stableJson(binding)),
    };
}

function buildReceipt(plan, readBackPlan, mutationCounts) {
    if (readBackPlan.counts.createGradeValueCount !== 0 ||
        readBackPlan.counts.generateCombinationCount !== 0 ||
        readBackPlan.counts.createSellableCount !== 0 ||
        readBackPlan.counts.activateSellableCount !== 0 ||
        readBackPlan.counts.enablePublicationCount !== 0 ||
        readBackPlan.counts.curatePlacementCount !== 0) {
        fail('TGY_IMPORT_READ_BACK_INCOMPLETE');
    }
    const binding = {
        planSha256: plan.planSha256,
        manifestSha256: plan.manifestSha256,
        productCode: plan.productCode,
        catalogCode: plan.catalogCode,
        candidateCount: plan.counts.candidateCount,
        mutationCounts,
        readBackPlanSha256: readBackPlan.planSha256,
        rollbackMode: 'remove-placement-and-disable-publication',
    };
    return {
        schemaVersion: RECEIPT_SCHEMA,
        complete: true,
        readBackVerified: true,
        noRetailPricePublished: true,
        noStockClaimPublished: true,
        ...binding,
        receiptSha256: sha256(stableJson(binding)),
    };
}

module.exports = {
    EXPECTED_CATALOG_CODE,
    EXPECTED_PRODUCT_CODE,
    PLAN_SCHEMA,
    RECEIPT_SCHEMA,
    buildPlan,
    buildReceipt,
    decimalNumber,
    guidValue,
    normalizeState,
};
