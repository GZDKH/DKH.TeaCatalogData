#!/usr/bin/env node
const assert = require('assert');
const { buildSpecificationDefinitions } = require('./lib/spec-definitions');

const products = [
    {
        code: 'TEA-CN-XIHU-LONGJING',
        specifications: [
            {
                lang: 'en-US',
                group: 'SPEC-TT-GROUP-CLASSIFICATION-ORIGIN',
                groupName: 'Classification and Origin',
                attribute: 'SPEC-TT-CLASSIFICATION-ORIGIN-TEA-TYPE',
                attributeName: 'Tea Type',
                type: 'Option',
                option: 'SPEC-TT-OPT-CLASSIFICATION-ORIGIN-TEA-TYPE-GREEN',
                optionName: 'Green',
                order: 1,
            },
            {
                lang: 'en-US',
                group: 'SPEC-TT-GROUP-HISTORY-CULTURE',
                groupName: 'History and Culture',
                attribute: 'SPEC-TT-FIELD-HISTORY-CULTURE-HISTORY',
                attributeName: 'History',
                type: 'CustomMarkdownText',
                value: 'Long history.',
                order: 2,
            },
            {
                lang: 'en-US',
                group: 'SPEC-TT-GROUP-SOURCE',
                groupName: 'Source Metadata',
                attribute: 'SPEC-TT-SOURCE-LAST-UPDATED',
                attributeName: 'TheTea Last Updated',
                type: 'Date',
                value: '2026-04-08',
                order: 3,
            },
        ],
    },
    {
        code: 'TEA-CN-BILUOCHUN',
        specifications: [
            {
                lang: 'en-US',
                group: 'SPEC-TT-GROUP-CLASSIFICATION-ORIGIN',
                groupName: 'Classification and Origin',
                attribute: 'SPEC-TT-CLASSIFICATION-ORIGIN-TEA-TYPE',
                attributeName: 'Tea Type',
                type: 'Option',
                option: 'SPEC-TT-OPT-CLASSIFICATION-ORIGIN-TEA-TYPE-GREEN',
                optionName: 'Green',
                order: 1,
            },
            {
                lang: 'en-US',
                group: 'SPEC-TT-GROUP-MARKDOWN',
                groupName: 'Full Markdown Pages',
                attribute: 'SPEC-TT-MARKDOWN-LV',
                attributeName: 'Full Markdown Page (lv)',
                type: 'CustomMarkdownText',
                value: 'legacy junk',
                order: 2,
            },
            {
                lang: 'en-US',
                group: 'SPEC-TT-GROUP-BOTANY-MATERIAL',
                groupName: 'Botany and Raw Material',
                attribute: 'SPEC-TT-FIELD-BOTANY-MATERIAL-BOTANY-MATERIAL-X7',
                attributeName: 'TheTea Botany Material Field 8',
                type: 'CustomMarkdownText',
                value: 'legacy synthetic field',
                order: 3,
            },
            {
                lang: 'en-US',
                group: 'SPEC-TT-GROUP-EXT-17',
                groupName: 'Extended Section 17',
                attribute: 'SPEC-TT-FIELD-EXT-17-EXT-17-X0',
                attributeName: 'TheTea Ext 17 Field 1',
                type: 'CustomMarkdownText',
                value: 'legacy synthetic group',
                order: 4,
            },
        ],
    },
];

const definitions = buildSpecificationDefinitions(products);

assert.deepStrictEqual(definitions.groups.map(g => g.code), [
    'SPEC-TT-GROUP-CLASSIFICATION-ORIGIN',
    'SPEC-TT-GROUP-HISTORY-CULTURE',
    'SPEC-TT-GROUP-SOURCE',
]);
assert.strictEqual(definitions.attributes.length, 3);
assert.strictEqual(definitions.options.length, 1);

const originGroup = definitions.groups.find(g => g.code === 'SPEC-TT-GROUP-CLASSIFICATION-ORIGIN');
assert.strictEqual(originGroup.translations[0].lang, 'en-US');
assert.strictEqual(originGroup.translations[0].name, 'Classification and Origin');

const teaTypeAttribute = definitions.attributes.find(a => a.code === 'SPEC-TT-CLASSIFICATION-ORIGIN-TEA-TYPE');
assert.strictEqual(teaTypeAttribute.group, 'SPEC-TT-GROUP-CLASSIFICATION-ORIGIN');
assert.strictEqual(teaTypeAttribute.filterable, true);
assert.strictEqual(teaTypeAttribute.comparable, true);

const historyAttribute = definitions.attributes.find(a => a.code === 'SPEC-TT-FIELD-HISTORY-CULTURE-HISTORY');
assert.strictEqual(historyAttribute.filterable, false);
assert.strictEqual(historyAttribute.comparable, false);

assert(!definitions.groups.some(g => /MARKDOWN|EXT-\d+/.test(g.code)));
assert(!definitions.attributes.some(a => /-X\d+(?:$|-)/.test(a.code) || /Field \d+/.test(a.translations[0].name)));
assert(!definitions.options.some(o => /MARKDOWN|EXT-\d+|-X\d+(?:$|-)/.test(o.code)));

console.log('test-spec-definitions: OK');
