#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { parseArgs, requireArg } = require('./lib/env');
const { loadVerifiedProductReference } = require('./lib/product-reference');

const GROUPS = {
    sensory: 'SPEC-TT-GROUP-SENSORY',
    organoleptic: 'SPEC-TT-GROUP-ORGANOLEPTIC',
    recipe: 'SPEC-TT-GROUP-RECIPE',
    brewing: 'SPEC-TT-GROUP-BREWING',
    origin: 'SPEC-TT-GROUP-CLASSIFICATION-ORIGIN',
    harvest: 'SPEC-TT-GROUP-HARVEST',
};
const MANAGED_GROUPS = new Set(Object.values(GROUPS));

function walkFiles(root) {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
        const filename = path.join(root, entry.name);
        if (entry.isDirectory()) return walkFiles(filename);
        return entry.isFile() && entry.name.endsWith('.json') ? [filename] : [];
    });
}

function readJson(filename) {
    return JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
}

function loadGeneratedProducts(artifactDir) {
    const productRoot = path.join(artifactDir, '04-products');
    const products = walkFiles(productRoot).flatMap(filename => {
        const value = readJson(filename);
        return Array.isArray(value) ? value : [];
    });
    const seen = new Set();
    for (const product of products) {
        const code = String(product?.code || '').trim().toUpperCase();
        if (!code) throw new Error(`Generated product has no code: ${productRoot}`);
        if (seen.has(code)) throw new Error(`Generated product code is duplicated: ${code}`);
        seen.add(code);
    }
    return products;
}

function populated(value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
}

function specKey(spec) {
    return JSON.stringify([
        spec.group || '',
        spec.attribute || '',
        spec.type || '',
        spec.option || '',
        spec.value ?? '',
    ]);
}

function managedSpecs(product) {
    return (product.specifications || [])
        .filter(spec => spec.lang === 'en-US' && MANAGED_GROUPS.has(spec.group))
        .map(specKey)
        .sort();
}

function groupCoverage(products) {
    return Object.fromEntries(Object.entries(GROUPS).map(([name, group]) => {
        const rows = products.flatMap(product => (product.specifications || [])
            .filter(spec => spec.lang === 'en-US' && spec.group === group));
        const productsWithData = new Set(rows.filter(spec => populated(spec.value) || populated(spec.option))
            .map(spec => spec._productCode));
        const attributes = {};
        const types = {};
        for (const spec of rows) {
            attributes[spec.attribute || '?'] = (attributes[spec.attribute || '?'] || 0) + 1;
            types[spec.type || '?'] = (types[spec.type || '?'] || 0) + 1;
        }
        return [name, {
            group,
            productCount: products.length,
            productsWithData: productsWithData.size,
            coveragePercent: products.length ? Number((productsWithData.size / products.length * 100).toFixed(2)) : 0,
            itemCount: rows.length,
            types,
            attributes,
        }];
    }));
}

function addProductCode(products) {
    return products.map(product => ({
        ...product,
        specifications: (product.specifications || []).map(spec => ({
            ...spec,
            _productCode: product.code,
        })),
    }));
}

function compareBaseline(generated, baseline) {
    if (!baseline) return {
        available: false,
        generatedCount: generated.length,
        baselineCount: 0,
        commonCount: 0,
        generatedOnly: generated.map(p => p.code).sort(),
        baselineOnly: [],
        productsWithManagedSpecChanges: [],
        changedProductCount: 0,
    };
    const generatedByCode = new Map(generated.map(p => [String(p.code).toUpperCase(), p]));
    const baselineByCode = new Map(baseline.map(p => [String(p.code).toUpperCase(), p]));
    const generatedOnly = [...generatedByCode.keys()].filter(code => !baselineByCode.has(code)).sort();
    const baselineOnly = [...baselineByCode.keys()].filter(code => !generatedByCode.has(code)).sort();
    const changed = [];
    for (const code of [...generatedByCode.keys()].filter(key => baselineByCode.has(key)).sort()) {
        const before = managedSpecs(baselineByCode.get(code));
        const after = managedSpecs(generatedByCode.get(code));
        if (JSON.stringify(before) !== JSON.stringify(after)) {
            changed.push({ code, beforeCount: before.length, afterCount: after.length });
        }
    }
    return {
        available: true,
        generatedCount: generated.length,
        baselineCount: baseline.length,
        commonCount: generated.length - generatedOnly.length,
        generatedOnly,
        baselineOnly,
        productsWithManagedSpecChanges: changed,
        changedProductCount: changed.length,
    };
}

function loadSourceManifest(snapshotRoot) {
    if (!snapshotRoot) return null;
    const filename = path.join(snapshotRoot, 'manifest.json');
    return fs.existsSync(filename) ? readJson(filename) : null;
}

function ageDays(iso, now = new Date()) {
    const time = Date.parse(iso || '');
    return Number.isFinite(time) ? Math.max(0, Math.round((now.getTime() - time) / 86400000)) : null;
}

function audit({ artifactDir, productReferenceDir, snapshotRoot, now = new Date() }) {
    const artifactManifest = readJson(path.join(artifactDir, 'artifact-manifest.json'));
    const generated = addProductCode(loadGeneratedProducts(artifactDir));
    const baselineReference = productReferenceDir ? loadVerifiedProductReference(productReferenceDir) : null;
    const sourceManifest = loadSourceManifest(snapshotRoot);
    const baseline = compareBaseline(generated, baselineReference?.products || null);
    const freshnessDays = ageDays(baselineReference?.manifest?.fetchedAt, now);
    const baselineFreshness = !baselineReference
        ? 'missing'
        : freshnessDays !== null && freshnessDays > 30 ? 'historical' : 'recent';
    const sourceFreshnessDays = ageDays(sourceManifest?.completedAt || sourceManifest?.createdAt, now);
    const sourceFreshness = !sourceManifest
        ? 'missing'
        : sourceFreshnessDays !== null && sourceFreshnessDays > 30 ? 'historical' : 'recent';
    const blockers = [];
    if (baselineFreshness !== 'recent') blockers.push('Current ProductCatalog baseline is missing or older than 30 days; refresh it before any import.');
    if (sourceFreshness !== 'recent') blockers.push('TheTea source snapshot is missing or older than 30 days; refresh it before any import.');
    if (baseline.generatedOnly.length) blockers.push(`${baseline.generatedOnly.length} generated product code(s) are absent from the baseline; new-product creation requires a separate approved workflow.`);
    if (artifactManifest.targets?.allowNewProducts === true) blockers.push('Artifact was generated with allow-new-products diagnostic mode; it is not import-ready.');
    if ((sourceManifest?.partialFieldDataSlugs || []).length) blockers.push(`${sourceManifest.partialFieldDataSlugs.length} source slug(s) have partial field locales; deterministic fallback must be reviewed.`);
    if (sourceManifest?.includeMarkdown === false) blockers.push('Source snapshot does not contain Markdown payloads; article/content parity is not proven.');
    const coverage = groupCoverage(generated);
    return {
        schemaVersion: 1,
        generatedAt: now.toISOString(),
        status: blockers.length ? 'diagnostic-blocked' : 'ready-for-review',
        applyAllowed: false,
        artifact: {
            directory: artifactDir,
            snapshotId: artifactManifest.snapshotId || null,
            generatedAt: artifactManifest.generatedAt || null,
            productCount: generated.length,
            productCodeHash: artifactManifest.productCodesSha256 || null,
            diagnosticFlags: {
                allowNewProducts: artifactManifest.targets?.allowNewProducts === true,
                allowPartialFieldLocales: sourceManifest?.partialFieldDataSlugs?.length > 0,
                includeMarkdown: sourceManifest?.includeMarkdown !== false,
            },
        },
        source: {
            snapshotId: sourceManifest?.snapshotId || artifactManifest.snapshotId || null,
            createdAt: sourceManifest?.createdAt || null,
            completedAt: sourceManifest?.completedAt || null,
            ageDays: sourceFreshnessDays,
            freshness: sourceFreshness,
            slugCount: Array.isArray(sourceManifest?.slugs) ? sourceManifest.slugs.length : (sourceManifest?.slugs ?? null),
            partialFieldDataSlugs: sourceManifest?.partialFieldDataSlugs?.length ?? null,
            fieldPackFiles: Array.isArray(sourceManifest?.fieldPackFiles)
                ? sourceManifest.fieldPackFiles.length : (sourceManifest?.fieldPackFiles ?? null),
            markdownFiles: Array.isArray(sourceManifest?.markdownFiles)
                ? sourceManifest.markdownFiles.length : (sourceManifest?.markdownFiles ?? null),
            errors: sourceManifest?.errors?.length ?? null,
            warnings: sourceManifest?.warnings?.length ?? null,
        },
        baseline: {
            fetchedAt: baselineReference?.manifest?.fetchedAt || null,
            ageDays: freshnessDays,
            freshness: baselineFreshness,
            ...baseline,
        },
        coverage,
        blockers,
        nextAction: blockers.length
            ? 'Refresh the read-only source and ProductCatalog references, then rerun this audit before proposing a canary.'
            : 'Review coverage and approve a separate one-product canary; this report itself never writes production.',
    };
}

function markdown(report) {
    const lines = [
        '# Product sensory readiness audit',
        '',
        `- Status: ${report.status}`,
        `- Apply allowed: ${report.applyAllowed ? 'yes' : 'no'}`,
        `- Generated products: ${report.artifact.productCount}`,
        `- Source freshness: ${report.source.freshness}`,
        `- Product baseline freshness: ${report.baseline.freshness}`,
        '',
        '## Coverage',
        '',
        '| Section | Products with data | Coverage | Items |',
        '| --- | ---: | ---: | ---: |',
        ...Object.entries(report.coverage).map(([name, value]) => `| ${name} | ${value.productsWithData} | ${value.coveragePercent}% | ${value.itemCount} |`),
        '',
        '## Baseline comparison',
        '',
        `- Common products: ${report.baseline.commonCount}`,
        `- Generated-only products: ${report.baseline.generatedOnly.length}`,
        `- Baseline-only products: ${report.baseline.baselineOnly.length}`,
        `- Products with managed specification changes: ${report.baseline.changedProductCount}`,
        '',
        '## Blockers',
        '',
        ...(report.blockers.length ? report.blockers.map(item => `- ${item}`) : ['- None']),
        '',
        `Next action: ${report.nextAction}`,
        '',
    ];
    return lines.join('\n');
}

function main() {
    const args = parseArgs();
    const artifactDir = path.resolve(requireArg(args, 'artifact-dir'));
    const productReferenceDir = args['product-ref'] ? path.resolve(String(args['product-ref'])) : null;
    const snapshotRoot = args['snapshot-root'] ? path.resolve(String(args['snapshot-root'])) : null;
    const report = audit({ artifactDir, productReferenceDir, snapshotRoot });
    const output = path.resolve(String(args.out || path.join(artifactDir, 'reports', 'sensory-readiness')));
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(output, 'summary.md'), markdown(report));
    console.log(JSON.stringify({ output, status: report.status, products: report.artifact.productCount, blockers: report.blockers.length }, null, 2));
}

if (require.main === module) main();

module.exports = {
    GROUPS,
    audit,
    compareBaseline,
    groupCoverage,
    loadGeneratedProducts,
    markdown,
};
