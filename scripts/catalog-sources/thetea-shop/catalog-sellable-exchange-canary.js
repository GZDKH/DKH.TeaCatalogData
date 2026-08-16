'use strict';

const crypto = require('crypto');
const { HEADERS, PROFILE } = require('./catalog-sellable-exchange');
const { parseCsv } = require('../lib/csv-records');

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_OP_REASON = 'CATALOG_SELLABLE_VARIANT_NO_OP';

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function required(value, code) {
    const result = String(value || '').trim();
    if (!result) fail(code);
    return result;
}

function requireGuid(value, code) {
    const result = required(value, code);
    if (!GUID.test(result)) fail(code);
    return result.toLowerCase();
}

function safeBaseUrl(value, code) {
    const url = new URL(required(value, code));
    if (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname))) {
        fail(`${code}_PLAINTEXT_FORBIDDEN`);
    }
    return url;
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

async function readLimited(response) {
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_RESPONSE_BYTES) fail('CANARY_RESPONSE_TOO_LARGE');
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_RESPONSE_BYTES) fail('CANARY_RESPONSE_TOO_LARGE');
    return body;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch {
        fail('CANARY_HTTP_UNAVAILABLE');
    } finally {
        clearTimeout(timeout);
    }
}

async function requestAccessToken(options) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const keycloakUrl = safeBaseUrl(options.keycloakUrl, 'KEYCLOAK_URL_REQUIRED');
    const realm = required(options.realm || 'dkh', 'KEYCLOAK_REALM_REQUIRED');
    const clientId = required(options.clientId, 'KEYCLOAK_CLIENT_ID_REQUIRED');
    const clientSecret = required(options.clientSecret, 'KEYCLOAK_CLIENT_SECRET_REQUIRED');
    const url = new URL(`/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`, keycloakUrl);
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
    });
    const response = await fetchWithTimeout(fetchImpl, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    }, options.timeoutMs || 15_000);
    const payload = await readLimited(response);
    if (!response.ok) fail(`KEYCLOAK_TOKEN_HTTP_${response.status}`);
    let parsed;
    try {
        parsed = JSON.parse(payload.toString('utf8'));
    } catch {
        fail('KEYCLOAK_TOKEN_INVALID_JSON');
    }
    return required(parsed.access_token, 'KEYCLOAK_ACCESS_TOKEN_MISSING');
}

class CatalogSellableExchangeClient {
    constructor(options) {
        this.baseUrl = safeBaseUrl(options.baseUrl, 'ADMIN_GATEWAY_URL_REQUIRED');
        this.workspaceId = requireGuid(options.workspaceId, 'WORKSPACE_ID_REQUIRED');
        this.token = required(options.token, 'ADMIN_GATEWAY_ACCESS_TOKEN_REQUIRED');
        this.fetchImpl = options.fetchImpl || globalThis.fetch;
        this.timeoutMs = options.timeoutMs || 30_000;
    }

    async request(pathname, init = {}, expected = 'json') {
        const url = new URL(pathname, this.baseUrl);
        if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith('/api/v1/')) {
            fail('ADMIN_GATEWAY_PATH_FORBIDDEN');
        }
        const response = await fetchWithTimeout(this.fetchImpl, url, {
            ...init,
            headers: {
                Accept: expected === 'json' ? 'application/json' : '*/*',
                Authorization: `Bearer ${this.token}`,
                'X-Workspace-Id': this.workspaceId,
                ...(init.headers || {}),
            },
        }, this.timeoutMs);
        const body = await readLimited(response);
        if (!response.ok) fail(`ADMIN_GATEWAY_HTTP_${response.status}`);
        if (expected === 'buffer') return body;
        try {
            return body.length === 0 ? null : JSON.parse(body.toString('utf8'));
        } catch {
            fail('ADMIN_GATEWAY_INVALID_JSON');
        }
    }

    async resolveCatalogId(catalogCode) {
        const code = required(catalogCode, 'CATALOG_CODE_REQUIRED').toUpperCase();
        const result = await this.request(
            `/api/v1/catalogs?search=${encodeURIComponent(code)}&page=1&pageSize=100`,
        );
        const matches = (result?.items || []).filter(item =>
            String(item?.code || '').trim().toUpperCase() === code && GUID.test(String(item?.id || '')),
        );
        if (matches.length !== 1) fail('CANARY_CATALOG_NOT_UNIQUE');
        return matches[0].id;
    }

    getTemplate(format = 'csv') {
        return this.request(
            `/api/v1/data-exchange/template?profile=${PROFILE}&format=${format}&includeExample=false`,
            {},
            'buffer',
        );
    }

    exportCurrent(catalogId, productCode) {
        return this.request('/api/v1/data-exchange/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                profile: PROFILE,
                format: 'csv',
                search: required(productCode, 'PRODUCT_CODE_REQUIRED').toUpperCase(),
                catalogIds: [requireGuid(catalogId, 'CATALOG_ID_REQUIRED')],
            }),
        }, 'buffer');
    }

    upload(pathname, contents) {
        const form = new FormData();
        form.append('profile', PROFILE);
        form.append('format', 'csv');
        form.append('file', new Blob([contents], { type: 'text/csv' }), 'catalog-sellable-variants.csv');
        return this.request(pathname, { method: 'POST', body: form });
    }

    validate(contents) { return this.upload('/api/v1/data-exchange/validate', contents); }
    import(contents) { return this.upload('/api/v1/data-exchange/import', contents); }
}

function inspectCsv(contents, options) {
    const records = parseCsv(contents);
    if (records.length < 2) fail('CANARY_EXPORT_EMPTY');
    if (JSON.stringify(records[0]) !== JSON.stringify(HEADERS)) fail('CANARY_EXPORT_HEADERS_INVALID');
    const rows = records.slice(1);
    if (rows.length !== options.expectedRows) fail('CANARY_EXPORT_ROW_COUNT_CHANGED');
    const catalogIndex = HEADERS.indexOf('CatalogCode');
    const productIndex = HEADERS.indexOf('ProductCode');
    const rowKeyIndex = HEADERS.indexOf('RowKey');
    if (!rows.every(row => row.length === HEADERS.length)) fail('CANARY_EXPORT_ROW_SHAPE_INVALID');
    if (!rows.every(row => row[catalogIndex].toUpperCase() === options.catalogCode.toUpperCase())) {
        fail('CANARY_EXPORT_CATALOG_SCOPE_VIOLATION');
    }
    if (!rows.every(row => row[productIndex].toUpperCase() === options.productCode.toUpperCase())) {
        fail('CANARY_EXPORT_PRODUCT_SCOPE_VIOLATION');
    }
    if (new Set(rows.map(row => row[rowKeyIndex])).size !== rows.length) {
        fail('CANARY_EXPORT_ROW_KEY_COLLISION');
    }
    return {
        rows: rows.length,
        rawSha256: sha256(contents),
        canonicalSha256: sha256(Buffer.from(JSON.stringify(records), 'utf8')),
    };
}

function inspectNoOpValidation(result, expectedRows) {
    const errors = Array.isArray(result?.errors) ? result.errors : [];
    const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
    if (result?.valid !== true || result?.totalRecords !== expectedRows ||
        result?.validRecords !== expectedRows || errors.length !== 0 || warnings.length !== expectedRows) {
        fail('CANARY_VALIDATION_NOT_EXACT_NO_OP');
    }
    if (!warnings.every(warning =>
        warning?.field === 'disposition' && warning?.message === NO_OP_REASON)) {
        fail('CANARY_VALIDATION_NOT_EXACT_NO_OP');
    }
    return { valid: true, totalRecords: expectedRows, noOp: warnings.length };
}

function inspectImport(result, expectedRows) {
    if (result?.processed !== expectedRows || result?.failed !== 0 ||
        !Array.isArray(result?.errors) || result.errors.length !== 0) {
        fail('CANARY_IMPORT_RESULT_INVALID');
    }
    return { processed: result.processed, failed: result.failed };
}

async function runNoOpCanary(client, options) {
    const catalogCode = required(options.catalogCode, 'CATALOG_CODE_REQUIRED').toUpperCase();
    const productCode = required(options.productCode, 'PRODUCT_CODE_REQUIRED').toUpperCase();
    const expectedRows = Number(options.expectedRows);
    if (!Number.isSafeInteger(expectedRows) || expectedRows < 1 || expectedRows > 2_000) {
        fail('CANARY_EXPECTED_ROWS_INVALID');
    }
    const catalogId = await client.resolveCatalogId(catalogCode);
    const template = await client.getTemplate('csv');
    const templateRecords = parseCsv(template);
    if (templateRecords.length !== 1 || JSON.stringify(templateRecords[0]) !== JSON.stringify(HEADERS)) {
        fail('CANARY_TEMPLATE_INVALID');
    }
    const before = await client.exportCurrent(catalogId, productCode);
    const beforeEvidence = inspectCsv(before, { catalogCode, productCode, expectedRows });
    const validation = inspectNoOpValidation(await client.validate(before), expectedRows);
    const evidence = {
        profile: PROFILE,
        catalogCode,
        productCode,
        template: { bytes: template.length, sha256: sha256(template), columns: HEADERS.length },
        before: beforeEvidence,
        validation,
        apply: { attempted: false },
    };
    if (options.apply !== true) return evidence;

    let importStarted = false;
    let rollbackResult = null;
    try {
        importStarted = true;
        const replay = inspectImport(await client.import(before), expectedRows);
        const readBack = await client.exportCurrent(catalogId, productCode);
        const readBackEvidence = inspectCsv(readBack, { catalogCode, productCode, expectedRows });
        rollbackResult = inspectImport(await client.import(before), expectedRows);
        const final = await client.exportCurrent(catalogId, productCode);
        const finalEvidence = inspectCsv(final, { catalogCode, productCode, expectedRows });
        if (readBackEvidence.canonicalSha256 !== beforeEvidence.canonicalSha256 ||
            finalEvidence.canonicalSha256 !== beforeEvidence.canonicalSha256) {
            fail('CANARY_READ_BACK_DRIFT');
        }
        evidence.apply = {
            attempted: true,
            replay,
            readBack: readBackEvidence,
            compensatingReplay: rollbackResult,
            final: finalEvidence,
            restored: true,
        };
        return evidence;
    } catch (error) {
        if (importStarted && rollbackResult === null) {
            try {
                inspectImport(await client.import(before), expectedRows);
                const final = await client.exportCurrent(catalogId, productCode);
                const finalEvidence = inspectCsv(final, { catalogCode, productCode, expectedRows });
                if (finalEvidence.canonicalSha256 !== beforeEvidence.canonicalSha256) {
                    fail('CANARY_ROLLBACK_HASH_MISMATCH');
                }
            } catch {
                fail('CANARY_ROLLBACK_FAILED');
            }
        }
        throw error;
    }
}

module.exports = {
    CatalogSellableExchangeClient,
    NO_OP_REASON,
    inspectCsv,
    inspectNoOpValidation,
    requestAccessToken,
    runNoOpCanary,
};
