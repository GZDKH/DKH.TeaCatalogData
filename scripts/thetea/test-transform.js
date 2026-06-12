#!/usr/bin/env node
const assert = require('assert');
const { cleanDisplayName, transformCardSet } = require('./lib/transform');

const xihu = {
    slug: 'xihu-longjing',
    lang: 'en',
    name: 'Xī Hú Lóngjǐng (西湖龙井, Xīhú lóngjǐng)',
    names: {
        en: 'Xī Hú Lóngjǐng (西湖龙井, Xīhú lóngjǐng)',
        ru: 'Си Ху Лун Цзин (西湖龙井, Xīhú lóngjǐng)',
        zh: '西湖龙井 (西湖龙井, Xīhú lóngjǐng)',
    },
    meta: {
        slug: 'xihu-longjing',
        article_type: 'tea',
        origin_country: 'CN',
        category_code: 'CHINA-GREEN TEA',
        tea_type: 'green',
        oxidation_min: 0,
        oxidation_max: 0,
        roast_level: 'none',
        processing: 'chaoqing',
        shape: 'flat',
        province: 'Zhejiang',
        lat: 30.22,
        lng: 120.13,
        altitude_min: 100,
        altitude_max: 800,
        brew_temp_min: 80,
        brew_temp_max: 90,
        version: '1.0',
        last_updated: '2026-04-08',
        review_status: 'published',
    },
    sections: {
        classification_origin: {
            type: { value: 'Green tea (non-oxidized).', num: null, unit: null },
            origin: { value: 'China, Zhejiang, Hangzhou, West Lake.', num: null, unit: null },
        },
        brewing: {
            water_temp: { value: '80-90°C.', num: 80, unit: '°C' },
        },
        terroir: {
            altitude: { value: '100-800 m.', num: 100, unit: 'm' },
            climate: { value: 'Subtropical monsoon.', num: null, unit: null },
            terroir_x7: { value: 'Unknown but retained field.', num: null, unit: null },
        },
        health: {
            health_x0: { value: 'Supports digestion after heavy meals.', num: null, unit: null },
        },
        organoleptic: {
            taste: { value: 'Chestnut, orchid, umami.', num: null, unit: null },
            liquor_aroma: { value: 'Fresh bean-floral aroma.', num: null, unit: null },
        },
    },
    recipe: [
        { style: 'gongfu', water_temp: 80, tea_grams: 5, water_ml: 100, steep_sec: 10, increment_sec: 5, max_steeps: 3, rinse: 0 },
        { style: 'western', water_temp: 75, tea_grams: 3, water_ml: 200, steep_sec: 180, increment_sec: null, max_steeps: 2, rinse: 0 },
    ],
    harvest: [
        { phase: 'early', months: '3' },
        { phase: 'peak', months: '4' },
    ],
    sensory: [
        { descriptor_id: 'L', descriptor: 'leafy', intensity: 5 },
    ],
    tags: ['gi', 'green'],
    enrichment: {
        caffeine_level: 'medium',
        difficulty: 'intermediate',
        price_tier: 'premium',
        best_season: ['spring'],
        occasion: ['morning', 'focus'],
        flavor_tags: ['chestnut', 'orchid'],
        one_liner: 'Imperial green tea.',
        summary: 'Xi Hu Long Jing is a famous green tea.',
        tasting_note: 'Delicate and sweet.',
        food_pairings: ['Tofu'],
        similar_teas: ['dongting-biluochun'],
    },
    seo: {
        title: 'Xi Hu Long Jing',
        description: 'Dragon Well tea.',
    },
};

const zhCnXihu = {
    ...xihu,
    lang: 'zh-cn',
    name: xihu.name,
};

const { product, warnings } = transformCardSet({ en: xihu, 'zh-CN': zhCnXihu }, {
    knownCategories: new Set([
        'CAT-GREEN-TEA',
        'CAT-REGION-ZHEJIANG',
        'CAT-SHAPE-FLAT',
        'CAT-PROC-CHAOQING',
        'CAT-ROAST-NONE',
        'CAT-SPEC-GI',
    ]),
    publish: false,
    packages: 'standard',
});

assert.strictEqual(product.code, 'TEA-CN-XIHU-LONGJING');
assert.strictEqual(product.published, false);
assert.strictEqual(product.nativeName, '西湖龙井');
assert(product.translations.some(t => t.lang === 'en-US' && t.description.includes('Imperial green tea')));
assert(product.translations.some(t => t.lang === 'en-US' && t.description.includes('## Brewing recipes')));
assert(!product.translations.some(t => t.lang === 'en-US' && t.description.includes('Unknown but retained field.')));
assert(!product.translations.some(t => t.lang === 'en-US' && t.description.includes('Supports digestion after heavy meals.')));
assert(!product.translations.some(t => t.lang === 'en-US' && t.description.includes('## Type')));
assert(!product.translations.some(t => t.lang === 'en-US' && t.description.includes('## Climate')));
assert.strictEqual(product.translations.find(t => t.lang === 'en-US')?.name, 'Xī Hú Lóngjǐng');
assert.strictEqual(product.translations.find(t => t.lang === 'ru-RU')?.name, 'Си Ху Лун Цзин');
assert.strictEqual(product.translations.find(t => t.lang === 'zh-CN')?.name, '西湖龙井');
assert.strictEqual(cleanDisplayName('阿里山乌龙 (阿里山乌龙, Ālǐshān Wūlóng) (阿里山乌龙)'), '阿里山乌龙');
assert(product.catalogs.some(c => c.category === 'CAT-GREEN-TEA'));
assert(product.catalogs.some(c => c.category === 'CAT-REGION-ZHEJIANG'));
assert(product.catalogs.some(c => c.category === 'CAT-SHAPE-FLAT'));
assert(product.catalogs.some(c => c.category === 'CAT-PROC-CHAOQING'));
assert(product.catalogs.some(c => c.category === 'CAT-ROAST-NONE'));
assert(product.catalogs.some(c => c.category === 'CAT-SPEC-GI'));
assert(product.packages.some(p => p.package === 'PKG-50G' && p.default === true));
assert(product.tags.some(t => t.code === 'TAG-TT-GI'));
assert(product.tags.some(t => t.code === 'TAG-FLAVOR-CHESTNUT'));
assert(product.origins[0].coordinates.lat === 30.22);

const specs = product.specifications;
assert(specs.some(s => s.attribute === 'SPEC-TT-BREWING-BREW-TEMP' && s.type === 'Range'));
assert(specs.some(s => s.attribute === 'SPEC-TT-FIELD-BREWING-WATER-TEMP' && s.type === 'Number'));
assert(specs.some(s => s.attribute === 'SPEC-TT-ATOMIC-OXIDATION' && s.type === 'Range'));
assert(specs.some(s => s.attribute === 'SPEC-TT-TERROIR-ALTITUDE' && s.type === 'Range'));
assert(specs.some(s => s.attribute === 'SPEC-TT-FIELD-TERROIR-ALTITUDE' && s.type === 'Number'));
assert(specs.some(s => s.attribute === 'SPEC-TT-RECIPE-GONGFU-WATER-TEMP' && s.type === 'Number'));
assert(specs.find(s => s.attribute === 'SPEC-TT-RECIPE-GONGFU-RINSE').attributeName === 'Gongfu Rinse');
assert(specs.find(s => s.attribute === 'SPEC-TT-RECIPE-WESTERN-WATER-TEMP').attributeName === 'Western Water Temperature');
assert(specs.some(s => s.attribute === 'SPEC-TT-HARVEST-PHASE' && s.option === 'SPEC-TT-OPT-HARVEST-PHASE-EARLY'));
assert(specs.some(s => s.attribute === 'SPEC-TT-NOTES-TERROIR'
    && s.attributeName === 'Terroir Notes'
    && s.type === 'CustomMarkdownText'
    && s.value.includes('Unknown but retained field.')));
assert(specs.some(s => s.attribute === 'SPEC-TT-NOTES-HEALTH'
    && s.attributeName === 'Health Notes'
    && s.type === 'CustomMarkdownText'
    && s.value.includes('Supports digestion after heavy meals.')));
assert(specs.some(s => s.attribute === 'SPEC-TT-TERRORIR-TERRORIR-X7') === false);
assert(!specs.some(s => /^TheTea .* Field \d+$/.test(s.attributeName || '')));

const customKeys = new Set();
for (const spec of specs) {
    if (spec.type === 'Option') continue;
    assert(!customKeys.has(spec.attribute), `duplicate non-option spec ${spec.attribute}`);
    customKeys.add(spec.attribute);
}

assert(warnings.some(w => w.includes('Missing localized ru card')));

console.log('test-transform: OK');
