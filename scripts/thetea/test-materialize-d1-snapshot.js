#!/usr/bin/env node
const assert = require('assert');
const {
    buildNames,
    buildTeaCard,
    cleanRow,
    groupRows,
} = require('./materialize-d1-snapshot');

const names = buildNames([
    { slug: 'xihu-longjing', lang: 'en', name: 'Xi Hu Longjing' },
    { slug: 'xihu-longjing', lang: 'ru', name: 'Си Ху Лунцзин' },
]);
assert.deepStrictEqual(names, {
    en: 'Xi Hu Longjing',
    ru: 'Си Ху Лунцзин',
});

const grouped = groupRows([
    { slug: 'a', value: 1 },
    { slug: 'b', value: 2 },
    { slug: 'a', value: 3 },
]);
assert.deepStrictEqual(grouped.get('a').map(item => item.value), [1, 3]);
assert.deepStrictEqual(cleanRow({
    __d1_rowid__: 1,
    slug: 'xihu-longjing',
    search_text: 'private search material',
}, ['search_text']), { slug: 'xihu-longjing' });

const card = buildTeaCard({
    tea: {
        __d1_rowid__: 9,
        slug: 'xihu-longjing',
        article_type: 'tea',
        search_text: 'not part of public TeaCard meta',
        tea_type: 'green',
    },
    lang: 'ru',
    names,
    recipe: [{
        slug: 'xihu-longjing',
        style: 'gongfu',
        water_temp: 80,
    }],
    sensory: [{
        slug: 'xihu-longjing',
        descriptor_id: 'L',
        descriptor: 'leafy',
        intensity: 5,
    }],
    tags: [
        { slug: 'xihu-longjing', tag: 'green' },
        { slug: 'xihu-longjing', tag: 'green' },
    ],
    comparison: [{
        slug: 'xihu-longjing',
        lang: 'en',
        ord: 0,
        other_slug: 'anji-baicha',
        other_name: 'Anji Baicha',
        differences_md: 'Different cultivar.',
    }],
    harvest: [{
        slug: 'xihu-longjing',
        phase: 'peak',
        months: '3,4',
    }],
});

assert.strictEqual(card.slug, 'xihu-longjing');
assert.strictEqual(card.lang, 'ru');
assert.strictEqual(card.name, 'Си Ху Лунцзин');
assert.deepStrictEqual(card.sections, {});
assert.strictEqual(card.meta.__d1_rowid__, undefined);
assert.strictEqual(card.meta.search_text, undefined);
assert.deepStrictEqual(card.tags, ['green']);
assert.deepStrictEqual(card.recipe, [{ style: 'gongfu', water_temp: 80 }]);
assert.deepStrictEqual(card.comparison, [{
    other_slug: 'anji-baicha',
    other_name: 'Anji Baicha',
    differences_md: 'Different cultivar.',
}]);
assert.strictEqual(buildTeaCard({
    tea: { slug: 'xihu-longjing' },
    lang: 'nb',
    names: { no: 'Norsk Longjing', en: 'English Longjing' },
}).name, 'Norsk Longjing');
assert.throws(() => buildTeaCard({
    tea: { slug: '../escape' },
    lang: 'en',
    names: { en: 'Invalid' },
}), /Unsafe or invalid D1 tea slug/);

console.log('test-materialize-d1-snapshot: OK');
