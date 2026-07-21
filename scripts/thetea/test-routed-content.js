const assert = require('assert');
const {
    FAQ_DEFINITION,
    articleDto,
    faqEntryDto,
    markdownToSafeHtml,
    normalizeJson,
} = require('./lib/routed-content');
const { buildPlan, definitionCompatible, summarize, verifyApplyInputs } = require('./import-routed-content');

const article = {
    code: 'ARTICLE-TT-TEA-CN-XIHU-LONGJING-DETAIL',
    product: 'TEA-CN-XIHU-LONGJING',
    slug: 'xihu-longjing',
    translations: [{
        lang: 'ru-RU',
        markdown: '# Сиху Лунцзин\n\n> Императорский зелёный чай.\n\nТекст <script>alert(1)</script>.',
        narratives: {},
    }],
};
const faq = {
    code: 'METAOBJECT-TT-TEA-CN-XIHU-LONGJING-FAQ',
    type: 'product_faq',
    product: 'TEA-CN-XIHU-LONGJING',
    slug: 'xihu-longjing',
    locales: [{ lang: 'ru-RU', items: [{ order: 1, question: 'Почему?', answer: 'Потому.' }] }],
};

const dto = articleDto(article);
assert.strictEqual(dto.slug, 'xihu-longjing');
assert.strictEqual(dto.translations[0].title, 'Сиху Лунцзин');
assert.strictEqual(dto.translations[0].excerpt, 'Императорский зелёный чай.');
assert(dto.translations[0].contentHtml.includes('&lt;script&gt;'));
assert(!dto.translations[0].contentHtml.includes('<script>'));
assert(markdownToSafeHtml('[bad](javascript:alert(1))', 'x').includes('javascript:alert'));
assert(!markdownToSafeHtml('[bad](javascript:alert(1))', 'x').includes('href='));

const faqDto = faqEntryDto(faq);
assert.strictEqual(faqDto.handle, 'xihu-longjing');
assert.deepStrictEqual(JSON.parse(faqDto.valuesJson).translations[0].items[0], {
    answer: 'Потому.', order: 1, question: 'Почему?',
});
assert(normalizeJson('{"b":2,"a":1}') === normalizeJson('{"a":1,"b":2}'));
assert(definitionCompatible({ schemaJson: JSON.stringify(FAQ_DEFINITION.schema) }));
assert(!definitionCompatible({ schemaJson: '{"fields":[]}' }));
assert.throws(
    () => verifyApplyInputs({ manifest: {} }, {}),
    /apply is forbidden for a diagnostic artifact/i);

const records = { articles: [article], metaobjects: [faq] };
const emptyClient = {
    getArticle: async () => null,
    listDefinitions: async () => [],
    listEntries: async () => [],
};

(async () => {
    const createPlan = await buildPlan(emptyClient, records);
    assert.deepStrictEqual(summarize(createPlan), { create: 3, update: 0, noop: 0, conflict: 0 });

    const definition = { id: 'definition-id', key: 'product_faq', schemaJson: JSON.stringify(FAQ_DEFINITION.schema) };
    const existingArticle = { id: 'article-id', ...articleDto(article), isDraft: true };
    const existingFaq = { id: 'faq-id', definitionId: definition.id, ...faqEntryDto(faq) };
    const noopClient = {
        getArticle: async () => existingArticle,
        listDefinitions: async () => [definition],
        listEntries: async () => [existingFaq],
    };
    const noopPlan = await buildPlan(noopClient, records);
    assert.deepStrictEqual(summarize(noopPlan), { create: 0, update: 0, noop: 3, conflict: 0 });

    const conflictClient = { ...noopClient, getArticle: async () => ({ ...existingArticle, authorName: 'Merchant', translations: [{ ...existingArticle.translations[0], contentHtml: '<p>Merchant</p>' }] }) };
    const conflictPlan = await buildPlan(conflictClient, records);
    assert.strictEqual(conflictPlan[0].action, 'conflict');

    const faqConflictClient = {
        ...noopClient,
        listEntries: async () => [{ ...existingFaq, valuesJson: '{"product_code":"TEA-CN-OTHER"}' }],
    };
    const faqConflictPlan = await buildPlan(faqConflictClient, records);
    assert.strictEqual(faqConflictPlan.find(item => item.kind === 'faq').action, 'conflict');
    console.log('routed content tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
