#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeTieguanyinSnapshot } = require('./thetea-shop/tieguanyin-normalizer');
const {
    applyGradeLocalization,
    buildGradeLocalizationPlan,
    rollbackGradeLocalization,
} = require('./thetea-shop/tieguanyin-localization');
const { TieguanyinProductionClient } = require('./thetea-shop/tieguanyin-production-client');

const ROOT = path.resolve(__dirname, '../..');
const fixture = JSON.parse(fs.readFileSync(path.join(
    ROOT,
    'scripts/catalog-sources/thetea-shop/fixtures/tieguanyin-price-base-2026-08-01.json',
), 'utf8'));
const manifest = normalizeTieguanyinSnapshot(fixture);
const translations = {
    Everyday: { 'ru-RU': 'Повседневный', 'en-US': 'Everyday' },
    铁观音: { 'ru-RU': 'Те Гуаньинь', 'en-US': 'Tieguanyin' },
};

function id(number) {
    return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
}

function createState() {
    const values = [
        { id: id(10), productVariantAttributeId: id(3), customValue: 'Everyday', isDeleted: false },
        { id: id(11), productVariantAttributeId: id(3), customValue: '铁观音', isDeleted: false },
    ];
    const sellable = {
        sellableUnitId: id(30),
        productId: id(1),
        variantCombinationId: id(20),
        packageId: id(40),
        unitQuantity: { units: '50', nanos: 0 },
        unitId: id(50),
        unitAuthorityVersion: 3,
        authorityVersion: 7,
        lifecycleState: 'Active',
        publicationEligible: true,
        internalCode: 'TGY-EVERYDAY-50G',
        referenceUnitKind: 'REFERENCE_UNIT_KIND_WEIGHT',
    };
    const placement = {
        catalogSellableId: id(60),
        catalogId: id(2),
        productId: id(1),
        sellableUnitId: id(30),
        authorityVersion: 4,
        presentationMode: 'Grouped',
        isVisible: true,
    };
    return {
        products: [{ id: id(1), code: 'TEA-CN-TIE-GUANYIN' }],
        catalogs: [{ id: id(2), code: 'CATALOG-CHINESE-TEA-SHOP' }],
        variantAttributes: [{
            id: id(3),
            productId: id(1),
            productAttributeId: id(4),
            textPrompt: 'Grade',
            isDeleted: false,
            values,
        }],
        productAttributeOptions: [],
        combinations: [{ id: id(20), attributeValueIds: [id(10)] }],
        sellables: [sellable],
        placements: [placement],
        placementDetails: [{
            placement,
            sourcePolicy: { policyKind: 'PlatformStock', policyDigest: 'f'.repeat(64) },
            sellableUnit: sellable,
        }],
    };
}

class FakeClient {
    constructor() {
        this.data = createState();
        this.sequence = 700;
    }

    nextId() { return id(this.sequence++); }

    async fetchState() { return structuredClone(this.data); }

    async createProductAttributeOption(attributeId, optionTranslations, displayOrder) {
        const option = {
            id: this.nextId(),
            productAttributeId: attributeId,
            displayOrder,
            translations: Object.entries(optionTranslations).map(([languageCode, name]) => ({
                languageCode,
                name,
            })),
        };
        this.data.productAttributeOptions.push(option);
        return structuredClone(option);
    }

    async updateProductAttributeOption(
        optionId,
        _attributeId,
        optionTranslations,
        displayOrder,
        priceAdjustment,
        weightAdjustment,
        isPreselected,
    ) {
        const option = this.data.productAttributeOptions.find(item => item.id === optionId);
        option.displayOrder = displayOrder;
        option.priceAdjustment = priceAdjustment;
        option.weightAdjustment = weightAdjustment;
        option.isPreselected = isPreselected;
        option.translations = Object.entries(optionTranslations).map(([languageCode, name]) => ({
            languageCode,
            name,
        }));
        return structuredClone(option);
    }

    async updateGradeValues(_attributeId, values) {
        const current = new Map(this.data.variantAttributes[0].values.map(value => [value.id, value]));
        this.data.variantAttributes[0].values = values.map(value => ({
            ...current.get(value.id.value),
            ...value,
            id: value.id.value,
            productVariantAttributeId: value.productVariantAttributeId.value,
            productAttributeOptionId: value.productAttributeOptionId?.value,
        }));
    }

    async deleteProductAttributeOption(optionId) {
        this.data.productAttributeOptions = this.data.productAttributeOptions.filter(
            option => option.id !== optionId,
        );
    }
}

(async () => {
    const pageCalls = [];
    const productionClient = new TieguanyinProductionClient({}, {
        invoke: (_proto, _method, request) => {
            pageCalls.push(request.pagination.page);
            return request.pagination.page === 1
                ? {
                    productAttributeOptions: Array.from({ length: 100 }, (_, index) => ({ id: id(index + 1000) })),
                    metadata: { totalPages: 2 },
                }
                : {
                    productAttributeOptions: [{ id: id(1100) }],
                    metadata: { totalPages: 2 },
                };
        },
    });
    const pagedOptions = await productionClient.fetchProductAttributeOptions(id(4));
    assert.deepEqual(pageCalls, [1, 2]);
    assert.equal(pagedOptions.length, 101);

    const stateClient = new TieguanyinProductionClient({
        async get(pathname) {
            if (pathname.startsWith('/api/v1/products?')) {
                return { items: [{ id: id(1), code: 'TEA-CN-TIE-GUANYIN' }] };
            }
            if (pathname.startsWith('/api/v1/catalogs?')) {
                return { items: [{ id: id(2), code: 'CATALOG-CHINESE-TEA-SHOP' }] };
            }
            return {
                items: [{
                    id: id(3),
                    productId: id(1),
                    productAttributeId: id(4),
                    textPrompt: 'Grade',
                    values: [],
                }],
            };
        },
    }, {
        invoke(_proto, methodName, request) {
            if (methodName.endsWith('/GetProductAttributeOptions')) {
                return { productAttributeOptions: [{ id: id(900) }], metadata: { totalPages: 1 } };
            }
            if (methodName.endsWith('/ListProductVariantCombinations')) {
                return { combinations: [] };
            }
            if (methodName.endsWith('/SearchSellableUnits')) {
                return { items: [] };
            }
            if (methodName.endsWith('/ListCatalogSellables')) {
                return { items: [] };
            }
            if (methodName.endsWith('/BatchGetCatalogSellableAdminDetails')) {
                return { items: [] };
            }
            throw new Error(`unexpected method: ${methodName}`);
        },
    });
    const fetchedState = await stateClient.fetchState(
        'TEA-CN-TIE-GUANYIN',
        'CATALOG-CHINESE-TEA-SHOP',
    );
    assert.equal(fetchedState.productAttributeOptions.length, 1);

    const initial = createState();
    const plan = buildGradeLocalizationPlan(manifest, initial, translations);
    assert.deepEqual(plan.counts, {
        createOptionCount: 2,
        updateOptionCount: 0,
        rebindValueCount: 2,
        alreadyLocalizedCount: 0,
    });
    assert.equal(JSON.stringify(plan).includes(id(1)), false);

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tgy-localization-'));
    const rollbackFile = path.join(directory, 'rollback.json');
    const client = new FakeClient();
    const applied = await applyGradeLocalization(
        client,
        manifest,
        await client.fetchState(),
        translations,
        rollbackFile,
    );
    assert.equal(applied.receipt.complete, true);
    assert.equal(applied.receipt.mutationCounts.optionsCreated, 2);
    assert.equal(applied.receipt.mutationCounts.valuesRebound, 2);
    assert.equal(client.data.variantAttributes[0].values.every(value => value.productAttributeOptionId), true);
    assert.equal(fs.statSync(rollbackFile).mode & 0o777, 0o600);

    const replayPlan = buildGradeLocalizationPlan(manifest, await client.fetchState(), translations);
    assert.deepEqual(replayPlan.counts, {
        createOptionCount: 0,
        updateOptionCount: 0,
        rebindValueCount: 0,
        alreadyLocalizedCount: 2,
    });

    const rollback = await rollbackGradeLocalization(client, JSON.parse(fs.readFileSync(rollbackFile, 'utf8')));
    assert.equal(rollback.restoredValueCount, 2);
    assert.equal(rollback.deletedOptionCount, 2);
    assert.equal(client.data.productAttributeOptions.length, 0);
    assert.equal(client.data.variantAttributes[0].values.every(value => !value.productAttributeOptionId), true);

    const existingOptionState = createState();
    existingOptionState.productAttributeOptions = [{
        id: id(800),
        productAttributeId: id(4),
        displayOrder: 0,
        priceAdjustment: 12.5,
        weightAdjustment: 0.25,
        isPreselected: true,
        translations: [{ languageCode: 'zh-CN', name: 'Everyday' }],
    }];
    existingOptionState.variantAttributes[0].values[0].productAttributeOptionId = id(800);
    const existingOptionClient = new FakeClient();
    existingOptionClient.data = existingOptionState;
    await applyGradeLocalization(
        existingOptionClient,
        manifest,
        await existingOptionClient.fetchState(),
        translations,
        path.join(directory, 'existing-option-rollback.json'),
    );
    const preservedOption = existingOptionClient.data.productAttributeOptions.find(item => item.id === id(800));
    assert.equal(preservedOption.priceAdjustment, 12.5);
    assert.equal(preservedOption.weightAdjustment, 0.25);
    assert.equal(preservedOption.isPreselected, true);
    fs.rmSync(directory, { recursive: true, force: true });
    console.log('Tieguanyin variant localization plan/apply/read-back/rollback tests passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
