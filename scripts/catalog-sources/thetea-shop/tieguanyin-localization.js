'use strict';

const fs = require('fs');
const { sha256, stableJson, writeJsonAtomic } = require('../lib/artifacts');
const { normalizeState } = require('./tieguanyin-importer');

const PLAN_SCHEMA = 'thetea-shop-tieguanyin-grade-localization-plan-v1';
const RECEIPT_SCHEMA = 'thetea-shop-tieguanyin-grade-localization-receipt-v1';
const ROLLBACK_SCHEMA = 'thetea-shop-tieguanyin-grade-localization-rollback-v1';
const TARGET_LANGUAGES = ['ru-RU', 'en-US'];
const ALL_LANGUAGES = [...TARGET_LANGUAGES, 'zh-CN'];

function id(value, ...keys) {
    for (const key of keys) {
        const candidate = typeof value?.[key] === 'string'
            ? value[key]
            : value?.[key]?.value;
        if (candidate) return candidate;
    }
    return '';
}

function text(value) {
    return String(value || '').trim();
}

function optionTranslations(option) {
    return new Map((option?.translations || []).map(translation => [
        String(translation.languageCode || translation.language_code || '').trim(),
        String(translation.name || '').trim(),
    ]));
}

function sourceLabel(value) {
    return text(value?.customValue);
}

function validateTranslations(translations) {
    if (!translations || typeof translations !== 'object') {
        throw new Error('TGY_LOCALIZATION_TRANSLATIONS_REQUIRED');
    }
    for (const [label, values] of Object.entries(translations)) {
        for (const language of TARGET_LANGUAGES) {
            if (!text(values?.[language])) {
                throw new Error(`TGY_LOCALIZATION_TRANSLATION_MISSING: ${label}:${language}`);
            }
        }
    }
}

function findOption(options, value) {
    const optionId = id(value, 'productAttributeOptionId');
    if (optionId) {
        const current = options.find(option => id(option, 'id') === optionId);
        if (current) return current;
    }
    const label = sourceLabel(value);
    return options.find(option => optionTranslations(option).get('zh-CN') === label) || null;
}

function needsUpdate(option, translations) {
    if (!option) return true;
    const current = optionTranslations(option);
    return ALL_LANGUAGES.some(language => current.get(language) !== translations[language]);
}

function buildGradeLocalizationPlan(manifest, rawState, translations) {
    validateTranslations(translations);
    const state = normalizeState(manifest, rawState);
    const options = Array.isArray(rawState.productAttributeOptions)
        ? rawState.productAttributeOptions.filter(option =>
            !option.isDeleted && id(option, 'productAttributeId') === state.productAttributeId)
        : [];
    const values = state.gradeValues.filter(value => sourceLabel(value));
    const rows = values.map((value, index) => {
        const label = sourceLabel(value);
        const option = findOption(options, value);
        const localized = translations[label];
        if (!localized) {
            throw new Error(`TGY_LOCALIZATION_TRANSLATION_MISSING: ${label}`);
        }
        return {
            sourceOrder: index + 1,
            sourceLabel: label,
            operation: option
                ? (needsUpdate(option, { ...localized, 'zh-CN': label }) ? 'update' : 'present')
                : 'create',
            languages: ALL_LANGUAGES,
        };
    });
    const plan = {
        schemaVersion: PLAN_SCHEMA,
        mode: 'dry-run',
        target: {
            productCode: manifest.target.productCode,
            catalogCode: manifest.target.catalogCode,
        },
        gradeValueCount: rows.length,
        counts: {
            createOptionCount: rows.filter(row => row.operation === 'create').length,
            updateOptionCount: rows.filter(row => row.operation === 'update').length,
            rebindValueCount: rows.filter(row => row.operation !== 'present').length,
            alreadyLocalizedCount: rows.filter(row => row.operation === 'present').length,
        },
        rows,
    };
    plan.planSha256 = sha256(stableJson(plan));
    return plan;
}

function valuePayload(value, optionId) {
    const payload = {
        id: { value: id(value, 'id', 'productVariantAttributeValueId') },
        productVariantAttributeId: { value: id(value, 'productVariantAttributeId') },
        customValue: sourceLabel(value),
        priceAdjustment: Number(value.priceAdjustment || 0),
        quantity: Number(value.quantity || 1),
        isPreselected: Boolean(value.isPreselected),
    };
    if (optionId) payload.productAttributeOptionId = { value: optionId };
    return payload;
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

function optionInput(translations) {
    return {
        'ru-RU': translations['ru-RU'],
        'en-US': translations['en-US'],
        'zh-CN': translations['zh-CN'],
    };
}

async function applyGradeLocalization(client, manifest, rawState, translations, rollbackFile) {
    const plan = buildGradeLocalizationPlan(manifest, rawState, translations);
    const state = normalizeState(manifest, rawState);
    const options = Array.isArray(rawState.productAttributeOptions)
        ? rawState.productAttributeOptions.filter(option =>
            !option.isDeleted && id(option, 'productAttributeId') === state.productAttributeId)
        : [];
    const rollback = {
        schemaVersion: ROLLBACK_SCHEMA,
        complete: false,
        target: plan.target,
        originalValues: state.gradeValues.map(value => valuePayload(value, id(value, 'productAttributeOptionId'))),
        createdOptionIds: [],
    };
    writePrivate(rollbackFile, rollback);

    const optionIdByLabel = new Map();
    for (const [index, value] of state.gradeValues.entries()) {
        const label = sourceLabel(value);
        if (!label) continue;
        const localized = translations[label];
        const existing = findOption(options, value);
        let option = existing;
        if (!option) {
            option = await client.createProductAttributeOption(
                state.productAttributeId,
                optionInput({ ...localized, 'zh-CN': label }),
                index,
            );
            const optionId = id(option, 'id');
            if (!optionId) throw new Error(`TGY_LOCALIZATION_OPTION_ID_MISSING: ${label}`);
            rollback.createdOptionIds.push(optionId);
            writePrivate(rollbackFile, rollback);
        } else if (needsUpdate(option, { ...localized, 'zh-CN': label })) {
            option = await client.updateProductAttributeOption(
                id(option, 'id'),
                state.productAttributeId,
                optionInput({ ...localized, 'zh-CN': label }),
                Number(option.displayOrder || index),
                Number(option.priceAdjustment || 0),
                Number(option.weightAdjustment || 0),
                Boolean(option.isPreselected),
            );
        }
        optionIdByLabel.set(label, id(option, 'id'));
    }

    const values = state.gradeValues.map(value => valuePayload(
        value,
        optionIdByLabel.get(sourceLabel(value)) || id(value, 'productAttributeOptionId'),
    ));
    await client.updateGradeValues(state.gradeAttributeId, values);
    const readBack = await client.fetchState(manifest.target.productCode, manifest.target.catalogCode);
    const readBackState = normalizeState(manifest, readBack);
    const readBackOptions = Array.isArray(readBack.productAttributeOptions)
        ? readBack.productAttributeOptions
        : [];
    const readBackOptionIds = new Set(readBackOptions.map(option => id(option, 'id')));
    for (const value of readBackState.gradeValues) {
        const optionId = id(value, 'productAttributeOptionId');
        if (!optionId || !readBackOptionIds.has(optionId)) {
            throw new Error(`TGY_LOCALIZATION_READ_BACK_MISSING: ${sourceLabel(value)}`);
        }
    }

    rollback.complete = true;
    writePrivate(rollbackFile, rollback);
    const receipt = {
        schemaVersion: RECEIPT_SCHEMA,
        complete: true,
        planSha256: plan.planSha256,
        mutationCounts: {
            optionsCreated: rollback.createdOptionIds.length,
            optionsUpdated: plan.counts.updateOptionCount,
            valuesRebound: plan.counts.rebindValueCount,
        },
        readBackVerified: true,
        rollbackMode: 'restore-values-and-soft-delete-created-options',
    };
    return { plan, receipt };
}

async function rollbackGradeLocalization(client, rollback) {
    if (!rollback || rollback.schemaVersion !== ROLLBACK_SCHEMA) {
        throw new Error('TGY_LOCALIZATION_ROLLBACK_MANIFEST_INVALID');
    }
    const attributeId = rollback.originalValues[0]?.productVariantAttributeId?.value;
    if (!attributeId) throw new Error('TGY_LOCALIZATION_ROLLBACK_ATTRIBUTE_MISSING');
    await client.updateGradeValues(attributeId, rollback.originalValues);
    for (const optionId of rollback.createdOptionIds || []) {
        await client.deleteProductAttributeOption(optionId);
    }
    return {
        restoredValueCount: rollback.originalValues.length,
        deletedOptionCount: (rollback.createdOptionIds || []).length,
    };
}

module.exports = {
    PLAN_SCHEMA,
    RECEIPT_SCHEMA,
    ROLLBACK_SCHEMA,
    buildGradeLocalizationPlan,
    applyGradeLocalization,
    rollbackGradeLocalization,
};
