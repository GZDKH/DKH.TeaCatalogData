#!/usr/bin/env node
/**
 * Build an immutable, read-only inventory from a TheTea snapshot.
 *
 * The report contains no source values. It binds every observed leaf to an
 * explicit disposition so missing source data, unsupported entity routes and
 * contract truncation remain reviewable before an import is prepared.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function hashManifest(manifest) {
    return crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

function leafPath(pathParts) {
    return pathParts.map((part, index) => {
        if (/^\d+$/.test(String(part))) return '[]';
        return String(part);
    }).filter((part, index, parts) => part !== '[]' || parts[index - 1] !== '[]').join('.').replace('.[]', '[]');
}

function collectLeaves(value, pathParts = [], result = []) {
    if (Array.isArray(value)) {
        if (!value.length) {
            result.push({ sourcePath: `${leafPath(pathParts)}[]`, valueKind: 'empty-array' });
            return result;
        }
        value.forEach((item, index) => collectLeaves(item, [...pathParts, index], result));
        return result;
    }
    if (value && typeof value === 'object') {
        if (pathParts[0] === 'sections'
            && ['value', 'num', 'unit'].some(key => Object.prototype.hasOwnProperty.call(value, key))) {
            result.push({ sourcePath: leafPath(pathParts), valueKind: 'field' });
            return result;
        }
        for (const [key, child] of Object.entries(value)) collectLeaves(child, [...pathParts, key], result);
        return result;
    }
    result.push({ sourcePath: leafPath(pathParts), valueKind: value === null ? 'null' : typeof value });
    return result;
}

function profileMappings(profile) {
    return (profile?.attributes || []).flatMap(attribute => (attribute.sourcePaths || []).map(sourcePath => ({
        sourcePath,
        targetPath: attribute.key,
        targetCode: attribute.targetCode,
        type: attribute.type,
        disposition: 'typed-definition',
    })));
}

function dispositionFor(sourcePath, mappings) {
    const exact = mappings.filter(item => item.sourcePath === sourcePath || item.sourcePath.replace(/\[\]/g, '') === sourcePath);
    if (exact.length) return { disposition: exact[0].disposition || 'typed-definition', mappings: exact };
    if (sourcePath === 'slug' || sourcePath === 'kind' || sourcePath.startsWith('meta.')) {
        return { disposition: 'source-identity-or-provenance', mappings: [] };
    }
    if (sourcePath.startsWith('names.') || sourcePath === 'name') {
        return { disposition: 'localized-product-name', mappings: [] };
    }
    if (sourcePath.startsWith('seo.')) {
        return { disposition: sourcePath === 'seo.keywords[]' ? 'preserve-source-review' : 'localized-seo', mappings: [] };
    }
    if (sourcePath.startsWith('sections.')) {
        return { disposition: 'routed-content-and-raw-source', mappings: [] };
    }
    if (sourcePath.startsWith('recipe') || sourcePath.startsWith('harvest')) {
        return { disposition: 'typed-when-existing-definition-else-raw', mappings: [] };
    }
    if (sourcePath.startsWith('tags')) {
        return { disposition: 'managed-tag-relationship', mappings: [] };
    }
    return { disposition: 'review-required', mappings: [] };
}

function cardFile(snapshotRoot, entity, lang) {
    const slug = String(entity.slug);
    return entity.entityKind === 'tea'
        ? path.join(snapshotRoot, 'raw', 'cards', lang, `${slug}.json`)
        : path.join(snapshotRoot, 'raw', 'entities', entity.entityKind, 'cards', lang, `${slug}.json`);
}

const DEFAULT_PROFILE_PATH = path.resolve(__dirname, '../../templates/product-profiles/tea/profile.json');

function buildInventory(snapshotRoot, profilePath = DEFAULT_PROFILE_PATH) {
    const manifestPath = path.join(snapshotRoot, 'manifest.json');
    const manifest = readJson(manifestPath);
    const profile = fs.existsSync(profilePath) ? readJson(profilePath) : null;
    const mappings = profileMappings(profile);
    const entities = manifest.entityInventory || (manifest.slugs || []).map(slug => ({ slug, entityKind: 'tea' }));
    const leafIndex = new Map();
    const cards = [];
    const sourceFiles = [];
    const errorsByStatus = {};

    for (const file of manifest.files || []) {
        const absolute = path.join(snapshotRoot, file);
        if (fs.existsSync(absolute)) sourceFiles.push({ file, sha256: sha256File(absolute) });
    }
    for (const issue of manifest.errors || []) {
        const status = String(issue.status || 'unknown');
        errorsByStatus[status] = (errorsByStatus[status] || 0) + 1;
    }

    for (const entity of entities) {
        const locales = {};
        for (const lang of manifest.langs || []) {
            const file = cardFile(snapshotRoot, entity, lang);
            const exists = fs.existsSync(file);
            const observation = (manifest.entityObservations || []).find(item => item.slug === entity.slug && item.lang === lang);
            const error = (manifest.errors || []).find(item => item.endpoint === 'card' && item.slug === entity.slug && item.lang === lang);
            locales[lang] = {
                status: exists ? 'fetched' : (error?.status ? `http-${error.status}` : 'missing'),
                file: exists ? path.relative(snapshotRoot, file).split(path.sep).join('/') : null,
                sha256: exists ? sha256File(file) : null,
                actualKind: observation?.actualKind || null,
                actualLang: observation?.language || null,
                errorStatus: error?.status || null,
            };
            if (!exists) continue;
            const card = readJson(file);
            for (const leaf of collectLeaves(card)) {
                const key = `${leaf.sourcePath}\0${entity.entityKind}`;
                const entry = leafIndex.get(key) || {
                    sourcePath: leaf.sourcePath,
                    entityKinds: new Set(),
                    locales: new Set(),
                    entityCount: 0,
                    valueKinds: new Set(),
                    disposition: null,
                    mappings: [],
                };
                entry.entityKinds.add(entity.entityKind);
                entry.locales.add(lang);
                entry.entityCount += 1;
                entry.valueKinds.add(leaf.valueKind);
                const disposition = dispositionFor(leaf.sourcePath, mappings);
                entry.disposition = disposition.disposition;
                entry.mappings.push(...disposition.mappings);
                leafIndex.set(key, entry);
            }
        }
        cards.push({ slug: entity.slug, entityKind: entity.entityKind, endpoint: entity.endpoint || null, locales });
    }

    const leaves = [...leafIndex.values()].map(item => ({
        sourcePath: item.sourcePath,
        entityKinds: [...item.entityKinds].sort(),
        locales: [...item.locales].sort(),
        entityCount: item.entityCount,
        valueKinds: [...item.valueKinds].sort(),
        disposition: item.disposition || 'review-required',
        mappings: [...new Map(item.mappings.map(mapping => [JSON.stringify(mapping), mapping])).values()],
    })).sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.entityKinds.join().localeCompare(b.entityKinds.join()));

    const fieldCoverage = (manifest.fieldCoverage || []).map(item => ({
        slug: item.slug,
        lang: item.lang,
        entityKind: item.entityKind,
        expectedCount: item.expected?.length || 0,
        fetchedCount: item.fetched?.length || 0,
        missingCount: item.missing?.length || 0,
        status: item.status || 'complete',
        missing: item.missing || [],
    }));
    const truncatedReferences = (manifest.referenceCoverage || []).filter(item => item.possiblyTruncated);
    const missingInfusionRoutes = (manifest.missingEntityCardFiles || [])
        .filter(item => item.entityKind === 'infusion' && item.status === 404)
        .map(item => ({ slug: item.slug, endpoint: item.endpoint, status: item.status }));
    const unexplainedLossCount = leaves.filter(item => !item.disposition).length;
    const report = {
        schemaVersion: 1,
        reportType: 'thetea-source-inventory',
        generatedAt: new Date().toISOString(),
        immutable: true,
        snapshot: {
            id: manifest.snapshotId || null,
            createdAt: manifest.createdAt || null,
            completedAt: manifest.completedAt || null,
            manifestSha256: hashManifest(manifest),
            manifestFileSha256: sha256File(manifestPath),
            requestedLangs: manifest.requestedLangs || [],
            locales: manifest.langs || [],
            advertisedLocales: manifest.availableLocales || [],
        },
        sourceFiles: sourceFiles.sort((a, b) => a.file.localeCompare(b.file)),
        entities: cards,
        leafDisposition: leaves,
        fieldCoverage,
        gaps: {
            errorsByStatus,
            cardLanguageMismatches: manifest.cardLanguageMismatches || [],
            truncatedReferences,
            missingInfusionRoutes,
            warnings: manifest.warnings || [],
            unexplainedLossCount,
        },
        eligibleForImport: unexplainedLossCount === 0
            && Object.keys(errorsByStatus).length === 0
            && truncatedReferences.length === 0
            && (manifest.cardLanguageMismatches || []).length === 0,
    };
    return report;
}

function markdown(report) {
    const lines = [
        '# TheTea source inventory',
        '',
        `Snapshot: ${report.snapshot.id || 'unknown'}`,
        `Immutable manifest SHA-256: ${report.snapshot.manifestFileSha256}`,
        '',
        `- Advertised locales: ${report.snapshot.advertisedLocales.length}`,
        `- Requested locales: ${report.snapshot.locales.length}`,
        `- Entities: ${report.entities.length}`,
        `- Leaf disposition rows: ${report.leafDisposition.length}`,
        `- Import eligible: ${report.eligibleForImport ? 'yes' : 'no'}`,
        '',
        '## Leaf dispositions',
        '',
        '| Source path | Entity kinds | Locales | Disposition |',
        '| --- | --- | ---: | --- |',
    ];
    for (const item of report.leafDisposition) {
        lines.push(`| ${item.sourcePath} | ${item.entityKinds.join(', ')} | ${item.locales.length} | ${item.disposition} |`);
    }
    lines.push('', '## Gaps requiring review', '', `- HTTP errors: ${JSON.stringify(report.gaps.errorsByStatus)}`, `- Possibly truncated references: ${report.gaps.truncatedReferences.length}`, `- Missing infusion routes: ${report.gaps.missingInfusionRoutes.length}`, `- Language mismatches: ${report.gaps.cardLanguageMismatches.length}`, `- Unexplained loss: ${report.gaps.unexplainedLossCount}`, '');
    return `${lines.join('\n')}\n`;
}

function main() {
    const snapshotRoot = process.argv.find(arg => arg.startsWith('--snapshot='))?.slice('--snapshot='.length);
    const outputRoot = process.argv.find(arg => arg.startsWith('--out='))?.slice('--out='.length);
    if (!snapshotRoot || !outputRoot) throw new Error('Usage: build-source-inventory.js --snapshot=SNAPSHOT_DIR --out=REPORT_DIR');
    const report = buildInventory(path.resolve(snapshotRoot));
    fs.mkdirSync(path.resolve(outputRoot), { recursive: true });
    fs.writeFileSync(path.join(outputRoot, 'source-inventory.json'), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(outputRoot, 'source-inventory.md'), markdown(report));
    console.log(JSON.stringify({
        output: path.resolve(outputRoot),
        entities: report.entities.length,
        leaves: report.leafDisposition.length,
        eligibleForImport: report.eligibleForImport,
    }, null, 2));
}

if (require.main === module) main();

module.exports = { buildInventory, collectLeaves, dispositionFor, markdown };
