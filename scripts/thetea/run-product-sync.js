#!/usr/bin/env node
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { REPO_ROOT, loadDotEnv, parseArgs, requireArg } = require('./lib/env');
const { catalogWorkspaceHeader, resolveCatalogWorkspaceId } = require('./lib/catalog-workspace');
const { requestDataExchangeExport } = require('./fetch-prod-products');
const { buildReconciliation, sha256 } = require('./reconcile-generated');
const { hashInputPath } = require('./generate-import');

loadDotEnv();

function usage() {
    console.log(`Usage:
  node scripts/thetea/run-product-sync.js \\
    --plan=reports/thetea/<reconciliation> \\
    --workspace-id=<uuid>

Options:
  --batch-size=<n>   Checkpoint size (default 25)
  --apply --yes      Apply pending desired products and verify every batch
  --rollback --yes   Restore all applied products from the exact rollback payload

Default mode validates pending batches through AdminGateway without writing.
The runner refuses live drift, resumes verified checkpoints, and automatically
rolls back the current batch if its read-back differs from the desired payload.`);
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function repoPath(value) {
    return path.isAbsolute(String(value)) ? String(value) : path.join(REPO_ROOT, String(value));
}

function indexByCode(products, label) {
    const result = new Map();
    for (const product of products) {
        const code = normalizeCode(product?.code);
        if (!code || result.has(code)) throw new Error(`${label} has a missing or duplicate product code.`);
        result.set(code, product);
    }
    return result;
}

function loadSyncPlan(planDirectory) {
    const root = path.resolve(planDirectory);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) {
        throw new Error(`Reconciliation directory is missing or unsafe: ${root}`);
    }
    const planFile = path.join(root, 'plan.json');
    const desiredFile = path.join(root, 'desired-products.json');
    const rollbackFile = path.join(root, 'rollback-products.json');
    for (const file of [planFile, desiredFile, rollbackFile]) {
        if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) {
            throw new Error(`Reconciliation file is missing or unsafe: ${file}`);
        }
    }
    const plan = readJson(planFile);
    const desired = readJson(desiredFile);
    const rollback = readJson(rollbackFile);
    if (plan.eligible !== true) throw new Error('Reconciliation plan is not eligible for apply.');
    if (!Array.isArray(desired) || !Array.isArray(rollback)) {
        throw new Error('Desired and rollback payloads must be arrays.');
    }
    const desiredByCode = indexByCode(desired, 'Desired payload');
    const rollbackByCode = indexByCode(rollback, 'Rollback payload');
    const expectedCodes = (plan.operations || [])
        .filter(operation => operation.action === 'update')
        .map(operation => normalizeCode(operation.code))
        .sort();
    if (JSON.stringify([...desiredByCode.keys()].sort()) !== JSON.stringify(expectedCodes)
        || JSON.stringify([...rollbackByCode.keys()].sort()) !== JSON.stringify(expectedCodes)) {
        throw new Error('Desired/rollback code sets differ from reconciliation update operations.');
    }
    if (hashInputPath(path.join(plan.artifactRoot, 'artifact-manifest.json')) !== plan.artifactManifestSha256) {
        throw new Error('Artifact manifest differs from reconciliation plan.');
    }
    if (plan.productReferencePath
        && hashInputPath(plan.productReferencePath) !== plan.productReferenceSha256) {
        throw new Error('Product reference differs from reconciliation plan.');
    }
    return { root, plan, desired, rollback, desiredByCode, rollbackByCode, expectedCodes };
}

function classifyLiveStates(syncPlan, liveProducts) {
    const liveByCode = indexByCode(liveProducts, 'Live export');
    const states = [];
    for (const code of syncPlan.expectedCodes) {
        const live = liveByCode.get(code);
        if (!live) {
            states.push({ code, state: 'conflict', reason: 'product missing from live export' });
            continue;
        }
        const desired = syncPlan.desiredByCode.get(code);
        const rollback = syncPlan.rollbackByCode.get(code);
        const desiredCheck = buildReconciliation([desired], [live]);
        if (desiredCheck.counts.noop === 1) {
            states.push({ code, state: 'desired', liveSha256: sha256(live) });
            continue;
        }
        const rollbackCheck = buildReconciliation([rollback], [live]);
        if (rollbackCheck.counts.noop === 1) {
            states.push({ code, state: 'baseline', liveSha256: sha256(live) });
            continue;
        }
        states.push({
            code,
            state: 'conflict',
            reason: 'live product differs from both desired and rollback payloads',
            desiredChangedFields: desiredCheck.operations[0]?.changedFields || [],
            rollbackChangedFields: rollbackCheck.operations[0]?.changedFields || [],
        });
    }
    return states;
}

function buildMultipart(records) {
    const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;
    const content = Buffer.from(JSON.stringify(records), 'utf8');
    const head = Buffer.from([
        `--${boundary}`,
        'Content-Disposition: form-data; name="Profile"',
        '',
        'products',
        `--${boundary}`,
        'Content-Disposition: form-data; name="Format"',
        '',
        'json',
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="thetea-product-sync.json"',
        'Content-Type: application/json',
        '',
        '',
    ].join('\r\n'), 'utf8');
    return {
        boundary,
        body: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]),
    };
}

function requestProducts(gatewayUrl, token, workspaceId, records, dryRun) {
    const url = new URL(dryRun ? '/api/v1/data-exchange/validate' : '/api/v1/data-exchange/import', gatewayUrl);
    const { boundary, body } = buildMultipart(records);
    const transport = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const request = transport.request(url, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
                ...catalogWorkspaceHeader(workspaceId),
            },
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(Buffer.from(chunk)));
            response.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let payload = {};
                try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
                const data = payload.data || payload;
                const failed = Number(data.failed ?? data.failedRecords ?? 0);
                const errors = data.errors || [];
                const valid = data.valid;
                if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300
                    || failed > 0 || errors.length > 0 || (dryRun && valid === false)) {
                    reject(new Error(
                        `${dryRun ? 'Validation' : 'Import'} failed (HTTP ${response.statusCode}, failed ${failed}).`));
                    return;
                }
                resolve({ status: response.statusCode, payload });
            });
        });
        request.on('error', reject);
        request.end(body);
    });
}

async function fetchLiveProducts(gatewayUrl, token, workspaceId) {
    const response = await requestDataExchangeExport(gatewayUrl, token, workspaceId, 'products');
    const products = JSON.parse(response.toString('utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(products)) throw new Error('Live products export must be an array.');
    return products;
}

function chunks(values, size) {
    const result = [];
    for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
    return result;
}

function writeCheckpoint(file, checkpoint) {
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
}

function assertBatchState(syncPlan, liveProducts, codes, expectedState) {
    const selectedPlan = { ...syncPlan, expectedCodes: codes };
    const states = classifyLiveStates(selectedPlan, liveProducts);
    const invalid = states.filter(state => state.state !== expectedState);
    if (invalid.length) {
        throw new Error(
            `Read-back failed for ${invalid.length} product(s): ${invalid.slice(0, 5).map(item => item.code).join(', ')}.`);
    }
    return states;
}

async function main() {
    const args = parseArgs();
    if (args.help || args.h) return usage();
    const apply = args.apply === true && args.yes === true;
    const rollbackMode = args.rollback === true && args.yes === true;
    if ((args.apply === true || args.rollback === true) && args.yes !== true) {
        throw new Error('Mutation requires --yes.');
    }
    if (apply && rollbackMode) throw new Error('Choose either --apply or --rollback.');
    const batchSize = Number(args['batch-size'] || 25);
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
        throw new Error('--batch-size must be an integer from 1 to 100.');
    }
    const syncPlan = loadSyncPlan(repoPath(requireArg(args, 'plan')));
    const workspaceId = resolveCatalogWorkspaceId(args);
    if (String(syncPlan.plan.workspaceId || '').toLowerCase() !== workspaceId) {
        throw new Error('Reconciliation workspace differs from --workspace-id.');
    }
    const { GATEWAY_URL, getToken } = require('../lib/config');
    const token = await getToken();
    let liveProducts = await fetchLiveProducts(GATEWAY_URL, token, workspaceId);
    let states = classifyLiveStates(syncPlan, liveProducts);
    const conflicts = states.filter(state => state.state === 'conflict');
    if (conflicts.length) throw new Error(`Live preflight has ${conflicts.length} conflict(s).`);

    const checkpointFile = path.join(syncPlan.root, 'product-sync-checkpoint.json');
    const checkpoint = fs.existsSync(checkpointFile) ? readJson(checkpointFile) : {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        planSha256: hashInputPath(path.join(syncPlan.root, 'plan.json')),
        desiredSha256: hashInputPath(path.join(syncPlan.root, 'desired-products.json')),
        rollbackSha256: hashInputPath(path.join(syncPlan.root, 'rollback-products.json')),
        workspaceId,
        batches: [],
    };
    if (checkpoint.planSha256 !== hashInputPath(path.join(syncPlan.root, 'plan.json'))
        || checkpoint.desiredSha256 !== hashInputPath(path.join(syncPlan.root, 'desired-products.json'))
        || checkpoint.rollbackSha256 !== hashInputPath(path.join(syncPlan.root, 'rollback-products.json'))
        || checkpoint.workspaceId !== workspaceId) {
        throw new Error('Existing checkpoint differs from the selected plan or workspace.');
    }

    const targetState = rollbackMode ? 'baseline' : 'desired';
    const pendingState = rollbackMode ? 'desired' : 'baseline';
    const pendingCodes = states.filter(state => state.state === pendingState).map(state => state.code);
    const payloadByCode = rollbackMode ? syncPlan.rollbackByCode : syncPlan.desiredByCode;
    console.log(`Mode: ${rollbackMode ? 'rollback' : apply ? 'apply' : 'validate'}`);
    console.log(`Live desired: ${states.filter(state => state.state === 'desired').length}`);
    console.log(`Live baseline: ${states.filter(state => state.state === 'baseline').length}`);
    console.log(`Pending: ${pendingCodes.length}`);

    for (const [index, codes] of chunks(pendingCodes, batchSize).entries()) {
        const records = codes.map(code => payloadByCode.get(code));
        await requestProducts(GATEWAY_URL, token, workspaceId, records, true);
        if (!apply && !rollbackMode) {
            checkpoint.batches.push({ index, mode: 'validate', codes, status: 'validated', at: new Date().toISOString() });
            writeCheckpoint(checkpointFile, checkpoint);
            continue;
        }
        const batch = { index, mode: rollbackMode ? 'rollback' : 'apply', codes, status: 'started', at: new Date().toISOString() };
        checkpoint.batches.push(batch);
        writeCheckpoint(checkpointFile, checkpoint);
        try {
            await requestProducts(GATEWAY_URL, token, workspaceId, records, false);
            liveProducts = await fetchLiveProducts(GATEWAY_URL, token, workspaceId);
            assertBatchState(syncPlan, liveProducts, codes, targetState);
            batch.status = 'verified';
            batch.verifiedAt = new Date().toISOString();
            writeCheckpoint(checkpointFile, checkpoint);
        } catch (error) {
            batch.status = 'failed';
            batch.error = error.message;
            if (!rollbackMode) {
                const rollbackRecords = codes.map(code => syncPlan.rollbackByCode.get(code));
                try {
                    await requestProducts(GATEWAY_URL, token, workspaceId, rollbackRecords, false);
                    liveProducts = await fetchLiveProducts(GATEWAY_URL, token, workspaceId);
                    assertBatchState(syncPlan, liveProducts, codes, 'baseline');
                    batch.rollback = 'verified';
                } catch (rollbackError) {
                    batch.rollback = 'failed';
                    batch.rollbackError = rollbackError.message;
                }
            }
            writeCheckpoint(checkpointFile, checkpoint);
            throw error;
        }
    }

    if (apply || rollbackMode) {
        liveProducts = await fetchLiveProducts(GATEWAY_URL, token, workspaceId);
        states = classifyLiveStates(syncPlan, liveProducts);
    }
    checkpoint.completedAt = new Date().toISOString();
    checkpoint.finalCounts = states.reduce((result, state) => {
        result[state.state] = (result[state.state] || 0) + 1;
        return result;
    }, {});
    writeCheckpoint(checkpointFile, checkpoint);
    console.log(`Checkpoint: ${checkpointFile}`);
    console.log(`Final desired: ${checkpoint.finalCounts.desired || 0}`);
    console.log(`Final baseline: ${checkpoint.finalCounts.baseline || 0}`);
    return checkpoint;
}

if (require.main === module) {
    main().catch(error => {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    assertBatchState,
    classifyLiveStates,
    loadSyncPlan,
    requestProducts,
};
