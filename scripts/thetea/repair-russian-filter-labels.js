#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, loadDotEnv, parseArgs, requireArg } = require('./lib/env');
const { assertScopedPath, withStagedOutput } = require('./lib/generated-output');
const { resolveCatalogWorkspaceId } = require('./lib/catalog-workspace');
const { requestDataExchangeExport } = require('./fetch-prod-products');
const { requestImport } = require('./repair-puerh-spec-groups');
const { hashInputPath } = require('./generate-import');

loadDotEnv();

const ATTRIBUTE_LABELS = new Map([
    ['SPEC-4304F36A0BF94F7', { english: 'Pressing Format', russian: 'Форма прессовки' }],
    ['SPEC-BF8EE9A970E348C', { english: 'Factory', russian: 'Фабрика' }],
    ['SPEC-06609725785E48F', { english: 'Vintage Year', russian: 'Год выпуска' }],
]);

const OPTION_LABELS = new Map([
    ['OPT-3FDFAEB0AEB14D52', 'Кирпич'],
    ['OPT-BF841D77083049E6', 'Рассыпной чай'],
    ['OPT-E9939A4B758741B3', 'Точа'],
    ['OPT-D902FEC129A64389', 'Блин'],
    ['OPT-PUERH-PRESSING-UNSPECIFIED', 'Не указано'],
    ['OPT-760EA71DBB554A6D', 'Хайвань'],
    ['OPT-D2BABEF7CA464C5B', 'Мэнхай (Даи)'],
    ['OPT-F4563886A4734B3A', 'Чэнь Шэн Хао'],
    ['OPT-9435918560EE4B93', 'Сягуань'],
    ['OPT-341E456C2EBF4F5B', 'Чжунча (CNNP)'],
    ['OPT-E3F03ACCC4FD4340', 'Мэнку Жунши'],
    ['OPT-PUERH-FACTORY-UNSPECIFIED', 'Не указано'],
    ['OPT-PUERH-VINTAGE-UNSPECIFIED', 'Не указано'],
]);

const TARGET_ATTRIBUTE_CODES = new Set(ATTRIBUTE_LABELS.keys());
const TARGET_OPTION_ATTRIBUTE_CODES = new Set([
    'SPEC-4304F36A0BF94F7',
    'SPEC-BF8EE9A970E348C',
    'SPEC-06609725785E48F',
]);

function usage() {
    console.log(`Usage:
  node scripts/thetea/repair-russian-filter-labels.js \\
    --catalog-ref=sources/prod/catalog-reference/prod-2026-07-27.json

Options:
  --out=<directory>     Report directory under reports/thetea/
  --workspace-id=<uuid> ProductCatalog workspace; or PRODUCT_CATALOG_WORKSPACE_ID
  --remote-validate     Validate through AdminGateway without writing
  --apply --yes         Apply through AdminGateway, read back, and verify

The default mode is a local dry-run. Only the allowlisted legacy pu-erh
filter definitions and their missing ru-RU names are changed.`);
}

function repoPath(value) {
    return path.isAbsolute(String(value)) ? String(value) : path.join(REPO_ROOT, String(value));
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function translationLocale(item) {
    return String(item?.lang || item?.languageCode || item?.locale || '').trim();
}

function translationName(item) {
    return String(item?.name || '').trim();
}

function indexByCode(items, label) {
    const result = new Map();
    for (const item of items || []) {
        const code = normalizeCode(item?.code);
        if (!code) throw new Error(`${label} contains an item without a code.`);
        if (result.has(code)) throw new Error(`${label} contains duplicate code ${code}.`);
        result.set(code, item);
    }
    return result;
}

function mergeRussianTranslation(before, russian, english, code) {
    const result = Array.isArray(before) ? before.map(item => ({ ...item })) : [];
    const existing = result.find(item => translationLocale(item).toLowerCase() === 'ru-ru');
    if (!existing) {
        result.push({ lang: 'ru-RU', name: russian, description: '' });
        return { translations: result, changed: true, action: 'add' };
    }
    const current = translationName(existing);
    if (current === english || current === code || /^SPEC[-_]/i.test(current) || /^OPT[-_]/i.test(current)) {
        if (current === russian) return { translations: result, changed: false, action: 'noop' };
        const replacement = { ...existing, name: russian };
        result[result.indexOf(existing)] = replacement;
        return { translations: result, changed: true, action: 'replace-raw' };
    }
    return { translations: result, changed: false, action: 'preserve-custom' };
}

function vintageOptionLabel(option) {
    const english = translationName((option.translations || []).find(item => translationLocale(item) === 'en-US'));
    if (/^\d{4}$/.test(english)) return english;
    return OPTION_LABELS.get(normalizeCode(option.code)) || null;
}

function buildRepairPlan(catalogReference) {
    const attributes = indexByCode(catalogReference?.specificationAttributes, 'Current specification attributes');
    const options = indexByCode(catalogReference?.specificationAttributeOptions, 'Current specification options');
    const operations = [];
    const attributeUpdates = [];
    const optionUpdates = [];
    const rollbackAttributes = [];
    const rollbackOptions = [];
    const conflicts = [];

    for (const [code, label] of ATTRIBUTE_LABELS) {
        const before = attributes.get(code);
        if (!before) {
            conflicts.push({ kind: 'attribute', code, reason: 'definition is missing from catalog reference' });
            continue;
        }
        const english = (before.translations || []).find(item => translationLocale(item) === 'en-US');
        if (!english || translationName(english) !== label.english) {
            conflicts.push({ kind: 'attribute', code, reason: 'canonical English label differs', expected: label.english });
            continue;
        }
        const merged = mergeRussianTranslation(before.translations, label.russian, label.english, code);
        operations.push({ kind: 'attribute', code, action: merged.changed ? 'update' : 'noop', translationAction: merged.action });
        if (merged.changed) {
            attributeUpdates.push({ ...before, translations: merged.translations });
            rollbackAttributes.push({ ...before });
        }
    }

    for (const [code, before] of options) {
        const attributeCode = normalizeCode(before.attribute);
        if (!TARGET_OPTION_ATTRIBUTE_CODES.has(attributeCode)) continue;
        const russian = vintageOptionLabel(before);
        if (!russian) continue;
        const english = (before.translations || []).find(item => translationLocale(item) === 'en-US');
        if (!english) {
            conflicts.push({ kind: 'option', code, reason: 'canonical English label is missing' });
            continue;
        }
        const merged = mergeRussianTranslation(before.translations, russian, translationName(english), code);
        operations.push({ kind: 'option', code, attribute: attributeCode, action: merged.changed ? 'update' : 'noop', translationAction: merged.action });
        if (merged.changed) {
            optionUpdates.push({ ...before, translations: merged.translations });
            rollbackOptions.push({ ...before });
        }
    }

    return {
        eligible: conflicts.length === 0,
        conflicts,
        operations,
        counts: operations.reduce((counts, operation) => {
            counts[operation.action] = (counts[operation.action] || 0) + 1;
            return counts;
        }, { update: 0, noop: 0, conflict: conflicts.length }),
        attributeUpdates,
        optionUpdates,
        rollbackAttributes,
        rollbackOptions,
    };
}

function targetRecords(reference, plan) {
    const attributes = indexByCode(reference.specificationAttributes, 'Live specification attributes');
    const options = indexByCode(reference.specificationAttributeOptions, 'Live specification options');
    for (const item of plan.rollbackAttributes) {
        if (!attributes.has(normalizeCode(item.code)) || stableStringify(attributes.get(normalizeCode(item.code))) !== stableStringify(item)) {
            throw new Error(`Live attribute ${item.code} differs from the immutable catalog reference.`);
        }
    }
    for (const item of plan.rollbackOptions) {
        if (!options.has(normalizeCode(item.code)) || stableStringify(options.get(normalizeCode(item.code))) !== stableStringify(item)) {
            throw new Error(`Live option ${item.code} differs from the immutable catalog reference.`);
        }
    }
}

function verifyApplied(plan, reference) {
    const attributes = indexByCode(reference.specificationAttributes, 'Applied specification attributes');
    const options = indexByCode(reference.specificationAttributeOptions, 'Applied specification options');
    const errors = [];
    for (const desired of plan.attributeUpdates) {
        if (stableStringify(attributes.get(normalizeCode(desired.code))) !== stableStringify(desired)) errors.push(desired.code);
    }
    for (const desired of plan.optionUpdates) {
        if (stableStringify(options.get(normalizeCode(desired.code))) !== stableStringify(desired)) errors.push(desired.code);
    }
    if (errors.length) throw new Error(`Russian filter label read-back failed: ${errors.join(', ')}`);
}

function writeReport(output, report, plan) {
    withStagedOutput(output, staging => {
        fs.writeFileSync(path.join(staging, 'plan.json'), `${JSON.stringify(report, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'specification_attributes.json'), `${JSON.stringify(plan.attributeUpdates, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'specification_attribute_options.json'), `${JSON.stringify(plan.optionUpdates, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'rollback-specification_attributes.json'), `${JSON.stringify(plan.rollbackAttributes, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'rollback-specification_attribute_options.json'), `${JSON.stringify(plan.rollbackOptions, null, 2)}\n`);
    });
}

function resolveOutput(args) {
    const requested = args.out
        ? repoPath(args.out)
        : path.join(REPO_ROOT, 'reports', 'thetea', 'russian-filter-label-repair');
    return assertScopedPath(requested, {
        repoRoot: REPO_ROOT,
        allowedRoot: path.join(REPO_ROOT, 'reports', 'thetea'),
        allowedDescription: 'reports/thetea/',
        label: 'Russian filter label repair report',
    });
}

async function main() {
    const args = parseArgs();
    if (args.help || args.h) return usage();
    if (args.apply === true && args.yes !== true) throw new Error('Real repair requires both --apply and --yes.');
    const catalogReferencePath = repoPath(requireArg(args, 'catalog-ref'));
    const catalogReference = JSON.parse(fs.readFileSync(catalogReferencePath, 'utf8').replace(/^\uFEFF/, ''));
    const plan = buildRepairPlan(catalogReference);
    if (!plan.eligible) throw new Error(`Repair plan has ${plan.conflicts.length} conflict(s): ${plan.conflicts.map(item => item.code).join(', ')}`);
    const apply = args.apply === true && args.yes === true;
    const remoteValidate = args['remote-validate'] === true || apply;
    const report = {
        generatedAt: new Date().toISOString(),
        mode: apply ? 'apply' : remoteValidate ? 'remote-validate' : 'dry-run',
        catalogReferencePath,
        catalogReferenceSha256: hashInputPath(catalogReferencePath),
        counts: plan.counts,
        operations: plan.operations,
        validation: null,
        apply: null,
        verification: null,
        rollback: { available: true, files: ['rollback-specification_attributes.json', 'rollback-specification_attribute_options.json'] },
    };
    const output = resolveOutput(args);
    writeReport(output, report, plan);

    if (remoteValidate) {
        const workspaceId = resolveCatalogWorkspaceId(args);
        const { GATEWAY_URL, getToken } = require('../lib/config');
        const token = await getToken();
        const [liveAttributes, liveOptions] = await Promise.all([
            requestDataExchangeExport(GATEWAY_URL, token, workspaceId, 'specification_attributes'),
            requestDataExchangeExport(GATEWAY_URL, token, workspaceId, 'specification_attribute_options'),
        ]).then(values => values.map(value => JSON.parse(value.toString('utf8').replace(/^\uFEFF/, ''))));
        targetRecords({ specificationAttributes: liveAttributes, specificationAttributeOptions: liveOptions }, plan);
        report.validation = {
            attributes: await requestImport(GATEWAY_URL, token, workspaceId, plan.attributeUpdates, true, 'specification_attributes'),
            options: await requestImport(GATEWAY_URL, token, workspaceId, plan.optionUpdates, true, 'specification_attribute_options'),
        };
        if (apply && (plan.attributeUpdates.length || plan.optionUpdates.length)) {
            report.apply = {
                attributes: await requestImport(GATEWAY_URL, token, workspaceId, plan.attributeUpdates, false, 'specification_attributes'),
                options: await requestImport(GATEWAY_URL, token, workspaceId, plan.optionUpdates, false, 'specification_attribute_options'),
            };
            const [afterAttributes, afterOptions] = await Promise.all([
                requestDataExchangeExport(GATEWAY_URL, token, workspaceId, 'specification_attributes'),
                requestDataExchangeExport(GATEWAY_URL, token, workspaceId, 'specification_attribute_options'),
            ]).then(values => values.map(value => JSON.parse(value.toString('utf8').replace(/^\uFEFF/, ''))));
            verifyApplied(plan, { specificationAttributes: afterAttributes, specificationAttributeOptions: afterOptions });
            report.verification = { valid: true, checkedAttributes: plan.attributeUpdates.length, checkedOptions: plan.optionUpdates.length };
        }
    }

    writeReport(output, report, plan);
    console.log(`Mode: ${report.mode}`);
    console.log(`Attribute updates: ${plan.attributeUpdates.length}`);
    console.log(`Option updates: ${plan.optionUpdates.length}`);
    console.log(`Noops: ${plan.counts.noop}`);
    console.log(`Report: ${output}`);
    return report;
}

if (require.main === module) {
    main().catch(error => {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    ATTRIBUTE_LABELS,
    OPTION_LABELS,
    buildRepairPlan,
    mergeRussianTranslation,
    verifyApplied,
};
