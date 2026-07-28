'use strict';

const { reject } = require('../lib/errors');

const FORBIDDEN_KEYS =
    /(?:phone|mobile|customer|avatar|contact|wechat|weixin)|^(?:sell|buy)(?!Count$)|^(?:seller|buyer)|(?:UserId|CustomerId)$/i;
const FORBIDDEN_VALUES = Object.freeze([
    /(?<!\d)1[3-9]\d{9}(?!\d)/u,
    /(?<!\d)1[3-9]\d[-\s]\d{4}[-\s]\d{4}(?!\d)/u,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/iu,
    /(?<!\d)(?:(?:\+?86[-\s]?)?\(?0\d{2,3}\)?[-\s]?\d{7,8}|\+?86[-\s]?\(?\d{2,3}\)?[-\s]?\d{7,8})(?!\d)/u,
    /(?<!\d)(?:400|800)[-\s]?\d{3}[-\s]?\d{4}(?!\d)/u,
    /(?:电话|联系电话|手机|\b(?:tel(?:ephone)?|phone)\b)\s*[:：]?\s*[+\d][\d ()-]{5,}\d/iu,
    /(?:微信(?:号)?|\b(?:wechat|weixin|wx)\b)(?:\s*[:：]\s*|\s+)[A-Za-z][A-Za-z0-9_-]{5,31}/iu,
    /\bwxid_[A-Za-z0-9_-]{4,28}\b/iu,
    /\b(?:qq|telegram|whatsapp)\b(?:\s*[:：]\s*|\s+)[A-Za-z0-9][A-Za-z0-9_.+-]{4,31}/iu,
    /\bline\b\s*[:：]\s*[A-Za-z0-9][A-Za-z0-9_.+-]{4,31}/iu,
    /(?:\bcontact\b|联系(?:方式)?)\s*[:：]\s*[A-Za-z0-9][A-Za-z0-9_.+-]{4,31}/iu,
]);

function assertPublicText(value) {
    if (FORBIDDEN_VALUES.some(pattern => pattern.test(value))) {
        reject('ZZCTEA_PUBLIC_PAYLOAD_PII_DETECTED');
    }
}

function assertPublicCatalogPayload(value) {
    function visit(current) {
        if (typeof current === 'string') assertPublicText(current);
        if (!current || typeof current !== 'object') return;
        for (const [key, child] of Object.entries(current)) {
            if (FORBIDDEN_KEYS.test(key)) {
                reject('ZZCTEA_PUBLIC_PAYLOAD_PII_DETECTED');
            }
            visit(child);
        }
    }
    visit(value);
}

module.exports = {
    assertPublicCatalogPayload,
    assertPublicText,
};
