'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { sha256, stableJson } = require('./artifacts');
const { buildProtoClosure } = require('./proto-closure');

const TOKEN_ENVIRONMENT_VARIABLE = 'COMMERCE_NETWORK_ADMIN_TOKEN';
const PROTO_FILE =
    'commerce_network/api/catalog_source_ingestion/v1/' +
    'catalog_source_ingestion_admin_service.proto';
const MAX_TOKEN_LENGTH = 65_536;
const MIN_TOKEN_LENGTH = 16;
const MAX_DIAGNOSTIC_LENGTH = 16_384;
const BEARER_TOKEN = /^[A-Za-z0-9\-._~+/]+={0,2}$/;
const TOKEN_LIKE = /[A-Za-z0-9\-._~+/=]{8,}/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/=]{4,}/gi;

function requireFile(value, label) {
    const resolved = path.resolve(value);
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`${label} must be a real file.`);
    }
    return resolved;
}

function requireDirectory(value, label) {
    const resolved = path.resolve(value);
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${label} must be a real directory.`);
    }
    return resolved;
}

function normalizeBearerToken(value) {
    if (typeof value !== 'string') {
        throw new Error(`${TOKEN_ENVIRONMENT_VARIABLE} is required for --apply.`);
    }
    const token = value.trim();
    if (token.length < MIN_TOKEN_LENGTH ||
        token.length > MAX_TOKEN_LENGTH ||
        !BEARER_TOKEN.test(token)) {
        throw new Error(
            `${TOKEN_ENVIRONMENT_VARIABLE} must be valid bearer token material between ` +
            `${MIN_TOKEN_LENGTH} and ${MAX_TOKEN_LENGTH} characters.`,
        );
    }
    return token;
}

function redactSensitiveText(value, token) {
    let text = String(value || '');
    if (token) {
        text = text.split(token).join('[REDACTED_TOKEN]');
    }
    text = text.replace(BEARER_PATTERN, 'Bearer [REDACTED_TOKEN]');
    if (token) {
        text = text.replace(TOKEN_LIKE, candidate =>
            candidate !== '[REDACTED_TOKEN]' &&
            token.includes(candidate)
                ? '[REDACTED_TOKEN_FRAGMENT]'
                : candidate);
    }
    if (text.length > MAX_DIAGNOSTIC_LENGTH) {
        return `${text.slice(0, MAX_DIAGNOSTIC_LENGTH)}…[TRUNCATED]`;
    }
    return text;
}

class CommerceGrpcurlClient {
    constructor(options = {}) {
        const endpointMatch = typeof options.endpoint === 'string'
            ? /^(?<host>[A-Za-z0-9.-]+|\[[0-9a-f:]+\]):[1-9]\d{0,4}$/i.exec(
                options.endpoint,
            )
            : null;
        if (!endpointMatch) {
            throw new Error(
                'Commerce gRPC endpoint must use host:port without a URL scheme.',
            );
        }
        if (!Number.isSafeInteger(options.timeoutSeconds) ||
            options.timeoutSeconds < 1 ||
            options.timeoutSeconds > 300) {
            throw new Error('Commerce gRPC timeout must be between 1 and 300 seconds.');
        }
        if (options.plaintext === true && options.caCertificate) {
            throw new Error('A CA certificate cannot be combined with plaintext transport.');
        }
        const endpointHost = endpointMatch.groups.host.toLowerCase();
        if (options.plaintext === true &&
            !['localhost', '127.0.0.1', '[::1]'].includes(endpointHost)) {
            throw new Error(
                'Plaintext Commerce gRPC transport is restricted to a loopback endpoint.',
            );
        }
        this.endpoint = options.endpoint;
        this.timeoutSeconds = options.timeoutSeconds;
        this.plaintext = options.plaintext === true;
        this.caCertificate = options.caCertificate
            ? requireFile(options.caCertificate, 'Commerce gRPC CA certificate')
            : null;
        this.grpcurl = options.grpcurl || 'grpcurl';
        this.commerceProtoRoot = requireDirectory(
            options.commerceProtoRoot,
            'CommerceNetwork proto root',
        );
        this.platformProtoRoot = requireDirectory(
            options.platformProtoRoot,
            'DKH.Platform gRPC proto root',
        );
        this.protoClosure = buildProtoClosure(
            PROTO_FILE,
            [this.commerceProtoRoot, this.platformProtoRoot],
        );
        this.protoFile = requireFile(
            path.join(this.commerceProtoRoot, PROTO_FILE),
            'Catalog-source ingestion proto',
        );
        this.spawn = options.spawn || spawnSync;
        this.environment = options.environment || process.env;
    }

    getReceiptMetadata() {
        return {
            sanitizedTargetEndpoint: this.endpoint,
            tlsMode: this.plaintext
                ? 'plaintext-loopback'
                : this.caCertificate
                    ? 'tls-custom-ca'
                    : 'tls-system-ca',
            protoFile: PROTO_FILE,
            protoSha256: this.protoClosure.rootProtoSha256,
            contractClosureSha256: this.protoClosure.closureSha256,
            contractFileCount: this.protoClosure.fileCount,
            contractFileListSha256: this.protoClosure.fileListSha256,
            contractBuiltInImportCount:
                this.protoClosure.builtInImports.length,
            contractBuiltInImportListSha256: sha256(stableJson(
                this.protoClosure.builtInImports,
            )),
        };
    }

    verifyContractClosure() {
        const current = buildProtoClosure(
            PROTO_FILE,
            [this.commerceProtoRoot, this.platformProtoRoot],
        );
        if (current.closureSha256 !== this.protoClosure.closureSha256) {
            throw new Error(
                'Catalog-source gRPC proto closure changed after apply preflight.',
            );
        }
    }

    invoke(method, request) {
        this.verifyContractClosure();
        const token = normalizeBearerToken(
            this.environment[TOKEN_ENVIRONMENT_VARIABLE],
        );
        const args = [
            '-max-time',
            String(this.timeoutSeconds),
            '-expand-headers',
            '-H',
            `Authorization: Bearer \${${TOKEN_ENVIRONMENT_VARIABLE}}`,
            '-import-path',
            this.commerceProtoRoot,
            '-import-path',
            this.platformProtoRoot,
            '-proto',
            PROTO_FILE,
            '-d',
            '@',
        ];
        if (this.plaintext) {
            args.push('-plaintext');
        } else if (this.caCertificate) {
            args.push('-cacert', this.caCertificate);
        }
        args.push(this.endpoint, method);
        const result = this.spawn(this.grpcurl, args, {
            encoding: 'utf8',
            env: {
                ...this.environment,
                [TOKEN_ENVIRONMENT_VARIABLE]: token,
            },
            input: JSON.stringify(request),
            maxBuffer: 4 * 1024 * 1024,
            timeout: (this.timeoutSeconds + 5) * 1000,
        });
        if (result.error || result.status !== 0) {
            const detail = redactSensitiveText(
                result.stderr || result.stdout || result.error?.message,
                token,
            ).trim();
            throw new Error(
                `Commerce gRPC ${method} failed${detail ? `: ${detail}` : '.'}`,
            );
        }
        try {
            return JSON.parse(result.stdout);
        } catch {
            throw new Error(
                `Commerce gRPC ${method} returned invalid JSON.`,
            );
        }
    }
}

module.exports = {
    CommerceGrpcurlClient,
    MAX_DIAGNOSTIC_LENGTH,
    MAX_TOKEN_LENGTH,
    MIN_TOKEN_LENGTH,
    PROTO_FILE,
    TOKEN_ENVIRONMENT_VARIABLE,
    normalizeBearerToken,
    redactSensitiveText,
};
