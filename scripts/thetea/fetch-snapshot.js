#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, loadDotEnv, parseArgs, csv, getTheTeaApiKey, requireArg } = require('./lib/env');
const { requestJson, requestText } = require('./lib/http');
const { localesFromMeta, resolveRequestedLocales } = require('./lib/locales');
const { extractFieldRefs } = require('./lib/field-details');
const { classifyFetchIssue } = require('./lib/snapshot-errors');
const { resolveFieldLocales, shouldFetchFieldsForLang } = require('./lib/snapshot-options');
const { createRequestStartGate } = require('./lib/request-start-gate');

const API_BASE = 'https://api.thetea.app';

loadDotEnv();

let waitForRequestStart = async () => {};

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, ''));
}

function safePathPart(value) {
    return String(value || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '_');
}

function headers() {
    const key = getTheTeaApiKey();
    return key ? { Authorization: `Bearer ${key}` } : {};
}

async function getJson(endpoint) {
    await waitForRequestStart();
    return requestJson(`${API_BASE}${endpoint}`, { headers: headers(), timeoutMs: 30000, retries: 2 });
}

async function getText(endpoint) {
    await waitForRequestStart();
    const response = await requestText(endpointUrl(endpoint), { headers: headers(), timeoutMs: 30000, retries: 2 });
    return response.body;
}

function endpointUrl(endpoint) {
    return /^https?:\/\//i.test(String(endpoint)) ? String(endpoint) : `${API_BASE}${endpoint}`;
}

function issueFromError(base, error) {
    return {
        ...base,
        status: error.status,
        message: error.message,
        body: error.body,
    };
}

async function writeTextSource(root, manifest, rel, endpoint, options = {}) {
    try {
        const target = path.join(root, rel);
        if (options.resume && fs.existsSync(target)) {
            manifest.files.push(rel);
            manifest.sourceContractFiles.push(rel);
            return;
        }

        ensureDir(path.dirname(target));
        fs.writeFileSync(target, await getText(endpoint));
        manifest.files.push(rel);
        manifest.sourceContractFiles.push(rel);
    } catch (error) {
        manifest.errors.push(issueFromError({ endpoint }, error));
    }
}

async function fetchAllTeas(lang, pageSize = 500) {
    const items = [];
    const pages = [];
    let offset = 0;

    while (true) {
        const page = await getJson(`/api/v2/teas?limit=${pageSize}&offset=${offset}&lang=${encodeURIComponent(lang)}`);
        const pageItems = page.items || [];
        items.push(...pageItems);
        pages.push({
            offset,
            count: page.count,
            itemCount: pageItems.length,
        });

        if (pageItems.length < pageSize) break;
        offset += pageItems.length;
    }

    return {
        count: items.length,
        offset: 0,
        items,
        pages,
    };
}

async function mapLimit(items, limit, worker) {
    const queue = [...items];
    const workers = Array.from({ length: Math.max(1, limit) }, async () => {
        while (queue.length) {
            const item = queue.shift();
            await worker(item);
        }
    });
    await Promise.all(workers);
}

async function main() {
    const args = parseArgs();
    const snapshotId = requireArg(args, 'snapshot');
    const requestedLangs = csv(args.langs);
    const requestedFieldLangs = csv(args['field-langs']);
    const only = new Set(csv(args.only));
    const limit = args.limit ? Number(args.limit) : null;
    const force = args.force === true;
    const resume = args.resume === true;
    const concurrency = Math.max(1, Number(args.concurrency || process.env.THETEA_FETCH_CONCURRENCY || 4));
    const configuredMinInterval = args['min-interval-ms']
        ?? process.env.THETEA_FETCH_MIN_INTERVAL_MS
        ?? (getTheTeaApiKey() ? 0 : 550);
    const minIntervalMs = Number(configuredMinInterval);
    if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
        throw new Error(`Invalid minimum request interval '${configuredMinInterval}'.`);
    }
    waitForRequestStart = createRequestStartGate(minIntervalMs);
    const includeMarkdown = args['skip-md'] !== true;
    const includeFields = args['skip-fields'] !== true;
    const includeSimilar = args['skip-similar'] !== true;

    const root = path.join(REPO_ROOT, 'sources', 'thetea', 'snapshots', snapshotId);
    const raw = path.join(root, 'raw');
    if (fs.existsSync(root) && !force && !resume) {
        throw new Error(`Snapshot '${snapshotId}' already exists. Pass --force to overwrite or --resume to continue.`);
    }

    ensureDir(raw);

    const metaPath = path.join(raw, 'meta.json');
    const meta = resume && fs.existsSync(metaPath)
        ? readJson(metaPath)
        : await getJson('/api/v2/meta');
    const langs = resolveRequestedLocales(requestedLangs, meta);
    const fieldLangs = includeFields ? resolveFieldLocales(requestedFieldLangs, langs) : [];
    const availableLocales = localesFromMeta(meta);

    const manifest = {
        snapshotId,
        apiBase: API_BASE,
        createdAt: new Date().toISOString(),
        requestedLangs: requestedLangs.length ? requestedLangs : ['all'],
        requestedFieldLangs: requestedFieldLangs.length ? requestedFieldLangs : ['all'],
        availableLocales,
        langs,
        fieldLangs,
        includeMarkdown,
        includeFields,
        includeSimilar,
        slugs: [],
        files: [],
        fieldFiles: [],
        missingFieldDetailFiles: [],
        markdownFiles: [],
        mapFiles: [],
        similarFiles: [],
        sourceContractFiles: [],
        warnings: [],
        errors: [],
    };

    console.log(`TheTea snapshot: ${snapshotId}`);
    console.log(`Languages: ${langs.length} (${langs.join(', ')})`);
    console.log(`API key: ${getTheTeaApiKey() ? 'configured' : 'not configured'}`);
    console.log(`Concurrency: ${concurrency}`);
    console.log(`Minimum request interval: ${minIntervalMs} ms`);
    console.log(`Resume: ${resume ? 'yes' : 'no'}`);
    console.log(`Field languages: ${fieldLangs === null ? 'all' : fieldLangs.join(', ') || 'none'}`);

    await writeTextSource(root, manifest, 'raw/source/docs.html', '/docs', { resume });
    await writeTextSource(root, manifest, 'raw/source/openapi.yaml', '/openapi.yaml', { resume });
    await writeTextSource(root, manifest, 'raw/source/llms.txt', '/llms.txt', { resume });
    await writeTextSource(root, manifest, 'raw/source/skill.md', 'https://tea.support/skill/SKILL.md', { resume });

    writeJson(metaPath, meta);
    manifest.files.push('raw/meta.json');

    const familyPath = path.join(raw, 'family.json');
    const family = resume && fs.existsSync(familyPath)
        ? readJson(familyPath)
        : await getJson('/api/v2/family');
    writeJson(familyPath, family);
    manifest.files.push('raw/family.json');

    for (const lang of langs) {
        try {
            const glossaryRel = `raw/glossary-${lang}.json`;
            const glossaryPath = path.join(root, glossaryRel);
            if (!(resume && fs.existsSync(glossaryPath))) {
                const glossary = await getJson(`/api/v2/glossary?lang=${encodeURIComponent(lang)}&limit=500`);
                writeJson(glossaryPath, glossary);
            }
            manifest.files.push(`raw/glossary-${lang}.json`);
        } catch (error) {
            manifest.errors.push(issueFromError({ endpoint: 'glossary', lang }, error));
        }

        try {
            const mapRel = `raw/map-${lang}.json`;
            const mapPath = path.join(root, mapRel);
            if (!(resume && fs.existsSync(mapPath))) {
                const map = await getJson(`/api/v2/map?lang=${encodeURIComponent(lang)}`);
                writeJson(mapPath, map);
            }
            manifest.files.push(mapRel);
            manifest.mapFiles.push(mapRel);
        } catch (error) {
            manifest.errors.push(issueFromError({ endpoint: 'map', lang }, error));
        }
    }

    const teasLang = langs.includes('en') ? 'en' : langs[0];
    const teasPath = path.join(raw, `teas-${teasLang}.json`);
    const teas = resume && fs.existsSync(teasPath)
        ? readJson(teasPath)
        : await fetchAllTeas(teasLang);
    writeJson(teasPath, teas);
    manifest.files.push(`raw/teas-${teasLang}.json`);

    let items = teas.items || [];
    if (only.size) items = items.filter(item => only.has(item.slug));
    if (limit) items = items.slice(0, limit);

    manifest.slugs = items.map(item => item.slug);
    console.log(`Cards to fetch: ${manifest.slugs.length}`);

    const cardTasks = manifest.slugs.flatMap(slug => langs.map(lang => ({ slug, lang })));
    await mapLimit(cardTasks, concurrency, async ({ slug, lang }) => {
        const cardRel = `raw/cards/${lang}/${slug}.json`;
        const cardPath = path.join(root, cardRel);
        let card = null;
        try {
            if (resume && fs.existsSync(cardPath)) {
                card = readJson(cardPath);
                manifest.files.push(cardRel);
                process.stdout.write('r');
            } else {
                card = await getJson(`/api/v2/tea/${encodeURIComponent(slug)}?lang=${encodeURIComponent(lang)}`);
                writeJson(cardPath, card);
                manifest.files.push(cardRel);
                process.stdout.write('.');
            }
        } catch (error) {
            manifest.errors.push({ endpoint: 'card', slug, lang, status: error.status, message: error.message });
            process.stdout.write('x');
        }

        if (includeFields && card && shouldFetchFieldsForLang(lang, fieldLangs)) {
            const fieldRefs = extractFieldRefs(card);
            for (const ref of fieldRefs) {
                const fieldRel = `raw/fields/${safePathPart(lang)}/${safePathPart(slug)}/${safePathPart(ref.section)}/${safePathPart(ref.field)}.json`;
                const fieldPath = path.join(root, fieldRel);
                const missingRel = `raw/field-missing/${safePathPart(lang)}/${safePathPart(slug)}/${safePathPart(ref.section)}/${safePathPart(ref.field)}.json`;
                const missingPath = path.join(root, missingRel);
                try {
                    if (resume && fs.existsSync(missingPath)) {
                        const missing = readJson(missingPath);
                        manifest.files.push(missingRel);
                        manifest.missingFieldDetailFiles.push(missingRel);
                        manifest.warnings.push({
                            type: missing.type || 'missing-field-detail',
                            endpoint: missing.endpoint,
                            slug: missing.slug || slug,
                            lang: missing.lang || lang,
                            section: missing.section || ref.section,
                            field: missing.field || ref.field,
                            status: missing.status,
                            message: missing.message,
                        });
                        continue;
                    }

                    if (!(resume && fs.existsSync(fieldPath))) {
                        const field = await getJson(`/api/v2/tea/${encodeURIComponent(slug)}/${encodeURIComponent(lang)}/field/${encodeURIComponent(ref.field)}`);
                        writeJson(fieldPath, field);
                    }
                    manifest.fieldFiles.push(fieldRel);
                } catch (error) {
                    const issue = issueFromError({
                        endpoint: 'field',
                        slug,
                        lang,
                        section: ref.section,
                        field: ref.field,
                    }, error);
                    const classification = classifyFetchIssue(issue);
                    if (classification.kind === 'missing-field-detail') {
                        writeJson(missingPath, {
                            type: classification.kind,
                            endpoint: `/api/v2/tea/${slug}/${lang}/field/${ref.field}`,
                            ...issue,
                        });
                        manifest.files.push(missingRel);
                        manifest.missingFieldDetailFiles.push(missingRel);
                        manifest.warnings.push({
                            type: classification.kind,
                            endpoint: issue.endpoint,
                            slug,
                            lang,
                            section: ref.section,
                            field: ref.field,
                            status: issue.status,
                            message: issue.message,
                        });
                    } else {
                        manifest.errors.push(issue);
                    }
                }
            }
        }

        if (includeMarkdown) {
            const mdRel = `raw/markdown/${lang}/${slug}.md`;
            const mdPath = path.join(root, mdRel);
            try {
                if (!(resume && fs.existsSync(mdPath))) {
                    const markdown = await getText(`/api/v2/tea/${encodeURIComponent(slug)}.md?lang=${encodeURIComponent(lang)}`);
                    ensureDir(path.dirname(mdPath));
                    fs.writeFileSync(mdPath, markdown);
                }
                manifest.files.push(mdRel);
                manifest.markdownFiles.push(mdRel);
            } catch (error) {
                manifest.errors.push(issueFromError({ endpoint: 'markdown', slug, lang }, error));
            }
        }

        if (includeSimilar) {
            const similarRel = `raw/similar/${lang}/${slug}.json`;
            const similarPath = path.join(root, similarRel);
            try {
                if (!(resume && fs.existsSync(similarPath))) {
                    const similar = await getJson(`/api/v2/tea/${encodeURIComponent(slug)}/similar?lang=${encodeURIComponent(lang)}&limit=12`);
                    writeJson(similarPath, similar);
                }
                manifest.files.push(similarRel);
                manifest.similarFiles.push(similarRel);
            } catch (error) {
                manifest.errors.push(issueFromError({ endpoint: 'similar', slug, lang }, error));
            }
        }
    });

    console.log('');
    manifest.completedAt = new Date().toISOString();
    writeJson(path.join(root, 'manifest.json'), manifest);

    console.log(`Snapshot written: ${root}`);
    console.log(`Field files: ${manifest.fieldFiles.length}`);
    console.log(`Missing field detail files: ${manifest.missingFieldDetailFiles.length}`);
    console.log(`Markdown files: ${manifest.markdownFiles.length}`);
    console.log(`Similar files: ${manifest.similarFiles.length}`);
    console.log(`Source contract files: ${manifest.sourceContractFiles.length}`);
    console.log(`Warnings: ${manifest.warnings.length}`);
    console.log(`Errors: ${manifest.errors.length}`);
    if (manifest.errors.length) {
        console.log('First errors:');
        for (const error of manifest.errors.slice(0, 8)) {
            console.log(`- ${error.endpoint} ${error.slug || ''} ${error.lang || ''}: ${error.status || ''} ${error.message.slice(0, 160)}`);
        }
    }
}

main().catch(error => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
});
