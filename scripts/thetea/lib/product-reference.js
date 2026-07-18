const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sha256, writeJson } = require('./artifact-bundle');
const { WORKSPACE_ID_PATTERN } = require('./catalog-workspace');

const PRODUCT_REFERENCE_MANIFEST_FILE = 'product-reference-manifest.json';
const PRODUCT_REFERENCE_SCHEMA_VERSION = 1;
const PRODUCT_REFERENCE_DATA_FILE = 'products.json';
const REPLACE_MODE_COLLECTIONS = [
    'translations',
    'specifications',
    'tags',
    'tierPrices',
    'catalogPrices',
    'storePriceOverrides',
    'packages',
    'catalogs',
    'origins',
    'related',
    'crossSells',
];

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
}

function productCodesSha256(products) {
    const codes = products.map(product => normalizeCode(product?.code)).sort();
    return crypto.createHash('sha256').update(`${codes.join('\n')}\n`).digest('hex');
}

function validateProductArray(value, label = 'Product reference') {
    if (!Array.isArray(value)) throw new Error(`${label} must be a top-level JSON array.`);
    if (value.length === 0) throw new Error(`${label} must contain at least one product.`);

    const seen = new Set();
    for (const [index, product] of value.entries()) {
        if (!product || typeof product !== 'object' || Array.isArray(product)) {
            throw new Error(`${label}[${index}] must be an object.`);
        }
        const code = normalizeCode(product.code);
        if (!code) throw new Error(`${label}[${index}] has no product code.`);
        if (seen.has(code)) throw new Error(`${label} contains duplicate product code ${code}.`);
        seen.add(code);
        for (const field of REPLACE_MODE_COLLECTIONS) {
            if (!Array.isArray(product[field])) {
                throw new Error(
                    `${label}[${index}] ${code} is not a complete nested products export: ${field} must be an array.`);
            }
        }
    }
    return value;
}

function assertNotSymlink(target, label) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${target}`);
    return stat;
}

function resolveContainedFile(root, relativePath, label) {
    if (path.isAbsolute(relativePath)) throw new Error(`${label} path must be relative.`);
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, relativePath);
    if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(`${label} path escapes the product reference directory.`);
    }
    assertNotSymlink(resolved, label);
    if (!fs.statSync(resolved).isFile()) throw new Error(`${label} must be a regular file.`);
    return resolved;
}

function createProductReferenceManifest({ products, productsBuffer, workspaceId, fetchedAt }) {
    validateProductArray(products);
    if (!WORKSPACE_ID_PATTERN.test(String(workspaceId || ''))) {
        throw new Error('A valid ProductCatalog workspace id is required for the product reference manifest.');
    }
    return {
        schemaVersion: PRODUCT_REFERENCE_SCHEMA_VERSION,
        complete: true,
        source: 'AdminGateway ProductCatalog DataExchange export/stream',
        profile: 'products',
        format: 'json',
        workspaceId: String(workspaceId || '').toLowerCase(),
        fetchedAt: fetchedAt || new Date().toISOString(),
        productFile: PRODUCT_REFERENCE_DATA_FILE,
        productCount: products.length,
        productsSha256: sha256(productsBuffer),
        productCodesSha256: productCodesSha256(products),
    };
}

function writeProductReference(root, products, metadata = {}) {
    validateProductArray(products);
    const productsFile = path.join(root, PRODUCT_REFERENCE_DATA_FILE);
    writeJson(productsFile, products);
    const productsBuffer = fs.readFileSync(productsFile);
    const manifest = createProductReferenceManifest({
        products,
        productsBuffer,
        workspaceId: metadata.workspaceId,
        fetchedAt: metadata.fetchedAt,
    });
    writeJson(path.join(root, PRODUCT_REFERENCE_MANIFEST_FILE), manifest);
    return manifest;
}

function loadVerifiedProductReference(inputPath) {
    const resolvedInput = path.resolve(inputPath);
    const inputStat = assertNotSymlink(resolvedInput, 'Product reference input');
    if (!inputStat.isDirectory()) {
        throw new Error('Product reference input must be the directory containing products.json and its manifest.');
    }
    const root = resolvedInput;
    const expectedFiles = [PRODUCT_REFERENCE_DATA_FILE, PRODUCT_REFERENCE_MANIFEST_FILE].sort();
    const actualFiles = fs.readdirSync(root, { withFileTypes: true }).map(entry => {
        if (entry.isSymbolicLink() || !entry.isFile()) {
            throw new Error(`Product reference directory contains a non-file entry: ${entry.name}.`);
        }
        return entry.name;
    }).sort();
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
        throw new Error(
            `Product reference directory must contain exactly ${expectedFiles.join(' and ')}.`);
    }
    const manifestPath = path.join(root, PRODUCT_REFERENCE_MANIFEST_FILE);
    assertNotSymlink(manifestPath, 'Product reference manifest');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));

    const errors = [];
    if (manifest.schemaVersion !== PRODUCT_REFERENCE_SCHEMA_VERSION) {
        errors.push(`unsupported schemaVersion '${manifest.schemaVersion}'`);
    }
    if (manifest.complete !== true) errors.push('complete must be true');
    if (manifest.profile !== 'products') errors.push("profile must be 'products'");
    if (manifest.format !== 'json') errors.push("format must be 'json'");
    if (!WORKSPACE_ID_PATTERN.test(String(manifest.workspaceId || ''))) {
        errors.push('workspaceId must be a UUID');
    }
    if (!Number.isInteger(manifest.productCount) || manifest.productCount < 1) {
        errors.push('productCount must be a positive integer');
    }
    if (errors.length) throw new Error(`Invalid product reference manifest: ${errors.join('; ')}.`);

    const productFile = resolveContainedFile(
        root,
        String(manifest.productFile || ''),
        'Product reference data');
    const productsBuffer = fs.readFileSync(productFile);
    if (sha256(productsBuffer) !== manifest.productsSha256) {
        throw new Error('Product reference data hash differs from its manifest.');
    }
    const products = validateProductArray(
        JSON.parse(productsBuffer.toString('utf8').replace(/^\uFEFF/, '')));
    if (products.length !== manifest.productCount) {
        throw new Error('Product reference count differs from its manifest.');
    }
    if (productCodesSha256(products) !== manifest.productCodesSha256) {
        throw new Error('Product reference code-set hash differs from its manifest.');
    }
    return { products, manifest, root, productFile };
}

module.exports = {
    PRODUCT_REFERENCE_DATA_FILE,
    PRODUCT_REFERENCE_MANIFEST_FILE,
    PRODUCT_REFERENCE_SCHEMA_VERSION,
    REPLACE_MODE_COLLECTIONS,
    createProductReferenceManifest,
    loadVerifiedProductReference,
    productCodesSha256,
    validateProductArray,
    writeProductReference,
};
