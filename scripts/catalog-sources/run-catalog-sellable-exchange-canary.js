#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../thetea/lib/env');
const {
    CatalogSellableExchangeClient,
    requestAccessToken,
    runNoOpCanary,
} = require('./thetea-shop/catalog-sellable-exchange-canary');

const DOTENV_ALLOWLIST = new Set([
    'ADMIN_GATEWAY_KEYCLOAK_SECRET',
    'ADMIN_GATEWAY_ORIGIN',
    'ADMIN_GATEWAY_URL',
    'GATEWAY_URL',
    'KEYCLOAK_CLIENT_ID',
    'KEYCLOAK_CLIENT_SECRET',
    'KEYCLOAK_EXTERNAL_URL',
    'KEYCLOAK_REALM',
    'KEYCLOAK_URL',
]);

function bool(value) {
    return value === true || String(value || '').toLowerCase() === 'true';
}

function safeError(error) {
    const code = String(error?.code || error?.message || 'CANARY_FAILED');
    return /^[A-Z0-9_]+$/u.test(code) ? code : 'CANARY_FAILED';
}

function readWorkspaceReference(value) {
    if (!value) return '';
    const file = path.resolve(String(value));
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('WORKSPACE_REFERENCE_INVALID');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return String(parsed?.workspaceId || '');
}

function parseAllowedDotenv(text) {
    if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw new Error('DOTENV_INPUT_TOO_LARGE');
    const result = {};
    for (const rawLine of String(text || '').split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator < 1) continue;
        const key = line.slice(0, separator).trim();
        if (!DOTENV_ALLOWLIST.has(key)) continue;
        let value = line.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    }
    return result;
}

async function readStdin() {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) throw new Error('DOTENV_INPUT_TOO_LARGE');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

async function main(argv = process.argv.slice(2), environment = process.env) {
    const args = parseArgs(argv);
    const effectiveEnvironment = bool(args['dotenv-stdin'])
        ? { ...environment, ...parseAllowedDotenv(await readStdin()) }
        : environment;
    const apply = bool(args.apply);
    if (apply && !bool(args.yes)) throw new Error('CANARY_APPLY_REQUIRES_YES');
    const token = effectiveEnvironment.ADMIN_GATEWAY_ACCESS_TOKEN || await requestAccessToken({
        keycloakUrl: effectiveEnvironment.KEYCLOAK_URL || effectiveEnvironment.KEYCLOAK_EXTERNAL_URL,
        realm: effectiveEnvironment.KEYCLOAK_REALM || 'dkh',
        clientId: effectiveEnvironment.KEYCLOAK_CLIENT_ID || 'dkh-admin-gateway',
        clientSecret: effectiveEnvironment.KEYCLOAK_CLIENT_SECRET ||
            effectiveEnvironment.ADMIN_GATEWAY_KEYCLOAK_SECRET,
    });
    const client = new CatalogSellableExchangeClient({
        baseUrl: effectiveEnvironment.GATEWAY_URL || effectiveEnvironment.ADMIN_GATEWAY_URL ||
            effectiveEnvironment.ADMIN_GATEWAY_ORIGIN,
        workspaceId: effectiveEnvironment.PRODUCT_CATALOG_WORKSPACE_ID ||
            effectiveEnvironment.CATALOG_WORKSPACE_ID ||
            readWorkspaceReference(args['workspace-reference']),
        token,
    });
    const result = await runNoOpCanary(client, {
        catalogCode: args['catalog-code'] || 'CATALOG-CHINESE-TEA-SHOP',
        productCode: args['product-code'] || 'TEA-CN-TIE-GUANYIN',
        expectedRows: Number(args['expected-rows'] || 25),
        apply,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${safeError(error)}\n`);
        process.exitCode = 1;
    });
}

module.exports = { main, parseAllowedDotenv, readWorkspaceReference, safeError };
