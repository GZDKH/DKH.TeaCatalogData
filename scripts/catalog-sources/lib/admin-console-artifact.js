'use strict';

const fs = require('fs');
const path = require('path');
const {
    createArtifactManifest,
    readArtifactBundle,
    verifyArtifactManifest,
} = require('../../thetea/lib/artifact-bundle');
const {
    readJson,
    sha256,
    stableJson,
    writeJsonAtomic,
} = require('./artifacts');
const {
    assertBundleBindings,
    cloneFile,
} = require('./import-bundle');

const CATALOG_CODE = 'CATALOG-PUERH';
const DATA_IMPORT_BATCH_MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([
    '.avif',
    '.gif',
    '.jpeg',
    '.jpg',
    '.png',
    '.svg',
    '.webp',
]);
const REQUIRED_JSON_FILES = new Set([
    '01-reference/catalogs.json',
    '02-specifications/specification_groups.json',
    '02-specifications/specification_attributes.json',
    '02-specifications/specification_attribute_options.json',
    '03-categories/categories.json',
    '05-catalog-bindings/catalogs.json',
    '06-routed-content/articles/index.json',
    '06-routed-content/metaobjects/index.json',
    '07-media/products/media.json',
]);

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeCode(value) {
    const raw = value && typeof value === 'object' ? value.code : value;
    return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

function productNumber(code) {
    const match = /^ZZC-([1-9]\d*)$/.exec(code);
    return match ? BigInt(match[1]) : null;
}

function compareProductCodes(left, right) {
    const leftNumber = productNumber(left);
    const rightNumber = productNumber(right);
    if (leftNumber !== null && rightNumber !== null) {
        return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
    }
    return left.localeCompare(right, 'en');
}

function assertProductCode(value) {
    const code = normalizeCode(value);
    if (!/^ZZC-[1-9]\d*$/.test(code)) {
        throw new Error(`Invalid ZZCTea product code '${value}'.`);
    }
    return code;
}

function productCategory(product) {
    const categories = (product.catalogs || [])
        .filter(assignment => normalizeCode(assignment.catalog) === CATALOG_CODE)
        .map(assignment => normalizeCode(assignment.category))
        .filter(Boolean);
    for (const preferred of ['CAT-PUER-SHENG', 'CAT-PUER-SHU', 'CAT-PUER-TEA']) {
        if (categories.includes(preferred)) return preferred;
    }
    return categories.sort()[0] || 'CAT-PUER-UNCLASSIFIED';
}

function referencedSpecificationCodes(products) {
    const groups = new Set();
    const attributes = new Set();
    const options = new Set();
    for (const product of products) {
        for (const specification of product.specifications || []) {
            const group = normalizeCode(specification.group);
            const attribute = normalizeCode(specification.attribute);
            const option = normalizeCode(specification.option);
            if (group) groups.add(group);
            if (attribute) attributes.add(attribute);
            if (option) options.add(option);
        }
    }
    return { groups, attributes, options };
}

function selectDefinitions(products, catalogReference) {
    const referenced = referencedSpecificationCodes(products);
    const select = (records, codes) => (records || [])
        .filter(record => codes.has(normalizeCode(record.code)))
        .sort((left, right) =>
            normalizeCode(left.code).localeCompare(normalizeCode(right.code)));
    const definitions = {
        groups: select(catalogReference.specificationGroups, referenced.groups),
        attributes: select(
            catalogReference.specificationAttributes,
            referenced.attributes,
        ),
        options: select(
            catalogReference.specificationAttributeOptions,
            referenced.options,
        ),
    };
    for (const [kind, codes] of Object.entries(referenced)) {
        const records = kind === 'groups'
            ? definitions.groups
            : kind === 'attributes'
                ? definitions.attributes
                : definitions.options;
        if (records.length !== codes.size) {
            throw new Error(
                `Catalog reference does not cover every referenced specification ${kind}.`,
            );
        }
    }
    return definitions;
}

function buildCatalogDocuments(products, catalogReference) {
    const referenceCatalog = (catalogReference.catalogs || [])
        .find(record => normalizeCode(record.code) === CATALOG_CODE);
    if (!referenceCatalog) {
        throw new Error(`Catalog reference does not contain ${CATALOG_CODE}.`);
    }
    const categoryReference = new Map(
        (referenceCatalog.categories || [])
            .map(record => [normalizeCode(record.category), record]),
    );
    const categories = new Map();
    for (const product of products) {
        const productCode = assertProductCode(product.code);
        for (const assignment of product.catalogs || []) {
            if (normalizeCode(assignment.catalog) !== CATALOG_CODE) continue;
            const categoryCode = normalizeCode(assignment.category);
            if (!categoryReference.has(categoryCode)) {
                throw new Error(
                    `${productCode} references unavailable category ${categoryCode}.`,
                );
            }
            if (!categories.has(categoryCode)) categories.set(categoryCode, []);
            categories.get(categoryCode).push({
                product: productCode,
                order: Number.isSafeInteger(assignment.order)
                    ? assignment.order
                    : 0,
                published: assignment.published !== false,
            });
        }
    }
    const bindingCategories = [...categories.entries()]
        .map(([category, assignedProducts]) => {
            const reference = categoryReference.get(category);
            return {
                category,
                order: Number.isSafeInteger(reference.order)
                    ? reference.order
                    : 0,
                published: reference.published !== false,
                products: assignedProducts.sort((left, right) =>
                    compareProductCodes(left.product, right.product)),
            };
        })
        .sort((left, right) =>
            left.order - right.order ||
            left.category.localeCompare(right.category));
    const catalog = {
        code: CATALOG_CODE,
        currency: referenceCatalog.currency || 'CNY',
        order: Number.isSafeInteger(referenceCatalog.order)
            ? referenceCatalog.order
            : 0,
        published: referenceCatalog.published !== false,
        translations: referenceCatalog.translations || [],
    };
    return {
        catalog,
        binding: {
            ...catalog,
            categories: bindingCategories,
        },
    };
}

function mediaOutputName(item, index) {
    const extension = path.extname(item.file).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) {
        throw new Error(`Unsupported media extension for ${item.file}.`);
    }
    return `${String(index + 1).padStart(3, '0')}-${item.sha256.slice(0, 16)}${extension}`;
}

function writeMedia(outputRoot, context, products) {
    const productCodes = new Set(products.map(product =>
        assertProductCode(product.code)));
    const mediaItems = readJson(path.join(
        context.mediaRoot,
        context.mediaManifest.mediaItemsFile,
    ));
    const byProduct = new Map();
    for (const item of mediaItems) {
        const productCode = assertProductCode(item.productCode);
        if (!productCodes.has(productCode)) {
            throw new Error(`Media references unknown product ${productCode}.`);
        }
        if (!byProduct.has(productCode)) byProduct.set(productCode, []);
        byProduct.get(productCode).push(item);
    }
    const records = [];
    let logicalBytes = 0;
    const sourceBlobs = new Set();
    for (const productCode of [...byProduct.keys()].sort(compareProductCodes)) {
        const items = byProduct.get(productCode)
            .sort((left, right) =>
                left.sortOrder - right.sortOrder ||
                left.sha256.localeCompare(right.sha256));
        const artifactFolder = `07-media/products/${productCode}`;
        const manifestItems = [];
        items.forEach((item, index) => {
            const outputName = mediaOutputName(item, index);
            const relativeOutput = `${artifactFolder}/${outputName}`;
            const cloned = cloneFile(
                path.join(context.mediaRoot, item.file),
                outputRoot,
                relativeOutput,
            );
            if (cloned.bytes !== item.bytes || cloned.sha256 !== item.sha256) {
                throw new Error(
                    `Copied media differs from verified source blob ${item.file}.`,
                );
            }
            logicalBytes += item.bytes;
            sourceBlobs.add(item.sha256);
            manifestItems.push({
                file: outputName,
                order: index + 1,
                isCover: index === 0,
                role: item.role || 'gallery',
                bytes: item.bytes,
                contentType: item.contentType,
                sha256: item.sha256,
            });
        });
        records.push({
            product: productCode,
            path: artifactFolder,
            replace: true,
            role: 'gallery',
            cover: manifestItems[0].file,
            items: manifestItems,
        });
    }
    writeJson(
        path.join(outputRoot, '07-media', 'products', 'media.json'),
        records,
    );
    return {
        itemCount: mediaItems.length,
        logicalBytes,
        productCount: records.length,
        productsWithoutMedia: products.length - records.length,
        uniqueSourceBlobCount: sourceBlobs.size,
    };
}

function sourceBinding(context, catalogReferenceSha256) {
    return {
        sourceId: context.sourceBundle.manifest.sourceId,
        snapshotId: context.sourceBundle.manifest.snapshotId,
        sourceArtifactSha256: context.sourceBundle.manifest.artifactSha256,
        sourceManifestSha256: sha256(fs.readFileSync(path.join(
            context.sourceBundle.root,
            'artifact-manifest.json',
        ))),
        projectionSha256: context.projectionBundle.manifest.projectionSha256,
        reconciliationSha256:
            context.mappingsBundle.manifest.reconciliationSha256,
        productPatchesSha256:
            context.mappingsBundle.manifest.productPatchesSha256,
        mappingsSha256: context.mappingsBundle.manifest.mappingSha256,
        mediaItemsSha256: context.mediaManifest.mediaItemsSha256,
        mediaReceiptSha256: context.mediaManifest.receiptSha256,
        catalogReferenceSha256,
    };
}

function writeAdminConsoleArtifact(outputDirectory, context) {
    const outputRoot = path.resolve(outputDirectory);
    assertBundleBindings(context);
    const expectedCatalogHash =
        context.mappingsBundle.manifest.inputCatalogReferenceSha256;
    if (!expectedCatalogHash ||
        context.catalogReferenceSha256 !== expectedCatalogHash) {
        throw new Error(
            'Catalog reference does not match the reconciliation input binding.',
        );
    }
    const products = readJson(path.join(
        context.mappingsBundle.root,
        context.mappingsBundle.manifest.productPatchesFile,
    )).sort((left, right) =>
        compareProductCodes(assertProductCode(left.code), assertProductCode(right.code)));
    if (products.length !== context.mappingsBundle.manifest.productPatchCount) {
        throw new Error('Product patch count differs from reconciliation manifest.');
    }
    const productCodes = products.map(product => assertProductCode(product.code));
    if (new Set(productCodes).size !== productCodes.length) {
        throw new Error('ZZCTea product codes must be unique.');
    }

    const definitions = selectDefinitions(products, context.catalogReference);
    const catalogs = buildCatalogDocuments(products, context.catalogReference);
    writeJson(path.join(outputRoot, '01-reference', 'catalogs.json'), [catalogs.catalog]);
    writeJson(
        path.join(outputRoot, '02-specifications', 'specification_groups.json'),
        definitions.groups,
    );
    writeJson(
        path.join(outputRoot, '02-specifications', 'specification_attributes.json'),
        definitions.attributes,
    );
    writeJson(
        path.join(
            outputRoot,
            '02-specifications',
            'specification_attribute_options.json',
        ),
        definitions.options,
    );
    writeJson(path.join(outputRoot, '03-categories', 'categories.json'), []);
    writeJson(
        path.join(outputRoot, '05-catalog-bindings', 'catalogs.json'),
        [catalogs.binding],
    );
    writeJson(
        path.join(outputRoot, '06-routed-content', 'articles', 'index.json'),
        [],
    );
    writeJson(
        path.join(outputRoot, '06-routed-content', 'metaobjects', 'index.json'),
        [],
    );

    const productRecords = [];
    for (const product of products) {
        const code = assertProductCode(product.code);
        const relativePath =
            `04-products/${productCategory(product)}/${code}.json`;
        const importProduct = {
            ...product,
            replaceTranslations: true,
        };
        writeJson(
            path.join(outputRoot, ...relativePath.split('/')),
            [importProduct],
        );
        const bytes = fs.statSync(path.join(
            outputRoot,
            ...relativePath.split('/'),
        )).size;
        if (bytes > DATA_IMPORT_BATCH_MAX_BYTES) {
            throw new Error(
                `${relativePath} exceeds the Data Import Console batch ceiling.`,
            );
        }
        productRecords.push({ code, path: relativePath });
    }
    const media = writeMedia(outputRoot, context, products);
    const assignmentCount = catalogs.binding.categories
        .reduce((sum, category) => sum + category.products.length, 0);
    const binding = sourceBinding(context, context.catalogReferenceSha256);
    const manifest = createArtifactManifest(outputRoot, {
        snapshotId: binding.snapshotId,
        sourceManifestSha256: binding.sourceManifestSha256,
        sourceFilesSha256: binding.sourceArtifactSha256,
        catalogReferenceSha256: binding.catalogReferenceSha256,
        baselineReferenceSha256:
            context.mappingsBundle.manifest.inputProductReferenceTreeSha256,
        generatedAt: context.sourceBundle.manifest.observedAt,
        requiredLocales: ['zh-CN'],
        productCodes,
        products: productRecords,
        lossEvents: [],
        localization: {
            sourceGeneratedLocales: ['zh-CN'],
            seoGeneratedByImport: false,
        },
        catalogPlacement: {
            catalogCode: CATALOG_CODE,
            assignmentCount,
        },
        catalogTargets: [CATALOG_CODE],
        storefrontTargets: [],
        catalogAssignmentMode: 'preserve',
    });
    manifest.source = binding;
    manifest.safety = {
        applyAllowed: false,
        canaryRequired: true,
        productionWrites: false,
    };
    manifest.counts = {
        catalogAssignments: assignmentCount,
        mediaItems: media.itemCount,
        products: products.length,
        productsWithMedia: media.productCount,
        productsWithoutMedia: media.productsWithoutMedia,
        uniqueSourceMediaBlobs: media.uniqueSourceBlobCount,
    };
    manifest.media = {
        galleryStrategy: 'replace',
        localFiles: true,
        logicalBytes: media.logicalBytes,
        manifest: '07-media/products/media.json',
    };
    manifest.artifactId = sha256(stableJson({
        files: manifest.files,
        productCodes: manifest.productCodes,
        snapshotId: manifest.snapshotId,
        source: manifest.source,
    }));
    manifest.version =
        `${manifest.snapshotId}.${manifest.artifactId.slice(0, 12)}`;
    writeJsonAtomic(path.join(outputRoot, 'artifact-manifest.json'), manifest);
    return { manifest, media };
}

function walkFiles(root) {
    const pending = [root];
    const files = [];
    while (pending.length > 0) {
        const directory = pending.pop();
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) {
                throw new Error(`Admin Console artifact contains symlink ${target}.`);
            }
            if (entry.isDirectory()) pending.push(target);
            else if (entry.isFile()) {
                files.push(path.relative(root, target).split(path.sep).join('/'));
            } else {
                throw new Error(`Admin Console artifact contains non-file ${target}.`);
            }
        }
    }
    return files.sort();
}

function assertImageMagic(file, extension) {
    const bytes = fs.readFileSync(file);
    const jpeg = bytes.length >= 3 &&
        bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.length >= 8 &&
        bytes.subarray(0, 8).equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        );
    if ((extension === '.jpg' || extension === '.jpeg') && !jpeg) {
        throw new Error(`JPEG asset has invalid magic bytes: ${file}.`);
    }
    if (extension === '.png' && !png) {
        throw new Error(`PNG asset has invalid magic bytes: ${file}.`);
    }
}

function verifyAdminConsoleArtifact(outputDirectory) {
    const root = path.resolve(outputDirectory);
    const manifestValidation = verifyArtifactManifest(root);
    if (!manifestValidation.valid) {
        throw new Error(
            `Admin Console artifact manifest is invalid:\n` +
            manifestValidation.errors.join('\n'),
        );
    }
    const bundle = readArtifactBundle(root);
    if (!bundle.valid) {
        throw new Error(
            `Admin Console artifact contract is invalid:\n${bundle.errors.join('\n')}`,
        );
    }
    const manifest = bundle.manifest;
    if (manifest.safety?.applyAllowed !== false ||
        manifest.safety?.productionWrites !== false ||
        manifest.safety?.canaryRequired !== true ||
        manifest.targets?.catalogCodes?.length !== 1 ||
        manifest.targets.catalogCodes[0] !== CATALOG_CODE ||
        manifest.requiredLocales?.length !== 1 ||
        manifest.requiredLocales[0] !== 'zh-CN') {
        throw new Error('Admin Console artifact safety or target metadata is invalid.');
    }
    const files = walkFiles(root);
    const productFiles = files.filter(file =>
        file.startsWith('04-products/') && file.endsWith('.json'));
    if (productFiles.length !== manifest.counts?.products ||
        bundle.products.length !== manifest.counts.products ||
        new Set(bundle.products.map(product =>
            assertProductCode(product.code))).size !== manifest.counts.products) {
        throw new Error('Admin Console product counts are inconsistent.');
    }
    for (const product of bundle.products) {
        const translations = product.translations || [];
        if (product.replaceTranslations !== true ||
            translations.length !== 1 ||
            translations[0].lang !== 'zh-CN' ||
            !String(translations[0].name || '').trim() ||
            'seo' in translations[0] ||
            'metaTitle' in translations[0] ||
            'metaDescription' in translations[0] ||
            /zzctea|找找茶/i.test(String(translations[0].description || ''))) {
            throw new Error(
                `Product ${product.code} violates the Chinese source text contract.`,
            );
        }
    }
    const dataExchangeFiles = files.filter(relativePath =>
        productFiles.includes(relativePath) ||
        relativePath === '01-reference/catalogs.json' ||
        relativePath.startsWith('02-specifications/') ||
        relativePath === '03-categories/categories.json' ||
        relativePath === '05-catalog-bindings/catalogs.json');
    for (const relativePath of dataExchangeFiles) {
        const size = fs.statSync(path.join(root, ...relativePath.split('/'))).size;
        if (size > DATA_IMPORT_BATCH_MAX_BYTES) {
            throw new Error(
                `${relativePath} exceeds the Data Import Console batch ceiling.`,
            );
        }
    }
    const unsupported = files.filter(relativePath => {
        if (relativePath === 'artifact-manifest.json') return false;
        if (REQUIRED_JSON_FILES.has(relativePath)) return false;
        if (relativePath.startsWith('04-products/') &&
            relativePath.endsWith('.json')) return false;
        if (relativePath.startsWith('07-media/products/') &&
            IMAGE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
            return false;
        }
        return true;
    });
    if (unsupported.length > 0) {
        throw new Error(
            `Admin Console artifact contains unsupported files: ${unsupported.join(', ')}.`,
        );
    }

    const mediaRecords = readJson(path.join(
        root,
        '07-media',
        'products',
        'media.json',
    ));
    const referencedImages = new Set();
    const sourceMediaHashes = new Set();
    const mediaProductCodes = new Set();
    const productCodes = new Set(bundle.products.map(product =>
        assertProductCode(product.code)));
    let mediaItemCount = 0;
    let logicalMediaBytes = 0;
    for (const record of mediaRecords) {
        const productCode = assertProductCode(record.product);
        if (!productCodes.has(productCode) ||
            mediaProductCodes.has(productCode)) {
            throw new Error(`Media product binding is invalid for ${productCode}.`);
        }
        mediaProductCodes.add(productCode);
        const expectedFolder = `07-media/products/${productCode}`;
        if (record.path !== expectedFolder ||
            record.replace !== true ||
            !Array.isArray(record.items) ||
            record.items.length === 0) {
            throw new Error(`Media record is invalid for ${productCode}.`);
        }
        record.items.forEach((item, index) => {
            if (item.order !== index + 1 ||
                item.isCover !== (index === 0) ||
                item.file !== path.basename(item.file)) {
                throw new Error(`Media item order/cover is invalid for ${productCode}.`);
            }
            const relativePath = `${record.path}/${item.file}`;
            if (referencedImages.has(relativePath) ||
                !files.includes(relativePath)) {
                throw new Error(`Media item binding is invalid: ${relativePath}.`);
            }
            referencedImages.add(relativePath);
            const imageFile = path.join(root, ...relativePath.split('/'));
            const imageBytes = fs.readFileSync(imageFile);
            if (!/^[a-f0-9]{64}$/.test(String(item.sha256 || '')) ||
                item.bytes !== imageBytes.length ||
                item.sha256 !== sha256(imageBytes) ||
                !/^image\/(?:jpeg|png|webp|gif|avif|svg\+xml)$/
                    .test(String(item.contentType || ''))) {
                throw new Error(
                    `Media source binding is invalid: ${relativePath}.`,
                );
            }
            assertImageMagic(
                imageFile,
                path.extname(relativePath).toLowerCase(),
            );
            sourceMediaHashes.add(item.sha256);
            logicalMediaBytes += item.bytes;
            mediaItemCount += 1;
        });
        if (record.cover !== record.items[0].file) {
            throw new Error(`Media cover is invalid for ${productCode}.`);
        }
    }
    const actualImages = files.filter(relativePath =>
        relativePath.startsWith('07-media/products/') &&
        IMAGE_EXTENSIONS.has(path.extname(relativePath).toLowerCase()));
    if (mediaRecords.length !== manifest.counts.productsWithMedia ||
        manifest.counts.productsWithoutMedia !==
            manifest.counts.products - mediaRecords.length ||
        mediaItemCount !== manifest.counts.mediaItems ||
        sourceMediaHashes.size !== manifest.counts.uniqueSourceMediaBlobs ||
        logicalMediaBytes !== manifest.media?.logicalBytes ||
        referencedImages.size !== actualImages.length ||
        actualImages.some(relativePath => !referencedImages.has(relativePath))) {
        throw new Error('Admin Console media counts or bindings are inconsistent.');
    }
    const assignmentCount = bundle.catalogBindings
        .flatMap(catalog => catalog.categories || [])
        .reduce((sum, category) => sum + (category.products || []).length, 0);
    if (assignmentCount !== manifest.counts.catalogAssignments) {
        throw new Error('Admin Console catalog assignment count is inconsistent.');
    }
    const artifactId = sha256(stableJson({
        files: manifest.files,
        productCodes: manifest.productCodes,
        snapshotId: manifest.snapshotId,
        source: manifest.source,
    }));
    if (manifest.artifactId !== artifactId ||
        manifest.version !==
        `${manifest.snapshotId}.${artifactId.slice(0, 12)}`) {
        throw new Error('Admin Console artifact identity is invalid.');
    }
    return { bundle, manifest, root };
}

module.exports = {
    CATALOG_CODE,
    DATA_IMPORT_BATCH_MAX_BYTES,
    compareProductCodes,
    verifyAdminConsoleArtifact,
    writeAdminConsoleArtifact,
};
