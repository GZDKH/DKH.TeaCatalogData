#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { REPO_ROOT, loadDotEnv, parseArgs } = require('./lib/env');
const { assertScopedPath, withStagedOutput } = require('./lib/generated-output');
const { resolveCatalogWorkspaceId, catalogWorkspaceHeader } = require('./lib/catalog-workspace');
const { loadVerifiedProductReference } = require('./lib/product-reference');
const { requestDataExchangeExport } = require('./fetch-prod-products');
const { hashInputPath } = require('./generate-import');

loadDotEnv();

const TARGET_GROUP = 'SPEC-TT-GROUP-ATOMIC';
const REPAIR_ATTRIBUTE_CODES = [
    'SPEC-06609725785E48F',
    'SPEC-4304F36A0BF94F7',
    'SPEC-BF8EE9A970E348C',
    'SPEC-PUERH-PROCESSING',
    'SPEC-PUERH-UNIT-WEIGHT-G',
    'SPEC-PUERH-PACKAGING-SPECIFICATION',
    'SPEC-PUERH-REFERENCE-PRICE-UNIT',
];

function usage() {
    console.log(`Usage:
  node scripts/thetea/repair-puerh-spec-groups.js \\
    --catalog-ref=sources/prod/catalog-reference/prod-2026-07-22.json \\
    --product-ref=sources/prod/product-reference/prod-products-2026-07-22

Options:
  --catalog-ref=<path>  Exact reference containing specificationGroups and specificationAttributes
  --product-ref=<path>  Exact complete products baseline used to count affected values
  --out=<directory>     Report directory under reports/thetea/
  --workspace-id=<uuid> ProductCatalog workspace; or PRODUCT_CATALOG_WORKSPACE_ID
  --remote-validate     Validate the repair through AdminGateway without writing
  --apply --yes         Apply through AdminGateway, read back, and verify

The repair changes only each allowlisted attribute's group to ${TARGET_GROUP}.
Product values are not rewritten.`);
}

function repoPath(value) {
    if (!value) return null;
    return path.isAbsolute(String(value)) ? String(value) : path.join(REPO_ROOT, String(value));
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key =>
            `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function withoutGroup(attribute) {
    const copy = { ...attribute };
    delete copy.group;
    return copy;
}

function buildRepairPlan(catalogReference, products) {
    const groups = Array.isArray(catalogReference?.specificationGroups)
        ? catalogReference.specificationGroups
        : null;
    const attributes = Array.isArray(catalogReference?.specificationAttributes)
        ? catalogReference.specificationAttributes
        : null;
    if (!groups || !attributes) {
        throw new Error(
            'Catalog reference must contain complete specificationGroups and specificationAttributes exports.');
    }

    const targetGroup = groups.find(group => normalizeCode(group.code) === TARGET_GROUP);
    if (!targetGroup) throw new Error(`Target specification group ${TARGET_GROUP} is missing.`);

    const attributesByCode = new Map(attributes.map(attribute => [normalizeCode(attribute.code), attribute]));
    const usageByCode = new Map(REPAIR_ATTRIBUTE_CODES.map(code => [code, new Set()]));
    for (const product of products || []) {
        for (const specification of product.specifications || []) {
            const code = normalizeCode(specification.attribute);
            if (usageByCode.has(code)) usageByCode.get(code).add(normalizeCode(product.code));
        }
    }

    const operations = [];
    const desiredAttributes = [];
    const rollbackAttributes = [];
    for (const code of REPAIR_ATTRIBUTE_CODES) {
        const before = attributesByCode.get(code);
        if (!before) {
            operations.push({ code, action: 'conflict', reason: 'attribute is missing' });
            continue;
        }

        const beforeGroup = normalizeCode(before.group);
        const affectedProducts = usageByCode.get(code).size;
        if (beforeGroup && beforeGroup !== TARGET_GROUP) {
            operations.push({
                code,
                action: 'conflict',
                reason: `attribute already belongs to ${beforeGroup}`,
                beforeGroup,
                targetGroup: TARGET_GROUP,
                affectedProducts,
            });
            continue;
        }

        const desired = { ...before, group: TARGET_GROUP };
        rollbackAttributes.push(before);
        desiredAttributes.push(desired);
        operations.push({
            code,
            action: beforeGroup === TARGET_GROUP ? 'noop' : 'update',
            beforeGroup: beforeGroup || null,
            targetGroup: TARGET_GROUP,
            changedFields: beforeGroup === TARGET_GROUP ? [] : ['group'],
            affectedProducts,
        });
    }

    const counts = operations.reduce((result, operation) => {
        result[operation.action] = (result[operation.action] || 0) + 1;
        return result;
    }, { update: 0, noop: 0, conflict: 0 });
    const affectedProductCodes = new Set();
    for (const productsForAttribute of usageByCode.values()) {
        for (const productCode of productsForAttribute) affectedProductCodes.add(productCode);
    }

    return {
        targetGroup,
        operations,
        counts,
        affectedProductCount: affectedProductCodes.size,
        affectedSpecificationValueCount: operations.reduce(
            (sum, operation) => sum + (operation.affectedProducts || 0),
            0),
        desiredAttributes,
        rollbackAttributes,
    };
}

function buildMultipart(profile, records) {
    const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;
    const content = Buffer.from(JSON.stringify(records), 'utf8');
    const head = Buffer.from([
        `--${boundary}`,
        'Content-Disposition: form-data; name="Profile"',
        '',
        profile,
        `--${boundary}`,
        'Content-Disposition: form-data; name="Format"',
        '',
        'json',
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="puerh-spec-group-repair.json"',
        'Content-Type: application/json',
        '',
        '',
    ].join('\r\n'), 'utf8');
    return {
        boundary,
        body: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]),
    };
}

function requestImport(gatewayUrl, token, workspaceId, records, dryRun) {
    const url = new URL(
        dryRun ? '/api/v1/data-exchange/validate' : '/api/v1/data-exchange/import',
        gatewayUrl);
    const { boundary, body } = buildMultipart('specification_attributes', records);
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
                try {
                    payload = raw ? JSON.parse(raw) : {};
                } catch {
                    payload = { raw: raw.slice(0, 500) };
                }
                if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
                    reject(new Error(`HTTP ${response.statusCode} for ${url.pathname}`));
                    return;
                }
                const failed = Number(payload.failed ?? payload.Failed ?? 0);
                const errors = payload.errors || payload.Errors || [];
                const valid = payload.valid ?? payload.Valid;
                if (failed > 0 || errors.length > 0 || (dryRun && valid === false)) {
                    const messages = errors.map(error =>
                        typeof error === 'string'
                            ? error
                            : `${error.field || error.Field || '<record>'}: ${error.message || error.Message || 'invalid'}`);
                    reject(new Error(
                        `${dryRun ? 'Validation' : 'Import'} failed for ${failed} record(s): ${messages.join('; ')}`));
                    return;
                }
                resolve({ status: response.statusCode, payload });
            });
        });
        request.on('error', reject);
        request.end(body);
    });
}

async function fetchExportArray(gatewayUrl, token, workspaceId, profile) {
    const response = await requestDataExchangeExport(gatewayUrl, token, workspaceId, profile);
    const records = JSON.parse(response.toString('utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(records)) throw new Error(`${profile} live export must be an array.`);
    return records;
}

function assertLiveReferenceUnchanged(plan, liveAttributes, liveGroups) {
    const liveAttributesByCode = new Map(
        liveAttributes.map(attribute => [normalizeCode(attribute.code), attribute]));
    const liveTargetGroup = liveGroups.find(group => normalizeCode(group.code) === TARGET_GROUP);
    if (!liveTargetGroup || stableStringify(liveTargetGroup) !== stableStringify(plan.targetGroup)) {
        throw new Error(`Live target group ${TARGET_GROUP} differs from the immutable catalog reference.`);
    }
    for (const before of plan.rollbackAttributes) {
        const live = liveAttributesByCode.get(normalizeCode(before.code));
        if (!live || stableStringify(live) !== stableStringify(before)) {
            throw new Error(`Live attribute ${before.code} differs from the immutable catalog reference.`);
        }
    }
}

function verifyApplied(plan, liveAttributes) {
    const liveByCode = new Map(liveAttributes.map(attribute => [normalizeCode(attribute.code), attribute]));
    const errors = [];
    for (const desired of plan.desiredAttributes) {
        const live = liveByCode.get(normalizeCode(desired.code));
        if (!live) {
            errors.push(`${desired.code}: missing after apply`);
            continue;
        }
        if (normalizeCode(live.group) !== TARGET_GROUP) {
            errors.push(`${desired.code}: group is ${live.group || '<none>'}`);
        }
        if (stableStringify(withoutGroup(live)) !== stableStringify(withoutGroup(desired))) {
            errors.push(`${desired.code}: a non-group field changed`);
        }
    }
    if (errors.length) throw new Error(`Repair read-back failed: ${errors.join('; ')}`);
}

function resolveOutput(args, catalogReferencePath) {
    const requested = args.out
        ? repoPath(args.out)
        : path.join(
            REPO_ROOT,
            'reports',
            'thetea',
            `${path.basename(catalogReferencePath, path.extname(catalogReferencePath))}-puerh-spec-groups`);
    return assertScopedPath(requested, {
        repoRoot: REPO_ROOT,
        allowedRoot: path.join(REPO_ROOT, 'reports', 'thetea'),
        allowedDescription: 'reports/thetea/',
        label: 'Pu-erh specification repair report',
    });
}

function writeReport(output, report, desiredAttributes, rollbackAttributes) {
    withStagedOutput(output, staging => {
        fs.writeFileSync(path.join(staging, 'plan.json'), `${JSON.stringify(report, null, 2)}\n`);
        fs.writeFileSync(
            path.join(staging, 'specification_attributes.json'),
            `${JSON.stringify(desiredAttributes, null, 2)}\n`);
        fs.writeFileSync(
            path.join(staging, 'rollback-specification_attributes.json'),
            `${JSON.stringify(rollbackAttributes, null, 2)}\n`);
    });
}

async function main() {
    const args = parseArgs();
    if (args.help || args.h) {
        usage();
        return;
    }
    if (args.apply === true && args.yes !== true) {
        throw new Error('Real repair requires both --apply and --yes.');
    }
    const catalogReferencePath = repoPath(args['catalog-ref']);
    const productReferencePath = repoPath(args['product-ref']);
    if (!catalogReferencePath || !productReferencePath) {
        throw new Error('--catalog-ref and --product-ref are required.');
    }

    const catalogReference = JSON.parse(fs.readFileSync(catalogReferencePath, 'utf8').replace(/^\uFEFF/, ''));
    const productReference = loadVerifiedProductReference(productReferencePath);
    const plan = buildRepairPlan(catalogReference, productReference.products);
    if (plan.counts.conflict > 0) {
        throw new Error(`Repair plan has ${plan.counts.conflict} conflict(s).`);
    }

    const apply = args.apply === true && args.yes === true;
    const remoteValidate = args['remote-validate'] === true || apply;
    const report = {
        generatedAt: new Date().toISOString(),
        mode: apply ? 'apply' : remoteValidate ? 'remote-validate' : 'dry-run',
        targetGroup: TARGET_GROUP,
        catalogReferenceSha256: hashInputPath(catalogReferencePath),
        productReferenceSha256: hashInputPath(productReferencePath),
        workspaceId: catalogReference.workspaceId,
        counts: plan.counts,
        affectedProductCount: plan.affectedProductCount,
        affectedSpecificationValueCount: plan.affectedSpecificationValueCount,
        operations: plan.operations,
        validation: null,
        apply: null,
        verification: null,
        rollback: {
            available: true,
            file: 'rollback-specification_attributes.json',
        },
    };
    const output = resolveOutput(args, catalogReferencePath);
    writeReport(output, report, plan.desiredAttributes, plan.rollbackAttributes);

    if (remoteValidate) {
        const workspaceId = resolveCatalogWorkspaceId(args);
        if (String(catalogReference.workspaceId || '').toLowerCase() !== workspaceId) {
            throw new Error('Catalog reference workspace differs from --workspace-id.');
        }
        const { GATEWAY_URL, getToken } = require('../lib/config');
        const token = await getToken();
        const [liveAttributes, liveGroups] = await Promise.all([
            fetchExportArray(GATEWAY_URL, token, workspaceId, 'specification_attributes'),
            fetchExportArray(GATEWAY_URL, token, workspaceId, 'specification_groups'),
        ]);
        assertLiveReferenceUnchanged(plan, liveAttributes, liveGroups);
        const updates = plan.desiredAttributes.filter(attribute =>
            plan.operations.some(operation => operation.code === normalizeCode(attribute.code)
                && operation.action === 'update'));
        report.validation = updates.length
            ? await requestImport(GATEWAY_URL, token, workspaceId, updates, true)
            : { skipped: true, reason: 'all operations are noop' };

        if (apply && updates.length) {
            try {
                report.apply = await requestImport(GATEWAY_URL, token, workspaceId, updates, false);
                const readBack = await fetchExportArray(
                    GATEWAY_URL,
                    token,
                    workspaceId,
                    'specification_attributes');
                verifyApplied(plan, readBack);
                report.verification = { valid: true, checkedAttributes: plan.desiredAttributes.length };
            } catch (error) {
                report.apply = { error: error.message };
                try {
                    await requestImport(
                        GATEWAY_URL,
                        token,
                        workspaceId,
                        plan.rollbackAttributes,
                        false);
                    report.rollback.executed = true;
                } catch (rollbackError) {
                    report.rollback.executed = false;
                    report.rollback.error = rollbackError.message;
                }
                writeReport(output, report, plan.desiredAttributes, plan.rollbackAttributes);
                throw error;
            }
        }
        if (apply && !updates.length) {
            report.apply = { skipped: true, reason: 'all operations are noop' };
            report.verification = { valid: true, checkedAttributes: plan.desiredAttributes.length };
        }
    }

    writeReport(output, report, plan.desiredAttributes, plan.rollbackAttributes);
    console.log(`Mode: ${report.mode}`);
    console.log(`Updates: ${plan.counts.update}`);
    console.log(`Noops: ${plan.counts.noop}`);
    console.log(`Affected products: ${plan.affectedProductCount}`);
    console.log(`Affected specification values: ${plan.affectedSpecificationValueCount}`);
    console.log(`Report: ${output}`);
    return report;
}

if (require.main === module) {
    main().catch(error => {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    REPAIR_ATTRIBUTE_CODES,
    TARGET_GROUP,
    assertLiveReferenceUnchanged,
    buildRepairPlan,
    requestImport,
    verifyApplied,
};
