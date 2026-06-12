#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, parseArgs, requireArg } = require('./lib/env');
const { validateProducts, writeReport } = require('./lib/report');
const { loadCatalogReference } = require('./lib/catalog-mapping');

function walkJson(dir) {
    const result = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) result.push(...walkJson(full));
        else if (entry.isFile() && entry.name.endsWith('.json')) result.push(full);
    }
    return result;
}

function main() {
    const args = parseArgs();
    const dir = path.resolve(REPO_ROOT, requireArg(args, 'dir'));
    const catalogReferencePath = args['catalog-ref'] || args['prod-ref'];
    const catalogReference = catalogReferencePath
        ? loadCatalogReference(path.isAbsolute(String(catalogReferencePath))
            ? String(catalogReferencePath)
            : path.join(REPO_ROOT, String(catalogReferencePath)))
        : null;
    const productsDir = fs.existsSync(path.join(dir, '04-products')) ? path.join(dir, '04-products') : dir;
    const files = walkJson(productsDir);
    const products = [];

    for (const file of files) {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, ''));
        if (!Array.isArray(data)) {
            throw new Error(`${file} is not a JSON array`);
        }
        products.push(...data);
    }

    const summary = validateProducts(products, {
        catalogReference,
        requiredCatalogCode: args.catalog || 'CATALOG-CHINESE-TEA',
    });

    const reportDir = path.join(REPO_ROOT, 'reports', 'thetea', args.report || 'validation');
    writeReport(reportDir, summary);

    console.log(`Input: ${productsDir}`);
    console.log(`Files: ${files.length}`);
    console.log(`Products: ${summary.productCount}`);
    console.log(`Valid: ${summary.valid ? 'yes' : 'no'}`);
    console.log(`Errors: ${summary.errors.length}`);
    console.log(`Warnings: ${summary.warnings.length}`);
    console.log(`Report: ${reportDir}`);

    for (const error of summary.errors.slice(0, 10)) console.log(`ERROR: ${error}`);
    for (const warning of summary.warnings.slice(0, 10)) console.log(`WARN: ${warning}`);

    process.exit(summary.valid ? 0 : 1);
}

try {
    main();
} catch (error) {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
}
