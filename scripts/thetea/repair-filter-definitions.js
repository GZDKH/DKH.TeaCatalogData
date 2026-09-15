#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, parseArgs, requireArg, loadDotEnv } = require('./lib/env');
const { readArtifactBundle } = require('./lib/artifact-bundle');
const { assertScopedPath, withStagedOutput } = require('./lib/generated-output');
const { requestImport } = require('./repair-puerh-spec-groups');
const { hashInputPath } = require('./generate-import');

loadDotEnv();

const MANAGED_PREFIX = 'SPEC-TT-';
const IMMUTABLE_FIELDS = ['code', 'group', 'type', 'unit'];
const RAW_LABEL_RE = /^(?:SPEC|TAG)(?:[-_]|$)/i;

function usage() {
    console.log(`Usage:
  node scripts/thetea/repair-filter-definitions.js \\
    --dir=import/thetea/<snapshot> \\
    --catalog-ref=sources/prod/catalog-reference/<snapshot>.json

Options:
  --out=<directory>     Report directory under reports/thetea/
  --remote-validate     Validate the scoped updates through AdminGateway
  --apply --yes         Apply through AdminGateway, read back, and verify

The default mode is local dry-run. Only filterability and missing/raw labels are
changed; stable identity, IDs, ordering, publication, groups, types, units, and
existing custom translations are preserved.`);
}

function repoPath(value) {
    if (!value) return null;
    return path.isAbsolute(String(value)) ? String(value) : path.join(REPO_ROOT, String(value));
}

function normalizeCode(value) {
    const raw = value && typeof value === 'object' ? value.code : value;
    return String(raw || '').trim().toUpperCase();
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key =>
            `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function isManaged(item) {
    return normalizeCode(item?.code).startsWith(MANAGED_PREFIX);
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

function translationLocale(item) {
    return String(item?.lang || item?.languageCode || item?.locale || '').trim();
}

function translationName(item) {
    return String(item?.name || '').trim();
}

function isRawLabel(name, code) {
    const value = String(name || '').trim();
    return !value || value === code || RAW_LABEL_RE.test(value);
}

function mergeTranslations(before, desired, code) {
    const result = Array.isArray(before) ? before.map(item => ({ ...item })) : [];
    const byLocale = new Map(result.map(item => [translationLocale(item).toLowerCase(), item]));
    const changes = [];
    for (const candidate of Array.isArray(desired) ? desired : []) {
        const locale = translationLocale(candidate);
        if (!locale) continue;
        const key = locale.toLowerCase();
        const existing = byLocale.get(key);
        if (!existing) {
            const added = { ...candidate };
            result.push(added);
            byLocale.set(key, added);
            changes.push({ locale, action: 'add', before: null, after: translationName(added) });
            continue;
        }
        if (isRawLabel(translationName(existing), code)) {
            const replacement = { ...existing, name: translationName(candidate) };
            const index = result.indexOf(existing);
            result[index] = replacement;
            byLocale.set(key, replacement);
            changes.push({ locale, action: 'replace-raw', before: translationName(existing), after: translationName(replacement) });
        }
    }
    result.sort((left, right) => translationLocale(left).localeCompare(translationLocale(right)));
    return { translations: result, changes };
}

function changedFields(before, after) {
    return Object.keys(after).filter(key => stableStringify(before?.[key]) !== stableStringify(after?.[key]));
}

function buildRepairPlan(desiredDefinitions, currentReference) {
    const desired = indexByCode(
        (desiredDefinitions?.attributes || []).filter(isManaged),
        'Desired managed attributes');
    const current = indexByCode(
        (currentReference?.specificationAttributes || []).filter(isManaged),
        'Current managed attributes');
    const operations = [];
    const updates = [];
    const rollback = [];
    const conflicts = [];

    for (const [code, afterDefinition] of [...desired.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const before = current.get(code);
        if (!before) {
            conflicts.push({ code, reason: 'managed definition is missing from current reference' });
            operations.push({ code, action: 'conflict', reason: conflicts.at(-1).reason });
            continue;
        }
        const immutableMismatches = IMMUTABLE_FIELDS.filter(field => {
            const left = normalizeCode(before[field]);
            const right = normalizeCode(afterDefinition[field]);
            return field === 'code' ? left !== right : left !== right;
        });
        if (immutableMismatches.length) {
            const conflict = { code, reason: 'immutable identity differs', fields: immutableMismatches };
            conflicts.push(conflict);
            operations.push({ code, action: 'conflict', ...conflict });
            continue;
        }
        const merged = mergeTranslations(before.translations, afterDefinition.translations, code);
        const after = { ...before, filterable: Boolean(afterDefinition.filterable), translations: merged.translations };
        const fields = changedFields(before, after);
        const operation = {
            code,
            action: fields.length ? 'update' : 'noop',
            changedFields: fields,
            translationChanges: merged.changes,
        };
        operations.push(operation);
        if (fields.length) {
            updates.push(after);
            rollback.push({ ...before });
        }
    }

    return {
        eligible: conflicts.length === 0,
        conflicts,
        operations,
        counts: operations.reduce((counts, item) => {
            counts[item.action] = (counts[item.action] || 0) + 1;
            return counts;
        }, { update: 0, noop: 0, conflict: 0 }),
        updates,
        rollback,
    };
}

function assertLiveReferenceUnchanged(plan, liveAttributes, catalogReference) {
    const live = indexByCode(liveAttributes.filter(isManaged), 'Live managed attributes');
    const reference = indexByCode(
        (catalogReference?.specificationAttributes || []).filter(isManaged),
        'Reference managed attributes');
    for (const operation of plan.operations.filter(item => item.action === 'update')) {
        const before = reference.get(operation.code);
        const actual = live.get(operation.code);
        if (!actual || stableStringify(actual) !== stableStringify(before)) {
            throw new Error(`Live attribute ${operation.code} differs from the immutable catalog reference.`);
        }
    }
}

function verifyApplied(plan, liveAttributes) {
    const live = indexByCode(liveAttributes.filter(isManaged), 'Live managed attributes');
    const errors = [];
    for (const desired of plan.updates) {
        const actual = live.get(normalizeCode(desired.code));
        if (!actual) {
            errors.push(`${desired.code}: missing after apply`);
            continue;
        }
        for (const field of ['filterable', 'translations']) {
            if (stableStringify(actual[field]) !== stableStringify(desired[field])) {
                errors.push(`${desired.code}: ${field} differs after apply`);
            }
        }
    }
    if (errors.length) throw new Error(`Repair read-back failed: ${errors.join('; ')}`);
}

function writeReport(output, report, updates, rollback) {
    withStagedOutput(output, staging => {
        fs.writeFileSync(path.join(staging, 'plan.json'), `${JSON.stringify(report, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'specification_attributes.json'), `${JSON.stringify(updates, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'rollback-specification_attributes.json'), `${JSON.stringify(rollback, null, 2)}\n`);
    });
}

function resolveOutput(args, catalogReferencePath) {
    const requested = args.out
        ? repoPath(args.out)
        : path.join(REPO_ROOT, 'reports', 'thetea', `${path.basename(catalogReferencePath, path.extname(catalogReferencePath))}-filter-repair`);
    return assertScopedPath(requested, {
        repoRoot: REPO_ROOT,
        allowedRoot: path.join(REPO_ROOT, 'reports', 'thetea'),
        allowedDescription: 'reports/thetea/',
        label: 'filter definition repair report',
    });
}

async function main() {
    const args = parseArgs();
    if (args.help || args.h) return usage();
    if (args.apply === true && args.yes !== true) throw new Error('Real repair requires both --apply and --yes.');
    const artifactRoot = repoPath(requireArg(args, 'dir'));
    const catalogReferencePath = repoPath(requireArg(args, 'catalog-ref'));
    const bundle = readArtifactBundle(artifactRoot);
    if (!bundle.valid) throw new Error(`Artifact integrity failed: ${bundle.errors.slice(0, 10).join('; ')}`);
    if (bundle.manifest.catalogReferenceSha256 !== hashInputPath(catalogReferencePath)) {
        throw new Error('Catalog reference hash differs from artifact manifest.');
    }
    const catalogReference = JSON.parse(fs.readFileSync(catalogReferencePath, 'utf8').replace(/^\uFEFF/, ''));
    const plan = buildRepairPlan(bundle.definitions, catalogReference);
    if (!plan.eligible) throw new Error(`Repair plan has ${plan.conflicts.length} conflict(s).`);
    const apply = args.apply === true && args.yes === true;
    const remoteValidate = args['remote-validate'] === true || apply;
    const report = {
        generatedAt: new Date().toISOString(),
        mode: apply ? 'apply' : remoteValidate ? 'remote-validate' : 'dry-run',
        artifactRoot,
        catalogReferencePath,
        catalogReferenceSha256: hashInputPath(catalogReferencePath),
        counts: plan.counts,
        operations: plan.operations,
        validation: null,
        apply: null,
        verification: null,
        rollback: { available: true, file: 'rollback-specification_attributes.json' },
    };
    const output = resolveOutput(args, catalogReferencePath);
    writeReport(output, report, plan.updates, plan.rollback);

    if (remoteValidate) {
        const workspaceId = String(catalogReference.workspaceId || '').trim();
        if (!workspaceId) throw new Error('Catalog reference has no workspaceId for remote validation.');
        const { GATEWAY_URL, getToken } = require('./lib/config');
        const { requestDataExchangeExport } = require('./fetch-prod-products');
        const token = await getToken();
        const live = JSON.parse((await requestDataExchangeExport(GATEWAY_URL, token, workspaceId, 'specification_attributes')).toString('utf8'));
        assertLiveReferenceUnchanged(plan, live, catalogReference);
        report.validation = plan.updates.length
            ? await requestImport(GATEWAY_URL, token, workspaceId, plan.updates, true)
            : { skipped: true, reason: 'all operations are noop' };
        if (apply && plan.updates.length) {
            try {
                report.apply = await requestImport(GATEWAY_URL, token, workspaceId, plan.updates, false);
                const readBack = JSON.parse((await requestDataExchangeExport(GATEWAY_URL, token, workspaceId, 'specification_attributes')).toString('utf8'));
                verifyApplied(plan, readBack);
                report.verification = { valid: true, checkedAttributes: plan.updates.length };
            } catch (error) {
                report.apply = { error: error.message };
                try {
                    await requestImport(GATEWAY_URL, token, workspaceId, plan.rollback, false);
                    report.rollback.executed = true;
                } catch (rollbackError) {
                    report.rollback.executed = false;
                    report.rollback.error = rollbackError.message;
                }
                writeReport(output, report, plan.updates, plan.rollback);
                throw error;
            }
        }
    }
    writeReport(output, report, plan.updates, plan.rollback);
    console.log(`Mode: ${report.mode}`);
    console.log(`Updates: ${plan.counts.update}`);
    console.log(`Noops: ${plan.counts.noop}`);
    console.log(`Conflicts: ${plan.counts.conflict}`);
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
    buildRepairPlan,
    isRawLabel,
    mergeTranslations,
    assertLiveReferenceUnchanged,
    verifyApplied,
};
