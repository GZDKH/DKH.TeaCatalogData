'use strict';

const { reject } = require('../lib/errors');
const {
    IMAGE_REFERENCE_POLICY_SCHEMA,
    hasForbiddenPublicText,
    isAllowedPublicImageReference,
    isForbiddenPublicKey,
} = require('../lib/public-pii');

const PUBLIC_IMAGE_KEYS = new Set(['img1', 'img2', 'imageUrl1', 'imgUrl']);
const PUBLIC_IMAGE_HOST = 'oss.yf-gz.cn';
const PUBLIC_IMAGE_POLICY_VERSION = 'zzctea-public-image-url-v1';
const PUBLIC_IMAGE_POLICY = Object.freeze({
    schemaVersion: IMAGE_REFERENCE_POLICY_SCHEMA,
    allowedHosts: Object.freeze([PUBLIC_IMAGE_HOST]),
    pathPrefix: '/file/',
    queryRules: Object.freeze({
        'x-oss-process': 'style-name',
    }),
    sourcePolicyVersion: PUBLIC_IMAGE_POLICY_VERSION,
});
function assertPublicText(value) {
    if (hasForbiddenPublicText(value)) {
        reject('ZZCTEA_PUBLIC_PAYLOAD_PII_DETECTED');
    }
}

function validatePublicImageUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        reject('ZZCTEA_PUBLIC_IMAGE_URL_INVALID');
    }
    if (!isAllowedPublicImageReference(value, PUBLIC_IMAGE_POLICY)) {
        reject('ZZCTEA_PUBLIC_IMAGE_URL_INVALID');
    }
    if (hasForbiddenPublicText(value, {
        allowOpaqueImageNumericIdentifier: true,
    })) {
        reject('ZZCTEA_PUBLIC_PAYLOAD_PII_DETECTED');
    }
    return url;
}

function assertPublicCatalogPayload(value) {
    function visit(current) {
        if (typeof current === 'string') assertPublicText(current);
        if (!current || typeof current !== 'object') return;
        for (const [key, child] of Object.entries(current)) {
            if (isForbiddenPublicKey(key)) {
                reject('ZZCTEA_PUBLIC_PAYLOAD_PII_DETECTED');
            }
            if (PUBLIC_IMAGE_KEYS.has(key)) {
                try {
                    validatePublicImageUrl(child);
                    continue;
                } catch (error) {
                    if (error?.code !== 'ZZCTEA_PUBLIC_IMAGE_URL_INVALID') {
                        throw error;
                    }
                }
                visit(child);
                continue;
            }
            visit(child);
        }
    }
    visit(value);
}

module.exports = {
    PUBLIC_IMAGE_POLICY,
    PUBLIC_IMAGE_POLICY_VERSION,
    assertPublicCatalogPayload,
    assertPublicText,
    validatePublicImageUrl,
};
