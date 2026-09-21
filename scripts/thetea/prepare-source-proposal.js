#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { REPO_ROOT, parseArgs, requireArg } = require('./lib/env');
const { assertScopedPath, withStagedOutput } = require('./lib/generated-output');
const { loadVerifiedProductReference } = require('./lib/product-reference');
const { hashInputPath } = require('./generate-import');
const {
    buildSourceBackedProposal,
    assertFreshInputs,
} = require('./lib/source-backed-proposal');
const { applyFieldDetails } = require('./lib/field-details');

function usage() {
    console.log(`Usage:
  node scripts/thetea/prepare-source-proposal.js \\
    --source-card=<raw/cards/<lang>/<slug>.json> \\
    --product-ref=<sources/prod/product-reference/<snapshot>>

Options:
  --source-manifest=<snapshot manifest>  Record the immutable source snapshot hash
  --field-pack=<slug.json.gz>           Overlay the exact locale field pack before preparing
  --article-url=<url>                   Override the source article link
  --product-code=<code>                 Require this exact ProductCatalog code
  --out=<reports/thetea/...>            Output directory (default: reports/thetea/source-proposals/<slug>)

The command is read-only. It prepares a fill-missing proposal and complete desired/rollback
ProductCatalog payloads. Existing values are preserved; conflicts remain review-only.`);
}

function readJson(file, label) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must contain a JSON object.`);
    }
    return value;
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
}

function readFieldPack(file, card) {
    const pack = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    if (pack.slug !== card.slug || !pack.locales || typeof pack.locales !== 'object') {
        throw new Error(`Field pack does not match source slug '${card.slug}'.`);
    }
    const sourceLang = String(card.lang || 'en').toLowerCase();
    const rows = pack.locales[sourceLang] || pack.locales[sourceLang.split('-')[0]];
    if (!Array.isArray(rows)) throw new Error(`Field pack has no locale '${sourceLang}'.`);
    return applyFieldDetails(card, rows.map(row => ({
        section: row.section,
        field: row.field,
        payload: row.payload,
    })));
}

function buildOutputPayloads(proposal) {
    if (!proposal?.eligible) {
        return { desiredPayload: [], rollbackPayload: [] };
    }

    return {
        desiredPayload: proposal.reconciliation?.desiredPayload || [proposal.desiredProduct],
        rollbackPayload: proposal.reconciliation?.rollbackPayload || [],
    };
}

function main() {
    const args = parseArgs();
    if (args.help || args.h) return usage();
    const sourcePath = path.resolve(requireArg(args, 'source-card'));
    const productRefPath = path.resolve(requireArg(args, 'product-ref'));
    let sourceCard = readJson(sourcePath, 'Source card');
    const sourceManifestPath = args['source-manifest']
        ? path.resolve(String(args['source-manifest']))
        : null;
    const sourceManifest = sourceManifestPath ? readJson(sourceManifestPath, 'Source manifest') : {};
    const fieldPackPath = args['field-pack'] ? path.resolve(String(args['field-pack'])) : null;
    const fieldPackSha256 = fieldPackPath ? hashInputPath(fieldPackPath) : null;
    if (fieldPackPath) sourceCard = readFieldPack(fieldPackPath, sourceCard);
    const reference = loadVerifiedProductReference(productRefPath);
    const expectedCode = normalizeCode(args['product-code']) || `TEA-${normalizeCode(sourceCard.meta?.origin_country || 'CN')}-${String(sourceCard.slug || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`;
    const baseline = reference.products.find(product => normalizeCode(product.code) === expectedCode);
    if (!baseline) throw new Error(`Exact baseline product '${expectedCode}' was not found.`);

    const sourceSha256 = hashInputPath(sourcePath);
    const baselineSha256 = hashInputPath(productRefPath);
    const sourceManifestSha256 = sourceManifestPath ? hashInputPath(sourceManifestPath) : null;
    const proposal = buildSourceBackedProposal({
        sourceCard,
        baselineProduct: baseline,
        sourceMetadata: {
            sourceSystem: 'thetea',
            snapshotId: sourceManifest.snapshotId,
            sourceSha256,
            sourceManifestSha256,
            fieldPackSha256,
            productCode: expectedCode,
            articleUrl: args['article-url'],
        },
    });
    proposal.inputs = {
        sourcePath,
        sourceSha256,
        sourceManifestPath,
        sourceManifestSha256,
        fieldPackPath,
        fieldPackSha256,
        baselinePath: productRefPath,
        baselineSha256,
        baselineProductSha256: hashInputPath(reference.productFile),
    };
    proposal.source.snapshotId = sourceManifest.snapshotId || null;
    proposal.source.sourceManifestSha256 = sourceManifestSha256;
    const outputPayloads = buildOutputPayloads(proposal);
    proposal.reconciliation = proposal.reconciliation
        ? {
            ...proposal.reconciliation,
            desiredPayload: 'desired-products.json',
            rollbackPayload: 'rollback-products.json',
        }
        : null;

    const slug = String(sourceCard.slug || expectedCode).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    const requestedOutput = args.out
        ? path.resolve(String(args.out))
        : path.join(REPO_ROOT, 'reports', 'thetea', 'source-proposals', slug);
    const output = assertScopedPath(requestedOutput, {
        repoRoot: REPO_ROOT,
        allowedRoot: path.join(REPO_ROOT, 'reports', 'thetea'),
        allowedDescription: 'reports/thetea/',
        label: 'TheTea source proposal report',
    });
    withStagedOutput(output, staging => {
        fs.writeFileSync(path.join(staging, 'proposal.json'), `${JSON.stringify(proposal, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'proposals.json'), `${JSON.stringify(proposal.proposals, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'desired-products.json'), `${JSON.stringify(outputPayloads.desiredPayload, null, 2)}\n`);
        fs.writeFileSync(path.join(staging, 'rollback-products.json'), `${JSON.stringify(outputPayloads.rollbackPayload, null, 2)}\n`);
    });
    console.log(`Eligible: ${proposal.eligible ? 'yes' : 'no'}`);
    console.log(`Product: ${proposal.productCode}`);
    console.log(`Apply proposals: ${proposal.proposals.filter(item => item.action === 'apply').length}`);
    console.log(`Review queue: ${proposal.reviewQueue.length}`);
    console.log(`Source revision: ${proposal.source.revision}`);
    console.log(`Report: ${output}`);
    if (!proposal.eligible) process.exitCode = 1;
    return proposal;
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { buildOutputPayloads, main };
