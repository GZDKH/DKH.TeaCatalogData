#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');
const { REPO_ROOT, parseArgs } = require('./lib/env');
const {
    getCode,
    getDisplayName,
    getId,
    isDeleted,
    isLegacyJunkSpecificationAttribute,
    isLegacyJunkSpecificationGroup,
} = require('./lib/cleanup-junk');

const MONOREPO_ROOT = path.resolve(REPO_ROOT, '../..');
const PRODUCT_CATALOG_PROTO_ROOT = path.join(
    MONOREPO_ROOT,
    'services/DKH.ProductCatalogService/DKH.ProductCatalogService.Contracts/proto');
const PLATFORM_GRPC_COMMON_PROTO_ROOT = path.join(
    MONOREPO_ROOT,
    'libraries/DKH.Platform/src/Api/DKH.Platform.Grpc.Common/proto');
const ATTRIBUTE_PROTO = 'product_catalog/api/specification_attribute_crud/v1/specification_attributes_crud_service.proto';
const GROUP_PROTO = 'product_catalog/api/specification_attribute_group_crud/v1/specification_attribute_groups_crud_service.proto';
const ATTRIBUTE_SERVICE = 'proto.product_catalog.api.specification_attribute_crud.v1.SpecificationAttributesCrudService';
const GROUP_SERVICE = 'proto.product_catalog.api.specification_attribute_group_crud.v1.SpecificationAttributeGroupsCrudService';

function usage() {
    console.log(`Usage:
  node scripts/thetea/cleanup-prod-junk-grpc.js --grpc-url=10.10.10.101:5003
  node scripts/thetea/cleanup-prod-junk-grpc.js --grpc-url=10.10.10.101:5003 --apply --yes

Default mode is a dry-run. Apply mode deletes only allowlisted TheTea junk:
- specification attributes with SPEC-TT-MARKDOWN-*, SPEC-TT-SIMILAR-*, or synthetic FIELD...Xn codes
- groups SPEC-TT-GROUP-MARKDOWN, SPEC-TT-GROUP-RELATED, or synthetic SPEC-TT-GROUP-EXT-N codes

Reads use AdminGateway. Deletes use ProductCatalogService gRPC CRUD APIs; the script never writes directly to the database.`);
}

function requireOption(args, key, envName) {
    const value = args[key] || process.env[envName];
    if (!value || value === true) {
        throw new Error(`--${key}=... or ${envName} is required`);
    }

    return String(value);
}

function requestRaw(url, token, method = 'GET') {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const req = lib.request(parsed, {
            method,
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
            },
        }, res => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
        });
        req.on('error', reject);
        req.end();
    });
}

async function requestJson(url, token) {
    const response = await requestRaw(url, token);
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status} for ${new URL(url).pathname}: ${response.body.slice(0, 240)}`);
    }

    try {
        return JSON.parse(response.body);
    } catch (error) {
        throw new Error(`Invalid JSON for ${new URL(url).pathname}: ${error.message}`);
    }
}

function extractPage(payload) {
    const body = payload.data || payload;
    const items = body.items || body.Items || [];
    return {
        items,
        totalCount: body.totalCount || body.TotalCount || items.length,
    };
}

async function fetchPaged(gatewayUrl, token, endpoint, pageSize) {
    const all = [];
    const maxPages = 1000;
    for (let page = 1; page <= maxPages; page++) {
        const separator = endpoint.includes('?') ? '&' : '?';
        const payload = await requestJson(`${gatewayUrl}${endpoint}${separator}page=${page}&pageSize=${pageSize}`, token);
        const current = extractPage(payload);
        all.push(...current.items);
        if (current.items.length === 0) {
            return all;
        }
    }

    throw new Error(`Exceeded ${maxPages} pages for ${endpoint}`);
}

function summarize(items) {
    return items.map(item => ({
        id: getId(item),
        code: getCode(item),
        name: getDisplayName(item),
        isDeleted: isDeleted(item),
    }));
}

function truncate(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function grpcInvoke(options, protoFile, method, data) {
    const args = [
        '-plaintext',
        '-max-time',
        String(options.timeoutSeconds),
        '-import-path',
        PRODUCT_CATALOG_PROTO_ROOT,
        '-import-path',
        PLATFORM_GRPC_COMMON_PROTO_ROOT,
        '-proto',
        protoFile,
        '-H',
        `X-User-Id: ${options.userId}`,
        '-H',
        `X-User-Name: ${options.userName}`,
        '-H',
        `X-User-Roles: ${options.userRoles}`,
        '-d',
        JSON.stringify(data),
        options.grpcUrl,
        method,
    ];

    const result = spawnSync(options.grpcurlBin, args, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
    });

    return {
        exitCode: result.status,
        stdout: truncate(result.stdout),
        stderr: truncate(result.stderr),
    };
}

function grpcStep(options, protoFile, method, data) {
    const result = grpcInvoke(options, protoFile, method, data);
    return {
        operation: method.split('/').pop(),
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
    };
}

function failed(step) {
    return step.exitCode !== 0;
}

function attributeRequest(id) {
    return { specificationAttributeId: { value: id } };
}

function groupRequest(id) {
    return { groupId: { value: id } };
}

async function cleanupAttributes(options, items, dryRun) {
    const results = [];
    for (const item of items) {
        const id = getId(item);
        const code = getCode(item);
        if (!id) {
            results.push({ id, code, status: 'skipped', reason: 'missing id' });
            continue;
        }

        if (dryRun) {
            results.push({ id, code, status: 'dry-run' });
            continue;
        }

        const steps = [];
        if (!isDeleted(item)) {
            const soft = grpcStep(
                options,
                ATTRIBUTE_PROTO,
                `${ATTRIBUTE_SERVICE}/DeleteSpecificationAttribute`,
                attributeRequest(id));
            steps.push(soft);
            if (failed(soft)) {
                results.push({ id, code, status: 'failed', steps });
                continue;
            }
        }

        const permanent = grpcStep(
            options,
            ATTRIBUTE_PROTO,
            `${ATTRIBUTE_SERVICE}/PermanentlyDeleteSpecificationAttribute`,
            attributeRequest(id));
        steps.push(permanent);
        results.push({ id, code, status: failed(permanent) ? 'failed' : 'deleted', steps });
    }

    return results;
}

async function cleanupGroups(options, items, dryRun) {
    const results = [];
    for (const item of items) {
        const id = getId(item);
        const code = getCode(item);
        if (!id) {
            results.push({ id, code, status: 'skipped', reason: 'missing id' });
            continue;
        }

        if (dryRun) {
            results.push({ id, code, status: 'dry-run' });
            continue;
        }

        const steps = [];
        if (!isDeleted(item)) {
            const soft = grpcStep(
                options,
                GROUP_PROTO,
                `${GROUP_SERVICE}/DeleteGroup`,
                groupRequest(id));
            steps.push(soft);
            if (failed(soft)) {
                results.push({ id, code, status: 'failed', steps });
                continue;
            }
        }

        const permanent = grpcStep(
            options,
            GROUP_PROTO,
            `${GROUP_SERVICE}/PermanentlyDeleteGroup`,
            groupRequest(id));
        steps.push(permanent);
        results.push({ id, code, status: failed(permanent) ? 'failed' : 'deleted', steps });
    }

    return results;
}

function writeLog(report, dryRun) {
    const logDir = path.join(REPO_ROOT, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logDir, `thetea-cleanup-junk-grpc-${ts}${dryRun ? '-dry-run' : '-apply'}.json`);
    fs.writeFileSync(logFile, JSON.stringify(report, null, 2));
    return logFile;
}

function hasFailures(results) {
    return results.some(result => result.status === 'failed' || result.status === 'skipped');
}

function statusCounts(results) {
    return results.reduce((acc, result) => {
        acc[result.status] = (acc[result.status] || 0) + 1;
        return acc;
    }, {});
}

async function main() {
    const args = parseArgs();
    if (args.help || args.h) {
        usage();
        return;
    }

    const dryRun = !(args.apply === true && args.yes === true);
    if (args.apply === true && args.yes !== true) {
        throw new Error('Cleanup apply requires both --apply and --yes.');
    }

    const { GATEWAY_URL, getToken } = require('../lib/config');
    const token = await getToken();
    const pageSize = args['page-size'] ? Number(args['page-size']) : 100;
    const options = {
        grpcUrl: requireOption(args, 'grpc-url', 'PRODUCT_CATALOG_GRPC_URL'),
        userId: String(args['user-id'] || process.env.PRODUCT_CATALOG_GRPC_USER_ID || '9e8c1c36-03c9-45de-8adc-c9dafd181835'),
        userName: String(args['user-name'] || process.env.PRODUCT_CATALOG_GRPC_USER_NAME || 'service-account-dkh-admin-gateway'),
        userRoles: String(args.roles || process.env.PRODUCT_CATALOG_GRPC_USER_ROLES || 'catalog-manager,catalog:delete,catalog:read,catalog:import'),
        grpcurlBin: String(args.grpcurl || process.env.GRPCURL_BIN || 'grpcurl'),
        timeoutSeconds: Number(args.timeout || process.env.GRPCURL_TIMEOUT_SECONDS || 15),
    };

    console.log(`TheTea prod junk gRPC cleanup ${dryRun ? '[DRY-RUN]' : '[APPLY]'}`);
    console.log(`Gateway reads: ${GATEWAY_URL}`);
    console.log(`ProductCatalog gRPC deletes: ${options.grpcUrl}`);

    const specificationAttributes = await fetchPaged(
        GATEWAY_URL,
        token,
        '/api/v1/specification-attributes?deletedFilter=all',
        pageSize);
    const groups = await fetchPaged(
        GATEWAY_URL,
        token,
        '/api/v1/specification-attribute-groups?deletedFilter=all',
        pageSize);

    const junkAttributes = specificationAttributes.filter(isLegacyJunkSpecificationAttribute);
    const junkGroups = groups.filter(isLegacyJunkSpecificationGroup);

    const attributeResults = await cleanupAttributes(options, junkAttributes, dryRun);
    const groupResults = await cleanupGroups(options, junkGroups, dryRun);

    const report = {
        timestamp: new Date().toISOString(),
        dryRun,
        gateway: GATEWAY_URL,
        grpcUrl: options.grpcUrl,
        found: {
            specificationAttributes: summarize(junkAttributes),
            groups: summarize(junkGroups),
        },
        results: {
            specificationAttributes: attributeResults,
            groups: groupResults,
        },
    };

    const logFile = writeLog(report, dryRun);
    const failedResults = hasFailures(attributeResults) || hasFailures(groupResults);

    console.log(`Junk specification attributes: ${junkAttributes.length}`);
    console.log(`Junk groups: ${junkGroups.length}`);
    console.log(`Attribute result counts: ${JSON.stringify(statusCounts(attributeResults))}`);
    console.log(`Group result counts: ${JSON.stringify(statusCounts(groupResults))}`);
    console.log(`Log: ${logFile}`);

    if (failedResults) {
        process.exit(1);
    }
}

main().catch(error => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
});
