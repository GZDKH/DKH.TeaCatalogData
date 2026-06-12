#!/usr/bin/env node
const assert = require('assert');
const { applyFieldDetails, extractFieldRefs } = require('./lib/field-details');
const { transformCardSet } = require('./lib/transform');

const card = {
    slug: 'xihu-longjing',
    sections: {
        brewing: {
            water_temp: { value: '80-90 C.', num: 80, unit: 'C' },
        },
        organoleptic: {
            taste: { value: 'Chestnut.', num: null, unit: null },
        },
    },
};

assert.deepStrictEqual(extractFieldRefs(card), [
    { section: 'brewing', field: 'water_temp' },
    { section: 'organoleptic', field: 'taste' },
]);

const enriched = applyFieldDetails(card, [
    {
        section: 'brewing',
        field: 'water_temp',
        payload: {
            value_md: '80-90°C with cooler water for high grades.',
            value_num: 80,
            unit: '°C',
            section_code: 'brewing',
        },
    },
    {
        section: 'organoleptic',
        field: 'taste',
        payload: {
            value_md: 'Chestnut, orchid, umami, long sweet aftertaste.',
            value_num: null,
            unit: null,
            section_code: 'organoleptic',
        },
    },
]);

assert.strictEqual(enriched.sections.brewing.water_temp.value, '80-90°C with cooler water for high grades.');
assert.strictEqual(enriched.sections.brewing.water_temp.num, 80);
assert.strictEqual(enriched.sections.brewing.water_temp.unit, '°C');
assert.strictEqual(enriched.sections.brewing.water_temp.endpoint.value_md, '80-90°C with cooler water for high grades.');
assert.strictEqual(enriched.sections.organoleptic.taste.value, 'Chestnut, orchid, umami, long sweet aftertaste.');
assert.strictEqual(card.sections.brewing.water_temp.value, '80-90 C.');

const { product } = transformCardSet({
    en: {
        ...enriched,
        lang: 'en',
        name: 'Xi Hu Longjing',
        meta: {
            slug: 'xihu-longjing',
            origin_country: 'CN',
            tea_type: 'green',
            province: 'Zhejiang',
        },
    },
});

assert(product.specifications.some(s => s.attribute === 'SPEC-TT-FIELD-BREWING-WATER-TEMP' && s.type === 'Number' && s.value === '80'));
assert(product.specifications.some(s => s.attribute === 'SPEC-TT-FIELD-DETAIL-BREWING-WATER-TEMP'
    && s.type === 'CustomMarkdownText'
    && s.value === '80-90°C with cooler water for high grades.'));

console.log('test-field-details: OK');
