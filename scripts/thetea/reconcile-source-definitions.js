#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REPO_ROOT, parseArgs } = require('./lib/env');
const { flattenCategories, loadCatalogReference } = require('./lib/catalog-mapping');
const { assertScopedPath, withStagedOutput } = require('./lib/generated-output');

const DEFAULT_MAPPING = path.join(REPO_ROOT, 'docs', 'thetea-definition-reconciliation.json');
const DEFAULT_CATEGORY_MAPPING = path.join(REPO_ROOT, 'docs', 'thetea-category-reconciliation.json');

function normalizeCode(value) {
    const code = value && typeof value === 'object' ? value.code : value;
    return String(code || '').trim().toUpperCase();
}

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function indexByCode(items = []) {
    const index = new Map();
    for (const item of items) {
        const code = normalizeCode(item);
        if (code) index.set(code, item);
    }
    return index;
}

function normalizeType(item) {
    return String(item?.type || item?.valueType || item?.dataType || '').trim().toLowerCase();
}

function normalizeUnit(item) {
    const value = item?.unit;
    return normalizeCode(value) || String(value || '').trim().toLowerCase();
}

function kindForLegacy(code) {
    if (code.includes('-GROUP-')) return 'groups';
    if (code.includes('-OPT-')) return 'options';
    return 'attributes';
}

function referenceForKind(reference, kind) {
    if (kind === 'groups') return reference.specificationGroups || [];
    if (kind === 'options') return reference.specificationAttributeOptions || [];
    return reference.specificationAttributes || [];
}

function definitionDisposition(row, reference) {
    const legacyCode = normalizeCode(row.legacyCode);
    const canonicalCode = normalizeCode(row.proposedCanonicalCode);
    const kind = kindForLegacy(legacyCode);
    const current = indexByCode(referenceForKind(reference, kind));
    const legacy = current.get(legacyCode) || null;
    const canonical = canonicalCode ? current.get(canonicalCode) || null : null;
    const action = String(row.action || '').toLowerCase();
    const result = {
        kind,
        legacyCode,
        canonicalCode: canonicalCode || null,
        legacyId: legacy?.id || null,
        canonicalId: canonical?.id || null,
        sourceAction: row.action,
        disposition: 'review',
        reasons: [],
    };

    if (!canonicalCode || action.includes('route localized') || action.includes('source-semantics')) {
        result.disposition = action.includes('route') ? 'route-content' : 'semantic-review';
        result.reasons.push('no automatic ProductCatalog definition change');
        return result;
    }
    if (action.includes('blocked')) {
        result.disposition = 'conflict';
        result.reasons.push('canonical mapping is explicitly blocked pending semantic/type/ID review');
        return result;
    }
    if (legacy && canonical && legacy.id && canonical.id && legacy.id !== canonical.id) {
        result.disposition = 'conflict';
        result.reasons.push('legacy and canonical codes already resolve to different IDs');
        return result;
    }
    if (canonical) {
        result.disposition = 'reuse-existing-canonical';
        result.reasons.push('canonical code exists; preserve its ID and references');
        return result;
    }
    if (legacy) {
        const expectedType = String(row.currentType || '').trim().toLowerCase();
        const actualType = normalizeType(legacy);
        const expectedUnit = normalizeUnit({ unit: row.unit });
        const actualUnit = normalizeUnit(legacy);
        if (expectedType && actualType && expectedType !== actualType) {
            result.disposition = 'conflict';
            result.reasons.push(`live type ${actualType} differs from matrix type ${expectedType}`);
            return result;
        }
        if (expectedUnit && actualUnit && expectedUnit !== actualUnit) {
            result.disposition = 'conflict';
            result.reasons.push(`live unit ${actualUnit} differs from matrix unit ${expectedUnit}`);
            return result;
        }
        result.disposition = 'rename-review';
        result.reasons.push('preserve existing ID; rename requires supported ID-addressed API and consumer migration');
        return result;
    }
    result.disposition = 'add-review';
    result.reasons.push('no matching live definition; candidate requires explicit registry approval and no automatic creation');
    return result;
}

function fieldDisposition(item, section = true) {
    const target = String(item.target || '').toLowerCase();
    const policy = String(item.policy || '').toLowerCase();
    const definitionCode = item.definitionCode || null;
    let disposition = 'review';
    if (definitionCode) disposition = 'typed-definition';
    else if (/article|localized|content|markdown|faq|media/.test(`${target} ${policy}`)) disposition = 'route-content';
    else if (/provenance|source metadata|raw source/.test(`${target} ${policy}`)) disposition = 'provenance';
    else if (/review|quarantine|disabled/.test(`${target} ${policy}`)) disposition = 'semantic-review';
    return {
        sourcePath: item.sourcePath,
        section,
        observedCardCount: item.observedCardCount ?? item.cards ?? null,
        definitionCode,
        target: item.target || null,
        targetType: item.targetType || null,
        disposition,
        policy: item.policy || null,
    };
}

function categoryDisposition(item, reference) {
    const categories = indexByCode(flattenCategories(reference.categories || []));
    const code = normalizeCode(item.code);
    const current = categories.get(code);
    return {
        code,
        nameRu: item.nameRu || null,
        parent: item.parent || null,
        lineage: item.lineage || [],
        historicalCatalogBinding: item.historicallyBoundToCatalog === true,
        liveId: current?.id || null,
        disposition: current ? 'reuse-existing-id' : 'add-review',
        membershipDisposition: 'preserve-and-reconcile-separately',
        templateDisposition: 'preserve-and-reconcile-separately',
        reason: current
            ? 'preserve current hierarchy, publication and order; update membership only through reviewed mapping'
            : 'category candidate is absent from supplied reference; no automatic creation',
    };
}

function buildReconciliation({ mapping, categoryMapping, reference = null, mappingPath, categoryMappingPath, catalogReferencePath = null }) {
    if (mapping.schemaVersion !== 1) throw new Error('Unsupported definition reconciliation schema.');
    if (mapping.sectionFields?.length !== 284) throw new Error(`Expected 284 section fields, got ${mapping.sectionFields?.length || 0}.`);
    if (mapping.outsideSectionLeaves?.length !== 83) throw new Error(`Expected 83 non-section paths, got ${mapping.outsideSectionLeaves?.length || 0}.`);
    if (mapping.definitionCodeMigration?.rows?.length !== 89) throw new Error(`Expected 89 code migration rows, got ${mapping.definitionCodeMigration?.rows?.length || 0}.`);
    if (categoryMapping.categoryInventory?.length !== 210) throw new Error(`Expected 210 category definitions, got ${categoryMapping.categoryInventory?.length || 0}.`);
    if (categoryMapping.directMappings?.length !== 62) throw new Error(`Expected 62 direct category maps, got ${categoryMapping.directMappings?.length || 0}.`);

    const live = reference || {};
    const matrixByCode = new Map((mapping.existingDefinitionMatrix || []).map(item => [normalizeCode(item.code), item]));
    for (const item of mapping.existingExecutableProfileAttributes || []) {
        const code = normalizeCode(item.targetCode);
        if (code && !matrixByCode.has(code)) matrixByCode.set(code, {
            code,
            currentType: item.type,
            unit: item.unit || null,
        });
    }
    const migration = mapping.definitionCodeMigration.rows.map(row => {
        const matrixRow = matrixByCode.get(normalizeCode(row.legacyCode)) || {};
        return {
            ...matrixRow,
            ...row,
            ...definitionDisposition({ ...matrixRow, ...row }, live),
        };
    });
    const canonicalOwners = new Map();
    for (const row of migration) {
        if (!row.canonicalCode) continue;
        if (!canonicalOwners.has(row.canonicalCode)) canonicalOwners.set(row.canonicalCode, []);
        canonicalOwners.get(row.canonicalCode).push(row.legacyCode);
    }
    for (const row of migration) {
        const owners = canonicalOwners.get(row.canonicalCode) || [];
        if (owners.length > 1 && row.disposition !== 'route-content' && row.disposition !== 'semantic-review') {
            row.disposition = 'conflict';
            row.reasons.push(`canonical code is proposed by multiple legacy concepts: ${owners.join(', ')}`);
        }
    }

    const sections = mapping.sectionFields.map(item => fieldDisposition(item, true));
    const outside = mapping.outsideSectionLeaves.map(item => fieldDisposition(item, false));
    const categoryDefinitions = categoryMapping.categoryInventory.map(item => categoryDisposition(item, live));
    const directCategoryMappings = categoryMapping.directMappings.map(item => ({
        ...item,
        disposition: item.existsInHistoricalReference ? 'reuse-existing-category-candidate' : 'review',
        membershipDisposition: 'preserve-existing-memberships-and-apply-only-reviewed-product-map',
    }));
    const liveGroups = (live.specificationGroups || []).map(item => ({ code: normalizeCode(item), id: item.id || null, disposition: 'preserve-unmapped-group' }));
    const liveOptions = (live.specificationAttributeOptions || []).map(item => ({ code: normalizeCode(item), id: item.id || null, disposition: 'preserve-unmapped-option' }));
    const conflicts = migration.filter(item => item.disposition === 'conflict');
    const review = migration.filter(item => /review|semantic|add/.test(item.disposition));
    const routeCount = [...sections, ...outside].filter(item => item.disposition === 'route-content').length;
    const typedCount = [...sections, ...outside].filter(item => item.disposition === 'typed-definition').length;
    return {
        schemaVersion: 1,
        mode: 'read-only-provider-independent-definition-reconciliation',
        applyAllowed: false,
        eligible: Boolean(reference) && conflicts.length === 0 && review.length === 0,
        reference: {
            supplied: Boolean(reference),
            path: catalogReferencePath,
            sha256: catalogReferencePath ? sha256File(catalogReferencePath) : null,
        },
        sourceEvidence: {
            mappingPath,
            mappingSha256: sha256File(mappingPath),
            categoryMappingPath,
            categoryMappingSha256: sha256File(categoryMappingPath),
            sourceScope: mapping.sourceScope,
            sectionFieldCount: sections.length,
            outsideSectionLeafCount: outside.length,
            migrationRowCount: migration.length,
            categoryDefinitionCount: categoryDefinitions.length,
            directCategoryMappingCount: directCategoryMappings.length,
        },
        summary: {
            typedDefinitionFields: typedCount,
            routedContentFields: routeCount,
            fieldReviewFields: sections.length + outside.length - typedCount - routeCount,
            migration: migration.reduce((acc, item) => {
                acc[item.disposition] = (acc[item.disposition] || 0) + 1;
                return acc;
            }, {}),
            categories: categoryDefinitions.reduce((acc, item) => {
                acc[item.disposition] = (acc[item.disposition] || 0) + 1;
                return acc;
            }, {}),
            categoryAxes: new Set([
                ...directCategoryMappings.map(item => item.axis),
                ...categoryDefinitions.filter(item => !item.parent).map(item => item.code),
            ]).size,
            liveGroups: liveGroups.length,
            liveOptions: liveOptions.length,
        },
        conflicts,
        definitionMigration: migration,
        sectionFields: sections,
        outsideSectionLeaves: outside,
        categories: {
            definitions: categoryDefinitions,
            directMappings: directCategoryMappings,
        },
        preservedReferences: { groups: liveGroups, options: liveOptions },
        invariants: [
            'No definition, option, category, catalog binding or product membership is created or deleted by this report.',
            'Equivalent rename candidates preserve the existing ProductCatalog ID and require an ID-addressed supported API.',
            'Product specifications remain distinct from configurable attributes and sellable variants.',
            'Source provenance and locale policy remain separate from canonical definition identity.',
            'Category definition, catalog-category link, product membership and effective templates are reconciled independently.',
        ],
    };
}

function writeReport(output, report) {
    withStagedOutput(output, staging => {
        fs.writeFileSync(path.join(staging, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'definition-migration.json'), `${JSON.stringify(report.definitionMigration, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'section-fields.json'), `${JSON.stringify(report.sectionFields, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'outside-section-leaves.json'), `${JSON.stringify(report.outsideSectionLeaves, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'categories.json'), `${JSON.stringify(report.categories, null, 2)}\n`);
    });
}

function main() {
    const args = parseArgs();
    const mappingPath = path.resolve(args.mapping || DEFAULT_MAPPING);
    const categoryMappingPath = path.resolve(args['category-mapping'] || DEFAULT_CATEGORY_MAPPING);
    const catalogReferencePath = args['catalog-ref'] ? path.resolve(args['catalog-ref']) : null;
    const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    const categoryMapping = JSON.parse(fs.readFileSync(categoryMappingPath, 'utf8'));
    const reference = catalogReferencePath ? loadCatalogReference(catalogReferencePath) : null;
    const report = buildReconciliation({ mapping, categoryMapping, reference, mappingPath, categoryMappingPath, catalogReferencePath });
    const output = assertScopedPath(
        path.join(REPO_ROOT, 'reports', 'thetea', String(args.report || 'definition-reconciliation')),
        { repoRoot: REPO_ROOT, allowedRoot: path.join(REPO_ROOT, 'reports', 'thetea'), allowedDescription: 'reports/thetea/', label: 'TheTea definition reconciliation report' });
    writeReport(output, report);
    console.log(`Eligible: ${report.eligible ? 'yes' : 'no'}`);
    console.log(`Fields: ${report.sourceEvidence.sectionFieldCount} section + ${report.sourceEvidence.outsideSectionLeafCount} non-section`);
    console.log(`Definitions: ${JSON.stringify(report.summary.migration)}`);
    console.log(`Categories: ${report.sourceEvidence.categoryDefinitionCount} definitions, ${report.sourceEvidence.directCategoryMappingCount} direct mappings, ${report.summary.categoryAxes} axes`);
    console.log(`Report: ${output}`);
    if (args['fail-on-conflict'] && !report.eligible) process.exitCode = 1;
    return report;
}

if (require.main === module) {
    try { main(); } catch (error) {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { buildReconciliation, definitionDisposition, fieldDisposition, categoryDisposition };
