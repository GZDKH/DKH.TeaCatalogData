const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    FAQ_DEFINITION,
    articleDto,
    faqEntryDto,
    markdownToSafeHtml,
    normalizeJson,
} = require('./lib/routed-content');
const {
    applyPlanAndRelease,
    buildPlan,
    definitionCompatible,
    operationEvidence,
    summarize,
    verifyApplyInputs,
    writeOperationsArtifact,
} = require('./import-routed-content');

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
const narrativeArticle = {
    code: 'ARTICLE-TT-TEA-CN-DA-HONG-PAO-DETAIL',
    product: 'TEA-CN-DA-HONG-PAO',
    slug: 'da-hong-pao',
    translations: [
        {
            lang: 'ru-RU',
            title: 'Да Хун Пао',
            narratives: {
                brewing: {
                    water_temp: 'Используйте воду температурой 95 °C.',
                },
                facts: {
                    facts_x0: 'Большой красный халат — знаменитый утёсный улун.',
                },
                classification_origin: {
                    origin: 'Уишань, провинция Фуцзянь, Китай.',
                },
            },
        },
        {
            lang: 'zh-TW',
            title: '大紅袍',
            narratives: {
                classification_origin: { origin: '中國福建武夷山。' },
                organoleptic: { liquor_color: '橙紅明亮。' },
            },
        },
    ],
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

const narrativeDto = articleDto(narrativeArticle);
const narrativeRu = narrativeDto.translations.find(item => item.languageCode === 'ru-RU');
assert.strictEqual(narrativeRu.title, 'Да Хун Пао');
assert(narrativeRu.contentHtml.indexOf('Классификация и происхождение')
    < narrativeRu.contentHtml.indexOf('Факты'));
assert(narrativeRu.contentHtml.indexOf('Факты')
    < narrativeRu.contentHtml.indexOf('Заваривание'));
assert(narrativeRu.contentHtml.includes('<strong>Происхождение:</strong>'));
assert(narrativeRu.contentHtml.includes('<strong>Температура воды:</strong>'));
assert(!narrativeRu.contentHtml.includes('facts_x0'));
const narrativeZhTw = narrativeDto.translations.find(item => item.languageCode === 'zh-TW');
assert.strictEqual(narrativeZhTw.title, '大紅袍');
assert(narrativeZhTw.contentHtml.includes('分類與產地'));
assert(narrativeZhTw.contentHtml.includes('茶湯顏色'));

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

const largePayload = 'x'.repeat(2 * 1024 * 1024);
const boundedEvidence = operationEvidence({
    kind: 'article',
    key: 'large-article',
    action: 'noop',
    remoteId: 'article-id',
    before: { translations: [{ contentHtml: largePayload }] },
    desired: { translations: [{ contentHtml: largePayload }] },
    desiredSha256: 'desired-hash',
});
assert(!Object.hasOwn(boundedEvidence, 'before'));
assert(!Object.hasOwn(boundedEvidence, 'desired'));
assert.strictEqual(typeof boundedEvidence.beforeSha256, 'string');
assert(JSON.stringify(boundedEvidence).length < 1024);

const rollbackFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thetea-rollback-'));
try {
    const rollbackFile = path.join(rollbackFixtureDir, 'rollback.json');
    writeOperationsArtifact(
        rollbackFile,
        { generatedAt: '2026-08-12T00:00:00.000Z', storefrontId: 'storefront-id' },
        [{ kind: 'article', key: 'large-article', before: { contentHtml: largePayload } }],
        item => ({ kind: item.kind, key: item.key, before: item.before }),
    );
    const rollback = JSON.parse(fs.readFileSync(rollbackFile, 'utf8'));
    assert.strictEqual(rollback.operations[0].before.contentHtml, largePayload);

    const failedFile = path.join(rollbackFixtureDir, 'failed.json');
    assert.throws(
        () => writeOperationsArtifact(failedFile, {}, [{}], () => { throw new Error('projection failed'); }),
        /projection failed/,
    );
    assert(!fs.existsSync(failedFile));
} finally {
    fs.rmSync(rollbackFixtureDir, { force: true, recursive: true });
}

const records = { articles: [article], metaobjects: [faq] };
const emptyClient = {
    getArticle: async () => null,
    listDefinitions: async () => [],
    listEntries: async () => [],
};

(async () => {
    const releaseOperations = [{
        kind: 'article',
        action: 'create',
        desired: articleDto(article),
    }];
    const applied = [];
    await applyPlanAndRelease({
        createArticle: async value => applied.push(value.slug),
    }, releaseOperations);
    assert.deepStrictEqual(applied, ['xihu-longjing']);
    assert.strictEqual(releaseOperations.length, 0);

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
