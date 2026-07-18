#!/usr/bin/env node
const assert = require('assert');
const { validateArtifact } = require('./lib/artifact-validator');
const { ATTRIBUTE_TYPES } = require('./lib/spec-contract');

const REQUIRED_LOCALES = ['en-US', 'ru-RU'];

function translation(lang, name) {
    return { lang, name: `${name} ${lang}` };
}

function translations(name) {
    return REQUIRED_LOCALES.map(lang => translation(lang, name));
}

function fixture() {
    const group = {
        code: 'SPEC-TT-GROUP-DETAIL',
        translations: translations('Detail'),
    };
    const values = {
        Option: { option: 'SPEC-TT-OPT-KIND-GREEN', optionName: 'Green' },
        CustomText: { value: 'plain' },
        CustomHtmlText: { value: '<strong>html</strong>' },
        CustomMarkdownText: { value: '**markdown**' },
        Hyperlink: { value: 'https://tea.support/tea/test' },
        Number: { value: '0' },
        Range: { valueMin: 0, valueMax: 0 },
        List: { value: '["spring","0"]' },
        Boolean: { value: 'false' },
        Date: { value: '2024-02-29' },
        Duration: { value: '0' },
    };
    const units = { Number: '°C', Range: 'm', Duration: 's' };
    const attributes = ATTRIBUTE_TYPES.map((type, index) => ({
        code: `SPEC-TT-ATTR-${type.replace(/([a-z])([A-Z])/g, '$1-$2').toUpperCase()}`,
        group: group.code,
        type,
        ...(units[type] ? { unit: units[type] } : {}),
        translations: translations(type),
    }));
    const optionAttribute = attributes.find(attribute => attribute.type === 'Option');
    const option = {
        code: 'SPEC-TT-OPT-KIND-GREEN',
        attribute: optionAttribute.code,
        translations: translations('Green'),
    };
    const specifications = attributes.map((attribute, index) => ({
        group: group.code,
        attribute: attribute.code,
        type: attribute.type,
        order: index,
        ...values[attribute.type],
    }));
    const products = [
        {
            code: 'TEA-CN-ONE',
            translations: translations('Tea One'),
            specifications,
            catalogs: [{ catalog: 'CATALOG-CHINESE-TEA', category: 'CAT-GREEN' }],
            packages: [{ package: 'PKG-50G' }],
            origins: [{
                country: 'CN',
                altitude: { min: 0, max: 0, unit: 'm' },
                coordinates: { lat: 0, lng: 0 },
                translations: [
                    { lang: 'en-US', place: 'Zero Point' },
                    { lang: 'ru-RU', place: 'Нулевая точка' },
                ],
            }],
            related: [{ product: 'TEA-CN-TWO', order: 0 }],
            crossSells: [{ product: 'TEA-CN-TWO' }],
        },
        {
            code: 'TEA-CN-TWO',
            translations: translations('Tea Two'),
            specifications: [],
            catalogs: [{ catalog: 'CATALOG-CHINESE-TEA', category: 'CAT-GREEN' }],
            packages: [{ package: 'PKG-50G' }],
        },
    ];
    const catalogReference = {
        catalogs: [{
            code: 'CATALOG-CHINESE-TEA',
            published: true,
            translations: [{ lang: 'en-US', name: 'Chinese Tea' }],
        }],
        categories: [{
            code: 'CAT-GREEN',
            published: true,
            translations: [{ lang: 'en-US', name: 'Green Tea' }],
        }],
    };

    return {
        products,
        definitions: { groups: [group], attributes, options: [option] },
        requiredLocales: REQUIRED_LOCALES,
        lossEvents: [],
        catalogReference,
        requiredCatalogCode: 'CATALOG-CHINESE-TEA',
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function expectInvalid(mutator, message) {
    const artifact = fixture();
    mutator(artifact);
    const result = validateArtifact(artifact);
    assert.strictEqual(result.valid, false, `expected invalid artifact for ${message}`);
    assert(
        result.errors.some(error => error.includes(message)),
        `expected error containing '${message}', got:\n${result.errors.join('\n')}`);
    return result;
}

const valid = validateArtifact(fixture());
assert.strictEqual(valid.valid, true, valid.errors.join('\n'));
assert.strictEqual(valid.productCount, 2);
assert.deepStrictEqual(valid.definitionCounts, { groups: 1, attributes: 11, options: 1 });
assert.strictEqual(valid.languageCoverage['en-US'], 2);
assert.strictEqual(valid.localeCoverage['ru-RU'].groups, 1);
assert.strictEqual(valid.localeCoverage['ru-RU'].attributes, 11);
assert.strictEqual(valid.localeCoverage['ru-RU'].options, 1);
assert.deepStrictEqual(valid.relationCounts, { related: 1, crossSells: 1, total: 2 });
assert.deepStrictEqual(Object.keys(valid.specTypes).sort(), [...ATTRIBUTE_TYPES].sort());
assert.strictEqual(valid.catalogMapping.valid, true);

expectInvalid(artifact => {
    artifact.products = [];
}, 'at least one product');

expectInvalid(artifact => {
    artifact.products[0].translations = artifact.products[0].translations
        .filter(item => item.lang !== 'ru-RU');
}, 'missing required ru-RU product translation');

expectInvalid(artifact => {
    artifact.products[0].packages = undefined;
}, 'packages must be an array');

expectInvalid(artifact => {
    artifact.products[0].catalogs = [];
}, 'no catalog/category assignments');

expectInvalid(artifact => {
    artifact.products[1].code = artifact.products[0].code;
}, 'duplicate product code');

expectInvalid(artifact => {
    artifact.products[0].code = 'tea-lowercase';
}, 'product code must match');

const csvList = expectInvalid(artifact => {
    artifact.products[0].specifications.find(spec => spec.type === 'List').value = 'spring, summer';
}, 'List value must be');
assert(csvList.errors.some(error => error.includes('JSON array')));

expectInvalid(artifact => {
    const option = artifact.products[0].specifications.find(spec => spec.type === 'Option');
    artifact.products[0].specifications.push({ ...option, order: 99 });
}, 'occurs more than once');

expectInvalid(artifact => {
    artifact.definitions.attributes = artifact.definitions.attributes
        .filter(attribute => attribute.type !== 'Number');
}, 'references undefined attribute');

expectInvalid(artifact => {
    artifact.products[0].specifications.find(spec => spec.type === 'Number').type = 'CustomText';
}, 'differs from attribute definition type');

expectInvalid(artifact => {
    artifact.products[0].specifications.find(spec => spec.type === 'Number').group = 'SPEC-GROUP-OTHER';
}, 'differs from attribute definition group');

expectInvalid(artifact => {
    artifact.definitions.attributes.find(attribute => attribute.type === 'Number').unit = '';
}, 'unit must be a non-empty string');

expectInvalid(artifact => {
    artifact.definitions.groups[0].translations = artifact.definitions.groups[0].translations
        .filter(item => item.lang !== 'ru-RU');
}, 'missing required ru-RU translation');

expectInvalid(artifact => {
    artifact.definitions.attributes.find(attribute => attribute.type === 'Option')
        .translations = [translation('en-US', 'Option')];
}, 'missing required ru-RU translation');

expectInvalid(artifact => {
    artifact.definitions.options[0].translations = [translation('en-US', 'Green')];
}, 'missing required ru-RU translation');

expectInvalid(artifact => {
    const spec = artifact.products[0].specifications.find(item => item.type === 'CustomText');
    const definition = artifact.definitions.attributes.find(item => item.type === 'CustomText');
    spec.type = 'Unknown';
    definition.type = 'Unknown';
}, "unsupported type 'Unknown'");

expectInvalid(artifact => {
    artifact.products[0].specifications.find(spec => spec.type === 'Boolean').value = '1';
}, "must be exactly 'true' or 'false'");

expectInvalid(artifact => {
    artifact.products[0].specifications.find(spec => spec.type === 'Date').value = '2023-02-29';
}, 'valid ISO date');

expectInvalid(artifact => {
    artifact.products[0].specifications.find(spec => spec.type === 'Duration').value = '-1';
}, 'non-negative integral seconds');

expectInvalid(artifact => {
    artifact.products[0].specifications.find(spec => spec.type === 'Number').value = 'NaN';
}, 'finite invariant decimal string');

expectInvalid(artifact => {
    const range = artifact.products[0].specifications.find(spec => spec.type === 'Range');
    range.valueMin = 10;
    range.valueMax = 5;
}, 'valueMin <= valueMax');

expectInvalid(artifact => {
    artifact.products[0].specifications.find(spec => spec.type === 'Option').value = 'green';
}, 'Option cannot contain custom');

expectInvalid(artifact => {
    artifact.products[0].specifications.find(spec => spec.type === 'Hyperlink').value = 'tea.support/test';
}, 'absolute http(s) URL');

expectInvalid(artifact => {
    artifact.definitions.attributes.push(clone(artifact.definitions.attributes[0]));
}, 'Duplicate attribute definition code');

expectInvalid(artifact => {
    artifact.definitions.groups.push(clone(artifact.definitions.groups[0]));
}, 'Duplicate group definition code');

expectInvalid(artifact => {
    artifact.definitions.options.push(clone(artifact.definitions.options[0]));
}, 'Duplicate option definition code');

expectInvalid(artifact => {
    artifact.definitions.options[0].attribute = artifact.definitions.attributes
        .find(attribute => attribute.type === 'Number').code;
}, 'not Option');

expectInvalid(artifact => {
    artifact.products[0].related = [{ product: 'TEA-CN-ONE', order: 0 }];
}, 'self relation');

expectInvalid(artifact => {
    artifact.products[0].related = [{ product: 'TEA-CN-MISSING', order: 0 }];
}, 'target product TEA-CN-MISSING is missing');

expectInvalid(artifact => {
    artifact.products[0].related = [
        { product: 'TEA-CN-TWO', order: 0 },
        { product: 'TEA-CN-TWO', order: 1 },
    ];
}, 'duplicate relation');

expectInvalid(artifact => {
    artifact.products[0].related = [
        { product: 'TEA-CN-TWO', order: 2 },
        { product: 'TEA-CN-TWO', catalog: 'CATALOG-OTHER', order: 1 },
    ];
}, 'sorted by ascending order');

expectInvalid(artifact => {
    artifact.products[0].origins[0].altitude = { min: 1, max: 0, unit: 'm' };
}, 'altitude.min must be <= altitude.max');

expectInvalid(artifact => {
    artifact.products[0].origins[0].coordinates.lat = 91;
}, 'latitude must be between');

expectInvalid(artifact => {
    artifact.products[0].origins[0].translations.push({ lang: 'en-US', place: 'Duplicate' });
}, 'duplicate en-US translation');

expectInvalid(artifact => {
    artifact.lossEvents.push({ severity: 'error', message: 'list value was truncated' });
}, 'Loss event: list value was truncated');

const warningArtifact = fixture();
warningArtifact.lossEvents.push({ severity: 'warning', message: 'fallback label used' });
const warningResult = validateArtifact(warningArtifact);
assert.strictEqual(warningResult.valid, true, warningResult.errors.join('\n'));
assert(warningResult.warnings.includes('Loss event: fallback label used'));
assert.deepStrictEqual(warningResult.lossEvents, warningArtifact.lossEvents);

const routedArtifact = fixture();
routedArtifact.routedContent = {
    articles: [{
        code: 'ARTICLE-TT-TEA-CN-ONE-DETAIL',
        product: 'TEA-CN-ONE',
        translations: [
            { lang: 'en-US', markdown: '# Tea' },
            { lang: 'ru-RU', markdown: '# Чай' },
        ],
    }],
    metaobjects: [{
        code: 'METAOBJECT-TT-TEA-CN-ONE-FAQ',
        type: 'product_faq',
        product: 'TEA-CN-ONE',
        locales: [
            {
                lang: 'en-US',
                items: [{ order: 1, question: 'How?', answer: 'Carefully.' }],
            },
            {
                lang: 'ru-RU',
                items: [{ order: 1, question: 'Как?', answer: 'Осторожно.' }],
            },
        ],
    }],
};
routedArtifact.lossEvents.push(
    {
        severity: 'warning',
        product: 'TEA-CN-ONE',
        source: 'markdown',
        target: 'localized-article',
        count: 2,
        routed: true,
        message: 'Markdown routed.',
    },
    {
        severity: 'warning',
        product: 'TEA-CN-ONE',
        source: 'enrichment.faq',
        target: 'storefront-metaobject',
        count: 2,
        routed: true,
        message: 'FAQ routed.',
    });
const routedResult = validateArtifact(routedArtifact);
assert.strictEqual(routedResult.valid, true, routedResult.errors.join('\n'));
assert.deepStrictEqual(routedResult.routedContentCounts, {
    articles: 1,
    articleTranslations: 2,
    markdown: 2,
    narratives: 0,
    metaobjects: 1,
    faqItems: 2,
});

expectInvalid(artifact => {
    artifact.routedContent = clone(routedArtifact.routedContent);
    artifact.lossEvents = clone(routedArtifact.lossEvents);
    artifact.routedContent.metaobjects[0].locales = artifact.routedContent.metaobjects[0].locales
        .filter(locale => locale.lang !== 'ru-RU');
}, 'missing required ru-RU FAQ locale');

expectInvalid(artifact => {
    artifact.lossEvents.push({
        severity: 'warning',
        target: 'localized-article',
        count: 1,
        message: 'Claimed but not routed.',
    });
}, 'not backed by a routed artifact');

const externalBaselineArtifact = fixture();
const manualSpec = {
    group: 'SPEC-GROUP-MANUAL',
    attribute: 'SPEC-MANUAL',
    type: 'CustomText',
    value: 'keep',
};
externalBaselineArtifact.products[0].specifications.push(manualSpec);
externalBaselineArtifact.products[0].related.push({
    product: 'TEA-CN-EXTERNAL',
    catalog: 'CATALOG-OTHER',
    order: 2,
});
externalBaselineArtifact.baselineProducts = [
    { code: 'TEA-CN-EXTERNAL' },
    {
        code: 'TEA-CN-ONE',
        specifications: [manualSpec],
        related: [{ product: 'TEA-CN-EXTERNAL', catalog: 'CATALOG-OTHER', order: 2 }],
    },
];
const externalBaselineResult = validateArtifact(externalBaselineArtifact);
assert.strictEqual(externalBaselineResult.valid, true, externalBaselineResult.errors.join('\n'));

expectInvalid(artifact => {
    artifact.catalogReference.catalogs = [];
}, 'Required prod catalog CATALOG-CHINESE-TEA was not found');

console.log('test-artifact-validator: OK');
