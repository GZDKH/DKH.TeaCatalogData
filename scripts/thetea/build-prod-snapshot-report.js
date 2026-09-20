#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');

function argument(name) {
    const prefix = `--${name}=`;
    const value = process.argv.find(item => item.startsWith(prefix));
    if (!value) throw new Error(`Missing ${prefix}<value>`);
    return value.slice(prefix.length);
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function nonEmpty(value) {
    return value !== undefined && value !== null && value !== '' &&
        (!Array.isArray(value) || value.length > 0);
}

function countBy(items, selector) {
    const counts = new Map();
    for (const item of items) {
        const key = selector(item) ?? '(missing)';
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

const productsFile = argument('products');
const templateFile = argument('template');
const outputFile = argument('out');
const products = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
const template = JSON.parse(fs.readFileSync(templateFile, 'utf8'));
if (!Array.isArray(products) || !Array.isArray(template) || template.length !== 1) {
    throw new Error('Expected a products array and one-row template array');
}

const specifications = products.flatMap(product => product.specifications || []);
const duplicateCount = field => {
    const seen = new Set();
    const duplicates = new Set();
    for (const product of products) {
        const value = product[field];
        if (!nonEmpty(value)) continue;
        if (seen.has(value)) duplicates.add(value);
        seen.add(value);
    }
    return duplicates.size;
};

const report = {
    schemaVersion: 1,
    snapshotId: 'prod-admin-2026-09-20',
    generatedAtUtc: new Date().toISOString(),
    source: {
        kind: 'authenticated-admin-ui-download',
        host: 'admin.xnata.com',
        page: '/ru-RU/catalogs/0be5b4fc-651b-4953-87d8-08d976ddb13d/imports',
        catalogId: '0be5b4fc-651b-4953-87d8-08d976ddb13d',
        catalogCode: 'CATALOG-CHINESE-TEA',
        catalogName: 'Китайский чай',
        capturedAtUtc: '2026-09-20T22:19:00Z',
        capturedAtEvidence: 'download filename products_20260920_221900.json; exact server event time was not exposed by the UI',
        workspaceId: null,
        workspaceLabel: 'XNATA Platform',
        workspaceEvidence: 'authenticated UI commercial profile; UUID is intentionally unresolved',
        completeExport: true,
        pagination: 'single downloaded system export; UI catalog count matched 526 products',
        liveTemplateEvidence: {
            specifications: 'No specifications yet for this catalog.',
            variantAttributes: 'No variant attributes yet for this catalog.',
        },
    },
    files: {
        products: {
            path: productsFile,
            sha256: sha256(productsFile),
            bytes: fs.statSync(productsFile).size,
        },
        template: {
            path: templateFile,
            sha256: sha256(templateFile),
            bytes: fs.statSync(templateFile).size,
        },
    },
    coverage: {
        products: products.length,
        productIds: new Set(products.map(product => product.id).filter(nonEmpty)).size,
        productCodes: new Set(products.map(product => product.code).filter(nonEmpty)).size,
        productSkus: new Set(products.map(product => product.sku).filter(nonEmpty)).size,
        duplicateIds: duplicateCount('id'),
        duplicateCodes: duplicateCount('code'),
        duplicateSkus: duplicateCount('sku'),
        specifications: specifications.length,
        productsWithSpecifications: products.filter(product => (product.specifications || []).length > 0).length,
        tags: products.reduce((sum, product) => sum + (product.tags || []).length, 0),
        packages: products.reduce((sum, product) => sum + (product.packages || []).length, 0),
        catalogs: products.reduce((sum, product) => sum + (product.catalogs || []).length, 0),
        origins: products.reduce((sum, product) => sum + (product.origins || []).length, 0),
        related: products.reduce((sum, product) => sum + (product.related || []).length, 0),
        crossSells: products.reduce((sum, product) => sum + (product.crossSells || []).length, 0),
    },
    specificationCoverage: {
        types: countBy(specifications, specification => specification.type),
        groups: countBy(specifications, specification => specification.group),
        distinctAttributes: new Set(specifications.map(specification => specification.attribute).filter(nonEmpty)).size,
        distinctOptions: new Set(specifications.map(specification => specification.option).filter(nonEmpty)).size,
        valuePresent: specifications.filter(specification => nonEmpty(specification.value)).length,
        valueMinPresent: specifications.filter(specification => nonEmpty(specification.valueMin)).length,
        valueMaxPresent: specifications.filter(specification => nonEmpty(specification.valueMax)).length,
        showOnPageTrue: specifications.filter(specification => specification.showOnPage === true).length,
        showOnPageFalse: specifications.filter(specification => specification.showOnPage === false).length,
    },
    exchangeTemplate: {
        rows: template.length,
        columns: Object.keys(template[0]).length,
        specificationColumns: Object.keys(template[0]).filter(key => key.startsWith('specs.')),
    },
    preparationStatus: {
        sourceExport: 'captured-and-hashed',
        generatedArtifact: 'not generated: source snapshot is the current phase output',
        productionWrite: false,
        workspaceResolution: 'blocked: authenticated UI exposes label but not UUID; no guessed value is recorded',
    },
};

fs.mkdirSync(require('path').dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${outputFile}`);
