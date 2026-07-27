#!/usr/bin/env node
const assert = require('assert');
const {
    auditProductNaming,
    decomposeTeaName,
} = require('./lib/product-naming');

assert.deepStrictEqual(
    decomposeTeaName('Xī Hú Lóngjǐng (西湖龙井, Xīhú lóngjǐng)'),
    {
        displayName: 'Xī Hú Lóngjǐng',
        nativeName: '西湖龙井',
        transcription: 'Xīhú lóngjǐng',
        editorialTitle: undefined,
    });

assert.deepStrictEqual(
    decomposeTeaName('Ancha (安茶, ānchá): One Character, Different Teas — A Guide to 同名异物'),
    {
        displayName: 'Ancha',
        nativeName: '安茶',
        transcription: 'ānchá',
        editorialTitle: 'Ancha (安茶, ānchá): One Character, Different Teas — A Guide to 同名异物',
    });

assert.deepStrictEqual(
    decomposeTeaName('安茶 (ānchá)：一字多茶——“同名异物”指南'),
    {
        displayName: '安茶',
        nativeName: '安茶',
        transcription: 'ānchá',
        editorialTitle: '安茶 (ānchá)：一字多茶——“同名异物”指南',
    });

assert.deepStrictEqual(
    decomposeTeaName('印級茶（印级茶、yìn jí chá）：紅印、綠印與黃印'),
    {
        displayName: '印級茶',
        nativeName: '印级茶',
        transcription: 'yìn jí chá',
        editorialTitle: '印級茶（印级茶、yìn jí chá）：紅印、綠印與黃印',
    });

assert.deepStrictEqual(
    decomposeTeaName('Kings of Tea Trees — Qianjiazhai and Bada (千家寨, 巴达)'),
    {
        displayName: 'Qianjiazhai and Bada',
        nativeName: '千家寨 · 巴达',
        transcription: undefined,
        editorialTitle: 'Kings of Tea Trees — Qianjiazhai and Bada (千家寨, 巴达)',
    });

assert.deepStrictEqual(
    decomposeTeaName('7542 — the benchmark sheng cake'),
    {
        displayName: '7542',
        nativeName: undefined,
        transcription: undefined,
        editorialTitle: '7542 — the benchmark sheng cake',
    });

assert.deepStrictEqual(
    decomposeTeaName('Jin Guanyin (金观音, 金牡丹)'),
    {
        displayName: 'Jin Guanyin',
        nativeName: '金观音 · 金牡丹',
        transcription: undefined,
        editorialTitle: undefined,
    });

assert.deepStrictEqual(
    decomposeTeaName('Spring Tea (2026 Harvest)'),
    {
        displayName: 'Spring Tea (2026 Harvest)',
        nativeName: undefined,
        transcription: undefined,
        editorialTitle: undefined,
    });

assert.deepStrictEqual(
    decomposeTeaName('Old Tree — Spring 2026'),
    {
        displayName: 'Old Tree — Spring 2026',
        nativeName: undefined,
        transcription: undefined,
        editorialTitle: undefined,
    });

assert.deepStrictEqual(
    decomposeTeaName('Tea_Name (2026 Harvest)'),
    {
        displayName: 'Tea_Name (2026 Harvest)',
        nativeName: undefined,
        transcription: undefined,
        editorialTitle: undefined,
    });

const cleanProduct = {
    code: 'TEA-CN-ANCHA',
    nativeName: '安茶',
    transcription: 'ānchá',
    translations: [{
        lang: 'en-US',
        name: 'Ancha',
        transcription: 'ānchá',
        metaTitle: 'Ancha (安茶, ānchá): One Character, Different Teas — A Guide to 同名异物',
    }],
};
const cleanAudit = auditProductNaming([cleanProduct]);
assert.strictEqual(cleanAudit.valid, true);
assert.deepStrictEqual(cleanAudit.errors, []);
assert.strictEqual(cleanAudit.counts.translationRows, 1);

const invalidAudit = auditProductNaming([{
    code: 'TEA-CN-BROKEN',
    nativeName: '安茶 (ānchá)',
    transcription: '安茶',
    translations: [{
        lang: 'en-US',
        name: 'Ancha (安茶, ānchá)',
        transcription: '安茶',
    }],
}]);
assert.strictEqual(invalidAudit.valid, false);
assert.strictEqual(invalidAudit.counts.compositeNativeNames, 1);
assert.strictEqual(invalidAudit.counts.compositeTranslationRows, 1);
assert.strictEqual(invalidAudit.counts.cjkTranscriptions, 2);

const duplicateAudit = auditProductNaming([
    {
        code: 'TEA-CN-FIRST',
        translations: [{ lang: 'en-US', name: 'Same Tea' }],
    },
    {
        code: 'TEA-CN-SECOND',
        translations: [{ lang: 'en-US', name: 'same-tea' }],
    },
]);
assert.strictEqual(duplicateAudit.valid, true);
assert.strictEqual(duplicateAudit.counts.duplicateEnglishNames, 1);
assert.strictEqual(duplicateAudit.duplicateEnglishNames[0].name, 'Same Tea');
assert.deepStrictEqual(
    duplicateAudit.duplicateEnglishNames[0].codes,
    ['TEA-CN-FIRST', 'TEA-CN-SECOND']);

console.log('test-product-naming: ok');
