#!/usr/bin/env node
const path = require('path');
const { REPO_ROOT, csv, parseArgs, requireArg } = require('./lib/env');
const { loadCatalogReference } = require('./lib/catalog-mapping');
const {
    analyzeSeedReadiness,
    readProductsFromDir,
    writeSeedReadinessReport,
} = require('./lib/seed-readiness');

function usage() {
    console.log(`Usage:
  node scripts/thetea/check-seed-readiness.js --dir=import/thetea/<id> --catalog-ref=sources/prod/catalog-reference/<id>.json

Options:
  --dir=<path>                Generated import directory.
  --catalog-ref=<path>        Production catalog/category reference snapshot.
  --catalog=<code>            Required POS catalog code. Default: CATALOG-CHINESE-TEA.
  --required-locales=<csv>    Required product locale coverage. Default: en-US,ru-RU,zh-CN.
  --min-products=<n>          Minimum generated/published product count. Default: 1.
  --min-categories=<n>        Minimum category assignment count. Default: 1.
  --report=<name>             Report directory under reports/thetea/. Default: seed-readiness.`);
}

function resolveRepoPath(value) {
    return path.isAbsolute(value) ? value : path.join(REPO_ROOT, value);
}

function main() {
    const args = parseArgs();
    if (args.help || args.h) {
        usage();
        return;
    }

    const dir = resolveRepoPath(requireArg(args, 'dir'));
    const catalogReference = loadCatalogReference(resolveRepoPath(requireArg(args, 'catalog-ref')));
    const { productsDir, products } = readProductsFromDir(dir);
    const summary = analyzeSeedReadiness(products, {
        catalogReference,
        requiredCatalogCode: args.catalog || 'CATALOG-CHINESE-TEA',
        requiredLocales: csv(args['required-locales'], ['en-US', 'ru-RU', 'zh-CN']),
        minProducts: args['min-products'] || 1,
        minCategories: args['min-categories'] || 1,
    });

    const reportDir = path.join(REPO_ROOT, 'reports', 'thetea', args.report || 'seed-readiness');
    writeSeedReadinessReport(reportDir, summary);

    console.log(`Input: ${productsDir}`);
    console.log(`Products: ${summary.productCount}`);
    console.log(`Published products: ${summary.publishedProductCount}`);
    console.log(`Catalog: ${summary.requiredCatalogCode}`);
    console.log(`Catalog found: ${summary.catalog.found ? 'yes' : 'no'}`);
    console.log(`Catalog published: ${summary.catalog.published === null ? 'n/a' : summary.catalog.published ? 'yes' : 'no'}`);
    console.log(`POS category assignments: ${summary.categoryCount}`);
    console.log(`Ready: ${summary.ready ? 'yes' : 'no'}`);
    console.log(`Report: ${reportDir}`);

    for (const error of summary.errors.slice(0, 10)) console.log(`ERROR: ${error}`);
    for (const warning of summary.warnings.slice(0, 10)) console.log(`WARN: ${warning}`);

    process.exit(summary.ready ? 0 : 1);
}

try {
    main();
} catch (error) {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
}
