'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');

const ADMIN_TOKEN_ENV = 'ADMIN_GATEWAY_ACCESS_TOKEN';
const PRODUCT_CATALOG_TOKEN_ENV = 'PRODUCT_CATALOG_ADMIN_TOKEN';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_DIAGNOSTIC_LENGTH = 16_384;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(value, code) {
    const result = String(value || '').trim();
    if (!result) throw new Error(code);
    return result;
}

function requireGuid(value, code) {
    const result = required(value, code);
    if (!GUID.test(result)) throw new Error(code);
    return result;
}

function redact(value, tokens = []) {
    let text = String(value || '');
    for (const token of tokens.filter(Boolean)) text = text.split(token).join('[REDACTED]');
    text = text.replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]');
    return text.slice(0, MAX_DIAGNOSTIC_LENGTH);
}

function assertRealDirectory(directory, label) {
    const resolved = path.resolve(required(directory, `${label}_REQUIRED`));
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label}_INVALID`);
    return resolved;
}

function assertRealFile(file, label) {
    const resolved = path.resolve(file);
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label}_INVALID`);
    return resolved;
}

function guid(value) {
    return { value: requireGuid(value, 'GUID_INVALID') };
}

class AdminGatewayClient {
    constructor(options = {}) {
        this.baseUrl = new URL(required(options.baseUrl, 'ADMIN_GATEWAY_URL_REQUIRED'));
        if (!['http:', 'https:'].includes(this.baseUrl.protocol)) {
            throw new Error('ADMIN_GATEWAY_URL_INVALID');
        }
        if (this.baseUrl.protocol === 'http:' &&
            !['localhost', '127.0.0.1', '::1'].includes(this.baseUrl.hostname)) {
            throw new Error('ADMIN_GATEWAY_PLAINTEXT_FORBIDDEN');
        }
        this.workspaceId = requireGuid(options.workspaceId, 'WORKSPACE_ID_REQUIRED');
        this.token = required(options.token, `${ADMIN_TOKEN_ENV}_REQUIRED`);
        this.timeoutMs = options.timeoutMs || 30_000;
    }

    request(method, pathname, body) {
        const url = new URL(pathname, this.baseUrl);
        if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith('/api/v1/')) {
            throw new Error('ADMIN_GATEWAY_PATH_FORBIDDEN');
        }
        const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
        const transport = url.protocol === 'https:' ? https : http;
        return new Promise((resolve, reject) => {
            const request = transport.request(url, {
                method,
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${this.token}`,
                    'X-Workspace-Id': this.workspaceId,
                    ...(payload ? {
                        'Content-Type': 'application/json',
                        'Content-Length': payload.length,
                    } : {}),
                },
            }, response => {
                const chunks = [];
                let total = 0;
                response.on('data', chunk => {
                    total += chunk.length;
                    if (total > MAX_RESPONSE_BYTES) {
                        request.destroy(new Error('ADMIN_GATEWAY_RESPONSE_TOO_LARGE'));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () => {
                    const responseText = Buffer.concat(chunks).toString('utf8');
                    if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
                        reject(new Error(
                            `ADMIN_GATEWAY_HTTP_${response.statusCode}: ` +
                            redact(responseText, [this.token]),
                        ));
                        return;
                    }
                    if (!responseText) {
                        resolve(null);
                        return;
                    }
                    try {
                        resolve(JSON.parse(responseText));
                    } catch {
                        reject(new Error('ADMIN_GATEWAY_INVALID_JSON'));
                    }
                });
            });
            request.on('error', error => reject(new Error(redact(error.message, [this.token]))));
            request.setTimeout(this.timeoutMs, () => request.destroy(new Error('ADMIN_GATEWAY_TIMEOUT')));
            if (payload) request.write(payload);
            request.end();
        });
    }

    get(pathname) { return this.request('GET', pathname); }
    put(pathname, body) { return this.request('PUT', pathname, body); }
    post(pathname, body) { return this.request('POST', pathname, body); }
}

class ProductCatalogGrpcClient {
    constructor(options = {}) {
        this.endpoint = required(options.endpoint, 'PRODUCT_CATALOG_GRPC_ENDPOINT_REQUIRED');
        if (!/^(?:[A-Za-z0-9.-]+|\[[0-9a-f:]+\]):[1-9]\d{0,4}$/i.test(this.endpoint)) {
            throw new Error('PRODUCT_CATALOG_GRPC_ENDPOINT_INVALID');
        }
        this.protoRoot = assertRealDirectory(options.protoRoot, 'PRODUCT_CATALOG_PROTO_ROOT');
        this.platformProtoRoot = assertRealDirectory(options.platformProtoRoot, 'PLATFORM_PROTO_ROOT');
        this.workspaceId = requireGuid(options.workspaceId, 'WORKSPACE_ID_REQUIRED');
        this.token = required(options.token, `${PRODUCT_CATALOG_TOKEN_ENV}_REQUIRED`);
        this.grpcurl = options.grpcurl || 'grpcurl';
        this.plaintext = options.plaintext === true;
        this.timeoutSeconds = options.timeoutSeconds || 30;
        this.spawn = options.spawn || spawnSync;
        if (this.plaintext && !/^(?:localhost|127\.0\.0\.1|\[::1\]):/.test(this.endpoint)) {
            throw new Error('PRODUCT_CATALOG_PLAINTEXT_FORBIDDEN');
        }
    }

    invoke(protoFile, method, request) {
        const proto = assertRealFile(path.join(this.protoRoot, protoFile), 'PRODUCT_CATALOG_PROTO');
        const args = [
            '-max-time', String(this.timeoutSeconds),
            '-expand-headers',
            '-H', `Authorization: Bearer \${${PRODUCT_CATALOG_TOKEN_ENV}}`,
            '-H', `x-workspace-id: ${this.workspaceId}`,
            '-import-path', this.protoRoot,
            '-import-path', this.platformProtoRoot,
            '-proto', proto,
            '-d', '@',
        ];
        if (this.plaintext) args.push('-plaintext');
        args.push(this.endpoint, method);
        const result = this.spawn(this.grpcurl, args, {
            encoding: 'utf8',
            env: { ...process.env, [PRODUCT_CATALOG_TOKEN_ENV]: this.token },
            input: JSON.stringify(request),
            maxBuffer: MAX_RESPONSE_BYTES,
            timeout: (this.timeoutSeconds + 5) * 1000,
        });
        if (result.error || result.status !== 0) {
            throw new Error(
                `PRODUCT_CATALOG_GRPC_FAILED: ${redact(
                    result.stderr || result.stdout || result.error?.message,
                    [this.token],
                )}`,
            );
        }
        if (!String(result.stdout || '').trim()) return {};
        try {
            return JSON.parse(result.stdout);
        } catch {
            throw new Error('PRODUCT_CATALOG_GRPC_INVALID_JSON');
        }
    }
}

const PROTOS = {
    curation: 'product_catalog/api/catalog_sellable_curation/v1/catalog_sellable_curation_service.proto',
    sellable: 'product_catalog/api/sellable_management/v1/sellable_management_service.proto',
    variant: 'product_catalog/api/variant_query/v1/variant_query_service.proto',
};
const SERVICES = {
    curation: 'proto.product_catalog.api.catalog_sellable_curation.v1.CatalogSellableCurationService',
    sellable: 'proto.product_catalog.api.sellable_management.v1.SellableManagementService',
    variant: 'proto.product_catalog.api.variant_query.v1.VariantQueryService',
};

function method(service, name) {
    return `${SERVICES[service]}/${name}`;
}

class TieguanyinProductionClient {
    constructor(rest, grpc) {
        this.rest = rest;
        this.grpc = grpc;
    }

    async fetchState(productCode, catalogCode) {
        const productsResponse = await this.rest.get(
            `/api/v1/products?search=${encodeURIComponent(productCode)}&page=1&pageSize=100`,
        );
        const catalogsResponse = await this.rest.get(
            `/api/v1/catalogs?search=${encodeURIComponent(catalogCode)}&page=1&pageSize=100`,
        );
        const products = productsResponse?.items || [];
        const catalogs = catalogsResponse?.items || [];
        const product = products.find(item => String(item.code).toUpperCase() === productCode);
        const catalog = catalogs.find(item => String(item.code).toUpperCase() === catalogCode);
        if (!product || !catalog) {
            return { products, catalogs, variantAttributes: [], combinations: [], sellables: [], placements: [], placementDetails: [] };
        }
        const productId = product.id;
        const catalogId = catalog.id;
        const [variantResponse, combinationsResponse, sellablesResponse, placementsResponse] = await Promise.all([
            this.rest.get(`/api/v1/product-variant-attributes?productId=${productId}`),
            Promise.resolve(this.grpc.invoke(
                PROTOS.variant,
                method('variant', 'ListProductVariantCombinations'),
                { productId: guid(productId) },
            )),
            Promise.resolve(this.grpc.invoke(
                PROTOS.sellable,
                method('sellable', 'SearchSellableUnits'),
                { productId: guid(productId), page: 1, pageSize: 1000 },
            )),
            Promise.resolve(this.grpc.invoke(
                PROTOS.curation,
                method('curation', 'ListCatalogSellables'),
                { catalogId: guid(catalogId), productId: guid(productId), page: 1, pageSize: 1000 },
            )),
        ]);
        const sellables = sellablesResponse.items || [];
        const placements = placementsResponse.items || [];
        const detailsResponse = placements.length > 0
            ? this.grpc.invoke(
                PROTOS.curation,
                method('curation', 'BatchGetCatalogSellableAdminDetails'),
                {
                    catalogId: guid(catalogId),
                    catalogSellableIds: placements.map(item => item.catalogSellableId),
                },
            )
            : { items: [] };
        return {
            products,
            catalogs,
            variantAttributes: variantResponse?.items || [],
            combinations: combinationsResponse.combinations || [],
            sellables,
            placements,
            placementDetails: detailsResponse.items || [],
        };
    }

    updateGradeValues(attributeId, values) {
        return this.rest.put(
            `/api/v1/product-variant-attribute-values?productVariantAttributeId=${attributeId}`,
            { values },
        );
    }

    generateCombinations(productId, productAttributeId) {
        return this.rest.post(
            `/api/v1/variant-templates/products/${productId}/generate-combinations`,
            { selectedAttributeIds: [productAttributeId], skuPattern: '{ProductCode}-{Opt1}' },
        );
    }

    createSellable(request) {
        return this.grpc.invoke(PROTOS.sellable, method('sellable', 'CreateSellableUnit'), request);
    }

    activateSellable(sellableUnitId, expectedAuthorityVersion) {
        return this.grpc.invoke(PROTOS.sellable, method('sellable', 'ActivateSellableUnit'), {
            sellableUnitId: guid(sellableUnitId),
            expectedAuthorityVersion,
        });
    }

    setPublicationEligibility(sellableUnitId, publicationEligible, expectedAuthorityVersion) {
        return this.grpc.invoke(PROTOS.sellable, method('sellable', 'SetSellableUnitPublicationEligibility'), {
            sellableUnitId: guid(sellableUnitId),
            publicationEligible,
            expectedAuthorityVersion,
        });
    }

    curate(catalogId, items) {
        return this.grpc.invoke(PROTOS.curation, method('curation', 'ApplyCatalogSellableMappingsBatch'), {
            catalogId: guid(catalogId),
            items,
        });
    }

    removePlacement(catalogSellableId, expectedAuthorityVersion) {
        return this.grpc.invoke(PROTOS.curation, method('curation', 'RemoveCatalogSellable'), {
            catalogSellableId: guid(catalogSellableId),
            expectedAuthorityVersion,
        });
    }

}

module.exports = {
    ADMIN_TOKEN_ENV,
    PRODUCT_CATALOG_TOKEN_ENV,
    AdminGatewayClient,
    ProductCatalogGrpcClient,
    TieguanyinProductionClient,
    guid,
    redact,
};
