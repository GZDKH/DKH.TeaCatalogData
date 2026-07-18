#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, parseArgs, requireArg } = require('./lib/env');
const { writeReport } = require('./lib/report');
const { loadCatalogReference } = require('./lib/catalog-mapping');
const { readArtifactBundle, sha256 } = require('./lib/artifact-bundle');
const { validateArtifact } = require('./lib/artifact-validator');
const {
    hashInputPath,
    hashSnapshotFiles,
} = require('./generate-import');
const { loadVerifiedProductReference } = require('./lib/product-reference');

function repoPath(value) {
    if (!value) return null;
    return path.isAbsolute(String(value)) ? String(value) : path.join(REPO_ROOT, String(value));
}

function main() {
    const args = parseArgs();
    const dir = path.resolve(REPO_ROOT, requireArg(args, 'dir'));
    const bundle = readArtifactBundle(dir);
    const manifest = bundle.manifest || {};
    const catalogReferencePath = repoPath(args['catalog-ref'] || args['prod-ref']);
    const productReferencePath = repoPath(args['product-ref']);
    const catalogReference = catalogReferencePath ? loadCatalogReference(catalogReferencePath) : null;
    const baselineReference = productReferencePath
        ? loadVerifiedProductReference(productReferencePath)
        : null;
    const baselineProducts = baselineReference?.products || [];
    const integrityErrors = [...bundle.errors];
    const integrityWarnings = [];

    if (manifest.catalogReferenceSha256) {
        if (!catalogReferencePath) {
            integrityErrors.push('Artifact requires the catalog reference used during generation; pass --catalog-ref=....');
        } else if (hashInputPath(catalogReferencePath) !== manifest.catalogReferenceSha256) {
            integrityErrors.push('Catalog reference hash differs from the artifact manifest.');
        }
    }
    if (manifest.baselineReferenceSha256) {
        if (!productReferencePath) {
            integrityErrors.push('Artifact requires the full product reference used during generation; pass --product-ref=....');
        } else if (hashInputPath(productReferencePath) !== manifest.baselineReferenceSha256) {
            integrityErrors.push('Product baseline reference hash differs from the artifact manifest.');
        }
    }

    const snapshotRoot = repoPath(args['snapshot-root'])
        || path.join(REPO_ROOT, 'sources', 'thetea', 'snapshots', manifest.snapshotId || '');
    const sourceManifestPath = path.join(snapshotRoot, 'manifest.json');
    if (fs.existsSync(sourceManifestPath)) {
        const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8').replace(/^\uFEFF/, ''));
        if (sha256(fs.readFileSync(sourceManifestPath)) !== manifest.sourceManifestSha256) {
            integrityErrors.push('Source snapshot manifest hash differs from the artifact manifest.');
        }
        if (hashSnapshotFiles(snapshotRoot, sourceManifest) !== manifest.sourceFilesSha256) {
            integrityErrors.push('Source snapshot file-set hash differs from the artifact manifest.');
        }
    } else if (args['allow-missing-source-snapshot'] === true) {
        integrityWarnings.push(`Source snapshot is unavailable for re-verification: ${snapshotRoot}`);
    } else {
        integrityErrors.push(`Source snapshot is unavailable for re-verification: ${snapshotRoot}`);
    }

    const semantic = validateArtifact({
        products: bundle.products,
        definitions: bundle.definitions,
        requiredLocales: manifest.requiredLocales || [],
        lossEvents: manifest.lossEvents || [],
        routedContent: bundle.routedContent,
        catalogReference,
        requiredCatalogCode: args.catalog || 'CATALOG-CHINESE-TEA',
        baselineProducts,
    });
    const summary = {
        ...semantic,
        valid: integrityErrors.length === 0 && semantic.valid,
        artifactDirectory: dir,
        artifactFileCount: manifest.files?.length || 0,
        productFileCount: bundle.productFiles.length,
        sourceManifestSha256: manifest.sourceManifestSha256,
        sourceFilesSha256: manifest.sourceFilesSha256,
        catalogReferenceSha256: manifest.catalogReferenceSha256,
        baselineReferenceSha256: manifest.baselineReferenceSha256,
        specificationDefinitionCounts: semantic.definitionCounts,
        specificationLocalization: manifest.localization,
        relations: semantic.relationCounts,
        errors: [...integrityErrors, ...semantic.errors],
        warnings: [...integrityWarnings, ...semantic.warnings],
    };

    const reportDir = path.join(REPO_ROOT, 'reports', 'thetea', args.report || 'validation');
    writeReport(reportDir, summary);
    console.log(`Input: ${dir}`);
    console.log(`Files: ${summary.artifactFileCount}`);
    console.log(`Product files: ${summary.productFileCount}`);
    console.log(`Products: ${summary.productCount}`);
    console.log(`Valid: ${summary.valid ? 'yes' : 'no'}`);
    console.log(`Errors: ${summary.errors.length}`);
    console.log(`Warnings: ${summary.warnings.length}`);
    console.log(`Report: ${reportDir}`);
    for (const error of summary.errors.slice(0, 10)) console.log(`ERROR: ${error}`);
    for (const warning of summary.warnings.slice(0, 10)) console.log(`WARN: ${warning}`);
    process.exitCode = summary.valid ? 0 : 1;
    return summary;
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { main };
