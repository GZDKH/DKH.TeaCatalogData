#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const zlib = require('zlib');
const { once } = require('events');
const { finished } = require('stream/promises');
const { REPO_ROOT, loadDotEnv, parseArgs, requireArg } = require('./lib/env');
const { assertScopedPath } = require('./lib/generated-output');

loadDotEnv();

const API_ORIGIN = 'https://api.cloudflare.com';
const DEFAULT_PAGE_SIZE = 5000;
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function usage() {
    console.log(`Usage:
  node scripts/thetea/export-d1-content.js \\
    --snapshot=thetea-content-d1-2026-07-27 \\
    --database-id=<uuid>

Options:
  --snapshot=<id>       Writes sources/thetea/snapshots/<id>/raw/d1/
  --database-id=<uuid>  Cloudflare D1 database id
  --page-size=<n>       Rows per query, default ${DEFAULT_PAGE_SIZE}
  --resume              Reuse completed table files from the incremental manifest

Environment:
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_Global_API_Key or CLOUDFLARE_GLOBAL_API_KEY
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_AUTH_EMAIL or CLOUDFLARE_EMAIL (optional; otherwise resolved via /user)

The exporter reads content tables only. Cloudflare internal tables such as
_cf_KV are intentionally excluded.`);
}

function requiredEnv(...names) {
    for (const name of names) {
        const value = String(process.env[name] || '').trim();
        if (value) return value;
    }
    throw new Error(`Missing required environment variable: ${names.join(' or ')}`);
}

function optionalEnv(...names) {
    for (const name of names) {
        const value = String(process.env[name] || '').trim();
        if (value) return value;
    }
    return '';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function requestJson(endpoint, options = {}) {
    const url = new URL(endpoint, API_ORIGIN);
    const body = options.body === undefined
        ? null
        : Buffer.from(JSON.stringify(options.body));
    const headers = {
        Accept: 'application/json',
        ...(options.headers || {}),
    };
    if (body) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = body.length;
    }

    return new Promise((resolve, reject) => {
        const request = https.request(url, {
            method: options.method || 'GET',
            headers,
            timeout: options.timeoutMs || 120000,
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(Buffer.from(chunk)));
            response.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let payload;
                try {
                    payload = raw ? JSON.parse(raw) : {};
                } catch (error) {
                    reject(new Error(
                        `Cloudflare returned invalid JSON for ${url.pathname}: ${error.message}`));
                    return;
                }

                const status = response.statusCode || 0;
                if (status < 200 || status >= 300 || payload.success === false) {
                    const details = Array.isArray(payload.errors)
                        ? payload.errors.map(item => `${item.code || 'error'}: ${item.message || ''}`).join('; ')
                        : '';
                    const error = new Error(
                        `Cloudflare HTTP ${status} for ${url.pathname}${details ? `: ${details}` : ''}`);
                    error.status = status;
                    error.retryAfter = Number(response.headers['retry-after'] || 0);
                    reject(error);
                    return;
                }
                resolve(payload);
            });
        });
        request.on('timeout', () => request.destroy(new Error(`Cloudflare request timed out: ${url.pathname}`)));
        request.on('error', reject);
        if (body) request.write(body);
        request.end();
    });
}

async function requestJsonWithRetry(endpoint, options = {}) {
    const attempts = Math.max(1, Number(options.attempts || 5));
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await requestJson(endpoint, options);
        } catch (error) {
            lastError = error;
            const retryable = error.status === 429 || error.status >= 500 || !error.status;
            if (!retryable || attempt === attempts) throw error;
            const delayMs = error.retryAfter > 0
                ? error.retryAfter * 1000
                : Math.min(10000, 500 * (2 ** (attempt - 1)));
            await sleep(delayMs);
        }
    }
    throw lastError;
}

async function resolveCloudflareEmail(apiToken) {
    const configured = optionalEnv('CLOUDFLARE_AUTH_EMAIL', 'CLOUDFLARE_EMAIL');
    if (configured) return configured;
    const payload = await requestJsonWithRetry('/client/v4/user', {
        headers: { Authorization: `Bearer ${apiToken}` },
    });
    const email = String(payload.result?.email || '').trim();
    if (!email) {
        throw new Error(
            'Cloudflare account email could not be resolved. Set CLOUDFLARE_AUTH_EMAIL.');
    }
    return email;
}

function assertTableName(table) {
    if (!TABLE_NAME.test(table)) {
        throw new Error(`Unsafe D1 table name: ${table}`);
    }
    return table;
}

function quoteIdentifier(value) {
    return `"${assertTableName(value).replace(/"/g, '""')}"`;
}

function queryResult(payload) {
    const result = payload.result?.[0];
    if (!result || !Array.isArray(result.results)) {
        throw new Error('Cloudflare D1 query response did not include a result set.');
    }
    return result;
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

function sha256File(file) {
    const hash = crypto.createHash('sha256');
    const data = fs.readFileSync(file);
    hash.update(data);
    return hash.digest('hex');
}

async function writeGzipLine(stream, value, hash) {
    const line = `${JSON.stringify(value)}\n`;
    hash.update(line);
    if (!stream.write(line)) await once(stream, 'drain');
}

async function exportTable(options) {
    const table = assertTableName(options.table);
    const quoted = quoteIdentifier(table);
    const statsSql =
        `SELECT COUNT(*) AS row_count, COALESCE(MAX(rowid), 0) AS max_rowid FROM ${quoted}`;
    const before = queryResult(await options.query(statsSql)).results[0];
    const expectedRows = Number(before.row_count || 0);
    const expectedMaxRowId = Number(before.max_rowid || 0);

    const file = path.join(options.outputDirectory, 'tables', `${table}.ndjson.gz`);
    const schemaFile = path.join(options.outputDirectory, 'schema', `${table}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.mkdirSync(path.dirname(schemaFile), { recursive: true });

    const fileStream = fs.createWriteStream(file, { flags: 'wx' });
    const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });
    gzip.pipe(fileStream);
    const contentHash = crypto.createHash('sha256');

    let exportedRows = 0;
    let lastRowId = 0;
    let pages = 0;
    try {
        while (true) {
            const sql =
                `SELECT rowid AS __d1_rowid__, * FROM ${quoted} ` +
                'WHERE rowid > ? ORDER BY rowid LIMIT ?';
            const page = queryResult(await options.query(
                sql,
                [lastRowId, options.pageSize])).results;
            if (page.length === 0) break;

            for (const row of page) {
                const rowId = Number(row.__d1_rowid__);
                if (!Number.isSafeInteger(rowId) || rowId <= lastRowId) {
                    throw new Error(`${table}: invalid or non-monotonic rowid ${row.__d1_rowid__}`);
                }
                lastRowId = rowId;
                await writeGzipLine(gzip, row, contentHash);
            }

            exportedRows += page.length;
            pages++;
            if (pages % 20 === 0 || exportedRows === expectedRows) {
                console.log(`${table}: ${exportedRows}/${expectedRows}`);
            }
            if (page.length < options.pageSize) break;
        }
        gzip.end();
        await finished(fileStream);
    } catch (error) {
        gzip.destroy();
        fileStream.destroy();
        if (fs.existsSync(file)) fs.unlinkSync(file);
        throw error;
    }

    const after = queryResult(await options.query(statsSql)).results[0];
    const finalRows = Number(after.row_count || 0);
    const finalMaxRowId = Number(after.max_rowid || 0);
    if (expectedRows !== finalRows || expectedMaxRowId !== finalMaxRowId) {
        throw new Error(
            `${table}: source changed during export ` +
            `(before ${expectedRows}/${expectedMaxRowId}, after ${finalRows}/${finalMaxRowId})`);
    }
    if (exportedRows !== expectedRows || lastRowId !== expectedMaxRowId) {
        throw new Error(
            `${table}: exported ${exportedRows}/${lastRowId}, expected ` +
            `${expectedRows}/${expectedMaxRowId}`);
    }

    const columns = queryResult(await options.query(`PRAGMA table_info(${quoted})`)).results;
    writeJsonAtomic(schemaFile, {
        table,
        createSql: options.createSql,
        columns,
    });

    return {
        table,
        rowCount: exportedRows,
        maxRowId: lastRowId,
        pages,
        file: path.relative(options.outputDirectory, file),
        contentSha256: contentHash.digest('hex'),
        compressedSha256: sha256File(file),
        compressedBytes: fs.statSync(file).size,
        schemaFile: path.relative(options.outputDirectory, schemaFile),
        schemaSha256: sha256File(schemaFile),
    };
}

async function main() {
    const args = parseArgs();
    if (args.help || args.h) {
        usage();
        return;
    }

    const snapshotId = requireArg(args, 'snapshot');
    const databaseId = requireArg(args, 'database-id');
    const pageSize = Number(args['page-size'] || DEFAULT_PAGE_SIZE);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10000) {
        throw new Error('--page-size must be an integer between 1 and 10000.');
    }

    const outputDirectory = assertScopedPath(
        path.join(REPO_ROOT, 'sources', 'thetea', 'snapshots', snapshotId, 'raw', 'd1'),
        {
            repoRoot: REPO_ROOT,
            allowedRoot: path.join(REPO_ROOT, 'sources', 'thetea', 'snapshots'),
            allowedDescription: 'sources/thetea/snapshots/',
            label: 'D1 snapshot output',
        });
    const manifestFile = path.join(outputDirectory, 'manifest.json');
    const resume = args.resume === true;
    if (fs.existsSync(outputDirectory) && !resume) {
        throw new Error(`D1 snapshot output already exists: ${outputDirectory}. Pass --resume.`);
    }
    fs.mkdirSync(outputDirectory, { recursive: true });

    const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
    const globalApiKey = requiredEnv(
        'CLOUDFLARE_Global_API_Key',
        'CLOUDFLARE_GLOBAL_API_KEY');
    const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
    const email = await resolveCloudflareEmail(apiToken);
    const queryEndpoint =
        `/client/v4/accounts/${encodeURIComponent(accountId)}` +
        `/d1/database/${encodeURIComponent(databaseId)}/query`;
    const query = async (sql, params = []) => requestJsonWithRetry(queryEndpoint, {
        method: 'POST',
        headers: {
            'X-Auth-Email': email,
            'X-Auth-Key': globalApiKey,
        },
        body: { sql, params },
    });

    const schemaRows = queryResult(await query(
        "SELECT name, sql FROM sqlite_master " +
        "WHERE type = 'table' AND name NOT LIKE '_cf_%' ORDER BY name")).results;
    const tables = schemaRows.map(row => ({
        name: assertTableName(String(row.name || '')),
        createSql: String(row.sql || ''),
    }));
    if (tables.length === 0) throw new Error('No D1 content tables found.');

    const previous = resume && fs.existsSync(manifestFile)
        ? JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
        : null;
    const manifest = previous || {
        schemaVersion: 1,
        snapshotId,
        source: 'cloudflare-d1',
        databaseId,
        generatedAt: new Date().toISOString(),
        pageSize,
        tables: [],
    };
    const completedByName = new Map(
        (manifest.tables || []).map(item => [item.table, item]));

    console.log(`D1 snapshot: ${snapshotId}`);
    console.log(`Content tables: ${tables.length}`);
    console.log(`Page size: ${pageSize}`);
    console.log(`Resume: ${resume ? 'yes' : 'no'}`);

    for (const table of tables) {
        const completed = completedByName.get(table.name);
        const completedFile = completed
            ? path.join(outputDirectory, completed.file)
            : '';
        if (resume && completed?.status === 'complete' && fs.existsSync(completedFile)) {
            console.log(`${table.name}: reused ${completed.rowCount} rows`);
            continue;
        }

        const staleFile = path.join(outputDirectory, 'tables', `${table.name}.ndjson.gz`);
        if (fs.existsSync(staleFile)) fs.unlinkSync(staleFile);
        console.log(`${table.name}: exporting`);
        const result = await exportTable({
            table: table.name,
            createSql: table.createSql,
            outputDirectory,
            pageSize,
            query,
        });
        const record = { ...result, status: 'complete' };
        const index = manifest.tables.findIndex(item => item.table === table.name);
        if (index >= 0) manifest.tables[index] = record;
        else manifest.tables.push(record);
        manifest.tables.sort((left, right) => left.table.localeCompare(right.table));
        writeJsonAtomic(manifestFile, manifest);
    }

    manifest.completedAt = new Date().toISOString();
    manifest.tableCount = manifest.tables.length;
    manifest.rowCount = manifest.tables.reduce((sum, item) => sum + item.rowCount, 0);
    manifest.compressedBytes = manifest.tables.reduce(
        (sum, item) => sum + item.compressedBytes,
        0);
    manifest.complete = manifest.tableCount === tables.length
        && manifest.tables.every(item => item.status === 'complete');
    writeJsonAtomic(manifestFile, manifest);

    console.log(`Tables: ${manifest.tableCount}`);
    console.log(`Rows: ${manifest.rowCount}`);
    console.log(`Compressed bytes: ${manifest.compressedBytes}`);
    console.log(`Manifest: ${manifestFile}`);
    if (!manifest.complete) {
        throw new Error('D1 snapshot manifest is incomplete.');
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    assertTableName,
    quoteIdentifier,
};
