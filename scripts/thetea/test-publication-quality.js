#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { auditPublicationQuality } = require('./lib/publication-quality');
const { writeReport } = require('./lib/report');

function fixture() {
    return {
        products: [{
            code: 'TEA-CN-ONE',
            published: false,
            translations: [
                {
                    lang: 'en-US',
                    name: 'Tea One',
                    description: 'A complete factual tea description.',
                },
                {
                    lang: 'ru-RU',
                    name: 'Чай один',
                    description: 'Полное фактическое описание чая.',
                },
            ],
            specifications: [{
                group: 'SPEC-TT-GROUP-BREWING',
                attribute: 'SPEC-TT-ATTR-WATER-TEMP',
                type: 'Number',
                value: '82.5',
            }],
            catalogs: [{
                catalog: 'CATALOG-CHINESE-TEA',
                category: 'CAT-GREEN-TEA',
                published: true,
            }],
            origins: [{
                country: 'CN',
                state: 'ZJ',
                altitude: { min: 100, max: 800, unit: 'm' },
                coordinates: { lat: 30.22, lng: 120.13 },
            }],
        }],
        definitions: {
            attributes: [{
                code: 'SPEC-TT-ATTR-WATER-TEMP',
                type: 'Number',
                unit: '°C',
            }],
        },
        requiredLocales: ['ru-RU', 'en-US'],
        productMedia: {
            records: [{
                product: 'TEA-CN-ONE',
                path: '07-media/products/tea-one',
                replace: true,
            }],
            assets: [{
                relativePath: '07-media/products/tea-one/cover.webp',
            }],
        },
        catalogBindings: [{
            code: 'CATALOG-CHINESE-TEA',
            categories: [{
                category: 'CAT-GREEN-TEA',
                products: [{ product: 'TEA-CN-ONE' }],
            }],
        }],
        targetCatalog: 'CATALOG-CHINESE-TEA',
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

const completeDraft = auditPublicationQuality(fixture());
assert.strictEqual(completeDraft.valid, true);
assert.strictEqual(completeDraft.gatePassed, true);
assert.strictEqual(completeDraft.publicationEligible, true);
assert.strictEqual(completeDraft.findingCount, 0);

const invalidInput = fixture();
invalidInput.products[0].translations[1].description =
    '**Tasting note:** fallback text.\n\n## Brewing recipes\n3 steeps';
invalidInput.products[0].specifications[0].value = '82.1234';
invalidInput.definitions.attributes[0].unit = 'C';
invalidInput.products[0].catalogs[0].category = 'CAT-UNKNOWN';
invalidInput.products[0].origins = [{ country: 'CN' }];
invalidInput.productMedia.assets = [];

const invalidDraft = auditPublicationQuality(invalidInput);
assert.strictEqual(invalidDraft.valid, false);
assert.strictEqual(invalidDraft.gatePassed, true);
assert.strictEqual(invalidDraft.draftEligible, true);
assert.strictEqual(invalidDraft.publicationEligible, false);
assert.strictEqual(invalidDraft.blockerCount, 0);
assert.strictEqual(invalidDraft.warningCount, invalidDraft.findingCount);
for (const rule of [
    'CATEGORY_MAPPING',
    'FORBIDDEN_INTERFACE_FALLBACK',
    'IMAGE_COVERAGE',
    'ORIGIN_MAPPING',
    'SPECIFICATION_PRECISION',
    'SPECIFICATION_UNIT',
]) {
    assert(invalidDraft.findings.some(finding => finding.rule === rule), rule);
}

const invalidPublishedInput = clone(invalidInput);
invalidPublishedInput.products[0].published = true;
const existingPublishedDraft = auditPublicationQuality(invalidPublishedInput);
assert.strictEqual(existingPublishedDraft.gatePassed, true);
assert.strictEqual(existingPublishedDraft.publishedProductCount, 1);
assert.strictEqual(existingPublishedDraft.publicationCandidateCount, 0);
assert.strictEqual(existingPublishedDraft.blockerCount, 0);

const invalidPublished = auditPublicationQuality({
    ...invalidPublishedInput,
    publicationRequested: true,
});
assert.strictEqual(invalidPublished.gatePassed, false);
assert.strictEqual(invalidPublished.publicationCandidateCount, 1);
assert.strictEqual(invalidPublished.blockerCount, invalidPublished.findingCount);
assert.strictEqual(invalidPublished.warningCount, 0);
assert(invalidPublished.errors.every(error => error.startsWith('Publication blocked:')));

assert.deepStrictEqual(
    auditPublicationQuality({
        ...clone(invalidPublishedInput),
        publicationRequested: true,
    }),
    invalidPublished,
    'The quality report must be deterministic for equivalent input.');

const reportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thetea-publication-quality-'));
try {
    writeReport(reportRoot, {
        valid: true,
        productCount: 1,
        errors: [],
        warnings: invalidDraft.warnings,
        publicationQuality: invalidDraft,
    });
    assert(fs.existsSync(path.join(reportRoot, 'publication-quality.json')));
    const markdown = fs.readFileSync(path.join(reportRoot, 'summary.md'), 'utf8');
    assert(markdown.includes('## Publication Quality Gate'));
    assert(markdown.includes('Bulk publication eligible: no'));
    assert(markdown.includes('FORBIDDEN_INTERFACE_FALLBACK'));
} finally {
    fs.rmSync(reportRoot, { recursive: true, force: true });
}

console.log('test-publication-quality: OK');
