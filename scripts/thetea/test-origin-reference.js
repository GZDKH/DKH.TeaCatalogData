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

console.log('test-origin-reference: OK');
