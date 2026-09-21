#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    assertFreshInputs,
    buildSourceBackedProposal,
} = require('./lib/source-backed-proposal');
const { buildOutputPayloads } = require('./prepare-source-proposal');

function card(overrides = {}) {
    return {
        slug: 'sample-tea',
        kind: 'tea',
        lang: 'en',
        name: 'Sample Tea (样茶, Yàng Chá)',
        names: { en: 'Sample Tea', zh: '样茶' },
        meta: {
            origin_country: 'CN',
            province: 'Hunan',
            city: 'Yueyang',
            tea_type: 'yellow',
            oxidation_min: 10,
            oxidation_max: 20,
            version: '1.0',
            last_updated: '2026-04-08',
        },
        sections: {},
        recipe: [{ style: 'gongfu', water_temp: 78, tea_grams: 5, water_ml: 100, steep_sec: 10, increment_sec: 5, max_steeps: 4, rinse: 0 }],
        harvest: [{ phase: 'early', months: '3' }],
        sensory: [{ descriptor_id: 'Cz', intensity: 3 }],
        tags: ['yellow'],
        ...overrides,
    };
}

function product(overrides = {}) {
    return {
        id: 'sample-id',
        code: 'TEA-CN-SAMPLE-TEA',
        sku: 'SAMPLE-TEA-CN',
        nativeName: '样茶',
        transcription: 'Yàng Chá',
        published: false,
        translations: [],
        specifications: [],
        tags: [],
        tierPrices: [],
        catalogPrices: [],
        storePriceOverrides: [],
        packages: [],
        catalogs: [],
        origins: [],
        related: [],
        crossSells: [],
        ...overrides,
    };
}

const metadata = {
    snapshotId: 'fixture-2026-09-22',
    sourceSha256: 'fixture-source-hash',
    articleUrl: 'https://tea.community/ru-RU/products/sample-tea',
};

const baseline = product({
    specifications: [
        { group: 'SPEC-TT-GROUP-RECIPE', attribute: 'SPEC-TT-RECIPE-GONGFU-RINSE', type: 'Boolean', value: 'False' },
        { group: 'SPEC-TT-GROUP-STORAGE', attribute: 'SPEC-TT-FIELD-STORAGE-TEMPERATURE', type: 'Number', value: '0' },
    ],
});
const proposal = buildSourceBackedProposal({
    sourceCard: card(),
    baselineProduct: baseline,
    sourceMetadata: metadata,
});
assert.strictEqual(proposal.productCode, 'TEA-CN-SAMPLE-TEA');
assert.strictEqual(proposal.eligible, true);
assert(proposal.proposals.some(item => item.action === 'apply'));
const applied = proposal.proposals.filter(item => item.action === 'apply');
assert(applied.every(item => item.evidence.articleUrl === metadata.articleUrl));
assert(applied.every(item => item.evidence.sourceRevision === 'fixture-2026-09-22:1.0:2026-04-08'));
assert(applied.every(item => item.evidence.excerpt !== undefined));
assert.strictEqual(proposal.desiredProduct.specifications.filter(item => item.attribute === 'SPEC-TT-RECIPE-GONGFU-RINSE').length, 1);
assert.strictEqual(proposal.desiredProduct.specifications.find(item => item.attribute === 'SPEC-TT-FIELD-STORAGE-TEMPERATURE').value, '0');
const outputPayloads = buildOutputPayloads(proposal);
assert(Array.isArray(outputPayloads.desiredPayload));
assert.strictEqual(outputPayloads.desiredPayload.length, 1);
assert.strictEqual(outputPayloads.desiredPayload[0].code, proposal.productCode);
assert(Array.isArray(outputPayloads.rollbackPayload));
assert.strictEqual(outputPayloads.rollbackPayload.length, 1);
assert.strictEqual(outputPayloads.rollbackPayload[0].code, proposal.productCode);

const falseMatch = buildSourceBackedProposal({
    sourceCard: card(),
    baselineProduct: product({ code: 'TEA-CN-OTHER' }),
    sourceMetadata: metadata,
});
assert.strictEqual(falseMatch.eligible, false);
assert.strictEqual(falseMatch.reviewQueue[0].reason, 'exact-product-match-required');

const conflictingRecipe = buildSourceBackedProposal({
    sourceCard: card({ recipe: [
        { style: 'gongfu', water_temp: 78, tea_grams: 5, water_ml: 100, steep_sec: 10, max_steeps: 4, rinse: 0 },
        { style: 'gongfu', water_temp: 82, tea_grams: 5, water_ml: 100, steep_sec: 12, max_steeps: 4, rinse: 0 },
    ] }),
    baselineProduct: baseline,
    sourceMetadata: metadata,
});
assert.strictEqual(conflictingRecipe.eligible, false);
assert.strictEqual(conflictingRecipe.reviewQueue[0].reason, 'conflicting-repeated-source-value');
assert.strictEqual(conflictingRecipe.reviewQueue[0].evidence.sourcePath, '/recipe/0');
assert(conflictingRecipe.reviewQueue[0].evidence.excerpt.includes('gongfu'));

const rangeTruncated = buildSourceBackedProposal({
    sourceCard: card(),
    baselineProduct: product({ specifications: [
        { group: 'SPEC-TT-GROUP-ATOMIC', attribute: 'SPEC-TT-ATOMIC-OXIDATION', type: 'Range', valueMin: 10 },
    ] }),
    sourceMetadata: metadata,
});
assert.strictEqual(rangeTruncated.eligible, false);
assert(rangeTruncated.reviewQueue.some(item => item.reason === 'range-truncation'));
assert.strictEqual(rangeTruncated.desiredProduct.specifications[0].valueMax, undefined);

const first = JSON.stringify(buildSourceBackedProposal({ sourceCard: card(), baselineProduct: baseline, sourceMetadata: metadata }));
const second = JSON.stringify(buildSourceBackedProposal({ sourceCard: card(), baselineProduct: baseline, sourceMetadata: metadata }));
assert.strictEqual(first, second);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thetea-source-proposal-'));
const sourceFile = path.join(tmp, 'card.json');
const baselineFile = path.join(tmp, 'baseline.json');
const sourceManifestFile = path.join(tmp, 'manifest.json');
fs.writeFileSync(sourceFile, JSON.stringify(card()));
fs.writeFileSync(baselineFile, JSON.stringify(baseline));
fs.writeFileSync(sourceManifestFile, JSON.stringify({ snapshotId: 'fixture-2026-09-22' }));
const fresh = buildSourceBackedProposal({
    sourceCard: card(),
    baselineProduct: baseline,
    sourceMetadata: {
        ...metadata,
        sourceSha256: require('./generate-import').hashInputPath(sourceFile),
        sourceManifestSha256: require('./generate-import').hashInputPath(sourceManifestFile),
    },
});
fresh.source.sourceManifestSha256 = require('./generate-import').hashInputPath(sourceManifestFile);
fresh.inputs = { baselineSha256: require('./generate-import').hashInputPath(baselineFile) };
assert.doesNotThrow(() => assertFreshInputs(fresh, {
    sourcePath: sourceFile,
    sourceManifestPath: sourceManifestFile,
    baselinePath: baselineFile,
}));
fs.appendFileSync(baselineFile, '\n');
assert.throws(() => assertFreshInputs(fresh, {
    sourcePath: sourceFile,
    sourceManifestPath: sourceManifestFile,
    baselinePath: baselineFile,
}), /baseline hash changed/);
fs.appendFileSync(sourceManifestFile, '\n');
assert.throws(() => assertFreshInputs(fresh, {
    sourcePath: sourceFile,
    sourceManifestPath: sourceManifestFile,
}), /source manifest hash changed/);

console.log('test-source-backed-proposal: OK');
