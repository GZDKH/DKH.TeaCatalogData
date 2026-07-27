#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const { once } = require('events');
const { finished } = require('stream/promises');
const { REPO_ROOT, parseArgs, requireArg } = require('./lib/env');
const { assertScopedPath } = require('./lib/generated-output');

const DEFAULT_BUCKETS = 64;
const SAFE_SLUG = /^[a-z0-9][a-z0-9_-]*$/i;

function usage() {
    console.log(`Usage:
  node scripts/thetea/build-d1-field-packs.js \\
    --snapshot=thetea-content-d1-2026-07-27

Options:
  --snapshot=<id>  Reads raw/d1/tables/tea_field.ndjson.gz
  --buckets=<n>    Temporary hash partitions, default ${DEFAULT_BUCKETS}

Output:
  sources/thetea/snapshots/<id>/raw/d1/field-packs/<slug>.json.gz
  sources/thetea/snapshots/<id>/raw/d1/field-packs-manifest.json`);
}

function sha256File(file) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(file));
    return hash.digest('hex');
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

function bucketForSlug(slug, bucketCount) {
    const digest = crypto.createHash('sha256').update(slug).digest();
    return digest.readUInt32BE(0) % bucketCount;
}

function parseFieldRow(line, lineNumber) {
    let row;
    try {
        row = JSON.parse(line);
    } catch (error) {
        throw new Error(`Invalid tea_field NDJSON at line ${lineNumber}: ${error.message}`);
    }
    const slug = String(row.slug || '').trim();
    const lang = String(row.lang || '').trim();
    const section = String(row.section_code || '').trim();
    const field = String(row.field_code || '').trim();
    if (!SAFE_SLUG.test(slug) || !lang || !section || !field) {
        throw new Error(`Invalid tea_field identity at line ${lineNumber}.`);
    }
    return { row, slug, lang, section, field };
}

async function partitionFields(inputFile, bucketDirectory, bucketCount) {
    const streams = Array.from({ length: bucketCount }, (_, index) =>
        fs.createWriteStream(path.join(bucketDirectory, `${index}.ndjson`), { flags: 'wx' }));
    const input = fs.createReadStream(inputFile).pipe(zlib.createGunzip());
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    let rowCount = 0;
    try {
        for await (const line of lines) {
            if (!line) continue;
            rowCount++;
            const { slug } = parseFieldRow(line, rowCount);
            const stream = streams[bucketForSlug(slug, bucketCount)];
            if (!stream.write(`${line}\n`)) await once(stream, 'drain');
            if (rowCount % 250000 === 0) console.log(`Partitioned fields: ${rowCount}`);
        }
        for (const stream of streams) stream.end();
        await Promise.all(streams.map(stream => finished(stream)));
        return rowCount;
    } catch (error) {
        for (const stream of streams) stream.destroy();
        throw error;
    }
}

function fieldDetail(item) {
    const { row, section, field } = item;
    return {
        section,
        field,
        payload: {
            section_code: section,
            field_code: field,
            ord: row.ord,
            value_md: row.value_md,
            value_num: row.value_num,
            unit: row.unit,
            source: row.source,
            confidence: row.confidence,
            review_status: row.review_status,
            updated_at: row.updated_at,
        },
    };
}

async function writeGzipJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const output = fs.createWriteStream(file, { flags: 'wx' });
    const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });
    gzip.pipe(output);
    gzip.end(`${JSON.stringify(value)}\n`);
    await finished(output);
}

async function buildPacks(bucketDirectory, outputDirectory, bucketCount) {
    const records = [];
    const localeCounts = new Map();
    let rowCount = 0;

    for (let index = 0; index < bucketCount; index++) {
        const bucketFile = path.join(bucketDirectory, `${index}.ndjson`);
        const bySlug = new Map();
        const lines = readline.createInterface({
            input: fs.createReadStream(bucketFile),
            crlfDelay: Infinity,
        });
        let bucketLine = 0;
        for await (const line of lines) {
            if (!line) continue;
            bucketLine++;
            const item = parseFieldRow(line, bucketLine);
            if (!bySlug.has(item.slug)) bySlug.set(item.slug, new Map());
            const byLocale = bySlug.get(item.slug);
            if (!byLocale.has(item.lang)) byLocale.set(item.lang, []);
            byLocale.get(item.lang).push(fieldDetail(item));
            rowCount++;
        }

        for (const [slug, byLocale] of [...bySlug.entries()]
            .sort(([left], [right]) => left.localeCompare(right))) {
            const locales = {};
            let fieldCount = 0;
            for (const [lang, details] of [...byLocale.entries()]
                .sort(([left], [right]) => left.localeCompare(right))) {
                details.sort((left, right) =>
                    left.section.localeCompare(right.section)
                    || left.field.localeCompare(right.field)
                    || Number(left.payload.ord || 0) - Number(right.payload.ord || 0));
                locales[lang] = details;
                fieldCount += details.length;
                localeCounts.set(lang, (localeCounts.get(lang) || 0) + details.length);
            }
            const file = path.join(outputDirectory, `${slug}.json.gz`);
            await writeGzipJson(file, {
                schemaVersion: 1,
                slug,
                fieldCount,
                locales,
            });
            records.push({
                slug,
                fieldCount,
                localeCount: Object.keys(locales).length,
                file: path.basename(file),
                compressedBytes: fs.statSync(file).size,
                compressedSha256: sha256File(file),
            });
        }
        fs.unlinkSync(bucketFile);
        console.log(`Built field-pack bucket ${index + 1}/${bucketCount}`);
    }

    records.sort((left, right) => left.slug.localeCompare(right.slug));
    return {
        records,
        rowCount,
        localeCounts: Object.fromEntries(
            [...localeCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    };
}

async function main() {
    const args = parseArgs();
    if (args.help || args.h) {
        usage();
        return;
    }
    const snapshotId = requireArg(args, 'snapshot');
    const bucketCount = Number(args.buckets || DEFAULT_BUCKETS);
    if (!Number.isSafeInteger(bucketCount) || bucketCount < 1 || bucketCount > 256) {
        throw new Error('--buckets must be an integer between 1 and 256.');
    }

    const d1Directory = assertScopedPath(
        path.join(REPO_ROOT, 'sources', 'thetea', 'snapshots', snapshotId, 'raw', 'd1'),
        {
            repoRoot: REPO_ROOT,
            allowedRoot: path.join(REPO_ROOT, 'sources', 'thetea', 'snapshots'),
            allowedDescription: 'sources/thetea/snapshots/',
            label: 'D1 field-pack input',
        });
    const d1ManifestFile = path.join(d1Directory, 'manifest.json');
    const inputFile = path.join(d1Directory, 'tables', 'tea_field.ndjson.gz');
    if (!fs.existsSync(d1ManifestFile) || !fs.existsSync(inputFile)) {
        throw new Error(`Complete D1 snapshot is required under ${d1Directory}.`);
    }
    const d1Manifest = JSON.parse(fs.readFileSync(d1ManifestFile, 'utf8'));
    if (d1Manifest.complete !== true) throw new Error('D1 snapshot manifest is incomplete.');
    const fieldTable = d1Manifest.tables?.find(item => item.table === 'tea_field');
    if (!fieldTable || fieldTable.status !== 'complete') {
        throw new Error('D1 tea_field table is missing or incomplete.');
    }

    const outputDirectory = path.join(d1Directory, 'field-packs');
    const manifestFile = path.join(d1Directory, 'field-packs-manifest.json');
    if (fs.existsSync(outputDirectory) || fs.existsSync(manifestFile)) {
        throw new Error(`Field-pack output already exists under ${d1Directory}.`);
    }
    const stagingDirectory = fs.mkdtempSync(path.join(d1Directory, '.field-packs-staging-'));
    const bucketDirectory = path.join(stagingDirectory, 'buckets');
    const stagingOutput = path.join(stagingDirectory, 'field-packs');
    fs.mkdirSync(bucketDirectory);
    fs.mkdirSync(stagingOutput);

    try {
        console.log(`Field pack snapshot: ${snapshotId}`);
        console.log(`Buckets: ${bucketCount}`);
        const partitionedRows = await partitionFields(inputFile, bucketDirectory, bucketCount);
        if (partitionedRows !== fieldTable.rowCount) {
            throw new Error(
                `Partitioned ${partitionedRows} fields, expected ${fieldTable.rowCount}.`);
        }
        const result = await buildPacks(
            bucketDirectory,
            stagingOutput,
            bucketCount);
        if (result.rowCount !== fieldTable.rowCount) {
            throw new Error(`Packed ${result.rowCount} fields, expected ${fieldTable.rowCount}.`);
        }

        const manifest = {
            schemaVersion: 1,
            snapshotId,
            sourceTable: 'tea_field',
            sourceTableContentSha256: fieldTable.contentSha256,
            generatedAt: new Date().toISOString(),
            packCount: result.records.length,
            rowCount: result.rowCount,
            localeCounts: result.localeCounts,
            files: result.records,
        };
        writeJsonAtomic(path.join(stagingDirectory, 'field-packs-manifest.json'), manifest);
        fs.renameSync(stagingOutput, outputDirectory);
        fs.renameSync(
            path.join(stagingDirectory, 'field-packs-manifest.json'),
            manifestFile);

        console.log(`Field packs: ${manifest.packCount}`);
        console.log(`Rows: ${manifest.rowCount}`);
        console.log(`Locales: ${Object.keys(manifest.localeCounts).length}`);
        console.log(`Manifest: ${manifestFile}`);
    } finally {
        fs.rmSync(stagingDirectory, { recursive: true, force: true });
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    bucketForSlug,
    parseFieldRow,
};
