#!/usr/bin/env node
const assert = require('assert');
const { sha256Buffer, validateCardIdentity } = require('./validate-d1-snapshot');

assert.strictEqual(
    sha256Buffer(Buffer.from('tea')),
    'a9f74d1ec36ebdeb2da3f6e5868090cd2a2d20b3dcca7b62f60304b1d3d9ef42');

assert.doesNotThrow(() => validateCardIdentity({
    slug: 'xihu-longjing',
    lang: 'zh-cn',
    kind: 'tea',
    name: '西湖龙井',
    meta: { slug: 'xihu-longjing' },
    names: { en: 'Xi Hu Longjing', 'zh-CN': '西湖龙井' },
}, 'xihu-longjing', 'zh-CN'));
assert.throws(() => validateCardIdentity({
    slug: 'other',
    lang: 'en',
    kind: 'tea',
    name: 'Other',
    meta: { slug: 'other' },
    names: { en: 'Other' },
}, 'xihu-longjing', 'en'), /card slug mismatch/);

console.log('test-validate-d1-snapshot: OK');
