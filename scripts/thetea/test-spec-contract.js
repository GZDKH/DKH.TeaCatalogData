#!/usr/bin/env node
const assert = require('assert');
const {
    encodeListValue,
    normalizeBoolean,
    normalizeDurationSeconds,
    normalizeScalarList,
    normalizeSpecifications,
    uniqueRepeatedObjects,
} = require('./lib/spec-contract');

assert.deepStrictEqual(
    normalizeScalarList([' spring ', 0, false, 'spring', '', null, undefined]),
    ['spring', '0', 'false']);
assert.strictEqual(encodeListValue(['spring', 'summer']), '["spring","summer"]');
assert.throws(() => normalizeScalarList([{ value: 'opaque' }]), /non-scalar object/);

assert.strictEqual(normalizeBoolean(0), false);
assert.strictEqual(normalizeBoolean('true'), true);
assert.throws(() => normalizeBoolean('maybe'), /Invalid Boolean/);
assert.strictEqual(normalizeDurationSeconds(0), 0);
assert.strictEqual(normalizeDurationSeconds('180'), 180);
assert.throws(() => normalizeDurationSeconds(-1), /Invalid Duration/);

const duplicate = {
    group: 'SPEC-TT-GROUP-ENRICHMENT',
    attribute: 'SPEC-TT-ENRICHMENT-OCCASION',
    attributeName: 'Occasion',
    type: 'List',
    value: '["morning","focus"]',
    order: 2,
};
assert.deepStrictEqual(
    normalizeSpecifications([{ ...duplicate, order: 3 }, duplicate], 'TEA-CN-TEST'),
    [duplicate]);
assert.throws(
    () => normalizeSpecifications([
        duplicate,
        { ...duplicate, value: '["afternoon"]' },
    ], 'TEA-CN-TEST'),
    /conflicting values/);
assert.throws(
    () => normalizeSpecifications([
        duplicate,
        { ...duplicate, type: 'CustomText' },
    ], 'TEA-CN-TEST'),
    /conflicting values|definition metadata/);
assert.throws(
    () => normalizeSpecifications([
        { ...duplicate, groupKey: 'enrichment', attributeKey: 'enrichment.occasion' },
        { ...duplicate, groupKey: 'different', attributeKey: 'enrichment.occasion' },
    ], 'TEA-CN-TEST'),
    /conflicting definition metadata/);

assert.deepStrictEqual(
    uniqueRepeatedObjects([
        { style: 'gongfu', water_temp: 80 },
        { style: 'gongfu', water_temp: 80 },
    ], item => item.style, 'recipe').map(x => x.key),
    ['gongfu']);
assert.throws(
    () => uniqueRepeatedObjects([
        { style: 'gongfu', water_temp: 80 },
        { style: 'gongfu', water_temp: 90 },
    ], item => item.style, 'recipe'),
    /conflicting entries/);
assert.throws(
    () => uniqueRepeatedObjects([{ water_temp: 80 }], item => item.style, 'recipe'),
    /missing its stable discriminator/);

console.log('test-spec-contract: OK');
