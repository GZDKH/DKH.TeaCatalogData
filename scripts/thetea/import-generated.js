#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { REPO_ROOT, loadDotEnv, parseArgs, csv } = require('./lib/env');
const { readArtifactBundle, sha256 } = require('./lib/artifact-bundle');
const { validateArtifact } = require('./lib/artifact-validator');
const { loadCatalogReference } = require('./lib/catalog-mapping');
const { resolveArtifactCatalogPolicy } = require('./lib/import-targets');
const { auditPublicationQuality } = require('./lib/publication-quality');
const {
    hashInputPath,
    hashSnapshotFiles,
} = require('./generate-import');
const {
    catalogWorkspaceHeader,
    resolveCatalogWorkspaceId,
} = require('./lib/catalog-workspace');
const { loadVerifiedProductReference } = require('./lib/product-reference');
const {
    apiClient: routedContentApiClient,
    applyPlanAndRelease: applyRoutedContentPlanAndRelease,
    buildPlan: buildRoutedContentPlan,
    operationEvidence: routedContentOperationEvidence,
    summarize: summarizeRoutedContent,
    writeRollbackArtifact: writeRoutedContentRollbackArtifact,
} = require('./import-routed-content');

loadDotEnv();

function usage() {
    console.log(`Usage:
  node scripts/thetea/import-generated.js --snapshot=<id>
  node scripts/thetea/import-generated.js --dir=import/thetea/<id>
  node scripts/thetea/import-generated.js --snapshot=<id> --profile=categories

Options:
  --snapshot=<id>       Reads import/thetea/<id>/04-products
  --dir=<path>          Reads a generated import directory
  --profile=<name>      DataExchange profile: products (default) or categories
  --only=<slug,code>    Import only files whose path or product code contains a value
  --limit=<n>           Import at most n files
  --catalog-ref=<path>  Exact catalog reference recorded in the artifact manifest
  --product-ref=<path>  Exact full-product baseline recorded in the artifact manifest
  --workspace-id=<uuid> ProductCatalog workspace; or PRODUCT_CATALOG_WORKSPACE_ID
  --storefront-id=<uuid> Storefront that receives routed product articles/FAQ
  --routed-content       Validate/import routed content even when coverage is not exact
  --skip-routed-content  Validate/import only ProductCatalog records
  --apply --yes         Write to AdminGateway import endpoint

Default mode calls /api/v1/data-exchange/validate and does not write.
Full artifacts with targets.articleCoverage=exact-product-slug require the
routed-content step on apply so product pages and article dossiers stay in sync.`);
}

function walkJson(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walkJson(full));
        else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full);
    }
    return files.sort();
}

function readRecords(file) {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(data)) throw new Error(`${file} is not a JSON array`);
    return data;
}

function request(url, options, body) {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const req = lib.request(parsed, options, res => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function buildMultipart(profile, format, jsonContent, fileName) {
    const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;
    const fileBuf = Buffer.from(JSON.stringify(jsonContent), 'utf-8');
    const head = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="Profile"',
        '',
        profile,
        `--${boundary}`,
        'Content-Disposition: form-data; name="Format"',
        '',
        format,
        `--${boundary}`,
        `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
        'Content-Type: application/json',
        '',
        '',
    ].join('\r\n');
    const body = Buffer.concat([
        Buffer.from(head, 'utf-8'),
        fileBuf,
        Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'),
    ]);

    return { boundary, body };
}

function shouldInclude(file, records, filters) {
    if (!filters.length) return true;
    const haystack = [
        file,
        ...records.flatMap(record => [record.code, record.sku, record.translations?.map(t => t.name).join(' ')]),
    ].join(' ').toLowerCase();
    return filters.some(filter => haystack.includes(filter.toLowerCase()));
}

function parseResponse(body) {
    try {
        return JSON.parse(body);
    } catch {
        return {};
    }
}

async function importOne({ gatewayUrl, token, workspaceId, file, profile, records, dryRun }) {
    const endpoint = dryRun
        ? `${gatewayUrl}/api/v1/data-exchange/validate`
        : `${gatewayUrl}/api/v1/data-exchange/import`;
    const { boundary, body } = buildMultipart(profile, 'json', records, path.basename(file));

    return request(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
            ...catalogWorkspaceHeader(workspaceId),
        },
    }, body);
}

function outputDir(args) {
    if (args.dir) return path.resolve(REPO_ROOT, String(args.dir));
    if (args.snapshot) return path.join(REPO_ROOT, 'import', 'thetea', String(args.snapshot));
    throw new Error('--snapshot=... or --dir=... is required');
}

function repoPath(value) {
    if (!value) return null;
    return path.isAbsolute(String(value)) ? String(value) : path.join(REPO_ROOT, String(value));
}

function normalizeCode(value) {
    const code = value && typeof value === 'object' ? value.code : value;
    return String(code || '').trim().toUpperCase();
}

function isExactArticleCoverage(manifest) {
    return manifest?.targets?.articleCoverage === 'exact-product-slug';
}

function hasRoutedContent(records) {
    return Boolean(records.articles.length || records.metaobjects.length);
}

function shouldRunRoutedContentStep(manifest, args, profile) {
    if (String(profile || '').toLowerCase() !== 'products') return false;
    return isExactArticleCoverage(manifest) || args['routed-content'] === true;
}

function resolveStorefrontId(args, required) {
    const value = String(args['storefront-id'] || process.env.THETEA_STOREFRONT_ID || '').trim();
    if (!value) {
        if (required) {
            throw new Error(
                '--storefront-id=<uuid> or THETEA_STOREFRONT_ID is required '
                + 'to apply routed product articles/FAQ.');
        }
        return null;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw new Error('--storefront-id must be a UUID.');
    }
    return value;
}

function selectRoutedContentRecords(bundle, selectedProductCodes) {
    const wanted = new Set(selectedProductCodes.map(normalizeCode).filter(Boolean));
    const include = record => {
        if (wanted.size === 0) return true;
        return wanted.has(normalizeCode(record?.product));
    };
    return {
        articles: bundle.routedContent.articles.filter(include),
        metaobjects: bundle.routedContent.metaobjects.filter(include),
    };
}

function assertRoutedContentStepAllowed(manifest, args, dryRun, profile) {
    if (!shouldRunRoutedContentStep(manifest, args, profile)) return;
    if (dryRun || !isExactArticleCoverage(manifest)) return;
    if (args['skip-routed-content'] === true) {
        throw new Error(
            'This artifact declares exact product/article slug coverage; '
            + '--skip-routed-content is not allowed on apply.');
    }
    resolveStorefrontId(args, true);
}

function writeJsonLog(prefix, payload) {
    const logDir = path.join(REPO_ROOT, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(logDir, `${prefix}-${ts}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    return file;
}

async function prepareRoutedContentStep({
    args,
    dryRun,
    gatewayUrl,
    token,
    manifest,
    records,
    selectedProductCodes,
}) {
    if (!shouldRunRoutedContentStep(manifest, args, 'products')) return null;

    const applyRequiresStep = !dryRun && isExactArticleCoverage(manifest);
    assertRoutedContentStepAllowed(manifest, args, dryRun, 'products');
    if (args['skip-routed-content'] === true) {
        return {
            skipped: true,
            reason: 'skipped by --skip-routed-content',
        };
    }

    const storefrontId = resolveStorefrontId(args, applyRequiresStep);
    if (!storefrontId) {
        return {
            skipped: true,
            reason: 'pass --storefront-id=... to validate routed product articles/FAQ',
        };
    }

    if (!hasRoutedContent(records)) {
        throw new Error(
            'No routed article/FAQ records matched the selected product import. '
            + `Selected products: ${selectedProductCodes.map(normalizeCode).filter(Boolean).join(', ') || '<all>'}`);
    }

    const client = routedContentApiClient(gatewayUrl, token, storefrontId);
    const operations = await buildRoutedContentPlan(client, records);
    const summary = summarizeRoutedContent(operations);
    const reportFile = writeJsonLog('thetea-import-routed-diff', {
        timestamp: new Date().toISOString(),
        dryRun,
        storefrontId,
        selectedProductCodes: selectedProductCodes.map(normalizeCode).filter(Boolean),
        summary,
        operations: operations.map(routedContentOperationEvidence),
    });

    if (summary.conflict) {
        throw new Error(`Routed content conflicts found; no ProductCatalog import will run. Diff: ${reportFile}`);
    }

    return { client, operations, records, storefrontId, summary, reportFile };
}

async function verifyRoutedContentStep(step) {
    const verification = await buildRoutedContentPlan(step.client, step.records);
    const summary = summarizeRoutedContent(verification);
    const verificationFile = writeJsonLog('thetea-import-routed-verification', {
        timestamp: new Date().toISOString(),
        storefrontId: step.storefrontId,
        summary,
        operations: verification.map(routedContentOperationEvidence),
    });
    if (summary.create || summary.update || summary.conflict) {
        throw new Error(`Routed content post-apply verification failed: ${JSON.stringify(summary)}. ${verificationFile}`);
    }
    return { summary, verificationFile };
}

function assertArtifactApplyAllowed(manifest, dryRun) {
    const updateScope = manifest?.targets?.updateScope || 'full';
    if (!dryRun && updateScope === 'packages') {
        throw new Error(
            'Package-scoped artifacts cannot be applied through import-generated; '
            + 'use the approved reconciliation plan and product sync runner.');
    }
}

function preflightArtifact(dir, args, dryRun, selectedProductCodes = []) {
    const bundle = readArtifactBundle(dir);
    const manifest = bundle.manifest || {};
    assertArtifactApplyAllowed(manifest, dryRun);
    const errors = [...bundle.errors];
    const catalogReferencePath = repoPath(args['catalog-ref'] || args['prod-ref']);
    const productReferencePath = repoPath(args['product-ref']);
    const catalogReference = catalogReferencePath ? loadCatalogReference(catalogReferencePath) : null;
    const baselineReference = productReferencePath
        ? loadVerifiedProductReference(productReferencePath)
        : null;
    const baselineProducts = baselineReference?.products || [];
    const workspaceId = resolveCatalogWorkspaceId(args);
    const catalogPolicy = resolveArtifactCatalogPolicy(manifest, args);
    if (baselineReference
        && String(baselineReference.manifest.workspaceId).toLowerCase() !== workspaceId) {
        errors.push('Product reference workspace differs from --workspace-id.');
    }

    if (manifest.catalogReferenceSha256) {
        if (!catalogReferencePath) errors.push('Pass --catalog-ref=... used to generate this artifact.');
        else if (hashInputPath(catalogReferencePath) !== manifest.catalogReferenceSha256) {
            errors.push('Catalog reference hash differs from the artifact manifest.');
        }
    }
    if (manifest.baselineReferenceSha256) {
        if (!productReferencePath) errors.push('Pass --product-ref=... used to generate this artifact.');
        else if (hashInputPath(productReferencePath) !== manifest.baselineReferenceSha256) {
            errors.push('Product reference hash differs from the artifact manifest.');
        }
    }
    if (!dryRun && (!manifest.catalogReferenceSha256 || !manifest.baselineReferenceSha256)) {
        errors.push('Apply is forbidden for a diagnostic artifact without catalog and full-product baseline hashes.');
    }

    if (!dryRun) {
        const snapshotRoot = repoPath(args['snapshot-root'])
            || path.join(REPO_ROOT, 'sources', 'thetea', 'snapshots', manifest.snapshotId || '');
        const sourceManifestPath = path.join(snapshotRoot, 'manifest.json');
        if (!fs.existsSync(sourceManifestPath)) {
            errors.push(`Source snapshot is unavailable for apply preflight: ${snapshotRoot}`);
        } else {
            const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8').replace(/^\uFEFF/, ''));
            if (sha256(fs.readFileSync(sourceManifestPath)) !== manifest.sourceManifestSha256) {
                errors.push('Source snapshot manifest hash differs from the artifact manifest.');
            }
            if (hashSnapshotFiles(snapshotRoot, sourceManifest) !== manifest.sourceFilesSha256) {
                errors.push('Source snapshot file-set hash differs from the artifact manifest.');
            }
        }
    }

    const semantic = validateArtifact({
        products: bundle.products,
        definitions: bundle.definitions,
        catalogs: bundle.catalogs,
        catalogBindings: bundle.catalogBindings,
        requiredLocales: manifest.requiredLocales || [],
        lossEvents: manifest.lossEvents || [],
        routedContent: bundle.routedContent,
        catalogReference,
        requiredCatalogCode: catalogPolicy.targetCatalog,
        baselineProducts,
        baselinePreservation: catalogPolicy.baselinePreservation,
        allowedCatalogCodes: catalogPolicy.allowedCatalogCodes,
        requireArticleParity: manifest.targets?.articleCoverage === 'exact-product-slug',
    });
    errors.push(...semantic.errors);
    const productProfile = String(args.profile || 'products').toLowerCase() === 'products';
    const selectedCodes = new Set(selectedProductCodes.map(normalizeCode).filter(Boolean));
    const qualityProducts = productProfile
        ? bundle.products.filter(product =>
            selectedCodes.size === 0 || selectedCodes.has(normalizeCode(product?.code)))
        : [];
    const publicationQuality = auditPublicationQuality({
        products: qualityProducts,
        definitions: bundle.definitions,
        requiredLocales: manifest.requiredLocales || [],
        productMedia: bundle.productMedia,
        catalogBindings: bundle.catalogBindings,
        targetCatalog: catalogPolicy.targetCatalog,
        publicationRequested: productProfile
            && (manifest.publication?.mode === 'publish'
                || qualityProducts.some(product => product?.published === true)),
    });
    errors.push(...publicationQuality.errors);
    if (errors.length) {
        throw new Error(`Generated artifact preflight failed:\n${errors.slice(0, 20).join('\n')}`);
    }
    return { bundle, semantic, publicationQuality, workspaceId };
}

function profileRoot(dir, profile) {
    if (profile === 'products') {
        return fs.existsSync(path.join(dir, '04-products')) ? path.join(dir, '04-products') : dir;
    }

    if (profile === 'categories') {
        return fs.existsSync(path.join(dir, '03-categories')) ? path.join(dir, '03-categories') : dir;
    }

    throw new Error(`Unsupported profile '${profile}'. Use products or categories.`);
}

async function main() {
    const args = parseArgs();
    if (args.help || args.h) {
        usage();
        return;
    }

    const dryRun = !(args.apply === true && args.yes === true);
    if (args.apply === true && args.yes !== true) {
        throw new Error('Real import requires both --apply and --yes.');
    }

    const dir = outputDir(args);
    const profile = String(args.profile || 'products').toLowerCase();
    const inputRoot = profileRoot(dir, profile);
    if (!fs.existsSync(inputRoot)) throw new Error(`Generated ${profile} directory not found: ${inputRoot}`);

    const only = csv(args.only);
    const limit = args.limit ? Number(args.limit) : null;
    const allFiles = walkJson(inputRoot);
    const selected = [];
    for (const file of allFiles) {
        const records = readRecords(file);
        if (!shouldInclude(file, records, only)) continue;
        selected.push({ file, records });
        if (limit && selected.length >= limit) break;
    }

    if (!selected.length) throw new Error('No generated product files selected.');
    const selectedProductCodes = profile === 'products'
        ? selected.flatMap(item => item.records.map(record => record?.code))
        : [];
    const preflight = preflightArtifact(
        dir,
        args,
        dryRun,
        selectedProductCodes);
    assertRoutedContentStepAllowed(preflight.bundle.manifest || {}, args, dryRun, profile);

    const { GATEWAY_URL, getToken } = require('../lib/config');
    const token = await getToken();
    const routedContentRecords = selectRoutedContentRecords(preflight.bundle, selectedProductCodes);
    const routedContentStep = await prepareRoutedContentStep({
        args,
        dryRun,
        gatewayUrl: GATEWAY_URL,
        token,
        manifest: preflight.bundle.manifest || {},
        records: routedContentRecords,
        selectedProductCodes,
    });
    const results = [];

    console.log(`TheTea generated import: ${selected.length} file(s) ${dryRun ? '[VALIDATE]' : '[APPLY]'}`);
    console.log(`Profile: ${profile}`);
    console.log(`Gateway: ${GATEWAY_URL}`);
    console.log(`Input: ${inputRoot}`);
    console.log(`Artifact products: ${preflight.semantic.productCount}`);
    console.log(
        `Publication quality: ${preflight.publicationQuality.findingCount} finding(s), `
        + `${preflight.publicationQuality.blockerCount} blocker(s)`);
    if (routedContentStep?.skipped) {
        console.log(`Routed content: SKIPPED (${routedContentStep.reason})`);
    } else if (routedContentStep) {
        console.log(
            `Routed content: CREATE ${routedContentStep.summary.create}; `
            + `UPDATE ${routedContentStep.summary.update}; `
            + `NOOP ${routedContentStep.summary.noop}; `
            + `CONFLICT ${routedContentStep.summary.conflict}`);
        console.log(`Routed diff: ${routedContentStep.reportFile}`);
    }

    for (const item of selected) {
        try {
            const response = await importOne({
                gatewayUrl: GATEWAY_URL,
                token,
                workspaceId: preflight.workspaceId,
                file: item.file,
                profile,
                records: item.records,
                dryRun,
            });
            const payload = parseResponse(response.body);
            const data = payload.data || payload;
            const failed = data.failed || data.failedRecords || 0;
            const processed = data.processed || data.validRecords || data.processedRecords || 0;
            const ok = response.status >= 200 && response.status < 300 && failed === 0;
            const rel = path.relative(inputRoot, item.file);

            if (ok) {
                console.log(`${rel} OK (${processed || item.records.length})`);
                results.push({ file: rel, status: 'ok', processed: processed || item.records.length });
            } else {
                const snippet = String(response.body).slice(0, 240);
                console.log(`${rel} FAILED HTTP ${response.status}: ${snippet}`);
                results.push({ file: rel, status: 'failed', httpStatus: response.status, body: response.body });
            }
        } catch (error) {
            const rel = path.relative(inputRoot, item.file);
            console.log(`${rel} ERROR: ${error.message}`);
            results.push({ file: rel, status: 'error', error: error.message });
        }
    }

    const ok = results.filter(r => r.status === 'ok').length;
    const failed = results.length - ok;
    const logDir = path.join(REPO_ROOT, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logDir, `thetea-import-${ts}${dryRun ? '-validate' : '-apply'}.json`);
    fs.writeFileSync(logFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        dryRun,
        profile,
        gateway: GATEWAY_URL,
        input: inputRoot,
        results,
    }, null, 2));

    console.log('');
    console.log(`OK: ${ok}`);
    console.log(`FAILED: ${failed}`);
    console.log(`Log: ${logFile}`);
    if (!dryRun && failed === 0 && routedContentStep && !routedContentStep.skipped) {
        const rollbackFile = writeRoutedContentRollbackArtifact(
            routedContentStep.storefrontId,
            routedContentStep.operations);
        console.log(`Routed rollback: ${rollbackFile}`);
        await applyRoutedContentPlanAndRelease(routedContentStep.client, routedContentStep.operations);
        const verification = await verifyRoutedContentStep(routedContentStep);
        console.log(
            `Routed content verified: ${verification.summary.noop} remote resource(s) match. `
            + `Verification: ${verification.verificationFile}`);
    }
    process.exit(failed ? 1 : 0);
}

if (require.main === module) {
    main().catch(error => {
        console.error(`FATAL: ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    assertRoutedContentStepAllowed,
    assertArtifactApplyAllowed,
    main,
    preflightArtifact,
    selectRoutedContentRecords,
    shouldRunRoutedContentStep,
};
