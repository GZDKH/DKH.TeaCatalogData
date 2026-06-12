#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { REPO_ROOT, parseArgs } = require('./lib/env');
const {
    getCode,
    getDisplayName,
    getId,
    isDeleted,
    isLegacyJunkSpecificationAttribute,
    isLegacyJunkSpecificationGroup,
} = require('./lib/cleanup-junk');

function usage() {
    console.log(`Usage:
  node scripts/thetea/cleanup-prod-junk.js
  node scripts/thetea/cleanup-prod-junk.js --apply --yes

Default mode is a dry-run. Apply mode deletes only legacy TheTea junk:
- specification attributes with codes SPEC-TT-MARKDOWN-* or SPEC-TT-SIMILAR-*
- groups SPEC-TT-GROUP-MARKDOWN and SPEC-TT-GROUP-RELATED

All reads and deletes go through AdminGateway. The script never writes directly to the database.`);
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
        if (current.items.length < pageSize) {
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

async function deleteResource(gatewayUrl, token, endpoint, item) {
    const id = getId(item);
    if (!id) {
        return { id, code: getCode(item), status: 'skipped', reason: 'missing id' };
    }

    const base = `${gatewayUrl}${endpoint}/${encodeURIComponent(id)}`;
    const steps = [];

    if (!isDeleted(item)) {
        const soft = await requestRaw(base, token, 'DELETE');
        steps.push({ operation: 'delete', status: soft.status, body: soft.body.slice(0, 240) });
        if (soft.status < 200 || soft.status >= 300) {
            return { id, code: getCode(item), status: 'failed', steps };
        }
    }

    const permanent = await requestRaw(`${base}/permanent`, token, 'DELETE');
    steps.push({ operation: 'permanent-delete', status: permanent.status, body: permanent.body.slice(0, 240) });

    if (permanent.status === 404) {
        return { id, code: getCode(item), status: 'already-deleted', steps };
    }

    if (permanent.status < 200 || permanent.status >= 300) {
        return { id, code: getCode(item), status: 'failed', steps };
    }

    return { id, code: getCode(item), status: 'deleted', steps };
}

async function cleanupCollection({ gatewayUrl, token, endpoint, items, dryRun }) {
    if (dryRun) {
        return items.map(item => ({ id: getId(item), code: getCode(item), status: 'dry-run' }));
    }

    const results = [];
    for (const item of items) {
        results.push(await deleteResource(gatewayUrl, token, endpoint, item));
    }
    return results;
}

function writeLog(report, dryRun) {
    const logDir = path.join(REPO_ROOT, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logDir, `thetea-cleanup-junk-${ts}${dryRun ? '-dry-run' : '-apply'}.json`);
    fs.writeFileSync(logFile, JSON.stringify(report, null, 2));
    return logFile;
}

function hasFailures(results) {
    return results.some(result => result.status === 'failed' || result.status === 'skipped');
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

    const pageSize = args['page-size'] ? Number(args['page-size']) : 500;
    const { GATEWAY_URL, getToken } = require('../lib/config');
    const token = await getToken();

    console.log(`TheTea prod junk cleanup ${dryRun ? '[DRY-RUN]' : '[APPLY]'}`);
    console.log(`Gateway: ${GATEWAY_URL}`);

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

    const attributeResults = await cleanupCollection({
        gatewayUrl: GATEWAY_URL,
        token,
        endpoint: '/api/v1/specification-attributes',
        items: junkAttributes,
        dryRun,
    });

    const groupResults = await cleanupCollection({
        gatewayUrl: GATEWAY_URL,
        token,
        endpoint: '/api/v1/specification-attribute-groups',
        items: junkGroups,
        dryRun,
    });

    const report = {
        timestamp: new Date().toISOString(),
        dryRun,
        gateway: GATEWAY_URL,
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
    const failed = hasFailures(attributeResults) || hasFailures(groupResults);

    console.log(`Junk specification attributes: ${junkAttributes.length}`);
    console.log(`Junk groups: ${junkGroups.length}`);
    console.log(`Log: ${logFile}`);

    if (failed) {
        process.exit(1);
    }
}

main().catch(error => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
});
