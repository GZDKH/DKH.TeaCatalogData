#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    normalizeTieguanyinSnapshot,
} = require('./thetea-shop/tieguanyin-normalizer');
const {
    buildPlan,
    buildReceipt,
} = require('./thetea-shop/tieguanyin-importer');
const {
    applyImport,
    rollbackImport,
} = require('./thetea-shop/tieguanyin-operator');
const {
    AdminGatewayClient,
    ProductCatalogGrpcClient,
} = require('./thetea-shop/tieguanyin-production-client');

const ROOT = path.resolve(__dirname, '../..');
const fixture = JSON.parse(fs.readFileSync(path.join(
    ROOT,
    'scripts/catalog-sources/thetea-shop/fixtures/tieguanyin-price-base-2026-08-01.json',
), 'utf8'));
const manifest = normalizeTieguanyinSnapshot(fixture);

function id(number) {
    return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
}

function state({ complete = false } = {}) {
    const gradeValues = [{ id: id(10), customValue: 'Everyday', isDeleted: false }];
    const combinations = [{ id: id(20), attributeValueIds: [id(10)] }];
    const sellables = [{
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
    }];
    const placements = [{
        catalogSellableId: id(60),
        catalogId: id(2),
        productId: id(1),
        sellableUnitId: id(30),
        authorityVersion: 4,
        presentationMode: 'Grouped',
        isVisible: true,
    }];

    if (complete) {
        manifest.exactCandidates.forEach((candidate, index) => {
            const valueId = id(100 + index);
            const combinationId = id(200 + index);
            const sellableId = id(300 + index);
            gradeValues.push({ id: valueId, customValue: candidate.gradeLabel, isDeleted: false });
            combinations.push({ id: combinationId, attributeValueIds: [valueId] });
            sellables.push({
                sellableUnitId: sellableId,
                productId: id(1),
                variantCombinationId: combinationId,
                packageId: id(40),
                unitQuantity: { units: '500', nanos: 0 },
                unitId: id(50),
                unitAuthorityVersion: 3,
                authorityVersion: 2,
                lifecycleState: 'Active',
                publicationEligible: true,
                internalCode: candidate.sellableInternalCode,
                referenceUnitKind: 'REFERENCE_UNIT_KIND_WEIGHT',
            });
            placements.push({
                catalogSellableId: id(500 + index),
                catalogId: id(2),
                productId: id(1),
                sellableUnitId: sellableId,
                authorityVersion: 1,
                presentationMode: 'Grouped',
                isVisible: true,
            });
        });
    }

    return {
        products: [{ id: id(1), code: 'TEA-CN-TIE-GUANYIN' }],
        catalogs: [{ id: id(2), code: 'CATALOG-CHINESE-TEA-SHOP' }],
        variantAttributes: [{
            id: id(3),
            productId: id(1),
            productAttributeId: id(4),
            textPrompt: 'Grade',
            isDeleted: false,
            values: gradeValues,
        }],
        combinations,
        sellables,
        placements,
        placementDetails: placements.map(placement => ({
            placement,
            sourcePolicy: {
                policyKind: 'PlatformStock',
                policyDigest: 'f'.repeat(64),
            },
            sellableUnit: sellables.find(
                item => item.sellableUnitId === placement.sellableUnitId,
            ),
        })),
    };
}

const plan = buildPlan(manifest, state());
assert.equal(plan.schemaVersion, 'thetea-shop-tieguanyin-import-plan-v1');
assert.equal(plan.mode, 'dry-run');
assert.equal(plan.counts.candidateCount, 25);
assert.equal(plan.counts.createGradeValueCount, 25);
assert.equal(plan.counts.generateCombinationCount, 25);
assert.equal(plan.counts.createSellableCount, 25);
assert.equal(plan.counts.curatePlacementCount, 25);
assert.equal(plan.targetUnitQuantity, 500);
assert.equal(plan.sourcePolicyKind, 'PlatformStock');
assert.match(plan.planSha256, /^[a-f0-9]{64}$/);
assert.equal(JSON.stringify(plan).includes(id(1)), false, 'plan must not print production ids');

const readBack = buildPlan(manifest, state({ complete: true }));
assert.deepEqual(readBack.counts, {
    candidateCount: 25,
    createGradeValueCount: 0,
    generateCombinationCount: 0,
    createSellableCount: 0,
    activateSellableCount: 0,
    enablePublicationCount: 0,
    curatePlacementCount: 0,
});
const receipt = buildReceipt(plan, readBack, {
    gradeValuesCreated: 25,
    combinationsCreated: 25,
    sellablesCreated: 25,
    sellablesActivated: 25,
    publicationEligibilityEnabled: 25,
    placementsCurated: 25,
});
assert.equal(receipt.complete, true);
assert.equal(receipt.readBackVerified, true);
assert.equal(receipt.noRetailPricePublished, true);
    assert.equal(receipt.rollbackMode, 'remove-placement-and-disable-publication');

assert.throws(
    () => buildPlan({ ...manifest, target: { ...manifest.target, productCode: 'WRONG' } }, state()),
    /TGY_IMPORT_TARGET_INVALID/,
);
const ambiguous = state();
ambiguous.products.push({ id: id(999), code: 'TEA-CN-TIE-GUANYIN' });
assert.throws(() => buildPlan(manifest, ambiguous), /TGY_IMPORT_PRODUCT_NOT_EXACT/);
const duplicateGrade = state();
duplicateGrade.variantAttributes[0].values.push({ id: id(999), customValue: 'Everyday' });
assert.throws(() => buildPlan(manifest, duplicateGrade), /TGY_IMPORT_DUPLICATE_GRADE_VALUES/);
assert.throws(() => new AdminGatewayClient({
    baseUrl: 'http://production.example',
    workspaceId: id(1),
    token: 'secret-token-material',
}), /ADMIN_GATEWAY_PLAINTEXT_FORBIDDEN/);

class FakeClient {
    constructor() {
        this.data = state();
        this.sequence = 700;
    }

    nextId() { return id(this.sequence++); }
    async fetchState() { return structuredClone(this.data); }

    async updateGradeValues(_attributeId, values) {
        const current = this.data.variantAttributes[0].values;
        const currentByLabel = new Map(current.map(value => [value.customValue, value]));
        this.data.variantAttributes[0].values = values.map(value => {
            const label = value.customValue;
            return currentByLabel.get(label) || {
                id: this.nextId(),
                productVariantAttributeId: id(3),
                customValue: label,
                priceAdjustment: value.priceAdjustment || 0,
                isPreselected: Boolean(value.isPreselected),
                isDeleted: false,
            };
        });
    }

    async generateCombinations() {
        const existing = new Set(
            this.data.combinations.flatMap(item => item.attributeValueIds),
        );
        let createdCount = 0;
        for (const value of this.data.variantAttributes[0].values) {
            if (!existing.has(value.id)) {
                this.data.combinations.push({
                    id: this.nextId(),
                    attributeValueIds: [value.id],
                });
                createdCount++;
            }
        }
        return { createdCount };
    }

    async createSellable(request) {
        const item = {
            sellableUnitId: this.nextId(),
            productId: request.productId.value,
            variantCombinationId: request.variantCombinationId.value,
            packageId: request.packageId.value,
            unitQuantity: request.unitQuantity,
            unitId: request.unitId.value,
            unitAuthorityVersion: request.unitAuthorityVersion,
            authorityVersion: 1,
            lifecycleState: 'Draft',
            publicationEligible: false,
            internalCode: request.internalCode,
            referenceUnitKind: request.referenceUnitKind,
        };
        this.data.sellables.push(item);
        return structuredClone(item);
    }

    async activateSellable(sellableUnitId, expected) {
        const item = this.data.sellables.find(value => value.sellableUnitId === sellableUnitId);
        assert.equal(item.authorityVersion, expected);
        item.lifecycleState = 'Active';
        item.authorityVersion++;
        return structuredClone(item);
    }

    async setPublicationEligibility(sellableUnitId, eligible, expected) {
        const item = this.data.sellables.find(value => value.sellableUnitId === sellableUnitId);
        assert.equal(item.authorityVersion, expected);
        item.publicationEligible = eligible;
        item.authorityVersion++;
        return structuredClone(item);
    }

    async curate(catalogId, items) {
        const results = [];
        for (const request of items) {
            const placement = {
                catalogSellableId: this.nextId(),
                catalogId,
                productId: id(1),
                sellableUnitId: request.sellableUnitId.value,
                authorityVersion: 1,
                presentationMode: 'Grouped',
                lifecycleState: 'Active',
                isVisible: true,
            };
            this.data.placements.push(placement);
            this.data.placementDetails.push({
                placement,
                sourcePolicy: {
                    policyKind: 'PlatformStock',
                    policyDigest: 'f'.repeat(64),
                },
                sellableUnit: this.data.sellables.find(
                    item => item.sellableUnitId === placement.sellableUnitId,
                ),
            });
            results.push({
                sellableUnitId: request.sellableUnitId,
                catalogSellableId: { value: placement.catalogSellableId },
                status: 'CATALOG_SELLABLE_MAPPING_STATUS_CREATED',
            });
        }
        return { results, createdCount: items.length, updatedCount: 0, failedCount: 0 };
    }

    async removePlacement(catalogSellableId, expected) {
        const index = this.data.placements.findIndex(item => item.catalogSellableId === catalogSellableId);
        assert.notEqual(index, -1);
        assert.equal(this.data.placements[index].authorityVersion, expected);
        this.data.placementDetails = this.data.placementDetails.filter(
            item => item.placement.catalogSellableId !== catalogSellableId,
        );
        this.data.placements.splice(index, 1);
    }

}

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tgy-importer-'));
    const protoRoot = path.join(directory, 'product-proto');
    const platformProtoRoot = path.join(directory, 'platform-proto');
    const protoFile = path.join(
        protoRoot,
        'product_catalog/api/variant_query/v1/variant_query_service.proto',
    );
    fs.mkdirSync(path.dirname(protoFile), { recursive: true });
    fs.mkdirSync(platformProtoRoot, { recursive: true });
    fs.writeFileSync(protoFile, 'syntax = "proto3";');
    const token = 'purpose-limited-secret-token';
    let spawned;
    const grpc = new ProductCatalogGrpcClient({
        endpoint: 'localhost:5001',
        protoRoot,
        platformProtoRoot,
        workspaceId: id(1),
        token,
        plaintext: true,
        spawn: (_binary, args, options) => {
            spawned = { args, options };
            return { status: 0, stdout: '{}', stderr: '' };
        },
    });
    grpc.invoke(
        'product_catalog/api/variant_query/v1/variant_query_service.proto',
        'test.Service/Test',
        {},
    );
    assert.equal(spawned.args.join(' ').includes(token), false);
    assert.equal(spawned.options.env.PRODUCT_CATALOG_ADMIN_TOKEN, token);
    assert.equal(spawned.args.join(' ').includes(`x-workspace-id: ${id(1)}`), true);

    const rollbackFile = path.join(directory, 'rollback.json');
    const client = new FakeClient();
    const applied = await applyImport(client, manifest, await client.fetchState(), rollbackFile);
    assert.equal(applied.receipt.complete, true);
    assert.equal(applied.receipt.mutationCounts.gradeValuesCreated, 25);
    assert.equal(applied.receipt.mutationCounts.sellablesCreated, 25);
    assert.equal(applied.receipt.mutationCounts.placementsCurated, 25);
    assert.equal(fs.statSync(rollbackFile).mode & 0o777, 0o600);

    const replay = buildPlan(manifest, await client.fetchState());
    assert.equal(replay.counts.createSellableCount, 0);
    assert.equal(replay.counts.curatePlacementCount, 0);

    const rollback = JSON.parse(fs.readFileSync(rollbackFile, 'utf8'));
    const rolledBack = await rollbackImport(client, rollback);
    assert.equal(rolledBack.placementCount, 25);
    assert.equal(rolledBack.sellableCount, 25);
    assert.equal(client.data.placements.length, 1);
    assert.equal(client.data.sellables.filter(item => item.publicationEligible === false).length, 25);
    fs.rmSync(directory, { recursive: true, force: true });
    console.log('Tieguanyin importer plan/apply/read-back/rollback tests passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
