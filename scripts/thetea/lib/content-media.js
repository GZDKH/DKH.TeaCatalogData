'use strict';

const fs = require('fs');
const path = require('path');

const CONTENT_MEDIA_ARTIFACT_PREFIX = '07-media/content';
const CONTENT_MEDIA_MANIFEST_FILE = 'media.json';
const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 10 * 1024 * 1024 * 1024;
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_IMAGE_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:jpe?g|png|webp)$/;
const SAFE_MEDIA_TOKEN = /^\{\{media:[a-z0-9]+(?:-[a-z0-9]+)*\}\}$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

const IMAGE_TYPES = Object.freeze({
    '.jpg': {
        mime: 'image/jpeg',
        matches: bytes => bytes.length >= 3
            && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    },
    '.jpeg': {
        mime: 'image/jpeg',
        matches: bytes => bytes.length >= 3
            && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    },
    '.png': {
        mime: 'image/png',
        matches: bytes => bytes.length >= 8
            && bytes.subarray(0, 8).equals(
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    },
    '.webp': {
        mime: 'image/webp',
        matches: bytes => bytes.length >= 12
            && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
            && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
    },
});

function collectContentMedia(root, articles, options = {}) {
    const result = readContentMediaDirectory(root, articles, options);
    if (result.errors.length) {
        throw new Error(`Invalid content media artifact:\n${result.errors.join('\n')}`);
    }
    return result;
}

function readContentMediaDirectory(root, articles, options = {}) {
    const resolvedRoot = path.resolve(root);
    const maxFileBytes = positiveLimit(
        options.maxFileBytes,
        DEFAULT_MAX_FILE_BYTES,
        'Content media maximum file bytes');
    const maxTotalBytes = positiveLimit(
        options.maxTotalBytes,
        DEFAULT_MAX_TOTAL_BYTES,
        'Content media maximum total bytes');
    if (maxTotalBytes < maxFileBytes) {
        throw new Error('Content media maximum total bytes must be at least maximum file bytes.');
    }
    const errors = [];
    const empty = { records: [], assets: [], files: [], totalBytes: 0, errors };

    if (!fs.existsSync(resolvedRoot)) return empty;
    if (fs.lstatSync(resolvedRoot).isSymbolicLink()) {
        errors.push(`Content media root must not be a symbolic link: ${resolvedRoot}.`);
        return empty;
    }

    const manifestPath = path.join(resolvedRoot, CONTENT_MEDIA_MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) {
        errors.push(`Missing ${CONTENT_MEDIA_ARTIFACT_PREFIX}/${CONTENT_MEDIA_MANIFEST_FILE}.`);
        return empty;
    }
    if (fs.lstatSync(manifestPath).isSymbolicLink()) {
        errors.push(`${CONTENT_MEDIA_ARTIFACT_PREFIX}/${CONTENT_MEDIA_MANIFEST_FILE} must not be a symbolic link.`);
        return empty;
    }

    let rawRecords;
    try {
        rawRecords = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
        errors.push(`Invalid content media manifest JSON: ${error.message}`);
        return empty;
    }
    if (!Array.isArray(rawRecords)) {
        errors.push('Content media manifest must be a JSON array.');
        return empty;
    }

    const articleByCode = new Map();
    for (const article of articles || []) {
        const code = text(article?.code);
        const slug = text(article?.slug);
        if (code && slug) articleByCode.set(code, { slug, record: article });
    }

    const actualFiles = walkContentFiles(resolvedRoot, errors);
    const actualAssetFiles = actualFiles.filter(file => file !== CONTENT_MEDIA_MANIFEST_FILE);
    const referencedFiles = new Set();
    const articleCodes = new Set();
    const articleSlugs = new Set();
    const records = [];
    const assets = [];
    let totalBytes = 0;

    for (const [index, value] of rawRecords.entries()) {
        const recordLabel = `Content media record ${index + 1}`;
        if (!isRecord(value)) {
            errors.push(`${recordLabel} must be an object.`);
            continue;
        }

        const article = text(value.article);
        const slug = text(value.slug);
        if (!article) errors.push(`${recordLabel}.article is required.`);
        const slugIsSafe = Boolean(slug && slug.length <= 120 && SAFE_SLUG.test(slug));
        if (!slugIsSafe) {
            errors.push(`${recordLabel}.slug must be a lowercase slug up to 120 characters.`);
        }
        if (article && articleCodes.has(article)) {
            errors.push(`Duplicate content media article entry: ${article}.`);
        }
        if (slug && articleSlugs.has(slug)) {
            errors.push(`Duplicate content media article slug: ${slug}.`);
        }
        if (article) articleCodes.add(article);
        if (slug) articleSlugs.add(slug);

        const routedArticle = articleByCode.get(article);
        if (!routedArticle) {
            errors.push(`${recordLabel} references unknown routed article '${article || '<missing>'}'.`);
        } else if (slug && routedArticle.slug !== slug) {
            errors.push(
                `${recordLabel} slug '${slug}' differs from routed article slug '${routedArticle.slug}'.`);
        }

        const expectedPath = `${CONTENT_MEDIA_ARTIFACT_PREFIX}/articles/${slug}`;
        const recordPath = text(value.path);
        const pathIsCanonical = recordPath === expectedPath;
        if (!pathIsCanonical) {
            errors.push(`${recordLabel}.path must equal '${expectedPath}'.`);
        }
        if (value.replace !== undefined && typeof value.replace !== 'boolean') {
            errors.push(`${recordLabel}.replace must be a boolean when present.`);
        }

        const cover = value.cover === undefined || value.cover === null
            ? null
            : normalizeImageFile(value.cover, `${recordLabel}.cover`, errors);
        const inlineValues = value.inline === undefined ? [] : value.inline;
        if (!Array.isArray(inlineValues)) {
            errors.push(`${recordLabel}.inline must be an array.`);
        }

        const inline = [];
        const tokens = new Set();
        const files = new Set();
        if (cover) files.add(cover);
        for (const [inlineIndex, inlineValue] of (Array.isArray(inlineValues) ? inlineValues : []).entries()) {
            const inlineLabel = `${recordLabel}.inline[${inlineIndex}]`;
            if (!isRecord(inlineValue)) {
                errors.push(`${inlineLabel} must be an object.`);
                continue;
            }
            const token = text(inlineValue.token);
            const file = normalizeImageFile(inlineValue.file, `${inlineLabel}.file`, errors);
            if (!token || !SAFE_MEDIA_TOKEN.test(token)) {
                errors.push(`${inlineLabel}.token must match '{{media:lowercase-slug}}'.`);
            } else if (tokens.has(token)) {
                errors.push(`Duplicate inline media token '${token}' for article '${article}'.`);
            } else {
                tokens.add(token);
                if (routedArticle && !containsString(routedArticle.record, token)) {
                    errors.push(
                        `Inline media token '${token}' is not present in routed article '${article}'.`);
                }
            }
            if (file && files.has(file)) {
                errors.push(`Duplicate content media file '${file}' for article '${article}'.`);
            }
            if (file) files.add(file);

            inline.push({
                token,
                file,
                ...normalizeLocalizedField(inlineValue.alt, `${inlineLabel}.alt`, errors, 'alt'),
                ...normalizeLocalizedField(
                    inlineValue.caption,
                    `${inlineLabel}.caption`,
                    errors,
                    'caption'),
            });
        }
        if (!cover && inline.length === 0) {
            errors.push(`${recordLabel} must declare a cover or at least one inline image.`);
        }

        for (const file of files) {
            if (!slugIsSafe || !pathIsCanonical) continue;
            const canonicalPath = `${expectedPath}/${file}`;
            if (referencedFiles.has(canonicalPath)) {
                errors.push(`Duplicate content media file reference: ${canonicalPath}.`);
                continue;
            }
            referencedFiles.add(canonicalPath);
            const sourceRelativePath = canonicalPath.slice(`${CONTENT_MEDIA_ARTIFACT_PREFIX}/`.length);
            if (!actualAssetFiles.includes(sourceRelativePath)) continue;
            const sourcePath = path.join(resolvedRoot, ...sourceRelativePath.split('/'));
            const asset = validateAsset(sourcePath, canonicalPath, maxFileBytes, errors);
            if (!asset) continue;
            totalBytes += asset.bytes;
            assets.push({ sourcePath, relativePath: canonicalPath, ...asset });
        }

        records.push({
            article,
            slug,
            path: expectedPath,
            replace: value.replace !== false,
            ...(cover ? { cover } : {}),
            ...(inline.length ? {
                inline: inline.sort((left, right) => left.token.localeCompare(right.token)),
            } : {}),
        });
    }

    if (totalBytes > maxTotalBytes) {
        errors.push(`Content media assets total ${totalBytes} bytes exceeds ${maxTotalBytes} bytes.`);
    }

    const actualCanonicalAssets = actualAssetFiles.map(
        file => `${CONTENT_MEDIA_ARTIFACT_PREFIX}/${file}`);
    for (const relativePath of actualCanonicalAssets) {
        if (!referencedFiles.has(relativePath)) {
            errors.push(`Unreferenced content media file: ${relativePath}.`);
        }
    }
    for (const relativePath of referencedFiles) {
        if (!actualCanonicalAssets.includes(relativePath)) {
            errors.push(`Missing content media file: ${relativePath}.`);
        }
    }

    return {
        records: records.sort((left, right) => left.article.localeCompare(right.article)),
        assets: assets.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
        files: [
            `${CONTENT_MEDIA_ARTIFACT_PREFIX}/${CONTENT_MEDIA_MANIFEST_FILE}`,
            ...actualCanonicalAssets,
        ].sort(),
        totalBytes,
        errors,
    };
}

function normalizeImageFile(value, label, errors) {
    const file = text(value);
    if (!file || file.length > 160 || !SAFE_IMAGE_FILE.test(file)) {
        errors.push(`${label} must be a lowercase PNG, JPEG, or WebP filename.`);
        return '';
    }
    return file;
}

function normalizeLocalizedField(value, label, errors, field) {
    if (value === undefined || value === null) return {};
    if (!isRecord(value)) {
        errors.push(`${label} must be an object keyed by locale.`);
        return {};
    }
    const normalized = {};
    for (const locale of Object.keys(value).sort()) {
        if (!LOCALE.test(locale) || typeof value[locale] !== 'string') {
            errors.push(`${label}.${locale} must be a string under a valid locale key.`);
            continue;
        }
        normalized[locale] = value[locale];
    }
    return { [field]: normalized };
}

function validateAsset(file, relativePath, maxFileBytes, errors) {
    if (!fs.existsSync(file)) return null;
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
        errors.push(`Content media file must not be a symbolic link: ${relativePath}.`);
        return null;
    }
    if (!stat.isFile()) {
        errors.push(`Content media path must be a file: ${relativePath}.`);
        return null;
    }
    if (stat.size > maxFileBytes) {
        errors.push(`Content media file exceeds ${maxFileBytes} bytes: ${relativePath}.`);
        return null;
    }

    const extension = path.extname(file).toLowerCase();
    const type = IMAGE_TYPES[extension];
    if (!type) {
        errors.push(`Unsupported content media type: ${relativePath}.`);
        return null;
    }
    const bytes = Buffer.alloc(16);
    const handle = fs.openSync(file, 'r');
    let read;
    try {
        read = fs.readSync(handle, bytes, 0, bytes.length, 0);
    } finally {
        fs.closeSync(handle);
    }
    if (!type.matches(bytes.subarray(0, read))) {
        errors.push(`Content media signature does not match ${type.mime}: ${relativePath}.`);
        return null;
    }
    return { bytes: stat.size, mime: type.mime };
}

function walkContentFiles(root, errors) {
    const files = [];
    const visit = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const fullPath = path.join(directory, entry.name);
            const relativePath = path.relative(root, fullPath).split(path.sep).join('/');
            const stat = fs.lstatSync(fullPath);
            if (stat.isSymbolicLink()) {
                errors.push(`Content media input must not contain symlinks: ${relativePath}.`);
            } else if (stat.isDirectory()) {
                visit(fullPath);
            } else if (stat.isFile()) {
                files.push(relativePath);
            }
        }
    };
    visit(root);
    return files.sort();
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function positiveLimit(value, fallback, label) {
    const resolved = value === undefined ? fallback : value;
    if (!Number.isSafeInteger(resolved) || resolved < 1) {
        throw new Error(`${label} must be a positive safe integer.`);
    }
    return resolved;
}

function containsString(value, expected) {
    if (typeof value === 'string') return value.includes(expected);
    if (Array.isArray(value)) return value.some(item => containsString(item, expected));
    if (isRecord(value)) return Object.values(value).some(item => containsString(item, expected));
    return false;
}

module.exports = {
    CONTENT_MEDIA_ARTIFACT_PREFIX,
    CONTENT_MEDIA_MANIFEST_FILE,
    DEFAULT_MAX_FILE_BYTES,
    DEFAULT_MAX_TOTAL_BYTES,
    collectContentMedia,
    readContentMediaDirectory,
};
