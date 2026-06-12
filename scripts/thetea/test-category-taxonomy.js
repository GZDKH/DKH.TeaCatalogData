#!/usr/bin/env node
const assert = require('assert');
const {
    buildCategoryAssignments,
    buildTheTeaCategories,
    PROVINCE_CATEGORY,
} = require('./lib/category-taxonomy');

const card = {
    slug: 'xihu-longjing',
    meta: {
        tea_type: 'green',
        province: 'Zhejiang',
        processing: 'chaoqing',
        shape: 'flat',
        roast_level: 'none',
    },
    tags: ['gi', 'green', 'ten-famous-teas'],
};

const warnings = [];
const assignments = buildCategoryAssignments(card, warnings);
assert.deepStrictEqual(warnings, []);
assert.deepStrictEqual(assignments, [
    'CAT-GREEN-TEA',
    'CAT-REGION-ZHEJIANG',
    'CAT-SHAPE-FLAT',
    'CAT-PROC-CHAOQING',
    'CAT-ROAST-NONE',
    'CAT-SPEC-GI',
    'CAT-SPEC-TEN-FAMOUS-TEAS',
]);

assert.strictEqual(PROVINCE_CATEGORY.Chongqing, 'CAT-REGION-CHONGQING');
assert.strictEqual(PROVINCE_CATEGORY.Tibet, 'CAT-REGION-TIBET');

const categories = buildTheTeaCategories([card], {
    family: {
        families: [
            {
                family_id: 1,
                province_en: 'Zhejiang',
                province_zh: '浙江省',
                name_ru: 'Система Лунцзин',
                name_zh: '龙井茶系统',
                tea_count: 45,
            },
        ],
    },
});

const codes = categories.map(category => category.code);
assert(codes.includes('CAT-BY-SHAPE'));
assert(codes.includes('CAT-SHAPE-FLAT'));
assert(codes.includes('CAT-BY-PROCESSING'));
assert(codes.includes('CAT-PROC-CHAOQING'));
assert(codes.includes('CAT-BY-ROAST'));
assert(codes.includes('CAT-ROAST-NONE'));
assert(codes.includes('CAT-BY-SPECIALTY'));
assert(codes.includes('CAT-SPEC-GI'));
assert(codes.includes('CAT-SPEC-TEN-FAMOUS-TEAS'));
assert(codes.includes('CAT-BY-FAMILY'));
assert(codes.includes('CAT-FAMILY-1'));

const flat = categories.find(category => category.code === 'CAT-SHAPE-FLAT');
assert.strictEqual(flat.parent, 'CAT-BY-SHAPE');
assert(flat.translations.some(t => t.lang === 'ru-RU' && t.name));

console.log('test-category-taxonomy: OK');
