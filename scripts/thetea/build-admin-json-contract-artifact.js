#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
    createArtifactManifest,
    readArtifactBundle,
    writeJson,
} = require('./lib/artifact-bundle');

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function copyDir(src, dst) {
    fs.rmSync(dst, { recursive: true, force: true });
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);
        if (entry.isDirectory()) copyDir(srcPath, dstPath);
        else if (entry.isFile()) fs.copyFileSync(srcPath, dstPath);
    }
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function localeOf(translation) {
    return translation.lang || translation.languageCode || translation.locale;
}

function translationRows(translations) {
    return asArray(translations)
        .map(item => ({ ...item, lang: localeOf(item) }))
        .filter(item => item.lang);
}

function addDotTranslations(row, translations, prefix = 'translations') {
    for (const translation of translationRows(translations)) {
        if (translation.name !== undefined) row[`${prefix}.${translation.lang}.name`] = translation.name;
        if (translation.description !== undefined) row[`${prefix}.${translation.lang}.description`] = translation.description;
        if (translation.seo !== undefined) row[`${prefix}.${translation.lang}.seo`] = translation.seo;
        if (translation.metaTitle !== undefined) row[`${prefix}.${translation.lang}.metaTitle`] = translation.metaTitle;
        if (translation.metaDescription !== undefined) {
            row[`${prefix}.${translation.lang}.metaDescription`] = translation.metaDescription;
        }
    }
}

function addSlashTranslations(row, translations, prefix = 'translations') {
    translationRows(translations).forEach((translation, index) => {
        row[`${prefix}/${index}/lang`] = translation.lang;
        for (const [key, value] of Object.entries(translation)) {
            if (key === 'lang' || key === 'languageCode' || key === 'locale') continue;
            if (value !== undefined && value !== null) row[`${prefix}/${index}/${key}`] = value;
        }
    });
}

function setIfPresent(row, key, value) {
    if (value !== undefined && value !== null) row[key] = value;
}

function sharedHeaders(rows) {
    const headers = [];
    const seen = new Set();
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (seen.has(key)) continue;
            seen.add(key);
            headers.push(key);
        }
    }
    return headers;
}

function normalizeRows(rows) {
    const headers = sharedHeaders(rows);
    return rows.map(row => Object.fromEntries(headers.map(key => [key, row[key] ?? ''])));
}

function convertSpecificationGroups(root) {
    const groupsFile = path.join(root, '02-specifications', 'specification_groups.json');
    const attributesFile = path.join(root, '02-specifications', 'specification_attributes.json');
    const optionsFile = path.join(root, '02-specifications', 'specification_attribute_options.json');

    const groups = readJson(groupsFile);
    const attributes = readJson(attributesFile);
    const options = fs.existsSync(optionsFile) ? readJson(optionsFile) : [];
    const optionsByAttribute = new Map();
    for (const option of options) {
        const key = String(option.attribute || option.specificationAttributeCode || '').toUpperCase();
        if (!key) continue;
        if (!optionsByAttribute.has(key)) optionsByAttribute.set(key, []);
        optionsByAttribute.get(key).push(option);
    }

    const attributesByGroup = new Map();
    for (const attribute of attributes) {
        const key = String(attribute.group || attribute.groupCode || '').toUpperCase();
        if (!key) continue;
        if (!attributesByGroup.has(key)) attributesByGroup.set(key, []);
        attributesByGroup.get(key).push(attribute);
    }

    const rows = groups.map(group => {
        const row = {
            code: group.code,
            icon: group.icon ?? '',
            order: group.order ?? 0,
            published: group.published ?? false,
            collapsible: group.collapsible ?? true,
            expanded: group.expanded ?? true,
        };
        addDotTranslations(row, group.translations);
        addSlashTranslations(row, group.translations);

        const groupAttributes = attributesByGroup.get(String(group.code).toUpperCase()) || [];
        groupAttributes.forEach((attribute, attrIndex) => {
            const attrPrefix = `attributes/${attrIndex}`;
            row[`${attrPrefix}/code`] = attribute.code;
            row[`${attrPrefix}/unit`] = attribute.unit ?? attribute.unitCode ?? '';
            row[`${attrPrefix}/order`] = attribute.order ?? 0;
            row[`${attrPrefix}/published`] = attribute.published ?? false;
            row[`${attrPrefix}/filterable`] = attribute.filterable ?? false;
            row[`${attrPrefix}/comparable`] = attribute.comparable ?? false;
            addSlashTranslations(row, attribute.translations, `${attrPrefix}/translations`);

            const attributeOptions = optionsByAttribute.get(String(attribute.code).toUpperCase()) || [];
            attributeOptions.forEach((option, optionIndex) => {
                const optionPrefix = `${attrPrefix}/options/${optionIndex}`;
                row[`${optionPrefix}/code`] = option.code;
                row[`${optionPrefix}/order`] = option.order ?? 0;
                row[`${optionPrefix}/published`] = option.published ?? false;
                setIfPresent(row, `${optionPrefix}/color`, option.color ?? option.colorSquaresRgb);
                addSlashTranslations(row, option.translations, `${optionPrefix}/translations`);
            });
        });

        const firstAttribute = groupAttributes[0];
        if (firstAttribute) {
            row['attributes.code'] = firstAttribute.code;
            row['attributes.unitCode'] = firstAttribute.unit ?? firstAttribute.unitCode ?? '';
            row['attributes.displayOrder'] = firstAttribute.order ?? 0;
            row['attributes.published'] = firstAttribute.published ?? false;
            row['attributes.isFilterable'] = firstAttribute.filterable ?? false;
            row['attributes.isComparable'] = firstAttribute.comparable ?? false;
            addDotTranslations(row, firstAttribute.translations, 'attributes.translations');
        }

        return row;
    });

    writeJson(groupsFile, normalizeRows(rows));
    writeJson(optionsFile, []);
}

function convertCategories(root) {
    const file = path.join(root, '03-categories', 'categories.json');
    const rows = readJson(file).map(category => {
        const row = {
            code: category.code,
            parent: category.parent ?? '',
            order: category.order ?? 0,
            published: category.published ?? false,
        };
        setIfPresent(row, 'categoryType', category.categoryType);
        setIfPresent(row, 'lat', category.lat);
        setIfPresent(row, 'lng', category.lng);
        addDotTranslations(row, category.translations);
        addSlashTranslations(row, category.translations);
        return row;
    });
    writeJson(file, normalizeRows(rows));
}

function convertProductFile(file) {
    const products = readJson(file);
    const rows = products.map(product => {
        const row = {};
        for (const [key, value] of Object.entries(product)) {
            if ([
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
            ].includes(key)) continue;
            if (value !== undefined && value !== null) row[key] = value;
        }
        addDotTranslations(row, product.translations);
        addSlashTranslations(row, product.translations);

        for (const [collectionKey, records] of Object.entries({
            specifications: product.specifications,
            tags: product.tags,
            tierPrices: product.tierPrices,
            catalogPrices: product.catalogPrices,
            storePriceOverrides: product.storePriceOverrides,
            packages: product.packages,
            catalogs: product.catalogs,
            origins: product.origins,
            related: product.related,
            crossSells: product.crossSells,
        })) {
            asArray(records).forEach((record, index) => {
                for (const [key, value] of Object.entries(record || {})) {
                    if (key === 'translations') {
                        addSlashTranslations(row, value, `${collectionKey}/${index}/translations`);
                        continue;
                    }
                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        for (const [nestedKey, nestedValue] of Object.entries(value)) {
                            setIfPresent(row, `${collectionKey}/${index}/${key}/${nestedKey}`, nestedValue);
                        }
                        continue;
                    }
                    setIfPresent(row, `${collectionKey}/${index}/${key}`, value);
                }
            });
        }

        const firstTag = asArray(product.tags)[0];
        if (firstTag) {
            row['tags.code'] = firstTag.code;
            row['tags.name'] = firstTag.name;
            row['tags.lang'] = firstTag.lang;
        }
        return row;
    });
    writeJson(file, normalizeRows(rows));
}

function convertProducts(root) {
    const productsRoot = path.join(root, '04-products');
    for (const folder of fs.readdirSync(productsRoot, { withFileTypes: true })) {
        if (!folder.isDirectory()) continue;
        const folderPath = path.join(productsRoot, folder.name);
        for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith('.json')) {
                convertProductFile(path.join(folderPath, entry.name));
            }
        }
    }
}

function rebuildManifest(root) {
    const previous = readJson(path.join(root, 'artifact-manifest.json'));
    const manifest = createArtifactManifest(root, {
        snapshotId: previous.snapshotId,
        sourceManifestSha256: previous.sourceManifestSha256,
        sourceFilesSha256: previous.sourceFilesSha256,
        catalogReferenceSha256: previous.catalogReferenceSha256,
        baselineReferenceSha256: previous.baselineReferenceSha256,
        generatedAt: new Date().toISOString(),
        requiredLocales: previous.requiredLocales || [],
        productCodes: previous.productCodes || [],
        products: previous.products || [],
        lossEvents: previous.lossEvents || [],
        localization: previous.localization || {},
    });
    const bundle = readArtifactBundle(root);
    if (!bundle.valid) {
        throw new Error(`Converted artifact is not self-consistent:\n${bundle.errors.join('\n')}`);
    }
    return manifest;
}

function main() {
    const [, , src, dst] = process.argv;
    if (!src || !dst) {
        throw new Error('Usage: build-admin-json-contract-artifact.js <source-artifact-dir> <target-artifact-dir>');
    }
    copyDir(path.resolve(src), path.resolve(dst));
    const root = path.resolve(dst);
    convertSpecificationGroups(root);
    convertCategories(root);
    convertProducts(root);
    const manifest = rebuildManifest(root);
    console.log(`Converted artifact: ${root}`);
    console.log(`Files: ${manifest.files.length}`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`FATAL: ${error.message}`);
        process.exitCode = 1;
    }
}
