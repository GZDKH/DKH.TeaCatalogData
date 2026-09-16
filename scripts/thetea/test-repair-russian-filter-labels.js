const assert = require('assert/strict');
const {
    buildRepairPlan,
    mergeRussianTranslation,
} = require('./repair-russian-filter-labels');

const reference = {
    specificationAttributes: [
        { code: 'SPEC-4304F36A0BF94F7', filterable: true, translations: [{ lang: 'en-US', name: 'Pressing Format' }] },
        { code: 'SPEC-BF8EE9A970E348C', filterable: true, translations: [{ lang: 'en-US', name: 'Factory' }] },
        { code: 'SPEC-06609725785E48F', filterable: true, translations: [{ lang: 'en-US', name: 'Vintage Year' }] },
    ],
    specificationAttributeOptions: [
        { attribute: 'SPEC-4304F36A0BF94F7', code: 'OPT-D902FEC129A64389', translations: [{ lang: 'en-US', name: 'Cake' }] },
        { attribute: 'SPEC-BF8EE9A970E348C', code: 'OPT-PUERH-FACTORY-UNSPECIFIED', translations: [{ lang: 'en-US', name: 'Unspecified' }] },
        { attribute: 'SPEC-06609725785E48F', code: 'OPT-PUERH-VINTAGE-2024', translations: [{ lang: 'en-US', name: '2024' }, { lang: 'ru-RU', name: '2024' }] },
        { attribute: 'SPEC-06609725785E48F', code: 'OPT-PUERH-VINTAGE-UNSPECIFIED', translations: [{ lang: 'en-US', name: 'Unspecified' }] },
    ],
};

const plan = buildRepairPlan(reference);
assert.equal(plan.eligible, true);
assert.equal(plan.attributeUpdates.length, 3);
assert.equal(plan.optionUpdates.length, 3);
assert.equal(plan.optionUpdates.find(item => item.code === 'OPT-D902FEC129A64389').translations.find(item => item.lang === 'ru-RU').name, 'Блин');
assert.equal(plan.optionUpdates.find(item => item.code === 'OPT-PUERH-VINTAGE-UNSPECIFIED').translations.find(item => item.lang === 'ru-RU').name, 'Не указано');
assert.equal(plan.operations.find(item => item.code === 'OPT-PUERH-VINTAGE-2024').action, 'noop');

const custom = mergeRussianTranslation(
    [{ lang: 'en-US', name: 'Factory' }, { lang: 'ru-RU', name: 'Пользовательская фабрика' }],
    'Фабрика',
    'Factory',
    'SPEC-BF8EE9A970E348C');
assert.equal(custom.changed, false);
assert.equal(custom.translations[1].name, 'Пользовательская фабрика');

console.log('test-repair-russian-filter-labels: OK');
