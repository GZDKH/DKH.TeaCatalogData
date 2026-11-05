#!/usr/bin/env node
const assert = require('assert');
const { knowledgeTopicFromCards, validateKnowledgeTopics } = require('./lib/knowledge-topics');
const { articleDto } = require('./lib/routed-content');
const { prepareRecords } = require('./prepare-setup-tool-content');

const topic = knowledgeTopicFromCards('bai-cha', {
    ru: { kind: 'category', name: 'Белый чай', markdown: '# Белый чай\n\nСведения об этой группе чая.' },
    en: { kind: 'category', name: 'White tea', markdown: '# White tea\n\nFacts about the tea class.' },
});
assert.strictEqual(topic.code, 'TOPIC-TT-BAI-CHA');
assert.strictEqual(topic.source.kind, 'category');
assert(!Object.hasOwn(topic, 'product'));
assert.deepStrictEqual(topic.translations.map(item => item.lang).sort(), ['en-US', 'ru-RU']);
assert.strictEqual(articleDto(topic).translations.length, 2);
assert.throws(() => knowledgeTopicFromCards('not-topic', { en: { kind: 'tea', markdown: '# Tea' } }), /not a category/);
assert.throws(() => knowledgeTopicFromCards('empty', { en: { kind: 'category' } }), /missing source/);
assert.throws(() => validateKnowledgeTopics([topic, topic]), /Duplicate knowledge topic/);
const limited = knowledgeTopicFromCards('source-only-ru', {
    ru: { kind: 'category', name: 'Источник', markdown: '# Источник\n\nТекст.', available_locales: ['ru'] },
    en: { kind: 'category', name: 'Source fallback', markdown: '# Not an English article', available_locales: ['ru'] },
});
assert.deepStrictEqual(limited.translations.map(item => item.lang), ['ru-RU']);
const prepared = prepareRecords({ routedContent: { articles: [], metaobjects: [], topics: [topic, limited] } }, { only: 'bai-cha' });
assert.strictEqual(prepared.length, 1);
assert.strictEqual(prepared[0].recordKey, 'ARTICLE:bai-cha');
assert.strictEqual(prepared[0].blogPost.translations.length, 2);
assert.strictEqual(prepared[0].blogPost.publish, false);
assert.throws(() => prepareRecords({ routedContent: { articles: [], metaobjects: [], topics: [topic] } }, { only: 'bai' }), /No exact/);
console.log('test-knowledge-topics: OK');
const articleReference = { articles: [{slug:'bai-cha',post:{slug:'bai-cha',isDraft:false,coverImageAttachmentId:'existing-cover',translations:[{languageCode:'ja',title:'手動の翻訳',contentHtml:'<p>残す</p>'}]}}] };
const preserved = prepareRecords({routedContent:{articles:[],metaobjects:[],topics:[topic]}},{},articleReference)[0].blogPost;
assert.strictEqual(preserved.publish,true);
assert.strictEqual(preserved.coverImageAttachmentId,'existing-cover');
assert.strictEqual(preserved.translations.find(item=>item.languageCode==='ja').title,'手動の翻訳');
assert.throws(()=>prepareRecords({routedContent:{articles:[],metaobjects:[],topics:[topic]}},{},{articles:[]}), /Missing or duplicate/);
assert.strictEqual(prepareRecords({routedContent:{articles:[],metaobjects:[],topics:[topic]}},{},{articles:[{slug:'bai-cha',post:null}]})[0].blogPost.publish,false);
