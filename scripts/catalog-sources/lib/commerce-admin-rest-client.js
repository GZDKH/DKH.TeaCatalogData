'use strict';

const { METHODS } = require('./commerce-publication');
const {
    MAX_DIAGNOSTIC_LENGTH,
    normalizeBearerToken,
    redactSensitiveText,
} = require('./commerce-grpcurl-client');

const TOKEN_ENVIRONMENT_VARIABLE = 'ADMIN_GATEWAY_ADMIN_TOKEN';
const GUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE_TEMPLATE =
    '/api/v1.0/admin/commerce-network/storefronts/{storefrontId}' +
    '/catalogs/{catalogId}/catalog-source-imports';

function requireGuid(value, label) {
    if (typeof value !== 'string' ||
        !GUID.test(value) ||
        /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(value)) {
        throw new Error(`${label} must be a non-empty UUID.`);
    }
    return value.toLowerCase();
}

function requireString(value, label, maximumLength) {
    if (typeof value !== 'string' ||
        !value ||
        value.length > maximumLength) {
        throw new Error(
            `${label} must be a non-empty string of at most ${maximumLength} characters.`,
        );
    }
    return value;
}

function requireCount(value, label) {
    const count = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error(`${label} must be a safe non-negative integer.`);
    }
    return count;
}

function normalizeBaseUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error('AdminGateway REST base URL must be a valid URL.');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error(
            'AdminGateway REST base URL must not contain credentials, query, or fragment.',
        );
    }
    if (url.pathname !== '/' && url.pathname !== '') {
        throw new Error(
            'AdminGateway REST base URL must be an origin without a path.',
        );
    }
    if (url.protocol === 'http:') {
        const host = url.hostname.toLowerCase();
        if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
            throw new Error(
                'Plain HTTP AdminGateway REST transport is restricted to loopback.',
            );
        }
    } else if (url.protocol !== 'https:') {
        throw new Error('AdminGateway REST base URL must use HTTPS.');
    }
    url.pathname = '';
    return url;
}

function sanitizedEndpoint(url) {
    const defaultPort = url.protocol === 'https:' ? '443' : '80';
    const port = url.port || defaultPort;
    const host = url.hostname.includes(':') ? `[${url.hostname}]` : url.hostname;
    return `${host}:${port}`;
}

function bearerFrom(environment, variableName) {
    return normalizeBearerToken(
        environment[variableName],
        variableName,
    );
}

function beginBody(request) {
    const { command: _command, ...body } = request;
    if (body.expectedItemCount !== undefined) {
        body.expectedItemCount = requireCount(
            body.expectedItemCount,
            'Expected item count',
        );
    }
    return body;
}

function itemBody(request) {
    const item = request?.item;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('Catalog source item body is required.');
    }
    const {
        localizedText,
        localizedTexts,
        ...body
    } = item;
    return {
        ...body,
        localizedTexts: localizedTexts || localizedText || [],
    };
}

function commitBody(request) {
    return {
        semanticDigest: requireString(
            request?.semanticDigest,
            'Semantic digest',
            128,
        ),
    };
}

function jsonBodyFor(method, request) {
    if (method === METHODS.begin) return beginBody(request);
    if (method === METHODS.importItem) return itemBody(request);
    if (method === METHODS.commit) return commitBody(request);
    throw new Error(`Unsupported Commerce publication REST method: ${method}.`);
}

function idempotencyKey(request) {
    return requireString(request?.command?.idempotencyKey, 'Idempotency key', 200);
}

function normalizeSnapshotResponse(response) {
    return {
        ...response,
        importId: { value: requireGuid(response?.importId, 'Import ID') },
        providerConnectionId: response?.providerConnectionId
            ? { value: requireGuid(
                response.providerConnectionId,
                'Provider connection ID',
            ) }
            : undefined,
        providerSyncRunId: response?.providerSyncRunId
            ? { value: requireGuid(response.providerSyncRunId, 'Provider sync run ID') }
            : undefined,
    };
}

function pathFor(method, importId) {
    if (method === METHODS.begin) return '';
    const suffix = method === METHODS.importItem
        ? 'items'
        : method === METHODS.commit
            ? 'commit'
            : null;
    if (!suffix) {
        throw new Error(`Unsupported Commerce publication REST method: ${method}.`);
    }
    return `/${requireGuid(importId, 'Import ID')}/${suffix}`;
}

class CommerceAdminRestClient {
    constructor(options = {}) {
        this.baseUrl = normalizeBaseUrl(options.baseUrl);
        this.storefrontId = requireGuid(options.storefrontId, 'Storefront ID');
        this.catalogId = requireGuid(options.catalogId, 'Catalog ID');
        this.timeoutSeconds = requireCount(
            options.timeoutSeconds ?? 30,
            'AdminGateway REST timeout',
        );
        if (this.timeoutSeconds < 1 || this.timeoutSeconds > 300) {
            throw new Error('AdminGateway REST timeout must be between 1 and 300 seconds.');
        }
        this.environment = options.environment || process.env;
        this.tokenEnvironmentVariable =
            options.tokenEnvironmentVariable || TOKEN_ENVIRONMENT_VARIABLE;
        this.fetch = options.fetchImpl || globalThis.fetch;
        if (typeof this.fetch !== 'function') {
            throw new Error('AdminGateway REST transport requires fetch.');
        }
    }

    getReceiptMetadata() {
        return {
            kind: 'admin-rest',
            sanitizedTargetEndpoint: sanitizedEndpoint(this.baseUrl),
            tlsMode: this.baseUrl.protocol === 'https:'
                ? 'tls-system-ca'
                : 'plaintext-loopback',
            routeTemplate: ROUTE_TEMPLATE,
            apiVersion: '1.0',
        };
    }

    async invoke(method, request) {
        const token = bearerFrom(
            this.environment,
            this.tokenEnvironmentVariable,
        );
        const importId = request?.importId?.value || request?.importId;
        const route =
            `/api/v1.0/admin/commerce-network/storefronts/${this.storefrontId}` +
            `/catalogs/${this.catalogId}/catalog-source-imports` +
            pathFor(method, importId);
        const url = new URL(route, this.baseUrl);
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            this.timeoutSeconds * 1000,
        );
        let text = '';
        try {
            const response = await this.fetch(url, {
                method: 'POST',
                redirect: 'manual',
                signal: controller.signal,
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Idempotency-Key': idempotencyKey(request),
                    'User-Agent': 'DKH.TeaCatalogData catalog-source-ingestion/1',
                },
                body: JSON.stringify(jsonBodyFor(method, request)),
            });
            text = await response.text();
            if (!response.ok) {
                const detail = redactSensitiveText(text, token).trim();
                throw new Error(
                    `AdminGateway REST ${method} failed with HTTP ${response.status}` +
                    `${detail ? `: ${detail}` : '.'}`,
                );
            }
            let parsed;
            try {
                parsed = text ? JSON.parse(text) : {};
            } catch {
                throw new Error(`AdminGateway REST ${method} returned invalid JSON.`);
            }
            return method === METHODS.importItem
                ? parsed
                : normalizeSnapshotResponse(parsed);
        } catch (error) {
            if (error.message.startsWith('AdminGateway REST ')) {
                throw error;
            }
            throw new Error(
                `AdminGateway REST ${method} failed: ` +
                redactSensitiveText(error.message, token).slice(
                    0,
                    MAX_DIAGNOSTIC_LENGTH,
                ),
            );
        } finally {
            clearTimeout(timeout);
        }
    }
}

module.exports = {
    CommerceAdminRestClient,
    ROUTE_TEMPLATE,
    TOKEN_ENVIRONMENT_VARIABLE,
};
