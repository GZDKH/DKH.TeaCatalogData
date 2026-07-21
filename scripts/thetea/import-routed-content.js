#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { REPO_ROOT, loadDotEnv, parseArgs, csv } = require('./lib/env');
const { readArtifactBundle, sha256 } = require('./lib/artifact-bundle');
const { hashInputPath, hashSnapshotFiles } = require('./generate-import');
const {
    FAQ_DEFINITION,
    articleDto,
    comparableArticle,
    faqEntryDto,
    hash,
    isOwnedArticle,
    normalizeJson,
    stableStringify,
} = require('./lib/routed-content');

loadDotEnv();

function usage() {
    console.log(`Usage:
  node scripts/thetea/import-routed-content.js --snapshot=<id> --storefront-id=<uuid>
  node scripts/thetea/import-routed-content.js --dir=import/thetea/<id> --storefront-id=<uuid>

Options:
  --only=<slug,code>    Select canary records by slug or product/article code
  --limit=<n>           Import at most n article/FAQ product pairs
  --catalog-ref=<path>  Exact catalog reference recorded in the artifact manifest
  --product-ref=<path>  Exact full-product baseline recorded in the artifact manifest
  --snapshot-root=<dir> Immutable source snapshot recorded in the manifest
  --apply --yes         Apply the exact plan after writing a rollback artifact

Default mode is a read-only dry-run against AdminGateway.`);
}

function outputDir(args) {
    if (args.dir) return path.resolve(REPO_ROOT, String(args.dir));
    if (args.snapshot) return path.join(REPO_ROOT, 'import', 'thetea', String(args.snapshot));
    throw new Error('--snapshot=... or --dir=... is required.');
}

function storefrontId(args) {
    const value = String(args['storefront-id'] || process.env.THETEA_STOREFRONT_ID || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw new Error('--storefront-id=<uuid> or THETEA_STOREFRONT_ID is required.');
    }
    return value;
}

function repoPath(value) {
    if (!value) return null;
    return path.isAbsolute(String(value)) ? String(value) : path.join(REPO_ROOT, String(value));
}

function verifyApplyInputs(bundle, args) {
    const manifest = bundle.manifest || {};
    const errors = [];
    const catalogReference = repoPath(args['catalog-ref'] || args['prod-ref']);
    const productReference = repoPath(args['product-ref']);
    const requiredHashes = [
        ['sourceManifestSha256', manifest.sourceManifestSha256],
        ['sourceFilesSha256', manifest.sourceFilesSha256],
        ['catalogReferenceSha256', manifest.catalogReferenceSha256],
        ['baselineReferenceSha256', manifest.baselineReferenceSha256],
    ];
    for (const [name, value] of requiredHashes) {
        if (!value) errors.push(`Artifact has no ${name}; apply is forbidden for a diagnostic artifact.`);
    }
    if (!catalogReference) errors.push('--catalog-ref=... is required for apply.');
    else if (!fs.existsSync(catalogReference)) errors.push(`Catalog reference is unavailable: ${catalogReference}`);
    else if (manifest.catalogReferenceSha256 && hashInputPath(catalogReference) !== manifest.catalogReferenceSha256) {
        errors.push('Catalog reference hash differs from the artifact manifest.');
    }
    if (!productReference) errors.push('--product-ref=... is required for apply.');
    else if (!fs.existsSync(productReference)) errors.push(`Product reference is unavailable: ${productReference}`);
    else if (manifest.baselineReferenceSha256 && hashInputPath(productReference) !== manifest.baselineReferenceSha256) {
        errors.push('Product baseline reference hash differs from the artifact manifest.');
    }

    const snapshotRoot = repoPath(args['snapshot-root'])
        || path.join(REPO_ROOT, 'sources', 'thetea', 'snapshots', manifest.snapshotId || '');
    const sourceManifestPath = path.join(snapshotRoot, 'manifest.json');
    if (!fs.existsSync(sourceManifestPath)) {
        errors.push(`Source snapshot is unavailable for apply: ${snapshotRoot}`);
    } else {
        const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8').replace(/^\uFEFF/, ''));
        if (manifest.sourceManifestSha256
            && sha256(fs.readFileSync(sourceManifestPath)) !== manifest.sourceManifestSha256) {
            errors.push('Source snapshot manifest hash differs from the artifact manifest.');
        }
        if (manifest.sourceFilesSha256
            && hashSnapshotFiles(snapshotRoot, sourceManifest) !== manifest.sourceFilesSha256) {
            errors.push('Source snapshot file-set hash differs from the artifact manifest.');
        }
    }
    if (errors.length) throw new Error(`Apply preflight failed:\n${errors.join('\n')}`);
}

function requestJson(baseUrl, token, method, apiPath, body, allowed = []) {
    const url = new URL(apiPath, `${baseUrl.replace(/\/$/, '')}/`);
    const transport = url.protocol === 'https:' ? https : http;
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
        const req = transport.request(url, {
            method,
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
            },
        }, res => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', chunk => text += chunk);
            res.on('end', () => {
                const status = res.statusCode || 0;
                let parsed = null;
                try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
                if ((status >= 200 && status < 300) || allowed.includes(status)) {
                    resolve({ status, body: parsed });
                    return;
                }
                reject(new Error(`${method} ${url.pathname} returned HTTP ${status}: ${text.slice(0, 240)}`));
            });
        });
        req.on('error', reject);
        req.setTimeout(30000, () => req.destroy(new Error(`Timeout for ${method} ${url.pathname}`)));
        if (payload) req.write(payload);
        req.end();
    });
}

function apiClient(baseUrl, token, id) {
    const root = `/api/v1.0/storefronts/${id}`;
    return {
        async getArticle(slug) {
            const result = await requestJson(baseUrl, token, 'GET', `${root}/blog-posts/by-slug/${encodeURIComponent(slug)}?includeDraft=true`, undefined, [404]);
            return result.status === 404 ? null : result.body;
        },
        createArticle: body => requestJson(baseUrl, token, 'POST', `${root}/blog-posts`, body).then(x => x.body),
        updateArticle: (postId, body) => requestJson(baseUrl, token, 'PUT', `${root}/blog-posts/${postId}`, body).then(x => x.body),
        async listDefinitions() {
            return listPages((page, pageSize) => requestJson(baseUrl, token, 'GET', `${root}/metaobjects/definitions?page=${page}&pageSize=${pageSize}`).then(x => x.body));
        },
        createDefinition: body => requestJson(baseUrl, token, 'POST', `${root}/metaobjects/definitions`, body).then(x => x.body),
        async listEntries(definitionId) {
            return listPages((page, pageSize) => requestJson(baseUrl, token, 'GET', `${root}/metaobjects/definitions/${definitionId}/entries?page=${page}&pageSize=${pageSize}`).then(x => x.body));
        },
        createEntry: (definitionId, body) => requestJson(baseUrl, token, 'POST', `${root}/metaobjects/definitions/${definitionId}/entries`, body).then(x => x.body),
        updateEntry: (definitionId, entryId, body) => requestJson(baseUrl, token, 'PUT', `${root}/metaobjects/definitions/${definitionId}/entries/${entryId}`, body).then(x => x.body),
    };
}

async function listPages(fetchPage) {
    const result = [];
    const pageSize = 100;
    for (let page = 1; ; page += 1) {
        const response = await fetchPage(page, pageSize);
        result.push(...(response.items || []));
        if (result.length >= Number(response.totalCount || 0) || !(response.items || []).length) return result;
    }
}

function selectRecords(bundle, args) {
    const filters = csv(args.only).map(value => value.toLowerCase());
    const matches = value => !filters.length || filters.some(filter => stableStringify(value).toLowerCase().includes(filter));
    let articles = bundle.routedContent.articles.filter(matches);
    let metaobjects = bundle.routedContent.metaobjects.filter(matches);
    const selectedProducts = new Set([...articles, ...metaobjects].map(item => item.product));
    articles = articles.filter(item => selectedProducts.has(item.product));
    metaobjects = metaobjects.filter(item => selectedProducts.has(item.product));
    if (args.limit) {
        const products = [...selectedProducts].sort().slice(0, Number(args.limit));
        const limited = new Set(products);
        articles = articles.filter(item => limited.has(item.product));
        metaobjects = metaobjects.filter(item => limited.has(item.product));
    }
    if (!articles.length && !metaobjects.length) throw new Error('No routed content records selected.');
    return { articles, metaobjects };
}

function desiredDefinition() {
    return {
        key: FAQ_DEFINITION.key,
        name: FAQ_DEFINITION.name,
        description: FAQ_DEFINITION.description,
        schemaJson: stableStringify(FAQ_DEFINITION.schema),
    };
}

function definitionCompatible(remote) {
    if (!remote) return false;
    let schema;
    try { schema = JSON.parse(remote.schemaJson); } catch { return false; }
    const keys = new Set((schema.fields || []).flatMap(field => [field.key, field.id]).filter(Boolean));
    return ['product_code', 'article_slug', 'translations'].every(key => keys.has(key));
}

async function buildPlan(client, records) {
    const operations = [];
    for (const article of records.articles) {
        const desired = articleDto(article);
        const before = await client.getArticle(desired.slug);
        let action = 'create';
        let reason = null;
        if (before) {
            if (stableStringify(comparableArticle(before)) === stableStringify(desired)) action = 'noop';
            else if (isOwnedArticle(before)) action = 'update';
            else {
                action = 'conflict';
                reason = 'Existing article is not marked as owned by TheTea ETL.';
            }
        }
        operations.push({ kind: 'article', key: desired.slug, product: article.product, action, reason, remoteId: before?.id || null, before, desired, desiredSha256: hash(desired) });
    }

    const definitions = await client.listDefinitions();
    const definition = definitions.find(item => item.key === FAQ_DEFINITION.key) || null;
    const wantedDefinition = desiredDefinition();
    let definitionAction = 'create';
    let definitionReason = null;
    if (definition) {
        if (!definitionCompatible(definition)) {
            definitionAction = 'conflict';
            definitionReason = 'Existing product_faq definition does not contain the required product_code, article_slug, and translations fields.';
        } else definitionAction = 'noop';
    }
    operations.push({ kind: 'definition', key: FAQ_DEFINITION.key, action: definitionAction, reason: definitionReason, remoteId: definition?.id || null, before: definition, desired: wantedDefinition, desiredSha256: hash(wantedDefinition) });

    const entries = definition ? await client.listEntries(definition.id) : [];
    for (const metaobject of records.metaobjects) {
        const desired = faqEntryDto(metaobject);
        const before = entries.find(item => item.handle === desired.handle) || null;
        let action = before ? 'update' : 'create';
        let reason = null;
        if (before) {
            try {
                const currentValues = JSON.parse(before.valuesJson);
                const desiredValues = JSON.parse(desired.valuesJson);
                if (currentValues.product_code !== desiredValues.product_code) {
                    action = 'conflict';
                    reason = `Existing FAQ handle belongs to ${currentValues.product_code || 'an unknown product'}.`;
                } else if (before.displayName === desired.displayName
                    && normalizeJson(currentValues) === normalizeJson(desiredValues)) {
                    action = 'noop';
                }
            } catch {
                action = 'conflict';
                reason = 'Existing FAQ valuesJson is not valid JSON.';
            }
        }
        operations.push({
            kind: 'faq', key: desired.handle, product: metaobject.product,
            action, reason,
            remoteId: before?.id || null, definitionId: definition?.id || null,
            before, desired, desiredSha256: hash(desired),
        });
    }
    return operations;
}

function summarize(operations) {
    return operations.reduce((result, operation) => {
        result[operation.action] = (result[operation.action] || 0) + 1;
        return result;
    }, { create: 0, update: 0, noop: 0, conflict: 0 });
}

function writeArtifact(prefix, payload) {
    const dir = path.join(REPO_ROOT, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${prefix}-${timestamp}.json`);
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
    return file;
}

async function applyPlan(client, operations) {
    let definitionId = operations.find(item => item.kind === 'definition')?.remoteId || null;
    for (const operation of operations) {
        if (operation.action === 'noop') continue;
        if (operation.kind === 'article') {
            if (operation.action === 'create') await client.createArticle(operation.desired);
            else await client.updateArticle(operation.remoteId, operation.desired);
        } else if (operation.kind === 'definition') {
            const created = await client.createDefinition(operation.desired);
            definitionId = created.id;
        } else if (operation.kind === 'faq') {
            if (!definitionId) throw new Error('FAQ definition id is unavailable during apply.');
            if (operation.action === 'create') await client.createEntry(definitionId, operation.desired);
            else await client.updateEntry(definitionId, operation.remoteId, operation.desired);
        }
    }
}

async function main() {
    const args = parseArgs();
    if (args.help || args.h) return usage();
    const apply = args.apply === true;
    if (apply && args.yes !== true) throw new Error('Real import requires both --apply and --yes.');
    const root = outputDir(args);
    const bundle = readArtifactBundle(root);
    if (bundle.errors.length) throw new Error(`Artifact bundle is invalid:\n${bundle.errors.join('\n')}`);
    if (apply) verifyApplyInputs(bundle, args);
    const records = selectRecords(bundle, args);
    const id = storefrontId(args);
    const { GATEWAY_URL, getToken } = require('../lib/config');
    const token = await getToken();
    const client = apiClient(GATEWAY_URL, token, id);
    const operations = await buildPlan(client, records);
    const summary = summarize(operations);
    const report = { generatedAt: new Date().toISOString(), mode: apply ? 'apply' : 'dry-run', storefrontId: id, artifactRoot: root, summary, operations };
    const reportFile = writeArtifact('thetea-routed-diff', report);

    console.log(`TheTea routed content ${apply ? '[APPLY]' : '[DRY-RUN]'}`);
    console.log(`Articles: ${records.articles.length}; FAQ products: ${records.metaobjects.length}`);
    console.log(`CREATE ${summary.create}; UPDATE ${summary.update}; NOOP ${summary.noop}; CONFLICT ${summary.conflict}`);
    for (const item of operations) console.log(`${item.kind.padEnd(10)} ${item.action.padEnd(8)} ${item.key}${item.reason ? ` — ${item.reason}` : ''}`);
    console.log(`Diff: ${reportFile}`);

    if (summary.conflict) throw new Error('Conflicts found; no changes were applied.');
    if (!apply) return;

    const rollbackFile = writeArtifact('thetea-routed-rollback', {
        generatedAt: new Date().toISOString(), storefrontId: id,
        operations: operations.filter(item => item.action !== 'noop').map(item => ({
            kind: item.kind, key: item.key, action: item.action === 'create' ? 'delete-created' : 'restore', remoteId: item.remoteId, before: item.before,
        })),
    });
    console.log(`Rollback: ${rollbackFile}`);
    await applyPlan(client, operations);

    const verification = await buildPlan(client, records);
    const verificationSummary = summarize(verification);
    const verificationFile = writeArtifact('thetea-routed-verification', {
        verifiedAt: new Date().toISOString(), storefrontId: id, summary: verificationSummary, operations: verification,
    });
    console.log(`Verification: ${verificationFile}`);
    if (verificationSummary.create || verificationSummary.update || verificationSummary.conflict) {
        throw new Error(`Post-apply verification failed: ${JSON.stringify(verificationSummary)}.`);
    }
    console.log(`VERIFIED: ${verificationSummary.noop} remote resources exactly match the desired DTOs.`);
}

if (require.main === module) {
    main().catch(error => {
        console.error(`FATAL: ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    apiClient, applyPlan, buildPlan, definitionCompatible, desiredDefinition,
    selectRecords, summarize, verifyApplyInputs,
};
