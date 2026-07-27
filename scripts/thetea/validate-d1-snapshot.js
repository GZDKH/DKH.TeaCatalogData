#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const { REPO_ROOT, parseArgs, requireArg } = require('./lib/env');
const { assertScopedPath } = require('./lib/generated-output');
const { toApiLocale } = require('./lib/locales');

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

function sha256Buffer(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

async function sha256File(file) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

async function validateTableFile(file, expected) {
    const compressedSha256 = await sha256File(file);
    if (compressedSha256 !== expected.compressedSha256) {
        throw new Error(`${expected.table}: compressed SHA-256 mismatch.`);
    }
    const contentHash = crypto.createHash('sha256');
    const lines = readline.createInterface({
        input: fs.createReadStream(file).pipe(zlib.createGunzip()),
        crlfDelay: Infinity,
    });
    let rowCount = 0;
    let maxRowId = 0;
    for await (const line of lines) {
        if (!line) continue;
        contentHash.update(`${line}\n`);
        rowCount++;
        let row;
        try {
            row = JSON.parse(line);
        } catch (error) {
            throw new Error(`${expected.table}: invalid NDJSON row ${rowCount}: ${error.message}`);
        }
        const rowId = Number(row.__d1_rowid__);
        if (!Number.isSafeInteger(rowId) || rowId <= maxRowId) {
            throw new Error(`${expected.table}: non-monotonic rowid at row ${rowCount}.`);
        }
        maxRowId = rowId;
    }
    if (rowCount !== expected.rowCount || maxRowId !== expected.maxRowId) {
        throw new Error(
            `${expected.table}: expected ${expected.rowCount}/${expected.maxRowId}, ` +
            `found ${rowCount}/${maxRowId}.`);
    }
    if (contentHash.digest('hex') !== expected.contentSha256) {
        throw new Error(`${expected.table}: content SHA-256 mismatch.`);
    }
    return { rowCount, maxRowId };
}

function validateCardIdentity(card, slug, lang) {
    if (card?.slug !== slug) throw new Error(`${slug}/${lang}: card slug mismatch.`);
    if (String(card?.lang || '').toLowerCase() !== String(lang).toLowerCase()) {
        throw new Error(`${slug}/${lang}: card locale mismatch.`);
    }
    if (card?.kind !== 'tea') throw new Error(`${slug}/${lang}: card kind is not tea.`);
    if (!card?.name) throw new Error(`${slug}/${lang}: card has no localized name.`);
    if (!card?.meta || card.meta.slug !== slug) {
        throw new Error(`${slug}/${lang}: card metadata mismatch.`);
    }
    if (!card?.names || typeof card.names !== 'object') {
        throw new Error(`${slug}/${lang}: card has no names map.`);
    }
}

async function validateFieldPacks(d1Directory, fieldManifest, slugs, locales) {
    const slugSet = new Set(slugs);
    const localeCounts = new Map();
    const packSlugs = new Set();
    let rowCount = 0;
    for (const record of fieldManifest.files || []) {
        const slug = String(record.slug || '');
        if (packSlugs.has(slug)) throw new Error(`Duplicate D1 field pack slug '${slug}'.`);
        packSlugs.add(slug);
        const file = path.join(d1Directory, 'field-packs', String(record.file || ''));
        const compressed = fs.readFileSync(file);
        if (sha256Buffer(compressed) !== record.compressedSha256) {
            throw new Error(`${slug}: field-pack SHA-256 mismatch.`);
        }
        const pack = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
        if (pack.slug !== slug) throw new Error(`${slug}: field-pack identity mismatch.`);
        let packRows = 0;
        for (const [sourceLang, details] of Object.entries(pack.locales || {})) {
            const lang = toApiLocale(sourceLang);
            if (!locales.has(lang)) {
                throw new Error(`${slug}: unknown field-pack locale '${sourceLang}'.`);
            }
            if (!Array.isArray(details)) throw new Error(`${slug}/${lang}: invalid field details.`);
            packRows += details.length;
            localeCounts.set(lang, (localeCounts.get(lang) || 0) + details.length);
            for (const detail of details) {
                if (!detail?.section || !detail?.field || !detail?.payload) {
                    throw new Error(`${slug}/${lang}: invalid field detail identity.`);
                }
            }
        }
        if (packRows !== record.fieldCount || packRows !== pack.fieldCount) {
            throw new Error(`${slug}: field-pack row count mismatch.`);
        }
        rowCount += packRows;
    }
    if (rowCount !== fieldManifest.rowCount) {
        throw new Error(
            `Field packs contain ${rowCount} rows, expected ${fieldManifest.rowCount}.`);
    }
    for (const [sourceLang, expected] of Object.entries(fieldManifest.localeCounts || {})) {
        const lang = toApiLocale(sourceLang);
        if ((localeCounts.get(lang) || 0) !== expected) {
            throw new Error(`${lang}: field-pack locale row count mismatch.`);
        }
    }
    return {
        packCount: packSlugs.size,
        productPackCount: [...packSlugs].filter(slug => slugSet.has(slug)).length,
        rowCount,
        localeCount: localeCounts.size,
        packSlugs,
    };
}

async function main() {
    const args = parseArgs();
    const snapshotId = requireArg(args, 'snapshot');
    const snapshotRoot = assertScopedPath(
        path.join(REPO_ROOT, 'sources', 'thetea', 'snapshots', snapshotId),
        {
            repoRoot: REPO_ROOT,
            allowedRoot: path.join(REPO_ROOT, 'sources', 'thetea', 'snapshots'),
            allowedDescription: 'sources/thetea/snapshots/',
            label: 'D1 snapshot validation',
        });
    const d1Directory = path.join(snapshotRoot, 'raw', 'd1');
    const manifestFile = path.join(snapshotRoot, 'manifest.json');
    const manifest = readJson(manifestFile);
    const d1Manifest = readJson(path.join(d1Directory, 'manifest.json'));
    const fieldManifest = readJson(path.join(d1Directory, 'field-packs-manifest.json'));
    const errors = [];
    const warnings = [...(manifest.warnings || [])];
    const tableResults = [];

    if (manifest.snapshotId !== snapshotId) errors.push('Snapshot manifest identity mismatch.');
    if (manifest.errors?.length) errors.push(`Snapshot records ${manifest.errors.length} fatal errors.`);
    if (d1Manifest.complete !== true) errors.push('D1 manifest is incomplete.');
    if (new Set(manifest.slugs || []).size !== manifest.slugs?.length) {
        errors.push('Snapshot manifest has duplicate tea slugs.');
    }
    if (new Set(manifest.langs || []).size !== manifest.langs?.length) {
        errors.push('Snapshot manifest has duplicate locales.');
    }

    for (const table of d1Manifest.tables || []) {
        try {
            const file = path.join(d1Directory, table.file);
            const schemaFile = path.join(d1Directory, table.schemaFile);
            if (await sha256File(schemaFile) !== table.schemaSha256) {
                throw new Error(`${table.table}: schema SHA-256 mismatch.`);
            }
            const result = await validateTableFile(file, table);
            tableResults.push({ table: table.table, ...result });
            console.log(`${table.table}: ${result.rowCount} rows OK`);
        } catch (error) {
            errors.push(error.message);
        }
    }

    const locales = new Set(manifest.langs || []);
    let fieldResult = null;
    try {
        fieldResult = await validateFieldPacks(
            d1Directory,
            fieldManifest,
            manifest.slugs || [],
            locales);
        console.log(`Field packs: ${fieldResult.packCount}/${fieldResult.rowCount} OK`);
    } catch (error) {
        errors.push(error.message);
    }

    let cardCount = 0;
    const cardFiles = new Set(manifest.cardFiles || []);
    const expectedCardCount = (manifest.slugs?.length || 0) * (manifest.langs?.length || 0);
    if (cardFiles.size !== expectedCardCount) {
        errors.push(`Expected ${expectedCardCount} unique card paths, found ${cardFiles.size}.`);
    }
    for (const slug of manifest.slugs || []) {
        for (const lang of manifest.langs || []) {
            const relative = `raw/cards/${lang}/${slug}.json`;
            try {
                if (!cardFiles.has(relative)) throw new Error(`${relative}: absent from manifest.`);
                validateCardIdentity(readJson(path.join(snapshotRoot, relative)), slug, lang);
                cardCount++;
            } catch (error) {
                errors.push(error.message);
                if (errors.length >= 100) break;
            }
        }
        if (errors.length >= 100) break;
    }

    if ((manifest.mapFiles || []).length !== locales.size) {
        errors.push(`Expected ${locales.size} localized map files.`);
    }
    if ((manifest.sourceContractFiles || []).length !== 4) {
        errors.push('Expected four Worker source-contract files.');
    }
    const expectedNoField = new Set(manifest.noFieldDataSlugs || []);
    if (fieldResult) {
        for (const slug of manifest.slugs || []) {
            const hasPack = fieldResult.packSlugs.has(slug);
            if (hasPack === expectedNoField.has(slug)) {
                errors.push(`${slug}: no-field classification disagrees with field-pack inventory.`);
            }
        }
    }

    const report = {
        schemaVersion: 1,
        snapshotId,
        validatedAt: new Date().toISOString(),
        valid: errors.length === 0,
        counts: {
            d1Tables: tableResults.length,
            d1Rows: tableResults.reduce((sum, item) => sum + item.rowCount, 0),
            teas: manifest.slugs?.length || 0,
            locales: locales.size,
            cards: cardCount,
            fieldPacks: fieldResult?.packCount || 0,
            productFieldPacks: fieldResult?.productPackCount || 0,
            fieldRows: fieldResult?.rowCount || 0,
            slugsWithoutFieldRows: expectedNoField.size,
            maps: manifest.mapFiles?.length || 0,
            sourceContracts: manifest.sourceContractFiles?.length || 0,
        },
        hashes: {
            snapshotManifestSha256: await sha256File(manifestFile),
            d1ManifestSha256: await sha256File(path.join(d1Directory, 'manifest.json')),
            fieldPackManifestSha256: await sha256File(
                path.join(d1Directory, 'field-packs-manifest.json')),
        },
        warnings,
        errors,
    };
    const reportFile = path.join(snapshotRoot, 'validation-report.json');
    writeJsonAtomic(reportFile, report);
    console.log(`Cards: ${cardCount}/${expectedCardCount}`);
    console.log(`Warnings: ${warnings.length}`);
    console.log(`Errors: ${errors.length}`);
    console.log(`Report: ${reportFile}`);
    if (!report.valid) throw new Error(`Snapshot validation failed with ${errors.length} errors.`);
}

if (require.main === module) {
    main().catch(error => {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    sha256Buffer,
    validateCardIdentity,
};
