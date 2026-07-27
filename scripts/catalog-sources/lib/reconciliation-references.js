'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WORKSPACE_ID_PATTERN } = require('../../thetea/lib/catalog-workspace');
const {
    PRODUCT_REFERENCE_MANIFEST_FILE,
    loadVerifiedProductReference,
} = require('../../thetea/lib/product-reference');

const CATALOG_COLLECTIONS = Object.freeze([
    'catalogs',
    'categories',
    'specificationGroups',
    'specificationAttributes',
    'specificationAttributeOptions',
]);

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function requireCanonicalTimestamp(value, label) {
    if (typeof value !== 'string') {
        throw new Error(`${label} must be a canonical UTC timestamp.`);
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
        throw new Error(`${label} must be a canonical UTC timestamp.`);
    }
    return value;
}

function requireWorkspaceId(value, label) {
    const workspaceId = String(value || '');
    if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        throw new Error(`${label} must be a UUID.`);
    }
    return workspaceId.toLowerCase();
}

function requireCatalogReferenceFile(inputPath) {
    const resolved = path.resolve(inputPath);
    let stat;
    try {
        stat = fs.lstatSync(resolved);
    } catch (error) {
        throw new Error(`Catalog reference must be an existing regular JSON file: ${resolved}`, {
            cause: error,
        });
    }
    if (stat.isSymbolicLink() || !stat.isFile() || path.extname(resolved).toLowerCase() !== '.json') {
        throw new Error(`Catalog reference must be a non-symlink regular JSON file: ${resolved}`);
    }
    return resolved;
}

function requireCompleteCodedCollection(reference, collectionName) {
    const records = reference[collectionName];
    if (!Array.isArray(records) || records.length === 0) {
        throw new Error(`Catalog reference ${collectionName} must be a non-empty array.`);
    }

    const seen = new Set();
    for (const [index, record] of records.entries()) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
            throw new Error(`Catalog reference ${collectionName}[${index}] must be an object.`);
        }
        if (typeof record.code !== 'string' || !record.code.trim()) {
            throw new Error(`Catalog reference ${collectionName}[${index}] has no code.`);
        }
        const code = record.code.trim().toUpperCase();
        if (seen.has(code)) {
            throw new Error(`Catalog reference ${collectionName} contains duplicate code ${code}.`);
        }
        seen.add(code);
    }
    return records;
}

function parseCatalogReference(catalogReferencePath) {
    const file = requireCatalogReferenceFile(catalogReferencePath);
    const buffer = fs.readFileSync(file);
    let reference;
    try {
        reference = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
        throw new Error(`Catalog reference is not valid JSON: ${error.message}`, { cause: error });
    }
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
        throw new Error('Catalog reference must be a JSON object.');
    }

    const workspaceId = requireWorkspaceId(
        reference.workspaceId,
        'Catalog reference workspaceId');
    const fetchedAt = requireCanonicalTimestamp(
        reference.fetchedAt,
        'Catalog reference fetchedAt');
    const collections = Object.fromEntries(
        CATALOG_COLLECTIONS.map(name => [
            name,
            requireCompleteCodedCollection(reference, name),
        ]));
    return {
        file,
        buffer,
        reference,
        workspaceId,
        fetchedAt,
        collections,
    };
}

function loadReconciliationReferences({ productReferencePath, catalogReferencePath } = {}) {
    if (!productReferencePath || !catalogReferencePath) {
        throw new Error('Both productReferencePath and catalogReferencePath are required.');
    }

    const productReference = loadVerifiedProductReference(productReferencePath);
    const productWorkspaceId = requireWorkspaceId(
        productReference.manifest.workspaceId,
        'Product reference workspaceId');
    const productFetchedAt = requireCanonicalTimestamp(
        productReference.manifest.fetchedAt,
        'Product reference fetchedAt');
    const catalogReference = parseCatalogReference(catalogReferencePath);
    if (productWorkspaceId !== catalogReference.workspaceId) {
        throw new Error('Product and catalog references belong to different workspaces.');
    }

    const productManifestFile = path.join(
        productReference.root,
        PRODUCT_REFERENCE_MANIFEST_FILE);
    const productManifestBuffer = fs.readFileSync(productManifestFile);
    const productManifestSha256 = sha256(productManifestBuffer);
    const productReferenceTreeSha256 = sha256(Buffer.from(
        `${productManifestSha256}\n${productReference.manifest.productsSha256}\n`,
    ));
    const counts = {
        products: productReference.products.length,
        ...Object.fromEntries(
            CATALOG_COLLECTIONS.map(name => [
                name,
                catalogReference.collections[name].length,
            ])),
    };

    return {
        workspaceId: productWorkspaceId,
        fetchedAt: {
            products: productFetchedAt,
            catalog: catalogReference.fetchedAt,
        },
        productReference: {
            manifest: productReference.manifest,
            products: productReference.products,
        },
        products: productReference.products,
        catalogReference: catalogReference.reference,
        ...catalogReference.collections,
        evidence: {
            hashes: {
                productManifestSha256,
                productReferenceTreeSha256,
                productsSha256: productReference.manifest.productsSha256,
                productCodesSha256: productReference.manifest.productCodesSha256,
                catalogReferenceSha256: sha256(catalogReference.buffer),
            },
            counts,
        },
    };
}

module.exports = {
    CATALOG_COLLECTIONS,
    loadReconciliationReferences,
};
