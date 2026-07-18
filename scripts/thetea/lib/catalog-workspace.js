const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveCatalogWorkspaceId(args = {}, options = {}) {
    const value = args['workspace-id']
        || process.env.PRODUCT_CATALOG_WORKSPACE_ID
        || process.env.CATALOG_WORKSPACE_ID
        || '';
    const workspaceId = String(value).trim();
    if (!workspaceId) {
        if (options.required === false) return '';
        throw new Error(
            'ProductCatalog workspace is required. Pass --workspace-id=<uuid> or set PRODUCT_CATALOG_WORKSPACE_ID.');
    }
    if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
        throw new Error(`Invalid ProductCatalog workspace id '${workspaceId}'.`);
    }
    return workspaceId.toLowerCase();
}

function catalogWorkspaceHeader(workspaceId) {
    if (!WORKSPACE_ID_PATTERN.test(String(workspaceId || ''))) {
        throw new Error('Cannot build ProductCatalog headers without a valid workspace id.');
    }
    return { 'X-Workspace-Id': String(workspaceId).toLowerCase() };
}

module.exports = {
    WORKSPACE_ID_PATTERN,
    catalogWorkspaceHeader,
    resolveCatalogWorkspaceId,
};
