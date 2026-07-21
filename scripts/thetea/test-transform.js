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
        faq: [{ q: 'How?', a: 'Carefully.' }],
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
    enrichment: {
        ...xihu.enrichment,
        faq: [{ q: '如何？' }, { a: '小心。' }],
    },
};

const { product, warnings, lossEvents, routedContent } = transformCardSet({ en: xihu, 'zh-CN': zhCnXihu }, {
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
    productCodeBySlug: new Map([
        ['xihu-longjing', 'TEA-CN-XIHU-LONGJING'],
        ['dongting-biluochun', 'TEA-CN-DONGTING-BILUOCHUN'],
    ]),
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
assert.strictEqual(product.origins[0].state, 'ZJ');
assert.strictEqual(product.origins[0].city, 'Hangzhou');
assert(product.specifications
    .filter(spec => spec.group === 'SPEC-TT-GROUP-SOURCE')
    .every(spec => spec.showOnPage === false));

const specs = product.specifications;
assert(specs.some(s => s.attribute === 'SPEC-TT-BREWING-BREW-TEMP' && s.type === 'Range'));
assert(!specs.some(s => s.attribute === 'SPEC-TT-FIELD-BREWING-WATER-TEMP'));
assert(!specs.some(s => s.attribute === 'SPEC-TT-FIELD-DETAIL-BREWING-WATER-TEMP'));
assert(specs.some(s => s.attribute === 'SPEC-TT-ATOMIC-OXIDATION' && s.type === 'Range'));
assert(!specs.some(s => /TERROIR-ALTITUDE/.test(s.attribute)));
assert.deepStrictEqual(product.origins[0].altitude, { min: 100, max: 800, unit: 'm' });
assert(specs.some(s => s.attribute === 'SPEC-TT-RECIPE-GONGFU-WATER-TEMP' && s.type === 'Number'));
assert(specs.find(s => s.attribute === 'SPEC-TT-RECIPE-GONGFU-RINSE').attributeName === 'Gongfu Rinse Required');
assert.strictEqual(specs.find(s => s.attribute === 'SPEC-TT-RECIPE-GONGFU-RINSE').value, 'false');
assert.strictEqual(specs.find(s => s.attribute === 'SPEC-TT-RECIPE-GONGFU-STEEP-SEC').type, 'Duration');
assert(specs.find(s => s.attribute === 'SPEC-TT-RECIPE-WESTERN-WATER-TEMP').attributeName === 'Western Water Temperature');
assert.strictEqual(
    specs.find(s => s.attribute === 'SPEC-TT-HARVEST-EARLY-MONTHS').value,
    '["3"]');
assert.strictEqual(
    specs.find(s => s.attribute === 'SPEC-TT-ENRICHMENT-OCCASION').value,
    '["morning","focus"]');
assert(!specs.some(s => s.attribute.startsWith('SPEC-TT-NOTES-')));
assert(specs.some(s => s.attribute === 'SPEC-TT-TERRORIR-TERRORIR-X7') === false);
assert(!specs.some(s => /^TheTea .* Field \d+$/.test(s.attributeName || '')));

const customKeys = new Set();
for (const spec of specs) {
    if (spec.type === 'Option') continue;
    assert(!customKeys.has(spec.attribute), `duplicate non-option spec ${spec.attribute}`);
    customKeys.add(spec.attribute);
}

assert(warnings.some(w => w.includes('Missing localized ru card')));
assert.deepStrictEqual(product.related, [{
    product: 'TEA-CN-DONGTING-BILUOCHUN',
    catalog: 'CATALOG-CHINESE-TEA',
    order: 1,
}]);
assert.strictEqual(routedContent.articles.length, 1);
assert(routedContent.articles[0].translations[0].narratives.terroir.terroir_x7
    .includes('Unknown but retained field.'));
assert(routedContent.articles[0].translations[0].narratives.brewing.water_temp
    .includes('80-90°C.'));
assert(routedContent.articles[0].translations[0].narratives.organoleptic.taste
    .includes('Chestnut, orchid, umami.'));
assert.strictEqual(routedContent.metaobjects[0].locales.reduce(
    (sum, locale) => sum + locale.items.length, 0), 2);
assert(lossEvents.some(event => event.source === 'localized-section-narratives' && event.count >= 8));
assert(lossEvents.some(event => event.source === 'enrichment.faq' && event.count === 2));

const fallbackCard = JSON.parse(JSON.stringify(zhCnXihu));
fallbackCard.sections.history_culture = {
    history: { value: 'Only available outside English.', num: null, unit: null },
};
const fallbackResult = transformCardSet({ en: xihu, 'zh-CN': fallbackCard });
assert(fallbackResult.product.specifications.some(
    spec => spec.attribute === 'SPEC-TT-FIELD-HISTORY-CULTURE-HISTORY'));
assert(fallbackResult.lossEvents.some(event =>
    event.source === 'localized-only-specifications'
    && event.fields.some(field => field.attribute === 'SPEC-TT-FIELD-HISTORY-CULTURE-HISTORY')));

const longNarrativeCard = JSON.parse(JSON.stringify(zhCnXihu));
longNarrativeCard.sections.organoleptic.taste = {
    value: `本地化长文 ${'细节'.repeat(180)}`,
    num: null,
    unit: null,
};
const longNarrativeResult = transformCardSet({ en: xihu, 'zh-CN': longNarrativeCard });
assert(!longNarrativeResult.product.specifications.some(
    spec => spec.attribute === 'SPEC-TT-FIELD-ORGANOLEPTIC-TASTE'));
assert(longNarrativeResult.routedContent.articles[0].translations
    .find(translation => translation.lang === 'zh-CN')
    .narratives.organoleptic.taste.includes('本地化长文'));

const unlabelledSensoryCard = JSON.parse(JSON.stringify(xihu));
unlabelledSensoryCard.sensory = [{ descriptor_id: 'Mw', descriptor: null, intensity: 4 }];
const unlabelledSensoryResult = transformCardSet({ en: unlabelledSensoryCard });
assert(!unlabelledSensoryResult.product.specifications.some(
    spec => spec.attribute === 'SPEC-TT-SENSORY-DESCRIPTOR-MW-INTENSITY'));
assert(unlabelledSensoryResult.lossEvents.some(
    event => event.source === 'sensory-without-label' && event.count === 1));

const missingFaqCard = JSON.parse(JSON.stringify(zhCnXihu));
missingFaqCard.enrichment.faq = [];
const faqFallbackResult = transformCardSet({ en: xihu, 'zh-CN': missingFaqCard });
assert.strictEqual(faqFallbackResult.routedContent.metaobjects[0].locales.length, 2);
assert(faqFallbackResult.lossEvents.some(event =>
    event.source === 'enrichment.faq-fallback'
    && event.locales.some(locale => locale.lang === 'zh-CN' && locale.from === 'en-US')));

const pointRangeCard = JSON.parse(JSON.stringify(xihu));
pointRangeCard.meta.brew_temp_max = null;
const pointRange = transformCardSet({ en: pointRangeCard }).product.specifications
    .find(spec => spec.attribute === 'SPEC-TT-BREWING-BREW-TEMP');
assert.deepStrictEqual([pointRange.valueMin, pointRange.valueMax], [80, 80]);

const kilometerAltitudeCard = JSON.parse(JSON.stringify(xihu));
kilometerAltitudeCard.meta.altitude_min = 1.2;
kilometerAltitudeCard.meta.altitude_max = 1.6;
assert.deepStrictEqual(
    transformCardSet({ en: kilometerAltitudeCard }).product.origins[0].altitude,
    { min: 1200, max: 1600, unit: 'm' });
const lowAltitudeCard = JSON.parse(JSON.stringify(xihu));
lowAltitudeCard.meta.altitude_min = 5;
lowAltitudeCard.meta.altitude_max = 50;
assert.deepStrictEqual(
    transformCardSet({ en: lowAltitudeCard }).product.origins[0].altitude,
    { min: 5, max: 50, unit: 'm' });

console.log('test-transform: OK');
