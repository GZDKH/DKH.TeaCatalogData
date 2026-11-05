const { toProductLocale, canonicalLocale } = require('./locales');
const { articleDto } = require('./routed-content');

function knowledgeTopicFromCards(slug, cards) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) throw new Error(`Unsafe knowledge topic slug: ${slug}`);
    const translations = [];
    for (const [locale, card] of Object.entries(cards)) {
        if (card.kind !== 'category') throw new Error(`${slug}/${locale}: source is not a category article.`);
        if (Array.isArray(card.available_locales)
            && !card.available_locales.map(canonicalLocale).includes(canonicalLocale(locale))) continue;
        if (!String(card.markdown || '').trim()) throw new Error(`${slug}/${locale}: missing source article Markdown.`);
        translations.push({ lang: toProductLocale(locale), title: card.name, markdown: card.markdown });
    }
    const topic = {
        code: `TOPIC-TT-${slug.toUpperCase().replace(/_/g, '-')}`,
        slug,
        source: { system: 'thetea', kind: 'category', externalId: slug },
        translations,
    };
    validateKnowledgeTopics([topic]);
    return topic;
}

function validateKnowledgeTopics(topics) {
    const slugs = new Set();
    for (const topic of topics) {
        if (!topic?.code?.startsWith('TOPIC-TT-') || topic.source?.kind !== 'category'
            || topic.source?.system !== 'thetea' || topic.source?.externalId !== topic.slug) {
            throw new Error('Knowledge topic requires an exact category source identity.');
        }
        if (slugs.has(topic.slug)) throw new Error(`Duplicate knowledge topic: ${topic.slug}`);
        slugs.add(topic.slug);
        const locales = topic.translations?.map(item => item.lang) || [];
        if (!locales.length || new Set(locales).size !== locales.length) throw new Error(`${topic.slug}: empty or duplicate knowledge locales.`);
        articleDto(topic);
    }
    return topics;
}

module.exports = { knowledgeTopicFromCards, validateKnowledgeTopics };
