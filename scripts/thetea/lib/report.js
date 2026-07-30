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
    if (summary.productNaming) {
        fs.writeFileSync(
            path.join(reportDir, 'product-naming.json'),
            JSON.stringify(summary.productNaming, null, 2));
    }
    if (summary.categoryCoverage) {
        fs.writeFileSync(
            path.join(reportDir, 'category-coverage.json'),
            JSON.stringify(summary.categoryCoverage, null, 2));
    }
    if (summary.publicationQuality) {
        fs.writeFileSync(
            path.join(reportDir, 'publication-quality.json'),
            JSON.stringify(summary.publicationQuality, null, 2));
    }
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

    if (summary.productNaming) {
        const naming = summary.productNaming;
        const counts = naming.counts || {};
        lines.push(
            '',
            '## Product Naming',
            '',
            `- Valid: ${naming.valid ? 'yes' : 'no'}`,
            `- Translation rows audited: ${counts.translationRows ?? 0}`,
            `- Composite translation names: ${counts.compositeTranslationRows ?? 0}`,
            `- Composite native names: ${counts.compositeNativeNames ?? 0}`,
            `- Native-script transcriptions: ${counts.cjkTranscriptions ?? 0}`,
            `- Editorial display names: ${counts.editorialDisplayNames ?? 0}`,
            `- Duplicate en-US display names: ${counts.duplicateEnglishNames ?? 0}`);

        if (naming.duplicateEnglishNames?.length) {
            lines.push('', '### Duplicate en-US Display Names', '');
            for (const duplicate of naming.duplicateEnglishNames) {
                lines.push(`- ${duplicate.name}: ${duplicate.codes.join(', ')}`);
            }
        }
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

    if (summary.catalogPlacement) {
        const placement = summary.catalogPlacement;
        lines.push(
            '',
            '## Catalog Placement',
            '',
            `- Required catalog: ${placement.requiredCatalog}`,
            `- Binding categories: ${placement.bindingCategoryCount}`,
            `- Binding assignments: ${placement.bindingAssignmentCount}`,
            `- Assigned products: ${placement.assignedProductCount}`,
            `- Unassigned products: ${placement.unassignedProductCount}`);
    }

    if (summary.importTargets) {
        lines.push(
            '',
            '## Import Targets',
            '',
            `- Catalogs: ${(summary.importTargets.catalogCodes || []).join(', ') || 'none'}`,
            `- Storefronts: ${(summary.importTargets.storefrontCodes || []).join(', ') || 'none'}`);
    }

    if (summary.categoryCoverage) {
        const coverage = summary.categoryCoverage;
        lines.push(
            '',
            '## Category Coverage',
            '',
            `- Category codes used: ${coverage.categoryCodeCount ?? 0}`,
            `- Product-category assignments: ${coverage.assignmentCount ?? 0}`,
            `- Assignments per product: ${coverage.minimumAssignmentsPerProduct ?? 0}–${coverage.maximumAssignmentsPerProduct ?? 0}`,
            `- Products with region: ${coverage.productsWithRegion ?? 0}`,
            `- Products with leaf shape: ${coverage.productsWithShape ?? 0}`,
            `- Products with processing: ${coverage.productsWithProcessing ?? 0}`,
            `- Products with family: ${coverage.productsWithFamily ?? 0}`,
            `- Products with herbal type: ${coverage.productsWithHerbalType ?? 0}`,
            `- Products with brewing method: ${coverage.productsWithBrewingMethod ?? 0}`,
            `- Provinces inferred from canonical origin text: ${coverage.inferredProvinceCount ?? 0}`,
            `- Unresolved taxonomy records: ${(coverage.unresolved || []).length}`);

        if (coverage.categoryUsage?.length) {
            lines.push('', '### Normalized Category Usage', '');
            for (const item of coverage.categoryUsage) {
                lines.push(`- ${item.code}: ${item.productCount} product(s)`);
            }
        }

        if (coverage.unresolved?.length) {
            lines.push('', '### Unresolved Taxonomy', '');
            for (const item of coverage.unresolved) {
                lines.push(`- ${item.product} (${item.slug}): ${item.warnings.join(' ')}`);
            }
        }
    }

    if (summary.publicationQuality) {
        const quality = summary.publicationQuality;
        lines.push(
            '',
            '## Publication Quality Gate',
            '',
            `- Gate passed for the current artifact: ${quality.gatePassed ? 'yes' : 'no'}`,
            `- Draft save eligible: ${quality.draftEligible ? 'yes' : 'no'}`,
            `- Bulk publication eligible: ${quality.publicationEligible ? 'yes' : 'no'}`,
            `- Already-published products: ${quality.publishedProductCount ?? 0}`,
            `- Publication candidates: ${quality.publicationCandidateCount ?? 0}`,
            `- Affected products: ${quality.affectedProductCount ?? 0}`,
            `- Findings: ${quality.findingCount ?? 0}`,
            `- Blocking findings: ${quality.blockerCount ?? 0}`,
            `- Draft warnings: ${quality.warningCount ?? 0}`);

        if (Object.keys(quality.ruleCounts || {}).length) {
            lines.push('', '### Findings by Rule', '');
            for (const [rule, count] of Object.entries(quality.ruleCounts)) {
                lines.push(`- ${rule}: ${count}`);
            }
        }

        if (quality.findings?.length) {
            const visibleFindings = quality.findings.slice(0, 50);
            lines.push('', '### First Findings', '');
            for (const finding of visibleFindings) {
                const locale = finding.locale ? ` ${finding.locale}` : '';
                const severity = finding.blocking ? 'BLOCK' : 'DRAFT';
                lines.push(
                    `- ${severity} ${finding.product} [${finding.rule}]${locale} `
                    + `${finding.field}: ${finding.message}`);
            }
            if (quality.findings.length > visibleFindings.length) {
                lines.push(
                    `- ${quality.findings.length - visibleFindings.length} additional finding(s); `
                    + 'see publication-quality.json.');
            }
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
