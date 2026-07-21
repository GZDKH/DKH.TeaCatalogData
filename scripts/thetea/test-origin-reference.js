const assert = require('assert');
const { extractCityCandidate, resolveOriginLocation } = require('./lib/origin-reference');

const card = {
    slug: 'xihu-longjing',
    meta: { origin_country: 'CN', province: 'Zhejiang', city: null },
    sections: {
        classification_origin: {
            origin: {
                value: 'China, Zhèjiāng Province (浙江), Hángzhōu City (杭州), vicinity of West Lake.',
            },
        },
    },
};

assert.strictEqual(extractCityCandidate(card), 'Hangzhou');
assert.deepStrictEqual(resolveOriginLocation(card), {
    country: 'CN',
    state: 'ZJ',
    city: 'Hangzhou',
});
assert.deepStrictEqual(resolveOriginLocation(card, {
    countryCode: 'CN',
    states: [{
        code: 'ZJ',
        name: 'Zhejiang',
        cities: [{ code: 'HZ', name: 'Hangzhou' }],
    }],
}), {
    country: 'CN',
    state: 'ZJ',
    city: 'Hangzhou',
});

const warnings = [];
assert.deepStrictEqual(resolveOriginLocation(card, {
    countryCode: 'CN',
    states: [{ code: 'ZJ', name: 'Zhejiang', cities: [] }],
}, warnings), {
    country: 'CN',
    state: 'ZJ',
    city: undefined,
});
assert.throws(
    () => resolveOriginLocation(card, { countryCode: 'CN', states: [] }),
    /absent from the production geography reference/);

const proseAfterProvince = {
    slug: 'baihao-yinzhen-xin-cha',
    meta: { origin_country: 'CN', province: 'Fujian', city: null },
    sections: {
        classification_origin: {
            origin: {
                value: 'China, primarily Fujian Province (福建, Fujian). Classic centers are Fuding and Zhenghe; stylizations exist in other regions.',
            },
        },
    },
};
assert.strictEqual(extractCityCandidate(proseAfterProvince), undefined);
assert.deepStrictEqual(resolveOriginLocation(proseAfterProvince), {
    country: 'CN',
    state: 'FJ',
    city: undefined,
});

const longExplicitCityWarnings = [];
assert.deepStrictEqual(resolveOriginLocation({
    slug: 'invalid-long-city',
    meta: { origin_country: 'CN', province: 'Fujian', city: 'A deliberately invalid city candidate that is longer than fifty characters' },
}, undefined, longExplicitCityWarnings), {
    country: 'CN',
    state: 'FJ',
    city: undefined,
});
assert.match(longExplicitCityWarnings[0], /50-character import limit/);

console.log('test-origin-reference: OK');
