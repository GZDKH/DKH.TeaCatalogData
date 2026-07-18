const fs = require('fs');
const path = require('path');
const { KNOWN_PACKAGES, validateArtifact } = require('./artifact-validator');

function validateProducts(products, options = {}) {
    if (!options.definitions) {
        throw new Error('validateProducts requires specification definitions; use validateArtifact for complete bundle validation.');
    }
    return validateArtifact({ products, ...options });
}

function writeReport(reportDir, summary) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(reportDir, 'summary.md'), toMarkdown(summary));
}

function toMarkdown(summary) {
    const lines = [
        '# TheTea ETL Summary',
        '',
        `- Valid: ${summary.valid ? 'yes' : 'no'}`,
        `- Products: ${summary.productCount}`,
        `- Category definitions: ${summary.categoryDefinitionCount ?? 0}`,
        `- Field detail files: ${summary.fieldDetailFiles ?? 0}`,
        `- Missing field detail files: ${summary.missingFieldDetailFiles ?? 0}`,
        `- Markdown files: ${summary.markdownFiles ?? 0}`,
        `- Similar files: ${summary.similarFiles ?? 0}`,
        `- Errors: ${summary.errors.length}`,
        `- Warnings: ${summary.warnings.length}`,
        '',
        '## Language Coverage',
        '',
        ...Object.entries(summary.languageCoverage || {}).map(([lang, count]) => `- ${lang}: ${count}`),
        '',
        '## Specification Types',
        '',
        ...Object.entries(summary.specTypes || {}).map(([type, count]) => `- ${type}: ${count}`),
    ];

    const definitionCounts = summary.specificationDefinitionCounts;
    if (definitionCounts) {
        lines.push(
            '',
            '## Specification Definitions',
            '',
            `- Groups: ${definitionCounts.groups ?? 0}`,
            `- Attributes: ${definitionCounts.attributes ?? 0}`,
            `- Options: ${definitionCounts.options ?? 0}`);
    }

    const localization = summary.specificationLocalization;
    if (localization) {
        lines.push(
            '',
            '## Specification Localization',
            '',
            `- Required locales: ${(localization.requiredLocales || []).length}`,
            `- Definitions: ${localization.definitionCount ?? 0}`,
            `- Translation rows: ${localization.translationCount ?? 0}`,
            `- Explicit fallback labels: ${localization.fallbackCount ?? 0}`);
    }

    if (summary.relations) {
        lines.push(
            '',
            '## Product Relations',
            '',
            `- Related: ${summary.relations.related ?? 0}`,
            `- Cross-sells: ${summary.relations.crossSells ?? 0}`);
    }

    if (summary.routedContentCounts) {
        const routed = summary.routedContentCounts;
        lines.push(
            '',
            '## Routed Content',
            '',
            `- Article records: ${routed.articles ?? 0}`,
            `- Article translations: ${routed.articleTranslations ?? 0}`,
            `- Markdown payloads: ${routed.markdown ?? 0}`,
            `- Narrative fields: ${routed.narratives ?? 0}`,
            `- FAQ metaobjects: ${routed.metaobjects ?? 0}`,
            `- FAQ items: ${routed.faqItems ?? 0}`);
    }

    if (summary.sourceManifestSha256 || summary.sourceFilesSha256) {
        lines.push(
            '',
            '## Artifact Integrity',
            '',
            `- Source manifest SHA-256: ${summary.sourceManifestSha256 || 'missing'}`,
            `- Source files SHA-256: ${summary.sourceFilesSha256 || 'missing'}`,
            `- Catalog reference SHA-256: ${summary.catalogReferenceSha256 || 'diagnostic artifact: missing'}`,
            `- Product baseline SHA-256: ${summary.baselineReferenceSha256 || 'diagnostic artifact: missing'}`);
    }

    if (summary.catalogMapping) {
        const mapping = summary.catalogMapping;
        lines.push(
            '',
            '## Prod Catalog Mapping',
            '',
            `- Required catalog: ${mapping.catalog.code}`,
            `- Catalog found: ${mapping.catalog.found ? 'yes' : 'no'}`,
            `- Catalog published: ${mapping.catalog.published === null ? 'n/a' : mapping.catalog.published ? 'yes' : 'no'}`,
            `- Prod categories in snapshot: ${mapping.totals.categories}`,
            `- Mapped categories used: ${mapping.totals.mappedCategories}`,
            `- Missing categories: ${mapping.missingCategories.length}`,
            `- Unpublished categories: ${mapping.unpublishedCategories.length}`);

        if (mapping.categoryUsage.length) {
            lines.push('', '### Category Usage', '');
            for (const item of mapping.categoryUsage) {
                lines.push(`- ${item.code}: ${item.productCount} product(s), ${item.published ? 'published' : 'unpublished'}, ${item.name}`);
            }
        }

        if (mapping.missingCategories.length) {
            lines.push('', '### Missing Categories', '', ...mapping.missingCategories.map(x => `- ${x}`));
        }
    }

    if (summary.errors.length) {
        lines.push('', '## Errors', '', ...summary.errors.map(e => `- ${e}`));
    }

    if (summary.warnings.length) {
        lines.push('', '## Warnings', '', ...summary.warnings.map(w => `- ${w}`));
    }

    return `${lines.join('\n')}\n`;
}

module.exports = {
    KNOWN_PACKAGES,
    validateProducts,
    writeReport,
};
