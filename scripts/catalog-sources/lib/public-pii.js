'use strict';

const FORBIDDEN_PUBLIC_KEY =
    /(?:phone|mobile|customer|avatar|contact|wechat|weixin)|^(?:sell|buy)(?!Count$)|^(?:seller|buyer)|(?:UserId|CustomerId)$/i;
const OPAQUE_NUMERIC_PATTERNS = Object.freeze([
    /(?<!\d)1[3-9]\d{9}(?!\d)/u,
    /(?<!\d)1[3-9]\d[-\s]\d{4}[-\s]\d{4}(?!\d)/u,
    /(?<!\d)(?:(?:\+?86[-\s]?)?\(?0\d{2,3}\)?[-\s]?\d{7,8}|\+?86[-\s]?\(?\d{2,3}\)?[-\s]?\d{7,8})(?!\d)/u,
    /(?<!\d)(?:400|800)[-\s]?\d{3}[-\s]?\d{4}(?!\d)/u,
]);
const FORBIDDEN_PUBLIC_TEXT_PATTERNS = Object.freeze([
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/iu,
    /(?:电话|联系电话|手机|\b(?:tel(?:ephone)?|phone)\b)\s*[:：]?\s*[+\d][\d ()-]{5,}\d/iu,
    /(?:微信(?:号)?|\b(?:wechat|weixin|wx)\b)(?:\s*[:：]\s*|\s+)[A-Za-z][A-Za-z0-9_-]{5,31}/iu,
    /\bwxid_[A-Za-z0-9_-]{4,28}\b/iu,
    /\b(?:qq|telegram|whatsapp)\b(?:\s*[:：]\s*|\s+)[A-Za-z0-9][A-Za-z0-9_.+-]{4,31}/iu,
    /\bline\b\s*[:：]\s*[A-Za-z0-9][A-Za-z0-9_.+-]{4,31}/iu,
    /(?:\bcontact\b|联系(?:方式)?)\s*[:：]\s*[A-Za-z0-9][A-Za-z0-9_.+-]{4,31}/iu,
    /(?:^|[/_.-])(?:tel(?:ephone)?|phone|mobile|contact)[/_.-]*[+\d][\d()-]{5,}\d(?=[/_.-]|$)/iu,
    /(?:^|[/_.-])(?:wechat|weixin|wx)[/_.-]*[A-Za-z][A-Za-z0-9_+-]{4,31}(?=[/.]|$)/iu,
    /(?:^|[/_.-])(?:qq|telegram|whatsapp)[/_.-]*[A-Za-z0-9][A-Za-z0-9_+-]{4,31}(?=[/.]|$)/iu,
    /(?:^|[/_.-])(?:line|contact)[/_.-]*(?=[A-Za-z0-9_+-]{5,32}(?=[/.]|$))(?=[A-Za-z0-9_+-]*\d)[A-Za-z0-9][A-Za-z0-9_+-]{4,31}(?=[/.]|$)/iu,
]);
const IMAGE_REFERENCE_POLICY_SCHEMA =
    'catalog-source-image-reference-policy-v1';
const CANONICAL_REFERENCE_POLICY_SCHEMA =
    'catalog-source-canonical-reference-policy-v1';
const IMAGE_PATH =
    /^\/[A-Za-z0-9][A-Za-z0-9._/-]{0,511}\.(?:gif|jpe?g|png|webp)$/iu;
const IMAGE_STYLE_NAME = /^style\/[A-Za-z0-9_-]{1,64}$/u;
const SINGLE_SEGMENT_HTML_PATH =
    /^[A-Za-z0-9][A-Za-z0-9-]*\.html$/u;

function isForbiddenPublicKey(value) {
    return FORBIDDEN_PUBLIC_KEY.test(value);
}

function hasForbiddenPublicText(
    value,
    { allowOpaqueNumericIdentifier = false } = {},
) {
    return FORBIDDEN_PUBLIC_TEXT_PATTERNS.some(pattern => pattern.test(value)) ||
        (!allowOpaqueNumericIdentifier &&
            OPAQUE_NUMERIC_PATTERNS.some(pattern => pattern.test(value)));
}

function isAllowedPublicImageReference(value, policy) {
    if (typeof value !== 'string' ||
        value.length > 2_048 ||
        !policy ||
        Array.isArray(policy) ||
        typeof policy !== 'object' ||
        policy.schemaVersion !== IMAGE_REFERENCE_POLICY_SCHEMA ||
        !Array.isArray(policy.allowedHosts) ||
        policy.allowedHosts.length === 0 ||
        policy.allowedHosts.length > 16 ||
        typeof policy.pathPrefix !== 'string' ||
        !/^\/[A-Za-z0-9._/-]*\/$/u.test(policy.pathPrefix) ||
        !policy.queryRules ||
        Array.isArray(policy.queryRules) ||
        typeof policy.queryRules !== 'object') {
        return false;
    }
    const allowedHosts = new Set();
    for (const host of policy.allowedHosts) {
        if (typeof host !== 'string' ||
            !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(host)) {
            return false;
        }
        allowedHosts.add(host);
    }
    const queryRules = new Map();
    for (const [key, rule] of Object.entries(policy.queryRules)) {
        if (!/^[A-Za-z0-9_-]{1,64}$/u.test(key) ||
            rule !== 'style-name') {
            return false;
        }
        queryRules.set(key, rule);
    }

    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        url.hash ||
        !allowedHosts.has(url.hostname.toLowerCase()) ||
        !url.pathname.startsWith(policy.pathPrefix) ||
        !IMAGE_PATH.test(url.pathname) ||
        hasForbiddenPublicText(url.hostname) ||
        hasForbiddenPublicText(url.pathname, {
            allowOpaqueNumericIdentifier: true,
        })) {
        return false;
    }
    const seenKeys = new Set();
    for (const [key, queryValue] of url.searchParams.entries()) {
        const rule = queryRules.get(key);
        if (!rule ||
            seenKeys.has(key) ||
            hasForbiddenPublicText(key) ||
            hasForbiddenPublicText(queryValue)) {
            return false;
        }
        seenKeys.add(key);
        if (rule === 'style-name' && !IMAGE_STYLE_NAME.test(queryValue)) {
            return false;
        }
    }
    return true;
}

function isAllowedPublicCanonicalReference(value, policy) {
    if (typeof value !== 'string' ||
        value.length > 2_048 ||
        !policy ||
        Array.isArray(policy) ||
        typeof policy !== 'object' ||
        policy.schemaVersion !== CANONICAL_REFERENCE_POLICY_SCHEMA ||
        policy.pathRule !== 'single-segment-html' ||
        typeof policy.pathPrefix !== 'string' ||
        !/^\/[A-Za-z0-9._/-]*\/$/u.test(policy.pathPrefix) ||
        !Array.isArray(policy.allowedHosts) ||
        policy.allowedHosts.length === 0 ||
        policy.allowedHosts.length > 16) {
        return false;
    }
    const allowedHosts = new Set();
    for (const host of policy.allowedHosts) {
        if (typeof host !== 'string' ||
            !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(host)) {
            return false;
        }
        allowedHosts.add(host);
    }
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    return url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.href === `${url.origin}${url.pathname}` &&
        allowedHosts.has(url.hostname.toLowerCase()) &&
        url.pathname.startsWith(policy.pathPrefix) &&
        SINGLE_SEGMENT_HTML_PATH.test(
            url.pathname.slice(policy.pathPrefix.length),
        ) &&
        !hasForbiddenPublicText(url.hostname) &&
        !hasForbiddenPublicText(url.pathname, {
            allowOpaqueNumericIdentifier: true,
        });
}

module.exports = {
    CANONICAL_REFERENCE_POLICY_SCHEMA,
    IMAGE_REFERENCE_POLICY_SCHEMA,
    hasForbiddenPublicText,
    isAllowedPublicCanonicalReference,
    isAllowedPublicImageReference,
    isForbiddenPublicKey,
};
