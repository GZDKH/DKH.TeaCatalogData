const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ARTIFACT_MANIFEST_FILE = 'artifact-manifest.json';
const ARTIFACT_SCHEMA_VERSION = 1;

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createArtifactManifest(root, metadata = {}) {
    const resolvedRoot = path.resolve(root);
    const files = listArtifactFiles(resolvedRoot).map(relativePath => {
        const file = resolveArtifactPath(resolvedRoot, relativePath);
        const content = fs.readFileSync(file);
        return {
            path: relativePath,
            bytes: content.length,
            sha256: sha256(content),
        };
    });

    const manifest = {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        snapshotId: String(metadata.snapshotId || ''),
        sourceManifestSha256: String(metadata.sourceManifestSha256 || ''),
        sourceFilesSha256: String(metadata.sourceFilesSha256 || ''),
        catalogReferenceSha256: String(metadata.catalogReferenceSha256 || ''),
        baselineReferenceSha256: String(metadata.baselineReferenceSha256 || ''),
        generatedAt: metadata.generatedAt || new Date().toISOString(),
        requiredLocales: sortedUnique(metadata.requiredLocales),
        productCodes: sortedUnique(metadata.productCodes),
        products: [...(metadata.products || [])]
            .map(item => ({ code: String(item.code || ''), path: String(item.path || '') }))
            .sort((a, b) => a.code.localeCompare(b.code) || a.path.localeCompare(b.path)),
        lossEvents: [...(metadata.lossEvents || [])],
        localization: metadata.localization || null,
        files,
    };
    writeJson(path.join(resolvedRoot, ARTIFACT_MANIFEST_FILE), manifest);
    return manifest;
}

function verifyArtifactManifest(root) {
    const resolvedRoot = path.resolve(root);
    const errors = [];
    const manifestFile = path.join(resolvedRoot, ARTIFACT_MANIFEST_FILE);
    if (!fs.existsSync(manifestFile)) {
        return { valid: false, errors: [`Missing ${ARTIFACT_MANIFEST_FILE}.`], manifest: null };
    }
    if (fs.lstatSync(manifestFile).isSymbolicLink()) {
        return {
            valid: false,
            errors: [`${ARTIFACT_MANIFEST_FILE} must not be a symbolic link.`],
            manifest: null,
        };
    }

    let manifest;
    try {
        manifest = readJson(manifestFile);
    } catch (error) {
        return { valid: false, errors: [`Invalid ${ARTIFACT_MANIFEST_FILE}: ${error.message}`], manifest: null };
    }

    if (manifest.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
        errors.push(`Unsupported artifact schema version '${manifest.schemaVersion}'.`);
    }
    if (!Array.isArray(manifest.files)) errors.push('Artifact manifest files must be an array.');
    if (!Array.isArray(manifest.requiredLocales) || manifest.requiredLocales.length === 0) {
        errors.push('Artifact manifest requiredLocales must be a non-empty array.');
    }
    if (!Array.isArray(manifest.productCodes)) errors.push('Artifact manifest productCodes must be an array.');
    if (!Array.isArray(manifest.products)) errors.push('Artifact manifest products must be an array.');
    if (!Array.isArray(manifest.lossEvents)) errors.push('Artifact manifest lossEvents must be an array.');

    const expected = new Map();
    for (const [index, entry] of (Array.isArray(manifest.files) ? manifest.files : []).entries()) {
        const relativePath = String(entry?.path || '');
        if (!relativePath || expected.has(relativePath)) {
            errors.push(`Artifact manifest files[${index}] has a missing or duplicate path.`);
            continue;
        }

        let file;
        try {
            file = resolveArtifactPath(resolvedRoot, relativePath);
        } catch (error) {
            errors.push(error.message);
            continue;
        }
        expected.set(relativePath, entry);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
            errors.push(`Artifact file is missing: ${relativePath}.`);
            continue;
        }
        const content = fs.readFileSync(file);
        if (entry.bytes !== content.length) {
            errors.push(`Artifact file size differs from manifest: ${relativePath}.`);
        }
        if (entry.sha256 !== sha256(content)) {
            errors.push(`Artifact file hash differs from manifest: ${relativePath}.`);
        }
    }

    const actualFiles = listArtifactFiles(resolvedRoot);
    for (const relativePath of actualFiles) {
        if (!expected.has(relativePath)) errors.push(`Stale or untracked artifact file: ${relativePath}.`);
    }
    for (const relativePath of expected.keys()) {
        if (!actualFiles.includes(relativePath)) errors.push(`Manifest references absent artifact file: ${relativePath}.`);
    }

    return { valid: errors.length === 0, errors, manifest };
}

function readArtifactBundle(root) {
    const resolvedRoot = path.resolve(root);
    const manifestValidation = verifyArtifactManifest(resolvedRoot);
    const errors = [...manifestValidation.errors];
    const products = [];
    const productFiles = listArtifactFiles(resolvedRoot)
        .filter(file => file.startsWith('04-products/') && file.endsWith('.json'));

    for (const relativePath of productFiles) {
        try {
            const records = readJson(resolveArtifactPath(resolvedRoot, relativePath));
            if (!Array.isArray(records) || records.length !== 1) {
                errors.push(`${relativePath} must contain exactly one product record.`);
                continue;
            }
            products.push(records[0]);
        } catch (error) {
            errors.push(`Cannot read ${relativePath}: ${error.message}`);
        }
    }

    const definitions = {
        groups: readRequiredArray(
            resolvedRoot,
            '02-specifications/specification_groups.json',
            errors),
        attributes: readRequiredArray(
            resolvedRoot,
            '02-specifications/specification_attributes.json',
            errors),
        options: readRequiredArray(
            resolvedRoot,
            '02-specifications/specification_attribute_options.json',
            errors),
    };
    const routedContent = {
        articles: readRoutedRecords(resolvedRoot, 'articles', errors),
        metaobjects: readRoutedRecords(resolvedRoot, 'metaobjects', errors),
    };

    const actualCodes = sortedUnique(products.map(product => product?.code));
    const manifestCodes = sortedUnique(manifestValidation.manifest?.productCodes || []);
    if (JSON.stringify(actualCodes) !== JSON.stringify(manifestCodes)) {
        errors.push('Artifact product codes differ from artifact manifest productCodes.');
    }

    const productPathByCode = new Map();
    for (const item of manifestValidation.manifest?.products || []) {
        const code = String(item?.code || '').trim();
        const relativePath = String(item?.path || '').trim();
        if (!code || !relativePath || productPathByCode.has(code)) {
            errors.push('Artifact manifest products contain a missing or duplicate code/path.');
            continue;
        }
        productPathByCode.set(code, relativePath);
    }
    if (productPathByCode.size !== productFiles.length) {
        errors.push('Artifact manifest product path count differs from product file count.');
    }
    for (const relativePath of productFiles) {
        try {
            const records = readJson(resolveArtifactPath(resolvedRoot, relativePath));
            if (Array.isArray(records) && records.length === 1) {
                const code = String(records[0]?.code || '').trim();
                if (productPathByCode.get(code) !== relativePath) {
                    errors.push(`${relativePath} does not match its artifact manifest product path.`);
                }
            }
        } catch {
            // The earlier product reader already reports malformed JSON.
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        manifest: manifestValidation.manifest,
        products,
        definitions,
        routedContent,
        productFiles,
    };
}

function readRoutedRecords(root, kind, errors) {
    const indexPath = `06-routed-content/${kind}/index.json`;
    const index = readRequiredArray(root, indexPath, errors);
    const records = [];
    const indexedPaths = new Set();
    const indexedCodes = new Set();
    for (const [position, item] of index.entries()) {
        const code = String(item?.code || '').trim();
        const relativePath = String(item?.path || '').trim();
        if (!code || !relativePath || indexedCodes.has(code) || indexedPaths.has(relativePath)) {
            errors.push(`${indexPath}[${position}] has a missing or duplicate code/path.`);
            continue;
        }
        if (!relativePath.startsWith(`06-routed-content/${kind}/records/`)) {
            errors.push(`${indexPath}[${position}] points outside its routed record directory.`);
            continue;
        }
        indexedCodes.add(code);
        indexedPaths.add(relativePath);
        let value;
        try {
            value = readJson(resolveArtifactPath(root, relativePath));
        } catch (error) {
            errors.push(`Cannot read ${relativePath}: ${error.message}`);
            continue;
        }
        if (!Array.isArray(value) || value.length !== 1) {
            errors.push(`${relativePath} must contain exactly one routed record.`);
            continue;
        }
        if (String(value[0]?.code || '') !== code) {
            errors.push(`${relativePath} record code differs from its routed index code.`);
            continue;
        }
        records.push(value[0]);
    }

    const recordPrefix = `06-routed-content/${kind}/records/`;
    const actualPaths = listArtifactFiles(root)
        .filter(relativePath => relativePath.startsWith(recordPrefix) && relativePath.endsWith('.json'));
    for (const relativePath of actualPaths) {
        if (!indexedPaths.has(relativePath)) errors.push(`Unindexed routed record file: ${relativePath}.`);
    }
    for (const relativePath of indexedPaths) {
        if (!actualPaths.includes(relativePath)) errors.push(`Missing routed record file: ${relativePath}.`);
    }
    return records;
}

function readRequiredArray(root, relativePath, errors) {
    let file;
    try {
        file = resolveArtifactPath(root, relativePath);
    } catch (error) {
        errors.push(error.message);
        return [];
    }
    if (!fs.existsSync(file)) {
        errors.push(`Required artifact file is missing: ${relativePath}.`);
        return [];
    }
    try {
        const value = readJson(file);
        if (!Array.isArray(value)) throw new Error('root value must be an array');
        return value;
    } catch (error) {
        errors.push(`Cannot read ${relativePath}: ${error.message}`);
        return [];
    }
}

function listArtifactFiles(root) {
    if (!fs.existsSync(root)) return [];
    const rootStat = fs.lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
        throw new Error(`Artifact root must be a real directory: ${root}`);
    }
    const result = [];
    walk(root, root, result);
    return result
        .filter(relativePath => relativePath !== ARTIFACT_MANIFEST_FILE)
        .sort();
}

function walk(root, directory, result) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error(`Artifact must not contain symbolic links: ${toPosix(path.relative(root, full))}`);
        }
        if (entry.isDirectory()) walk(root, full, result);
        else if (entry.isFile()) result.push(toPosix(path.relative(root, full)));
    }
}

function resolveArtifactPath(root, relativePath) {
    if (path.isAbsolute(relativePath)) throw new Error(`Artifact path must be relative: ${relativePath}.`);
    const resolved = path.resolve(root, relativePath);
    const prefix = `${path.resolve(root)}${path.sep}`;
    if (!resolved.startsWith(prefix)) throw new Error(`Artifact path escapes output root: ${relativePath}.`);
    return resolved;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function sortedUnique(values) {
    return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))].sort();
}

function toPosix(value) {
    return value.split(path.sep).join('/');
}

module.exports = {
    ARTIFACT_MANIFEST_FILE,
    ARTIFACT_SCHEMA_VERSION,
    createArtifactManifest,
    readArtifactBundle,
    sha256,
    verifyArtifactManifest,
    writeJson,
};
