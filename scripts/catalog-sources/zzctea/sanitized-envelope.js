'use strict';

const { parseLosslessJson } = require('../lib/lossless-json');
const { reject } = require('../lib/errors');
const { assertPublicCatalogPayload } = require('./policy');

const MAXIMUM_SANITIZED_ENVELOPE_BYTES = 8 * 1024 * 1024;
const SANITIZED_ENVELOPE_SCHEMA = 'zzctea-sanitized-html-v1';
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

function decodeSanitizedEnvelope(responseBody) {
    if (!Buffer.isBuffer(responseBody)) responseBody = Buffer.from(responseBody);
    if (responseBody.length === 0 ||
        responseBody.length > MAXIMUM_SANITIZED_ENVELOPE_BYTES) {
        reject('ZZCTEA_SANITIZED_ENVELOPE_SIZE_INVALID');
    }

    let text;
    try {
        text = strictUtf8.decode(responseBody);
    } catch (error) {
        reject('ZZCTEA_SANITIZED_ENVELOPE_UTF8_INVALID', error);
    }
    const value = parseLosslessJson(text);
    if (!value || Array.isArray(value) || typeof value !== 'object' ||
        value.schemaVersion !== SANITIZED_ENVELOPE_SCHEMA ||
        !['list', 'detail', 'terminal-probe'].includes(value.kind)) {
        reject('ZZCTEA_SANITIZED_ENVELOPE_INVALID');
    }
    assertPublicCatalogPayload(value);
    return value;
}

module.exports = {
    MAXIMUM_SANITIZED_ENVELOPE_BYTES,
    SANITIZED_ENVELOPE_SCHEMA,
    decodeSanitizedEnvelope,
};
