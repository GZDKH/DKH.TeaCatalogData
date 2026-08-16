'use strict';

const fs = require('fs');
const path = require('path');
const {
    EXPECTED_CATALOG_CODE,
    EXPECTED_PRODUCT_CODE,
    buildPlan,
    buildReceipt,
    guidValue,
    normalizeState,
} = require('./tieguanyin-importer');
const { writeJsonAtomic } = require('../lib/artifacts');

const ROLLBACK_SCHEMA = 'thetea-shop-tieguanyin-rollback-v1';

function id(item, ...keys) {
    for (const key of keys) {
        const value = guidValue(item?.[key]);
        if (value) return value;
    }
    return '';
}

function valuePayload(value) {
    const payload = {};
    const valueId = id(value, 'id', 'productVariantAttributeValueId');
    if (valueId) payload.id = { value: valueId };
    const attributeId = id(value, 'productVariantAttributeId');
    if (attributeId) payload.productVariantAttributeId = { value: attributeId };
    const optionId = id(value, 'productAttributeOptionId');
    if (optionId) payload.productAttributeOptionId = { value: optionId };
    if (value.customValue !== undefined && value.customValue !== null) {
        payload.customValue = String(value.customValue);
    }
    if (value.priceAdjustment !== undefined && value.priceAdjustment !== null) {
        payload.priceAdjustment = Number(value.priceAdjustment);
    }
    if (value.quantity !== undefined && value.quantity !== null) {
        payload.quantity = Number(value.quantity);
    }
    if (value.isPreselected !== undefined && value.isPreselected !== null) {
        payload.isPreselected = Boolean(value.isPreselected);
    }
    return payload;
}

function sourcePolicyInput(sourcePolicy) {
    const result = { policyKind: String(sourcePolicy.policyKind) };
    for (const key of [
        'lockedOfferRevisionId',
        'lockedOriginSiteId',
        'lockedReleaseId',
        'equivalenceSetRevisionId',
    ]) {
        const value = id(sourcePolicy, key);
        if (value) result[key] = { value };
    }
    return result;
}

function combinationByLabel(state, label) {
    const value = state.gradeValues.find(item => String(item.customValue || '').trim() === label);
    const valueId = id(value, 'id', 'productVariantAttributeValueId');
    if (!valueId) throw new Error(`TGY_IMPORT_GRADE_VALUE_READ_BACK_MISSING: ${label}`);
    const matches = state.combinations.filter(item => {
        const ids = Array.isArray(item.attributeValueIds)
            ? item.attributeValueIds.map(guidValue)
            : [];
        return ids.length === 1 && ids[0] === valueId;
    });
    if (matches.length !== 1) {
        throw new Error(`TGY_IMPORT_COMBINATION_NOT_EXACT: ${label}`);
    }
    return matches[0];
}

function assertExistingCandidateSafe(candidate, sellable, combination, state) {
    if (!sellable) return;
    const expected = {
        productId: state.productId,
        variantCombinationId: id(combination, 'id'),
        packageId: id(state.baselineSellable, 'packageId'),
        unitId: id(state.baselineSellable, 'unitId'),
        unitQuantity: 500,
        referenceUnitKind: String(state.baselineSellable.referenceUnitKind),
    };
    const actual = {
        productId: id(sellable, 'productId'),
        variantCombinationId: id(sellable, 'variantCombinationId'),
        packageId: id(sellable, 'packageId'),
        unitId: id(sellable, 'unitId'),
        unitQuantity: Number(sellable.unitQuantity?.units ?? sellable.unitQuantity),
        referenceUnitKind: String(sellable.referenceUnitKind),
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`TGY_IMPORT_SELLABLE_IDENTITY_CONFLICT: ${candidate.sellableInternalCode}`);
    }
    const lifecycle = String(sellable.lifecycleState).toLowerCase();
    if (!['draft', 'active'].includes(lifecycle)) {
        throw new Error(`TGY_IMPORT_EXISTING_SELLABLE_NOT_RECOVERABLE: ${candidate.sellableInternalCode}`);
    }
}

function writePrivate(file, value) {
    const previous = process.umask(0o077);
    try {
        writeJsonAtomic(file, value);
        fs.chmodSync(file, 0o600);
    } finally {
        process.umask(previous);
    }
}

async function applyImport(client, manifest, initialRawState, rollbackFile) {
    const initialPlan = buildPlan(manifest, initialRawState);
    const initial = normalizeState(manifest, initialRawState);
    const rollback = {
        schemaVersion: ROLLBACK_SCHEMA,
        complete: false,
        productCode: EXPECTED_PRODUCT_CODE,
        catalogCode: EXPECTED_CATALOG_CODE,
        createdSellables: [],
        publicationRestores: [],
        createdPlacements: [],
    };
    writePrivate(rollbackFile, rollback);

    const missingLabels = initialPlan.rows
        .filter(row => row.gradeValueStatus === 'create')
        .map(row => row.gradeLabel);
    if (missingLabels.length > 0) {
        const values = [
            ...initial.gradeValues.map(valuePayload),
            ...missingLabels.map(label => ({
                customValue: label,
                priceAdjustment: 0,
                isPreselected: false,
            })),
        ];
        await client.updateGradeValues(initial.gradeAttributeId, values);
    }

    let combinationsCreated = 0;
    if (initialPlan.counts.generateCombinationCount > 0) {
        const generated = await client.generateCombinations(
            initial.productId,
            initial.productAttributeId,
        );
        combinationsCreated = Number(generated?.createdCount || 0);
    }

    let rawState = await client.fetchState(EXPECTED_PRODUCT_CODE, EXPECTED_CATALOG_CODE);
    let state = normalizeState(manifest, rawState);
    const sellablesByCode = new Map(
        state.sellables.map(item => [String(item.internalCode || ''), item]),
    );
    let sellablesActivated = 0;
    let publicationEligibilityEnabled = 0;
    for (const candidate of manifest.exactCandidates) {
        const combination = combinationByLabel(state, candidate.gradeLabel);
        let sellable = sellablesByCode.get(candidate.sellableInternalCode);
        assertExistingCandidateSafe(candidate, sellable, combination, state);
        if (!sellable) {
            sellable = await client.createSellable({
                productId: { value: state.productId },
                variantCombinationId: { value: id(combination, 'id') },
                packageId: { value: id(state.baselineSellable, 'packageId') },
                unitQuantity: { units: '500', nanos: 0 },
                unitId: { value: id(state.baselineSellable, 'unitId') },
                unitAuthorityVersion: Number(state.baselineSellable.unitAuthorityVersion),
                internalCode: candidate.sellableInternalCode,
                publicationEligible: false,
                referenceUnitKind: String(state.baselineSellable.referenceUnitKind),
            });
            rollback.createdSellables.push({
                sellableUnitId: id(sellable, 'sellableUnitId'),
                authorityVersion: Number(sellable.authorityVersion),
            });
            writePrivate(rollbackFile, rollback);
        }
        let changed = false;
        if (String(sellable.lifecycleState).toLowerCase() !== 'active') {
            sellable = await client.activateSellable(
                id(sellable, 'sellableUnitId'),
                Number(sellable.authorityVersion),
            );
            sellablesActivated++;
            changed = true;
        }
        if (sellable.publicationEligible !== true) {
            rollback.publicationRestores.push({
                sellableUnitId: id(sellable, 'sellableUnitId'),
                authorityVersion: Number(sellable.authorityVersion) + 1,
            });
            writePrivate(rollbackFile, rollback);
            sellable = await client.setPublicationEligibility(
                id(sellable, 'sellableUnitId'),
                true,
                Number(sellable.authorityVersion),
            );
            rollback.publicationRestores[rollback.publicationRestores.length - 1].authorityVersion =
                Number(sellable.authorityVersion);
            writePrivate(rollbackFile, rollback);
            publicationEligibilityEnabled++;
            changed = true;
        }
        if (changed) {
            const created = rollback.createdSellables.find(
                item => item.sellableUnitId === id(sellable, 'sellableUnitId'),
            );
            if (created) created.authorityVersion = Number(sellable.authorityVersion);
            writePrivate(rollbackFile, rollback);
        }
    }

    rawState = await client.fetchState(EXPECTED_PRODUCT_CODE, EXPECTED_CATALOG_CODE);
    state = normalizeState(manifest, rawState);
    const placementsBySellableId = new Map(
        state.placements.map(item => [id(item, 'sellableUnitId'), item]),
    );
    const currentSellablesByCode = new Map(
        state.sellables.map(item => [String(item.internalCode || ''), item]),
    );
    const curateItems = [];
    for (let index = 0; index < manifest.exactCandidates.length; index++) {
        const candidate = manifest.exactCandidates[index];
        const sellable = currentSellablesByCode.get(candidate.sellableInternalCode);
        if (!sellable) throw new Error('TGY_IMPORT_SELLABLE_READ_BACK_MISSING');
        const placement = placementsBySellableId.get(id(sellable, 'sellableUnitId'));
        if (!placement) {
            curateItems.push({
                sellableUnitId: { value: id(sellable, 'sellableUnitId') },
                sourcePolicy: sourcePolicyInput(state.sourcePolicy),
                presentationMode: 'Grouped',
                displayOrder: 1000 + index,
                isVisible: true,
                expectedAuthorityVersion: '0',
            });
        }
    }
    if (curateItems.length > 0) {
        const result = await client.curate(state.catalogId, curateItems);
        for (const item of result.results || []) {
            if (!id(item, 'catalogSellableId')) continue;
            if (String(item.status).endsWith('_FAILED')) continue;
            rollback.createdPlacements.push({
                catalogSellableId: id(item, 'catalogSellableId'),
                authorityVersion: 1,
            });
        }
        writePrivate(rollbackFile, rollback);
        if (Number(result.failedCount || 0) !== 0 ||
            (result.results || []).some(item => String(item.status).endsWith('_FAILED'))) {
            throw new Error('TGY_IMPORT_CURATION_BATCH_FAILED');
        }
    }

    const readBackRaw = await client.fetchState(EXPECTED_PRODUCT_CODE, EXPECTED_CATALOG_CODE);
    const readBackPlan = buildPlan(manifest, readBackRaw);
    const readBackState = normalizeState(manifest, readBackRaw);
    const finalPlacements = new Map(
        readBackState.placements.map(item => [id(item, 'catalogSellableId'), item]),
    );
    const finalSellables = new Map(
        readBackState.sellables.map(item => [id(item, 'sellableUnitId'), item]),
    );
    rollback.createdPlacements = rollback.createdPlacements.map(item => ({
        ...item,
        authorityVersion: Number(finalPlacements.get(item.catalogSellableId)?.authorityVersion || item.authorityVersion),
    }));
    rollback.createdSellables = rollback.createdSellables.map(item => ({
        ...item,
        authorityVersion: Number(finalSellables.get(item.sellableUnitId)?.authorityVersion || item.authorityVersion),
    }));
    rollback.publicationRestores = rollback.publicationRestores.map(item => ({
        ...item,
        authorityVersion: Number(finalSellables.get(item.sellableUnitId)?.authorityVersion || item.authorityVersion),
    }));
    rollback.complete = true;
    writePrivate(rollbackFile, rollback);

    return {
        plan: initialPlan,
        receipt: buildReceipt(initialPlan, readBackPlan, {
            gradeValuesCreated: missingLabels.length,
            combinationsCreated,
            sellablesCreated: rollback.createdSellables.length,
            sellablesActivated,
            publicationEligibilityEnabled,
            placementsCurated: rollback.createdPlacements.length,
        }),
    };
}

async function rollbackImport(client, rollback) {
    if (rollback?.schemaVersion !== ROLLBACK_SCHEMA ||
        !Array.isArray(rollback.createdPlacements) ||
        !Array.isArray(rollback.createdSellables) ||
        !Array.isArray(rollback.publicationRestores)) {
        throw new Error('TGY_IMPORT_ROLLBACK_MANIFEST_INVALID');
    }
    const failures = [];
    let placementsRemoved = 0;
    let sellablesDisabled = 0;
    for (const placement of [...rollback.createdPlacements].reverse()) {
        try {
            await client.removePlacement(placement.catalogSellableId, placement.authorityVersion);
            placementsRemoved++;
        } catch {
            failures.push('placement');
        }
    }
    for (const sellable of [...rollback.publicationRestores].reverse()) {
        try {
            await client.setPublicationEligibility(
                sellable.sellableUnitId,
                false,
                sellable.authorityVersion,
            );
            sellablesDisabled++;
        } catch {
            failures.push('sellable');
        }
    }
    if (failures.length > 0) {
        throw new Error(`TGY_IMPORT_ROLLBACK_INCOMPLETE: ${failures.length} operation(s)`);
    }
    return {
        complete: true,
        placementCount: placementsRemoved,
        sellableCount: sellablesDisabled,
    };
}

module.exports = {
    ROLLBACK_SCHEMA,
    applyImport,
    rollbackImport,
    sourcePolicyInput,
    valuePayload,
};
