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
    'CAT-GREEN-LONGJING',
    'CAT-FAMILY-1',
    'CAT-FAMILY-2',
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

const inferredWarnings = [];
const inferredAssignments = buildCategoryAssignments({
    slug: 'xihu-longjing',
    name: 'Xihu Longjing',
    meta: {
        tea_type: 'green',
        province: null,
        processing: null,
        shape: null,
        roast_level: null,
    },
    tags: ['gi'],
    recipe: [{ style: 'gongfu' }],
    sections: {
        classification_origin: {
            origin: {
                value: 'China, Zhèjiāng Province (浙江), Hángzhōu City (杭州), vicinity of West Lake.',
            },
            type: {
                value: 'Green tea. Belongs to pan-fired green teas with flat leaf form.',
            },
        },
        brewing: {
            teaware: {
                value: 'A glass tumbler or white porcelain gaiwan is recommended.',
            },
        },
    },
}, inferredWarnings);
assert.deepStrictEqual(inferredWarnings, []);
assert(inferredAssignments.includes('CAT-REGION-ZHEJIANG'));
assert(inferredAssignments.includes('CAT-SHAPE-FLAT'));
assert(inferredAssignments.includes('CAT-PROC-CHAOQING'));
assert(inferredAssignments.includes('CAT-GREEN-LONGJING'));
assert(inferredAssignments.includes('CAT-FAMILY-1'));
assert(inferredAssignments.includes('CAT-BREW-GONGFU'));
assert(inferredAssignments.includes('CAT-BREW-GAIWAN'));
assert(inferredAssignments.includes('CAT-BREW-GLASS'));

const ambiguousWarnings = [];
const ambiguousAssignments = buildCategoryAssignments({
    slug: 'multi-region-tea',
    meta: { tea_type: 'oolong' },
    sections: {
        classification_origin: {
            origin: { value: 'Produced in Fujian Province and Guangdong Province.' },
        },
    },
}, ambiguousWarnings);
assert(ambiguousWarnings.some(message => message.includes('Ambiguous inferred province')));
assert(!ambiguousAssignments.includes('CAT-REGION-FUJIAN'));
assert(!ambiguousAssignments.includes('CAT-REGION-GUANGDONG'));

const herbalAssignments = buildCategoryAssignments({
    slug: 'meigui-hua-cha',
    meta: { category_code: 'FLOWERS AND DRY' },
});
assert(herbalAssignments.includes('CAT-HERBAL-TEA'));
assert(herbalAssignments.includes('CAT-HERBAL-FLOWER'));
assert(herbalAssignments.includes('CAT-HERBAL-ROSE'));

for (const [slug, subtype] of [
    ['damai-cha', 'CAT-HERBAL-GRAIN'],
    ['hong-qiao-mei', 'CAT-HERBAL-FLOWER'],
    ['lan-hudie', 'CAT-HERBAL-FLOWER'],
    ['luoshen-hua', 'CAT-HERBAL-FLOWER'],
    ['shanzha-gan', null],
]) {
    const assignments = buildCategoryAssignments({
        slug,
        meta: { category_code: 'FLOWERS AND DRY' },
    });
    assert(assignments.includes('CAT-HERBAL-TEA'), slug);
    if (subtype) assert(assignments.includes(subtype), slug);
}

const dancongSubtypeCases = [
    ['dan-cong-mi-lan-xiang', 'Dān Cóng Mì Lán Xiāng', 'CAT-DANCONG-MILAN'],
    ['dan-cong-ya-shi-xiang', 'Dān Cóng Yā Shǐ Xiāng', 'CAT-DANCONG-YASHI'],
    ['zhi-lan-xiang-dancong', 'Zhī Lán Xiāng Dàn Cóng', 'CAT-DANCONG-ZHILAN'],
    ['guihua-xiang-dancong', 'Guī Huā Xiāng Dāncóng', 'CAT-DANCONG-GUIHUA'],
    ['dan-cong-xing-ren-xiang', 'Dān Cóng Xìng Rén Xiāng', 'CAT-DANCONG-XINGREN'],
    ['huang-zhi-xiang-dancong', 'Huáng Zhī Xiāng Dàn Cóng', 'CAT-DANCONG-HUANGZHI'],
    ['yulan-xiang-dancong', 'Yù Làn Xiāng Dāncóng', 'CAT-DANCONG-YULAN'],
];
for (const [slug, name, subtypeCategory] of dancongSubtypeCases) {
    const subtypeAssignments = buildCategoryAssignments({
        slug,
        name,
        meta: { tea_type: 'oolong' },
    });
    assert(subtypeAssignments.includes('CAT-OOLONG-DANCONG'), slug);
    assert(subtypeAssignments.includes(subtypeCategory), slug);
}

const nonDancongMiLan = buildCategoryAssignments({
    slug: 'mi-lan-xiang-hongcha',
    name: 'Mi Lan Xiang Red Tea',
    meta: { tea_type: 'red' },
});
assert(!nonDancongMiLan.includes('CAT-DANCONG-MILAN'));

const genericDancong = buildCategoryAssignments({
    slug: 'lingtou-dan-cong',
    name: 'Lingtou Dan Cong',
    meta: { tea_type: 'oolong' },
});
assert(genericDancong.includes('CAT-OOLONG-DANCONG'));
assert(!genericDancong.some(code => code.startsWith('CAT-DANCONG-')));

console.log('test-category-taxonomy: OK');
