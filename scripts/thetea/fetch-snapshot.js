#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REPO_ROOT, loadDotEnv, parseArgs, csv, getTheTeaApiKey, requireArg } = require('./lib/env');
const { requestJson, requestText } = require('./lib/http');
const { localesFromMeta, resolveRequestedLocales, apiRequestLocale } = require('./lib/locales');
const { extractFieldRefs } = require('./lib/field-details');
const { classifyFetchIssue } = require('./lib/snapshot-errors');
const { resolveFieldLocales, shouldFetchFieldsForLang } = require('./lib/snapshot-options');
const { createRequestStartGate } = require('./lib/request-start-gate');
const { sourceHeaders } = require('./lib/source-api');
const { fetchCompleteReferences } = require('./lib/complete-api-references');
const {
    buildEntityInventory,
    classifySourceEntity,
    validateCardLanguage,
} = require('./lib/source-entities');

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

function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, ''));
}

function safePathPart(value) {
    return String(value || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '_');
}

function relativeSnapshotPath(snapshotRoot, file) {
    const root = path.resolve(snapshotRoot);
    const resolved = path.resolve(file);
    const relative = path.relative(root, resolved);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)) {
        throw new Error(`D1 field-pack path must be inside the snapshot: ${file}`);
    }
    return relative.split(path.sep).join('/');
}

function loadD1FieldPacks(snapshotRoot, configuredPath, slugs = []) {
    if (!configuredPath) return null;
    const manifestPath = path.isAbsolute(String(configuredPath))
        ? String(configuredPath)
        : path.join(snapshotRoot, String(configuredPath));
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`D1 field-pack manifest not found: ${manifestPath}`);
    }
    const payload = readJson(manifestPath);
    if (!Array.isArray(payload.files) || payload.files.length === 0) {
        throw new Error('D1 field-pack manifest has no files.');
    }
    const directory = path.dirname(manifestPath);
    const bySlug = new Map(payload.files.map(item => [String(item.slug || ''), item]));
    const missingSlugs = slugs.filter(slug => !bySlug.has(slug));
    const files = payload.files.map(item => {
        const file = path.join(directory, 'field-packs', String(item.file || ''));
        if (!fs.existsSync(file)) throw new Error(`D1 field-pack file is missing: ${file}`);
        return relativeSnapshotPath(snapshotRoot, file);
    });
    const d1ManifestPath = path.join(directory, 'manifest.json');
    if (!fs.existsSync(d1ManifestPath)) {
        throw new Error(`D1 snapshot manifest not found: ${d1ManifestPath}`);
    }
    const d1Manifest = readJson(d1ManifestPath);
    if (d1Manifest.complete !== true || !Array.isArray(d1Manifest.tables)) {
        throw new Error('D1 snapshot manifest is incomplete.');
    }
    const d1Files = [
        relativeSnapshotPath(snapshotRoot, d1ManifestPath),
        relativeSnapshotPath(snapshotRoot, manifestPath),
    ];
    for (const table of d1Manifest.tables) {
        for (const relative of [table.file, table.schemaFile]) {
            const file = path.join(directory, String(relative || ''));
            if (!fs.existsSync(file)) throw new Error(`D1 snapshot file is missing: ${file}`);
            d1Files.push(relativeSnapshotPath(snapshotRoot, file));
        }
    }
    d1Files.push(...files);
    return {
        manifestPath,
        payload,
        files,
        d1Files: [...new Set(d1Files)].sort(),
        missingSlugs,
    };
}

function headers(url) {
    return sourceHeaders(url, getTheTeaApiKey());
}

async function getJson(endpoint) {
    await waitForRequestStart();
    const url = `${API_BASE}${endpoint}`;
    return requestJson(url, { headers: headers(url), timeoutMs: 30000, retries: 2 });
}

async function getText(endpoint) {
    await waitForRequestStart();
    const url = endpointUrl(endpoint);
    const response = await requestText(url, { headers: headers(url), timeoutMs: 30000, retries: 2 });
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
            manifest.sourceContract.fetched.push({ file: rel, endpoint, resumed: true, sha256: sha256File(target) });
            return;
        }

        ensureDir(path.dirname(target));
        fs.writeFileSync(target, await getText(endpoint));
        manifest.files.push(rel);
        manifest.sourceContractFiles.push(rel);
        manifest.sourceContract.fetched.push({ file: rel, endpoint, sha256: sha256File(target) });
    } catch (error) {
        const issue = issueFromError({ endpoint }, error);
        manifest.errors.push(issue);
        manifest.sourceContract.failed.push(issue);
    }
}

async function fetchInventory(resource, requestLocale, pageSize = 500) {
    const items = [];
    const pages = [];
    let offset = 0;

    while (true) {
        const page = await getJson(`/api/v2/${resource}?limit=${pageSize}&offset=${offset}&lang=${encodeURIComponent(requestLocale)}`);
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
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(snapshotId)) throw new Error('Unsafe snapshot identifier.');
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
    const configuredFieldPacks = args['d1-field-packs'];
    const cardSections = args['field-source'] === 'card-sections';
    if (args['field-source'] && !['card-sections', 'endpoints'].includes(args['field-source'])) throw new Error('Unknown field source.');
    if (cardSections && (!includeFields || configuredFieldPacks)) throw new Error('Card sections require fields and cannot use D1 packs.');

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
    if (langs.some(lang => !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lang))) throw new Error('Unsafe source locale.');
    const fieldLangs = includeFields ? resolveFieldLocales(requestedFieldLangs, langs) : [];
    const availableLocales = localesFromMeta(meta);
    const previousManifestPath = path.join(root, 'manifest.json');
    const hasPreviousManifest = resume && fs.existsSync(previousManifestPath);
    const previousManifest = hasPreviousManifest ? readJson(previousManifestPath) : {};
    const requestLocales = Object.fromEntries(langs.map(lang => [lang, apiRequestLocale(lang, meta)]));
    const changedLocale = hasPreviousManifest && langs.find(lang => (previousManifest.langs || []).includes(lang)
        && (previousManifest.requestLocales?.[lang] ?? lang) !== requestLocales[lang]);
    if (changedLocale) {
        throw new Error(`Source request code changed for ${changedLocale}. Use a new snapshot to keep the retained evidence bound to its original request.`);
    }
    const resumeLocale = lang => resume && (previousManifest.requestLocales?.[lang] ?? lang) === requestLocales[lang];

    const manifest = {
        snapshotId,
        apiBase: API_BASE,
        createdAt: new Date().toISOString(),
        requestedLangs: requestedLangs.length ? requestedLangs : ['all'],
        requestedFieldLangs: requestedFieldLangs.length ? requestedFieldLangs : ['all'],
        availableLocales,
        requestLocales,
        langs,
        fieldLangs,
        includeMarkdown,
        includeFields,
        includeSimilar,
        slugs: [],
        files: [],
        fieldFiles: [],
        fieldPackFiles: [],
        d1Files: [],
        missingFieldDetailFiles: [],
        markdownFiles: [],
        mapFiles: [],
        placesFiles: [],
        referenceCoverage: [],
        similarFiles: [],
        missingSimilarFiles: [],
        sourceContractFiles: [],
        sourceContract: {
            expected: ['raw/source/docs.html', 'raw/source/openapi.yaml', 'raw/source/llms.txt', 'raw/source/skill.md'],
            fetched: [],
            failed: [],
        },
        entityInventory: [],
        entityCardFiles: [],
        missingEntityCardFiles: [],
        entityObservations: [],
        cardLanguageMismatches: [],
        fieldCoverage: [],
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

    // Discovery is a language-neutral inventory. Always use the free English
    // projection so a paid target locale can still be fetched and recorded as
    // a per-card 402 instead of aborting before the snapshot exists.
    const teasLang = 'en';
    const discoveryLocale = apiRequestLocale(teasLang, meta);
    const teasPath = path.join(raw, `teas-${teasLang}.json`);
    const teas = resume && fs.existsSync(teasPath)
        ? readJson(teasPath)
        : await fetchInventory('teas', discoveryLocale);
    writeJson(teasPath, teas);
    manifest.files.push(`raw/teas-${teasLang}.json`);
    const categoriesRel = `raw/categories-${teasLang}.json`;
    const categoriesPath = path.join(root, categoriesRel);
    const categories = resume && fs.existsSync(categoriesPath)
        ? readJson(categoriesPath)
        : await fetchInventory('categories', discoveryLocale);
    writeJson(categoriesPath, categories);
    manifest.files.push(categoriesRel);

    const infusionsRel = `raw/infusions-${teasLang}.json`;
    const infusionsPath = path.join(root, infusionsRel);
    let infusions;
    try {
        infusions = resume && fs.existsSync(infusionsPath)
            ? readJson(infusionsPath)
            : await fetchInventory('infusions', discoveryLocale);
        writeJson(infusionsPath, infusions);
        manifest.files.push(infusionsRel);
    } catch (error) {
        const issue = issueFromError({ endpoint: 'infusions', lang: teasLang }, error);
        manifest.errors.push(issue);
        infusions = { count: 0, offset: 0, items: [], pages: [] };
    }

    const cacheReference = async (rel, endpoint) => {
        const file = path.join(root, rel);
        if (!(resume && fs.existsSync(file))) writeJson(file, await getJson(endpoint));
        manifest.files.push(rel);
        return readJson(file);
    };
    const priorPlaceQueries = Object.fromEntries(['toponym', 'tea_name', 'name'].map(kind => {
        const directory = path.join(root, 'raw/reference-pages/places', kind);
        const queries = resume && fs.existsSync(directory) ? fs.readdirSync(directory)
            .filter(file => /^(?:[a-f0-9]{2}){1,4}\.json$/.test(file))
            .map(file => Buffer.from(file.slice(0, -5), 'hex').toString('utf8')) : [];
        return [kind, queries];
    }));
    try {
        const references = await fetchCompleteReferences({ meta, langs, fetch: cacheReference,
            seedText: JSON.stringify([teas, categories, infusions]), priorPlaceQueries });
        manifest.referenceCoverage.push(...references.coverage);
        manifest.placesFiles.push(...references.placesFiles);
    } catch (error) {
        manifest.errors.push(issueFromError({ endpoint: 'complete-references' }, error));
    }
    for (const lang of langs) {
        try {
            const mapRel = `raw/map-${lang}.json`;
            const mapPath = path.join(root, mapRel);
            if (!(resumeLocale(lang) && fs.existsSync(mapPath))) {
                const map = await getJson(`/api/v2/map?lang=${encodeURIComponent(requestLocales[lang])}`);
                writeJson(mapPath, map);
            }
            manifest.files.push(mapRel);
            manifest.mapFiles.push(mapRel);
        } catch (error) {
            manifest.errors.push(issueFromError({ endpoint: 'map', lang }, error));
        }
    }

    let sourceInventory = buildEntityInventory({
        teas: teas.items || [],
        infusions: infusions.items || [],
        categories: categories.items || [],
    });
    let entities = sourceInventory.entities;
    if (only.size) entities = entities.filter(item => only.has(item.slug));
    if (limit) entities = entities.slice(0, limit);
    if (entities.some(entity => !/^[a-z0-9][a-z0-9_-]*$/i.test(entity.slug))) throw new Error('Unsafe source slug.');

    manifest.entityInventory = entities;
    manifest.slugs = entities
        .filter(item => item.entityKind === 'tea' && !item.classificationConflict)
        .map(item => item.slug);
    for (const duplicate of sourceInventory.duplicates) {
        manifest.warnings.push({ type: 'duplicate-source-entity', ...duplicate });
    }
    for (const conflict of sourceInventory.kindConflicts || []) {
        manifest.warnings.push({ type: 'entity-kind-conflict', ...conflict });
    }
    for (const entity of entities) {
        if (entity.entityKind === 'unknown' || entity.classificationConflict) {
            manifest.warnings.push({
                type: entity.classificationConflict ? 'entity-kind-conflict' : 'unknown-source-entity',
                slug: entity.slug,
                endpoint: entity.endpoint,
                sourceKind: entity.sourceKind,
            });
        }
    }
    const d1FieldPacks = loadD1FieldPacks(root, configuredFieldPacks, manifest.slugs);
    if (d1FieldPacks) {
        manifest.fieldSource = 'cloudflare-d1-packs';
        manifest.fieldPackFiles = d1FieldPacks.files;
        manifest.d1Files = d1FieldPacks.d1Files;
        for (const slug of d1FieldPacks.missingSlugs) {
            manifest.warnings.push({
                type: 'missing-d1-field-pack',
                slug,
                message: `No D1 field pack exists for ${slug}.`,
            });
        }
    }
    if (cardSections) manifest.fieldSource = 'api-card-sections';
    console.log(`Entities to fetch: ${entities.length} (${manifest.slugs.length} tea products)`);
    console.log(`Field source: ${d1FieldPacks ? 'Cloudflare D1 packs' : cardSections ? 'canonical API card sections' : 'per-field API'}`);

    const cardTasks = entities.flatMap(entity => langs.map(lang => ({ entity, lang })));
    await mapLimit(cardTasks, concurrency, async ({ entity, lang }) => {
        const { slug } = entity;
        const cardRel = entity.entityKind === 'tea'
            ? `raw/cards/${lang}/${slug}.json`
            : `raw/entities/${entity.entityKind}/cards/${lang}/${slug}.json`;
        const cardPath = path.join(root, cardRel);
        let card = null;
        let cardLanguageValid = true;
        try {
            if (resumeLocale(lang) && fs.existsSync(cardPath)) {
                card = readJson(cardPath);
                manifest.files.push(cardRel);
                process.stdout.write('r');
            } else {
                const route = entity.entityKind === 'infusion' ? 'infusion' : 'tea';
                card = await getJson(`/api/v2/${route}/${encodeURIComponent(slug)}?lang=${encodeURIComponent(requestLocales[lang])}`);
                writeJson(cardPath, card);
                manifest.files.push(cardRel);
                process.stdout.write('.');
            }
            const classification = classifySourceEntity(card, entity.entityKind);
            const language = validateCardLanguage(card, lang);
            manifest.entityObservations.push({
                slug,
                lang,
                expectedKind: entity.entityKind,
                actualKind: classification.kind,
                classificationEvidence: classification.evidence,
                classificationConflict: classification.conflict,
                language: language.actual,
            });
            if (classification.kind !== entity.entityKind && classification.kind !== 'unknown') {
                manifest.warnings.push({
                    type: 'entity-kind-mismatch',
                    slug,
                    lang,
                    expectedKind: entity.entityKind,
                    actualKind: classification.kind,
                });
            }
            if (!language.ok) {
                const mismatch = {
                    type: 'language-fallback',
                    endpoint: 'card',
                    slug,
                    lang,
                    requestedLang: language.requested,
                    actualLang: language.actual,
                    message: `TheTea returned ${language.actual} for requested ${language.requested}; English fallback is not accepted.`,
                };
                manifest.cardLanguageMismatches.push(mismatch);
                manifest.errors.push(mismatch);
                cardLanguageValid = false;
            }
            manifest.entityCardFiles.push(cardRel);
        } catch (error) {
            const issue = issueFromError({ endpoint: 'card', slug, lang, entityKind: entity.entityKind }, error);
            const classification = classifyFetchIssue(issue);
            if (classification.kind === 'missing-entity-card') {
                const missing = {
                    ...issue,
                    type: classification.kind,
                    file: cardRel,
                };
                manifest.missingEntityCardFiles.push(missing);
                manifest.warnings.push(missing);
            } else {
                manifest.errors.push({ ...issue, type: classification.kind });
            }
            process.stdout.write('x');
        }

        if (cardSections && card && cardLanguageValid && shouldFetchFieldsForLang(lang, fieldLangs)) {
            const refs = extractFieldRefs(card);
            manifest.fieldCoverage.push({ slug, lang, entityKind: entity.entityKind,
                source: 'api-card-sections', sourceFile: cardRel, sha256: sha256File(cardPath),
                expectedCount: refs.length, fetchedCount: refs.length, missing: [] });
        } else if (includeFields && !d1FieldPacks && card && cardLanguageValid && shouldFetchFieldsForLang(lang, fieldLangs)) {
            const fieldRefs = extractFieldRefs(card);
            const fieldCoverage = {
                slug,
                lang,
                entityKind: entity.entityKind,
                expected: fieldRefs.map(ref => ({ section: ref.section, field: ref.field })),
                fetched: [],
                missing: [],
            };
            manifest.fieldCoverage.push(fieldCoverage);
            for (const ref of fieldRefs) {
                const fieldRel = `raw/fields/${safePathPart(lang)}/${safePathPart(slug)}/${safePathPart(ref.section)}/${safePathPart(ref.field)}.json`;
                const fieldPath = path.join(root, fieldRel);
                const missingRel = `raw/field-missing/${safePathPart(lang)}/${safePathPart(slug)}/${safePathPart(ref.section)}/${safePathPart(ref.field)}.json`;
                const missingPath = path.join(root, missingRel);
                try {
                    if (resumeLocale(lang) && fs.existsSync(missingPath)) {
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
                        fieldCoverage.missing.push({ section: ref.section, field: ref.field, status: missing.status, type: missing.type });
                        continue;
                    }

                    if (!(resumeLocale(lang) && fs.existsSync(fieldPath))) {
                        const field = await getJson(`/api/v2/tea/${encodeURIComponent(slug)}/${encodeURIComponent(requestLocales[lang])}/field/${encodeURIComponent(ref.field)}`);
                        writeJson(fieldPath, field);
                        fs.rmSync(missingPath, { force: true });
                    }
                    manifest.fieldFiles.push(fieldRel);
                    fieldCoverage.fetched.push({ section: ref.section, field: ref.field });
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
                        fs.rmSync(fieldPath, { force: true });
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
                        fieldCoverage.missing.push({ section: ref.section, field: ref.field, status: issue.status, type: classification.kind });
                    } else {
                        manifest.errors.push(issue);
                    }
                }
            }
        } else if (includeFields && !d1FieldPacks && shouldFetchFieldsForLang(lang, fieldLangs)) {
            manifest.fieldCoverage.push({
                slug,
                lang,
                entityKind: entity.entityKind,
                expected: [],
                fetched: [],
                missing: [],
                status: 'card-unavailable',
            });
        }

        if (includeMarkdown && ['tea', 'category'].includes(entity.entityKind)) {
            const mdRel = `raw/markdown/${lang}/${slug}.md`;
            const mdPath = path.join(root, mdRel);
            try {
                if (!(resumeLocale(lang) && fs.existsSync(mdPath))) {
                    const markdown = await getText(`/api/v2/tea/${encodeURIComponent(slug)}.md?lang=${encodeURIComponent(requestLocales[lang])}`);
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
            const missingRel = `raw/similar-missing/${lang}/${slug}.json`;
            const missingPath = path.join(root, missingRel);
            try {
                if (resumeLocale(lang) && fs.existsSync(missingPath)) {
                    const missing = readJson(missingPath);
                    manifest.files.push(missingRel);
                    manifest.missingSimilarFiles.push(missingRel);
                    manifest.warnings.push(missing);
                    return;
                }
                if (!(resumeLocale(lang) && fs.existsSync(similarPath))) {
                    const similar = await getJson(`/api/v2/tea/${encodeURIComponent(slug)}/similar?lang=${encodeURIComponent(requestLocales[lang])}&limit=12`);
                    writeJson(similarPath, similar);
                    fs.rmSync(missingPath, { force: true });
                }
                manifest.files.push(similarRel);
                manifest.similarFiles.push(similarRel);
            } catch (error) {
                const issue = issueFromError({ endpoint: 'similar', slug, lang }, error);
                const classification = classifyFetchIssue(issue);
                if (classification.kind === 'missing-similarity-vector') {
                    const missing = { ...issue, type: classification.kind,
                        requestedEndpoint: `/api/v2/tea/${slug}/similar?lang=${requestLocales[lang]}&limit=12` };
                    writeJson(missingPath, missing);
                    fs.rmSync(similarPath, { force: true });
                    manifest.files.push(missingRel);
                    manifest.missingSimilarFiles.push(missingRel);
                    manifest.warnings.push(missing);
                } else manifest.errors.push(issue);
            }
        }
    });

    console.log('');
    manifest.completedAt = new Date().toISOString();
    writeJson(path.join(root, 'manifest.json'), manifest);

    console.log(`Snapshot written: ${root}`);
    console.log(`Field files: ${manifest.fieldFiles.length}`);
    console.log(`Field pack files: ${manifest.fieldPackFiles.length}`);
    console.log(`Missing field detail files: ${manifest.missingFieldDetailFiles.length}`);
    console.log(`Markdown files: ${manifest.markdownFiles.length}`);
    console.log(`Similar files: ${manifest.similarFiles.length}`);
    console.log(`Source contract files: ${manifest.sourceContractFiles.length}`);
    console.log(`Warnings: ${manifest.warnings.length}`);
    console.log(`Errors: ${manifest.errors.length}`);
    if (manifest.errors.length) {
        process.exitCode = 1;
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
