const { DEFAULT_CATALOG_CODE } = require('./catalog-mapping');

function resolveArtifactCatalogPolicy(manifest = {}, args = {}) {
    const targets = manifest.targets || {};
    const catalogCodes = Array.isArray(targets.catalogCodes)
        ? targets.catalogCodes.map(normalizeCode).filter(Boolean)
        : [];
    const manifestCatalog = catalogCodes[0] || '';
    const requestedCatalog = normalizeCode(args.catalog);

    if (manifestCatalog && requestedCatalog && manifestCatalog !== requestedCatalog) {
        throw new Error(
            `Requested catalog ${requestedCatalog} differs from artifact target ${manifestCatalog}.`);
    }

    const targetCatalog = manifestCatalog || requestedCatalog || DEFAULT_CATALOG_CODE;
    const catalogAssignmentMode = targets.catalogAssignmentMode || 'preserve';

    return {
        targetCatalog,
        catalogAssignmentMode,
        baselinePreservation: {
            catalogAssignmentMode,
            targetCatalog,
        },
        allowedCatalogCodes: catalogAssignmentMode === 'target-only'
            ? [targetCatalog]
            : undefined,
    };
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
}

module.exports = {
    resolveArtifactCatalogPolicy,
};
