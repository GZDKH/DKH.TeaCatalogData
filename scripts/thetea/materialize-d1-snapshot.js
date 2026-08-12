#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { REPO_ROOT, parseArgs, requireArg } = require('./lib/env');
const { assertScopedPath } = require('./lib/generated-output');
const { d1LocaleCandidates, localesFromMeta } = require('./lib/locales');

const SAFE_SLUG = /^[a-z0-9][a-z0-9_-]*$/i;
const CARD_TABLES = [
    'tea',
    'tea_name',
    'tea_recipe',
    'tea_sensory',
    'tea_tag',
    'tea_comparison',
    'tea_harvest',
];

function usage() {
    console.log(`Usage:
  node scripts/thetea/materialize-d1-snapshot.js \\
    --snapshot=thetea-content-d1-2026-07-27 \\
    [--snapshot-root=/absolute/path/to/snapshot]

Builds compact TeaCard shells for every D1 tea and locale. The complete
localized section payload remains in raw/d1/field-packs/*.json.gz and is
overlaid by generate-import.js, so the snapshot does not duplicate roughly
two million field rows as uncompressed card JSON.`);
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJsonAtomic(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    try {
        fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

function readGzipNdjson(file) {
    const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').trim();
    if (!text) return [];
    return text.split('\n').map((line, index) => {
        try {
            return JSON.parse(line);
        } catch (error) {
            throw new Error(`Invalid NDJSON in ${file} at line ${index + 1}: ${error.message}`);
        }
    });
}

function cleanRow(row, excluded = []) {
    const result = {};
    const excludedSet = new Set(['__d1_rowid__', ...excluded]);
    for (const [key, value] of Object.entries(row || {})) {
        if (!excludedSet.has(key)) result[key] = value;
    }
    return result;
}

function groupRows(rows, key = row => row.slug) {
    const result = new Map();
    for (const row of rows) {
        const value = String(key(row) || '').trim();
        if (!value) continue;
        if (!result.has(value)) result.set(value, []);
        result.get(value).push(row);
    }
    return result;
}

function buildNames(rows) {
    const names = {};
    for (const row of rows || []) {
        const lang = String(row.lang || '').trim();
        const name = String(row.name || '').trim();
        if (lang && name && names[lang] === undefined) names[lang] = name;
    }
    return names;
}

function mapRows(rows, excluded, orderBy) {
    return [...(rows || [])]
        .sort(orderBy)
        .map(row => cleanRow(row, excluded));
}

function buildTeaCard({
    tea,
    lang,
    names,
    recipe = [],
    sensory = [],
    tags = [],
    comparison = [],
    harvest = [],
}) {
    const slug = String(tea?.slug || '').trim();
    if (!SAFE_SLUG.test(slug)) throw new Error(`Unsafe or invalid D1 tea slug '${slug}'.`);
    const fallbackName = d1LocaleCandidates(lang)
        .map(candidate => names[candidate])
        .find(Boolean)
        || names.en
        || names.ru
        || names.zh
        || slug;
    return {
        slug,
        kind: 'tea',
        lang,
        name: fallbackName,
        meta: cleanRow(tea, ['search_text']),
        names,
        sections: {},
        sensory: mapRows(
            sensory,
            ['slug'],
            (left, right) => String(left.descriptor_id).localeCompare(String(right.descriptor_id))),
        recipe: mapRows(
            recipe,
            ['slug'],
            (left, right) => String(left.style).localeCompare(String(right.style))),
        harvest: mapRows(
            harvest,
            ['slug'],
            (left, right) => String(left.phase).localeCompare(String(right.phase))),
        tags: [...new Set(tags.map(row => String(row.tag || '').trim()).filter(Boolean))].sort(),
        comparison: mapRows(
            comparison,
            ['slug', 'lang', 'ord'],
            (left, right) => Number(left.ord || 0) - Number(right.ord || 0)),
    };
}

function relativePath(root, file) {
    const relative = path.relative(path.resolve(root), path.resolve(file));
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)) {
        throw new Error(`Snapshot file must be inside ${root}: ${file}`);
    }
    return relative.split(path.sep).join('/');
}

function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function inventoryD1Files(snapshotRoot, d1Directory, d1Manifest, fieldPackManifest) {
    const files = [
        relativePath(snapshotRoot, path.join(d1Directory, 'manifest.json')),
        relativePath(snapshotRoot, path.join(d1Directory, 'field-packs-manifest.json')),
    ];
    for (const table of d1Manifest.tables || []) {
        files.push(relativePath(snapshotRoot, path.join(d1Directory, table.file)));
        files.push(relativePath(snapshotRoot, path.join(d1Directory, table.schemaFile)));
    }
    for (const pack of fieldPackManifest.files || []) {
        files.push(relativePath(
            snapshotRoot,
            path.join(d1Directory, 'field-packs', pack.file)));
    }
    return [...new Set(files)].sort();
}

function existingSourceFiles(snapshotRoot, rawDirectory, locales) {
    const files = [];
    const sourceContractFiles = [];
    const mapFiles = [];
    for (const relative of [
        'raw/meta.json',
        'raw/family.json',
        'raw/teas-en.json',
    ]) {
        if (fs.existsSync(path.join(snapshotRoot, relative))) files.push(relative);
    }
    for (const relative of [
        'raw/source/docs.html',
        'raw/source/openapi.yaml',
        'raw/source/llms.txt',
        'raw/source/skill.md',
    ]) {
        if (!fs.existsSync(path.join(snapshotRoot, relative))) continue;
        files.push(relative);
        sourceContractFiles.push(relative);
    }
    for (const lang of locales) {
        for (const kind of ['glossary', 'map']) {
            const relative = `raw/${kind}-${lang}.json`;
            if (!fs.existsSync(path.join(snapshotRoot, relative))) continue;
            files.push(relative);
            if (kind === 'map') mapFiles.push(relative);
        }
    }
    return { files, sourceContractFiles, mapFiles };
}

function loadCardTables(d1Directory, d1Manifest) {
    const tableRecords = new Map((d1Manifest.tables || []).map(item => [item.table, item]));
    const result = {};
    for (const table of CARD_TABLES) {
        const record = tableRecords.get(table);
        if (!record || record.status !== 'complete') {
            throw new Error(`Complete D1 table '${table}' is required.`);
        }
        result[table] = readGzipNdjson(path.join(d1Directory, record.file));
        if (result[table].length !== record.rowCount) {
            throw new Error(
                `${table}: read ${result[table].length} rows, expected ${record.rowCount}.`);
        }
    }
    return result;
}

async function main() {
    const args = parseArgs();
    if (args.help || args.h) {
        usage();
        return;
    }
    const snapshotId = requireArg(args, 'snapshot');
    const snapshotRoot = assertScopedPath(
        args['snapshot-root']
            ? path.resolve(String(args['snapshot-root']))
            : path.join(REPO_ROOT, 'sources', 'thetea', 'snapshots', snapshotId),
        {
            repoRoot: REPO_ROOT,
            allowedRoot: path.join(REPO_ROOT, 'sources', 'thetea', 'snapshots'),
            allowedDescription: 'sources/thetea/snapshots/',
            label: 'D1 snapshot materialization',
        });
    const rawDirectory = path.join(snapshotRoot, 'raw');
    const d1Directory = path.join(rawDirectory, 'd1');
    const d1Manifest = readJson(path.join(d1Directory, 'manifest.json'));
    const fieldPackManifest = readJson(path.join(d1Directory, 'field-packs-manifest.json'));
    const meta = readJson(path.join(rawDirectory, 'meta.json'));
    if (d1Manifest.complete !== true) throw new Error('D1 snapshot manifest is incomplete.');
    if (fieldPackManifest.rowCount !== d1Manifest.tables
        .find(item => item.table === 'tea_field')?.rowCount) {
        throw new Error('D1 field-pack manifest does not cover the complete tea_field table.');
    }

    const locales = localesFromMeta(meta);
    if (!locales.length) throw new Error('TheTea meta payload has no locales.');
    const tables = loadCardTables(d1Directory, d1Manifest);
    const teas = [...tables.tea]
        .sort((left, right) => String(left.slug).localeCompare(String(right.slug)));
    const namesBySlug = groupRows(tables.tea_name);
    const recipeBySlug = groupRows(tables.tea_recipe);
    const sensoryBySlug = groupRows(tables.tea_sensory);
    const tagsBySlug = groupRows(tables.tea_tag);
    const comparisonBySlugLang = groupRows(
        tables.tea_comparison,
        row => `${row.slug}\0${row.lang}`);
    const harvestBySlug = groupRows(tables.tea_harvest);
    const fieldPacksBySlug = new Map(
        (fieldPackManifest.files || []).map(item => [String(item.slug), item]));
    const cardFiles = [];
    const noFieldDataSlugs = [];
    const partialFieldDataSlugs = [];
    let reusedCards = 0;
    let materializedCards = 0;

    for (const tea of teas) {
        const slug = String(tea.slug || '').trim();
        if (!SAFE_SLUG.test(slug)) throw new Error(`Unsafe or invalid D1 tea slug '${slug}'.`);
        const fieldPack = fieldPacksBySlug.get(slug);
        if (!fieldPack) noFieldDataSlugs.push(slug);
        else if (Number(fieldPack.localeCount || 0) < locales.length) {
            partialFieldDataSlugs.push({
                slug,
                localeCount: Number(fieldPack.localeCount || 0),
                expectedLocaleCount: locales.length,
            });
        }
        const names = buildNames(namesBySlug.get(slug));
        if (!Object.keys(names).length) throw new Error(`${slug}: no localized names.`);
        for (const lang of locales) {
            const relative = `raw/cards/${lang}/${slug}.json`;
            const file = path.join(snapshotRoot, relative);
            if (fs.existsSync(file)) {
                const existing = readJson(file);
                if (existing.slug !== slug
                    || String(existing.lang || '').toLowerCase() !== lang.toLowerCase()) {
                    throw new Error(`Existing card identity mismatch: ${relative}`);
                }
                if (Object.keys(existing.sections || {}).length) {
                    reusedCards++;
                } else {
                    const localizedComparison = comparisonBySlugLang.get(`${slug}\0${lang}`)
                        || comparisonBySlugLang.get(`${slug}\0en`)
                        || [];
                    writeJsonAtomic(file, buildTeaCard({
                        tea,
                        lang,
                        names,
                        recipe: recipeBySlug.get(slug),
                        sensory: sensoryBySlug.get(slug),
                        tags: tagsBySlug.get(slug),
                        comparison: localizedComparison,
                        harvest: harvestBySlug.get(slug),
                    }));
                    materializedCards++;
                }
            } else {
                const localizedComparison = comparisonBySlugLang.get(`${slug}\0${lang}`)
                    || comparisonBySlugLang.get(`${slug}\0en`)
                    || [];
                writeJsonAtomic(file, buildTeaCard({
                    tea,
                    lang,
                    names,
                    recipe: recipeBySlug.get(slug),
                    sensory: sensoryBySlug.get(slug),
                    tags: tagsBySlug.get(slug),
                    comparison: localizedComparison,
                    harvest: harvestBySlug.get(slug),
                }));
                materializedCards++;
            }
            cardFiles.push(relative);
        }
    }

    const source = existingSourceFiles(snapshotRoot, rawDirectory, locales);
    const d1Files = inventoryD1Files(
        snapshotRoot,
        d1Directory,
        d1Manifest,
        fieldPackManifest);
    const fieldPackFiles = (fieldPackManifest.files || [])
        .map(item => `raw/d1/field-packs/${item.file}`)
        .sort();
    const warnings = noFieldDataSlugs.map(slug => ({
        type: 'missing-d1-field-pack',
        slug,
        message: `No tea_field rows exist for ${slug}; D1 metadata and related rows are preserved.`,
    })).concat(partialFieldDataSlugs.map(item => ({
        type: 'partial-d1-field-locales',
        ...item,
        message: `${item.slug} has field rows for ${item.localeCount}/${item.expectedLocaleCount} locales; routed article generation must use an explicit locale fallback.`,
    })));
    const manifest = {
        schemaVersion: 2,
        snapshotId,
        apiBase: 'https://api.thetea.app',
        source: 'cloudflare-d1-with-worker-contracts',
        createdAt: d1Manifest.generatedAt,
        completedAt: new Date().toISOString(),
        requestedLangs: ['all'],
        requestedFieldLangs: ['all'],
        availableLocales: locales,
        langs: locales,
        fieldLangs: locales,
        includeMarkdown: false,
        markdownSource: 'd1-field-packs',
        includeFields: true,
        fieldSource: 'cloudflare-d1-packs',
        includeSimilar: false,
        similarSource: 'd1-comparison',
        slugs: teas.map(tea => tea.slug),
        files: [...new Set([...source.files, ...cardFiles])].sort(),
        cardFiles: cardFiles.sort(),
        fieldFiles: [],
        fieldPackFiles,
        d1Files,
        noFieldDataSlugs: noFieldDataSlugs.sort(),
        partialFieldDataSlugs: partialFieldDataSlugs
            .sort((left, right) => left.slug.localeCompare(right.slug)),
        missingFieldDetailFiles: [],
        markdownFiles: [],
        mapFiles: source.mapFiles.sort(),
        similarFiles: [],
        sourceContractFiles: source.sourceContractFiles.sort(),
        warnings,
        errors: [],
        materialization: {
            cardCount: cardFiles.length,
            materializedCards,
            reusedExistingCards: reusedCards,
            teaCount: teas.length,
            localeCount: locales.length,
            fieldPackCount: fieldPackManifest.packCount,
            fieldRowCount: fieldPackManifest.rowCount,
            d1TableCount: d1Manifest.tableCount,
            d1RowCount: d1Manifest.rowCount,
            d1ManifestSha256: sha256File(path.join(d1Directory, 'manifest.json')),
            fieldPackManifestSha256: sha256File(
                path.join(d1Directory, 'field-packs-manifest.json')),
        },
    };
    writeJsonAtomic(path.join(snapshotRoot, 'manifest.json'), manifest);

    console.log(`Snapshot: ${snapshotId}`);
    console.log(`Teas: ${teas.length}`);
    console.log(`Locales: ${locales.length}`);
    console.log(`Cards: ${cardFiles.length} (${materializedCards} local, ${reusedCards} reused)`);
    console.log(`D1 field rows: ${fieldPackManifest.rowCount}`);
    console.log(`Tea slugs without field rows: ${noFieldDataSlugs.length}`);
    console.log(`Tea slugs with partial field locales: ${partialFieldDataSlugs.length}`);
    console.log(`Manifest: ${path.join(snapshotRoot, 'manifest.json')}`);
}

if (require.main === module) {
    main().catch(error => {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    buildNames,
    buildTeaCard,
    cleanRow,
    groupRows,
};
