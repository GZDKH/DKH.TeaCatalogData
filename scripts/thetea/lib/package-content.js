const MANAGED_PACKAGE_CONTENT = Object.freeze({
    'PKG-25G': Object.freeze({
        package: 'PKG-25G',
        packageName: '25g',
        packageUnit: 'g',
        quantity: 25,
        default: false,
    }),
    'PKG-50G': Object.freeze({
        package: 'PKG-50G',
        packageName: '50g',
        packageUnit: 'g',
        quantity: 50,
        default: true,
    }),
    'PKG-100G': Object.freeze({
        package: 'PKG-100G',
        packageName: '100g',
        packageUnit: 'g',
        quantity: 100,
        default: false,
    }),
    'PKG-250G': Object.freeze({
        package: 'PKG-250G',
        packageName: '250g',
        packageUnit: 'g',
        quantity: 250,
        default: false,
    }),
    'PKG-500G': Object.freeze({
        package: 'PKG-500G',
        packageName: '500g',
        packageUnit: 'g',
        quantity: 500,
        default: false,
    }),
});

const DEFAULT_PACKAGE_CODES = Object.freeze(['PKG-50G']);
const STANDARD_PACKAGE_CODES = Object.freeze([
    'PKG-25G',
    'PKG-50G',
    'PKG-100G',
    'PKG-250G',
    'PKG-500G',
]);

function packageDefinitionsFor(profile = 'default') {
    const normalizedProfile = String(profile || 'default').trim().toLowerCase();
    let codes;
    if (normalizedProfile === 'default') codes = DEFAULT_PACKAGE_CODES;
    else if (normalizedProfile === 'standard') codes = STANDARD_PACKAGE_CODES;
    else throw new Error(`Unsupported TheTea package profile '${profile}'.`);

    return codes.map(code => ({ ...MANAGED_PACKAGE_CONTENT[code] }));
}

function isManagedPackageCode(value) {
    return getManagedPackageContent(value) !== null;
}

function getManagedPackageContent(value) {
    const code = normalizePackageCode(value);
    return Object.prototype.hasOwnProperty.call(MANAGED_PACKAGE_CONTENT, code)
        ? MANAGED_PACKAGE_CONTENT[code]
        : null;
}

function normalizePackageCode(value) {
    let code = value;
    if (code && typeof code === 'object') code = code.package ?? code.code;
    if (code && typeof code === 'object') code = code.code;
    return String(code || '').trim().toUpperCase();
}

module.exports = {
    DEFAULT_PACKAGE_CODES,
    MANAGED_PACKAGE_CONTENT,
    STANDARD_PACKAGE_CODES,
    getManagedPackageContent,
    isManagedPackageCode,
    packageDefinitionsFor,
};
