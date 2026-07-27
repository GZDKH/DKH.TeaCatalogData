'use strict';

const crypto = require('crypto');
const { parseLosslessJson } = require('../lib/lossless-json');
const { reject } = require('../lib/errors');

const MAXIMUM_ENCRYPTED_RESPONSE_BYTES = 8 * 1024 * 1024;
// Public protocol material shipped in the ZZCTea browser bundle. It grants no authorization.
const PUBLIC_PROTOCOL_KEY = Buffer.from('0132030505061708', 'utf8');
const PUBLIC_PROTOCOL_IV = Buffer.from('0112030405160718', 'utf8');
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

function decodeEnvelope(responseBody) {
    if (!Buffer.isBuffer(responseBody)) responseBody = Buffer.from(responseBody);
    if (responseBody.length === 0 || responseBody.length > MAXIMUM_ENCRYPTED_RESPONSE_BYTES) {
        reject('ZZCTEA_ENCRYPTED_RESPONSE_SIZE_INVALID');
    }

    let encryptedHex;
    try {
        encryptedHex = JSON.parse(strictUtf8.decode(responseBody));
    } catch (error) {
        reject('ZZCTEA_ENCRYPTED_RESPONSE_ENVELOPE_INVALID', error);
    }
    if (typeof encryptedHex !== 'string' ||
        encryptedHex.length === 0 ||
        encryptedHex.length % 2 !== 0 ||
        encryptedHex.length > MAXIMUM_ENCRYPTED_RESPONSE_BYTES * 2 ||
        !/^[0-9a-f]+$/i.test(encryptedHex)) {
        reject('ZZCTEA_ENCRYPTED_RESPONSE_HEX_INVALID');
    }

    let plaintext;
    try {
        const decipher = crypto.createDecipheriv('aes-128-cbc', PUBLIC_PROTOCOL_KEY, PUBLIC_PROTOCOL_IV);
        plaintext = Buffer.concat([
            decipher.update(Buffer.from(encryptedHex, 'hex')),
            decipher.final(),
        ]);
    } catch (error) {
        reject('ZZCTEA_ENCRYPTED_RESPONSE_DECRYPT_FAILED', error);
    }

    let text;
    try {
        text = strictUtf8.decode(plaintext);
    } catch (error) {
        reject('ZZCTEA_DECRYPTED_UTF8_INVALID', error);
    }
    const value = parseLosslessJson(text);
    if (!value || Array.isArray(value) || typeof value !== 'object') {
        reject('ZZCTEA_DECRYPTED_JSON_ROOT_INVALID');
    }
    return value;
}

module.exports = {
    MAXIMUM_ENCRYPTED_RESPONSE_BYTES,
    PUBLIC_PROTOCOL_IV,
    PUBLIC_PROTOCOL_KEY,
    decodeEnvelope,
};
