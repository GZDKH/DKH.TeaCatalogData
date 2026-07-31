const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SELECTED_FOLDER = '1 photo ready';
const GALLERY_FOLDER = path.join('готовые', 'png');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sortStrings(values) {
    return [...values].sort((left, right) => {
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
    });
}

function normalizeText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase('ru-RU')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function normalizeTranscription(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

function parsePhotoFolderName(folderName) {
    const value = String(folderName || '').normalize('NFC').trim();
    const match = /^(?<family>.+?)-(?<index>\d+)\.(?<russian>.+?)\s+\((?<native>[^,，]+)[,，]\s*(?<transcription>[^)]+)\)$/.exec(value);
    if (!match) {
        throw new Error(`Invalid photo folder label: ${folderName}`);
    }
    return {
        folderName,
        family: match.groups.family.trim(),
        index: Number(match.groups.index),
        russian: match.groups.russian.trim(),
        native: match.groups.native.trim(),
        transcription: match.groups.transcription.trim(),
    };
}

function translation(product, locales) {
    const wanted = new Set(locales.map(locale => locale.toLowerCase()));
    return (product.translations || []).find(item =>
        wanted.has(String(item?.lang || '').toLowerCase())) || null;
}

function productMatchFacts(product) {
    const russian = translation(product, ['ru-RU', 'ru']);
    const native = translation(product, ['zh-CN', 'zh-Hans', 'zh']);
    const transcription = russian?.transcription
        || translation(product, ['en-US', 'en'])?.transcription
        || native?.transcription
        || '';
    const code = String(product.code || '').trim();
    if (!/^[A-Z0-9][A-Z0-9_-]*$/i.test(code)) {
        throw new Error(`Unsafe or invalid product code: ${product.code}`);
    }
    return {
        product,
        code,
        russian: russian?.name || '',
        native: native?.name || '',
        transcription,
    };
}

function matchPhotoFolder(folder, products) {
    const facts = products.map(productMatchFacts);
    const russian = normalizeText(folder.russian);
    const native = normalizeText(folder.native);
    const transcription = normalizeTranscription(folder.transcription);
    if (!transcription) {
        throw new Error(`Photo folder has no usable transcription: '${folder.folderName}'.`);
    }

    let candidates = facts.filter(item =>
        normalizeTranscription(item.transcription) === transcription);
    if (!candidates.length) {
        throw new Error(`No transcription match for '${folder.folderName}'.`);
    }
    if (candidates.length === 1) {
        return { ...candidates[0], method: 'transcription' };
    }

    const russianMatches = candidates.filter(item =>
        russian && normalizeText(item.russian) === russian);
    if (russianMatches.length === 1) {
        return { ...russianMatches[0], method: 'transcription+russian' };
    }
    if (russianMatches.length > 1) candidates = russianMatches;

    const nativeMatches = candidates.filter(item =>
        native && normalizeText(item.native) === native);
    if (nativeMatches.length === 1) {
        return { ...nativeMatches[0], method: 'transcription+native' };
    }
    if (nativeMatches.length > 1) candidates = nativeMatches;

    throw new Error(
        `Ambiguous transcription match for '${folder.folderName}': `
        + candidates.map(item => item.code).sort().join(', '));
}

function assertRealDirectory(dir, label) {
    if (!fs.existsSync(dir)) throw new Error(`${label} does not exist: ${dir}`);
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${label} must be a real directory: ${dir}`);
    }
}

function directFiles(dir, predicate) {
    assertRealDirectory(dir, 'Photo directory');
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error(`Photo source must not contain symlinks: ${full}`);
        }
        if (entry.isFile() && predicate(full)) files.push(full);
    }
    return sortStrings(files);
}

function isPng(file) {
    return path.extname(file).toLowerCase() === '.png';
}

function assertPng(file) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < PNG_SIGNATURE.length) {
        throw new Error(`Invalid PNG file: ${file}`);
    }
    const header = Buffer.alloc(PNG_SIGNATURE.length);
    const descriptor = fs.openSync(file, 'r');
    try {
        fs.readSync(descriptor, header, 0, header.length, 0);
    } finally {
        fs.closeSync(descriptor);
    }
    if (!header.equals(PNG_SIGNATURE)) {
        throw new Error(`Invalid PNG signature: ${file}`);
    }
    return {
        bytes: stat.size,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    };
}

function selectPhotoAssets(photoRoot, folderName) {
    const selectedDir = path.join(photoRoot, SELECTED_FOLDER, folderName);
    const selected = directFiles(selectedDir, isPng);
    if (selected.length !== 1) {
        throw new Error(
            `Expected exactly one selected PNG in '${folderName}', found ${selected.length}.`);
    }

    const galleryDir = path.join(photoRoot, folderName, GALLERY_FOLDER);
    const galleryExists = fs.existsSync(galleryDir);
    const gallery = galleryExists ? directFiles(galleryDir, isPng) : [];
    if (galleryExists && !gallery.length) {
        throw new Error(`Gallery has no PNG files: ${galleryDir}`);
    }
    let assets;
    let kind;
    if (gallery.length) {
        const selectedName = path.basename(selected[0]).toLowerCase();
        const covers = gallery.filter(file => path.basename(file).toLowerCase() === selectedName);
        if (covers.length !== 1) {
            throw new Error(
                `Selected cover '${path.basename(selected[0])}' is not unique in gallery `
                + `'${folderName}'.`);
        }
        assets = [selected[0], ...gallery.filter(file => file !== covers[0])];
        kind = 'gallery';
    } else {
        assets = selected;
        kind = 'cover-only';
    }

    const seen = new Set();
    const records = assets.map((sourcePath, index) => {
        const realPath = fs.realpathSync(sourcePath);
        if (seen.has(realPath)) throw new Error(`Duplicate PNG source: ${sourcePath}`);
        seen.add(realPath);
        const verified = assertPng(realPath);
        const sourceName = path.basename(sourcePath);
        return {
            sourcePath: realPath,
            sourceName,
            outputName: index === 0
                ? '00-cover.png'
                : `${String(index).padStart(2, '0')}-${sourceName}`,
            bytes: verified.bytes,
            sha256: verified.sha256,
            isCover: index === 0,
        };
    });
    return { kind, assets: records };
}

function walkProductFiles(dir) {
    assertRealDirectory(dir, 'Product artifact directory');
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error(`Product artifact must not contain symlinks: ${full}`);
        }
        if (entry.isDirectory()) files.push(...walkProductFiles(full));
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) files.push(full);
    }
    return sortStrings(files);
}

function loadProducts(artifactDir) {
    const productDir = path.join(artifactDir, '04-products');
    const products = [];
    for (const file of walkProductFiles(productDir)) {
        const payload = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        if (!Array.isArray(payload) || payload.length !== 1 || !payload[0]?.code) {
            throw new Error(`Expected one product record in ${file}`);
        }
        products.push(payload[0]);
    }
    const codes = new Set();
    for (const product of products) {
        const code = String(product.code).trim().toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(code)) {
            throw new Error(`Unsafe or invalid product code in artifact: ${product.code}`);
        }
        if (codes.has(code)) throw new Error(`Duplicate product code in artifact: ${code}`);
        codes.add(code);
    }
    return products;
}

function listPhotoFolders(photoRoot) {
    const selectedRoot = path.join(photoRoot, SELECTED_FOLDER);
    assertRealDirectory(selectedRoot, 'Selected photo root');
    const folders = [];
    for (const entry of fs.readdirSync(selectedRoot, { withFileTypes: true })) {
        const full = path.join(selectedRoot, entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error(`Selected photo root must not contain symlinks: ${full}`);
        }
        if (entry.isDirectory()) folders.push(entry.name);
    }
    return sortStrings(folders);
}

function assertNoOrphanGalleries(photoRoot, selectedFolders) {
    const selected = new Set(selectedFolders);
    for (const entry of fs.readdirSync(photoRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === SELECTED_FOLDER) continue;
        const galleryDir = path.join(photoRoot, entry.name, GALLERY_FOLDER);
        if (fs.existsSync(galleryDir) && !selected.has(entry.name)) {
            throw new Error(`Gallery has no selected cover folder: ${entry.name}`);
        }
    }
}

function buildPhotoMapping({ artifactDir, photoRoot }) {
    assertRealDirectory(artifactDir, 'Artifact');
    assertRealDirectory(photoRoot, 'Photo root');
    const products = loadProducts(artifactDir);
    const records = [];
    const matchedCodes = new Set();
    const contentHashes = new Map();
    const photoFolders = listPhotoFolders(photoRoot);
    assertNoOrphanGalleries(photoRoot, photoFolders);

    for (const folderName of photoFolders) {
        const folder = parsePhotoFolderName(folderName);
        const matched = matchPhotoFolder(folder, products);
        const code = matched.code.toUpperCase();
        if (matchedCodes.has(code)) {
            throw new Error(`Multiple photo folders map to product ${code}.`);
        }
        matchedCodes.add(code);
        const selected = selectPhotoAssets(photoRoot, folderName);
        for (const asset of selected.assets) {
            const existing = contentHashes.get(asset.sha256);
            if (existing) {
                throw new Error(
                    `Duplicate PNG content: ${existing} and ${code}/${asset.sourceName}.`);
            }
            contentHashes.set(asset.sha256, `${code}/${asset.sourceName}`);
        }
        records.push({
            productCode: matched.code,
            folder,
            matchMethod: matched.method,
            productNames: {
                russian: matched.russian,
                native: matched.native,
                transcription: matched.transcription,
            },
            mediaKind: selected.kind,
            assets: selected.assets,
        });
    }

    records.sort((left, right) => left.productCode.localeCompare(right.productCode));
    const unmatchedProductCodes = products
        .map(product => String(product.code).trim())
        .filter(code => !matchedCodes.has(code.toUpperCase()))
        .sort();
    const imageCount = records.reduce((sum, record) => sum + record.assets.length, 0);
    const bytes = records.reduce(
        (sum, record) => sum + record.assets.reduce((itemSum, asset) => itemSum + asset.bytes, 0),
        0);
    return {
        summary: {
            productsTotal: products.length,
            matchedProducts: records.length,
            unmatchedProducts: unmatchedProductCodes.length,
            galleries: records.filter(record => record.mediaKind === 'gallery').length,
            coverOnly: records.filter(record => record.mediaKind === 'cover-only').length,
            imageCount,
            uniqueContentHashes: contentHashes.size,
            bytes,
        },
        records,
        unmatchedProductCodes,
    };
}

function reportForDisk(mapping, { artifactDir, photoRoot }) {
    return {
        schema: 'thetea-product-photo-mapping/v1',
        generatedAt: new Date().toISOString(),
        artifactDir: path.resolve(artifactDir),
        photoRoot: path.resolve(photoRoot),
        summary: mapping.summary,
        records: mapping.records.map(record => ({
            productCode: record.productCode,
            sourceFolder: record.folder.folderName,
            sourceLabel: {
                family: record.folder.family,
                index: record.folder.index,
                russian: record.folder.russian,
                native: record.folder.native,
                transcription: record.folder.transcription,
            },
            matchMethod: record.matchMethod,
            productNames: record.productNames,
            mediaKind: record.mediaKind,
            imageCount: record.assets.length,
            bytes: record.assets.reduce((sum, asset) => sum + asset.bytes, 0),
            cover: path.relative(photoRoot, record.assets[0].sourcePath).split(path.sep).join('/'),
            assets: record.assets.map(asset => ({
                source: path.relative(photoRoot, asset.sourcePath).split(path.sep).join('/'),
                output: `${record.productCode}/${asset.outputName}`,
                bytes: asset.bytes,
                sha256: asset.sha256,
                isCover: asset.isCover,
            })),
        })),
        unmatchedProductCodes: mapping.unmatchedProductCodes,
    };
}

function materializePhotoMedia(mapping, { outputDir, artifactDir, photoRoot }) {
    const resolvedOutput = path.resolve(outputDir);
    if (fs.existsSync(resolvedOutput)) {
        throw new Error(`Output already exists; refusing to replace it: ${resolvedOutput}`);
    }
    const parent = path.dirname(resolvedOutput);
    fs.mkdirSync(parent, { recursive: true });
    const staging = path.join(
        parent,
        `.${path.basename(resolvedOutput)}.staging-${process.pid}-${Date.now()}`);
    fs.mkdirSync(staging);
    try {
        for (const record of mapping.records) {
            const productDir = path.join(staging, record.productCode);
            fs.mkdirSync(productDir);
            for (const asset of record.assets) {
                const destination = path.join(productDir, asset.outputName);
                try {
                    fs.linkSync(asset.sourcePath, destination);
                } catch (error) {
                    if (!['EXDEV', 'EPERM', 'EACCES'].includes(error.code)) throw error;
                    fs.copyFileSync(asset.sourcePath, destination);
                }
            }
        }
        const report = reportForDisk(mapping, { artifactDir, photoRoot });
        fs.writeFileSync(
            path.join(staging, 'photo-mapping.json'),
            `${JSON.stringify(report, null, 2)}\n`);
        fs.renameSync(staging, resolvedOutput);
        return report;
    } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw error;
    }
}

module.exports = {
    buildPhotoMapping,
    loadProducts,
    matchPhotoFolder,
    materializePhotoMedia,
    normalizeText,
    normalizeTranscription,
    parsePhotoFolderName,
    reportForDisk,
    selectPhotoAssets,
};
