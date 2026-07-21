const crypto = require('crypto');

const FAQ_DEFINITION = Object.freeze({
    key: 'product_faq',
    name: 'Product FAQ',
    description: 'Localized product FAQ imported from TheTea article data.',
    schema: {
        fields: [
            { id: 'product_code', key: 'product_code', type: 'single_line_text_field', required: true },
            { id: 'article_slug', key: 'article_slug', type: 'single_line_text_field', required: true },
            { id: 'translations', key: 'translations', type: 'json', required: true },
        ],
    },
});

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function normalizeJson(value) {
    return stableStringify(typeof value === 'string' ? JSON.parse(value) : value);
}

function normalizeSlug(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function articleSlug(article) {
    const explicit = normalizeSlug(article.slug);
    if (explicit) return explicit;
    const product = String(article.product || '').replace(/^TEA-[A-Z]{2}-/i, '');
    const derived = normalizeSlug(product);
    if (!derived) throw new Error(`${article.code || '<article>'}: cannot derive article slug.`);
    return derived;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function inlineMarkdown(value) {
    let text = escapeHtml(value);
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
    return text;
}

function markdownToSafeHtml(markdown, sourceCode) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let paragraph = [];
    let list = [];

    const flushParagraph = () => {
        if (!paragraph.length) return;
        blocks.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
        paragraph = [];
    };
    const flushList = () => {
        if (!list.length) return;
        blocks.push(`<ul>${list.map(item => `<li>${inlineMarkdown(item)}</li>`).join('')}</ul>`);
        list = [];
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            flushParagraph();
            flushList();
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            flushParagraph();
            flushList();
            const level = heading[1].length;
            blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
            continue;
        }
        const item = line.match(/^[-*]\s+(.+)$/);
        if (item) {
            flushParagraph();
            list.push(item[1]);
            continue;
        }
        if (line.startsWith('> ')) {
            flushParagraph();
            flushList();
            blocks.push(`<blockquote><p>${inlineMarkdown(line.slice(2))}</p></blockquote>`);
            continue;
        }
        flushList();
        paragraph.push(line);
    }
    flushParagraph();
    flushList();

    return `<article data-source="thetea" data-source-code="${escapeHtml(sourceCode)}">${blocks.join('')}</article>`;
}

function stripMarkdown(value) {
    return String(value || '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^>\s+/gm, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractTitle(markdown, fallback) {
    const match = String(markdown || '').match(/^#\s+(.+)$/m);
    return stripMarkdown(match?.[1] || fallback);
}

function extractExcerpt(markdown) {
    const source = String(markdown || '');
    const quote = source.match(/^>\s+(.+)$/m)?.[1];
    const paragraphs = source.split(/\n\s*\n/).map(value => value.trim());
    const prose = paragraphs.find(value => value && !/^#|^[-*]\s|^`/.test(value));
    const text = stripMarkdown(quote || prose || '');
    return text.length > 500 ? `${text.slice(0, 497).trimEnd()}...` : text || null;
}

function renderNarratives(narratives) {
    const parts = [];
    for (const section of Object.keys(narratives || {}).sort()) {
        parts.push(`## ${section.replace(/_/g, ' ')}`);
        for (const field of Object.keys(narratives[section] || {}).sort()) {
            parts.push(`**${field.replace(/_/g, ' ')}:** ${narratives[section][field]}`);
        }
    }
    return parts.join('\n\n');
}

function articleDto(article) {
    const slug = articleSlug(article);
    const translations = [...(article.translations || [])]
        .map(translation => {
            const markdown = String(translation.markdown || renderNarratives(translation.narratives)).trim();
            if (!markdown) throw new Error(`${article.code}/${translation.lang}: article content is empty.`);
            const title = extractTitle(markdown, slug.replace(/-/g, ' '));
            return {
                languageCode: translation.lang,
                title,
                excerpt: extractExcerpt(markdown),
                contentHtml: markdownToSafeHtml(markdown, article.code),
                metaTitle: title,
                metaDescription: extractExcerpt(markdown),
            };
        })
        .sort((a, b) => a.languageCode.localeCompare(b.languageCode));
    return { slug, translations, authorName: 'TheTea ETL', coverImageAttachmentId: null };
}

function faqEntryDto(metaobject) {
    const slug = normalizeSlug(metaobject.slug)
        || normalizeSlug(String(metaobject.product || '').replace(/^TEA-[A-Z]{2}-/i, ''));
    if (!slug) throw new Error(`${metaobject.code}: cannot derive FAQ handle.`);
    if (slug.length > 80) throw new Error(`${metaobject.code}: FAQ handle exceeds 80 characters.`);
    const translations = [...(metaobject.locales || [])]
        .map(locale => ({
            language_code: locale.lang,
            items: [...locale.items]
                .map(item => ({ order: Number(item.order), question: item.question.trim(), answer: item.answer.trim() }))
                .sort((a, b) => a.order - b.order),
        }))
        .sort((a, b) => a.language_code.localeCompare(b.language_code));
    const values = {
        product_code: metaobject.product,
        article_slug: slug,
        translations,
    };
    return {
        handle: slug,
        displayName: `${metaobject.product} FAQ`,
        valuesJson: stableStringify(values),
    };
}

function comparableArticle(value) {
    if (!value) return null;
    return {
        slug: value.slug,
        translations: [...(value.translations || [])].map(item => ({
            languageCode: item.languageCode,
            title: item.title,
            excerpt: item.excerpt ?? null,
            contentHtml: item.contentHtml,
            metaTitle: item.metaTitle ?? null,
            metaDescription: item.metaDescription ?? null,
        })).sort((a, b) => a.languageCode.localeCompare(b.languageCode)),
        authorName: value.authorName ?? null,
        coverImageAttachmentId: value.coverImageAttachmentId ?? null,
    };
}

function isOwnedArticle(value) {
    return value?.authorName === 'TheTea ETL'
        || ((value?.translations || []).length > 0
            && value.translations.every(item => item.contentHtml?.includes('data-source="thetea"')));
}

function hash(value) {
    return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

module.exports = {
    FAQ_DEFINITION,
    articleDto,
    articleSlug,
    comparableArticle,
    escapeHtml,
    faqEntryDto,
    hash,
    isOwnedArticle,
    markdownToSafeHtml,
    normalizeJson,
    stableStringify,
};
