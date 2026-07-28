'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    createRequestStartGate,
    retryDelayMs,
} = require('./http');
const {
    atomicWrite,
    readJson,
    sha256,
    stableJson,
    writeJsonAtomic,
} = require('./artifacts');
const {
    validatePublicImageUrl,
} = require('../zzctea/policy');

const CHECKPOINT_SCHEMA = 'catalog-source-media-checkpoint-v1';
const MANIFEST_SCHEMA = 'catalog-source-media-manifest-v1';
const RECEIPT_SCHEMA = 'catalog-source-media-receipt-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 10 * 1024 * 1024 * 1024;
const DEFAULT_MINIMUM_REQUEST_INTERVAL_MS = 1000;

const TYPES = Object.freeze({
    'image/jpeg': {
        extension: 'jpg',
        matches: bytes => bytes.length >= 3 &&
            bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    },
    'image/png': {
        extension: 'png',
        matches: bytes => bytes.length >= 8 &&
            bytes.subarray(0, 8).equals(
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            ),
    },
    'image/webp': {
        extension: 'webp',
        matches: bytes => bytes.length >= 12 &&
            bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
            bytes.subarray(8, 12).toString('ascii') === 'WEBP',
    },
});

function assertPositiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new Error(`${label} must be a positive integer no greater than ${maximum}.`);
    }
}

function assertSafeOutputRoot(outputDirectory) {
    const resolved = path.resolve(outputDirectory);
    const stat = fs.existsSync(resolved) ? fs.lstatSync(resolved) : null;
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) {
        throw new Error('Media artifact output must be a real directory.');
    }
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
}

function ensureRealDirectory(directory, label) {
    if (fs.existsSync(directory)) {
        const stat = fs.lstatSync(directory);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new Error(`${label} must be a real directory.`);
        }
        return;
    }
    fs.mkdirSync(directory);
}

function assertContainedRegularFile(root, relativeFile, label) {
    if (!relativeFile || path.isAbsolute(relativeFile)) {
        throw new Error(`${label} must be a relative path.`);
    }
    const file = path.resolve(root, relativeFile);
    if (!file.startsWith(`${root}${path.sep}`)) {
        throw new Error(`${label} escapes the media artifact.`);
    }
    let current = root;
    const parentRelative = path.relative(root, path.dirname(file));
    for (const segment of parentRelative.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        const parentStat = fs.lstatSync(current);
        if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
            throw new Error(`${label} has a non-directory or symlink ancestor.`);
        }
    }
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`${label} must be a real file.`);
    }
    return file;
}

function normalizeContentType(value) {
    return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

async function cancelResponseBody(response) {
    try {
        await response?.body?.cancel?.();
    } catch {
        // The response is being rejected anyway. Do not replace the fixed error.
    }
}

function detectImageType(contentType, bytes) {
    const normalized = normalizeContentType(contentType);
    const type = TYPES[normalized];
    if (!type) {
        throw new Error('MEDIA_CONTENT_TYPE_NOT_ALLOWED');
    }
    if (!type.matches(bytes)) {
        throw new Error('MEDIA_MAGIC_BYTES_MISMATCH');
    }
    return {
        contentType: normalized,
        extension: type.extension,
    };
}

function canonicalImagePath(rawUrl) {
    const url = validatePublicImageUrl(rawUrl);
    return `${url.origin}${url.pathname}`;
}

function validateMappingCoverage(artifact, mappings, expectedCounts = null) {
    if (!artifact ||
        artifact.source?.id !== 'zzctea' ||
        !Array.isArray(artifact.items)) {
        throw new Error('Only a verified ZZCTea artifact is supported.');
    }
    if (!Array.isArray(mappings)) {
        throw new Error('Reconciliation mappings must be an array.');
    }
    const artifactIds = new Set();
    for (const item of artifact.items) {
        const externalId = String(item?.externalId || '');
        if (!/^[1-9]\d*$/.test(externalId) || artifactIds.has(externalId)) {
            throw new Error('ZZCTea artifact external IDs must be exact and unique.');
        }
        artifactIds.add(externalId);
    }
    const mappingByExternalId = new Map();
    const productCodes = new Set();
    const statusCounts = {
        matched: 0,
        missing: 0,
    };
    for (const mapping of mappings) {
        const externalId = String(mapping?.externalId || '');
        const matched = mapping.status === 'matched-update' ||
            mapping.status === 'matched-noop';
        const draft = mapping.status === 'missing-create-draft';
        if (!/^[1-9]\d*$/.test(externalId) ||
            (!matched && !draft) ||
            mapping.productCode !== `ZZC-${externalId}` ||
            (matched && !UUID.test(String(mapping.productId || ''))) ||
            (draft && (mapping.productId !== undefined ||
                mapping.published !== false)) ||
            mappingByExternalId.has(externalId) ||
            productCodes.has(mapping.productCode) ||
            !artifactIds.has(externalId)) {
            throw new Error(
                'Reconciliation mappings must be exact, unique matched or Draft ZZCTea products.',
            );
        }
        mappingByExternalId.set(externalId, mapping);
        productCodes.add(mapping.productCode);
        statusCounts[matched ? 'matched' : 'missing'] += 1;
    }
    if (mappingByExternalId.size !== artifactIds.size ||
        [...artifactIds].some(externalId => !mappingByExternalId.has(externalId))) {
        throw new Error('Reconciliation mappings do not exactly cover the ZZCTea artifact.');
    }
    if (expectedCounts &&
        (expectedCounts.ambiguous !== 0 ||
            expectedCounts.matched !== statusCounts.matched ||
            expectedCounts.missing !== statusCounts.missing)) {
        throw new Error('Reconciliation mapping status counts differ from its manifest.');
    }
    return mappingByExternalId;
}

function selectOriginalImageCandidates(artifact, mappings, onlyExternalId = null) {
    const mappingByExternalId = validateMappingCoverage(artifact, mappings);
    const selectedItems = onlyExternalId === null
        ? artifact.items
        : artifact.items.filter(item => String(item.externalId) === onlyExternalId);
    if (onlyExternalId !== null && selectedItems.length !== 1) {
        throw new Error(`--only=${onlyExternalId} must identify exactly one artifact item.`);
    }

    const candidates = [];
    for (const item of selectedItems) {
        const externalId = String(item.externalId || '');
        const mapping = mappingByExternalId.get(externalId);
        if (!mapping) {
            throw new Error(`No exact product mapping exists for ZZCTea ${externalId}.`);
        }
        const byPath = new Map();
        for (const image of item.images || []) {
            const url = validatePublicImageUrl(image?.url).toString();
            const key = canonicalImagePath(url);
            const variants = byPath.get(key) || [];
            variants.push({ role: String(image.role || ''), url });
            byPath.set(key, variants);
        }
        let sourceOrder = 0;
        for (const [sourcePath, variants] of byPath.entries()) {
            const originals = variants.filter(entry => !new URL(entry.url).search);
            if (originals.length !== 1) {
                throw new Error(
                    `ZZCTea ${externalId} image ${sourcePath} must have exactly one original URL.`,
                );
            }
            candidates.push({
                aliases: [...new Set(variants.map(entry => entry.url))].sort(),
                externalId,
                localizedName: String(
                    item.localizedFields?.['zh-CN']?.name || mapping.productCode,
                ),
                productCode: mapping.productCode,
                ...(mapping.productId ? { productId: mapping.productId } : {}),
                sourceOrder,
                sourcePath,
                url: originals[0].url,
            });
            sourceOrder += 1;
        }
    }
    return candidates.sort((left, right) => {
        const leftId = BigInt(left.externalId);
        const rightId = BigInt(right.externalId);
        if (leftId < rightId) return -1;
        if (leftId > rightId) return 1;
        return left.sourceOrder - right.sourceOrder ||
            left.url.localeCompare(right.url);
    });
}

function checkpointBinding(options) {
    return {
        artifactSha256: options.artifactSha256,
        mappingSha256: options.mappingSha256,
        maxFileBytes: options.maxFileBytes,
        maxTotalBytes: options.maxTotalBytes,
        minimumRequestIntervalMs: options.minimumRequestIntervalMs,
        onlyExternalId: options.onlyExternalId,
        snapshotId: options.snapshotId,
        sourceId: options.sourceId,
    };
}

function newCheckpoint(binding, networkUrlCount) {
    return {
        schemaVersion: CHECKPOINT_SCHEMA,
        status: 'in-progress',
        binding,
        networkUrlCount,
        entries: {},
        totalBytes: 0,
        completedCount: 0,
        productionWrites: false,
    };
}

function assertCheckpoint(checkpoint, binding, networkUrlCount) {
    if (checkpoint.schemaVersion !== CHECKPOINT_SCHEMA ||
        !['in-progress', 'complete'].includes(checkpoint.status) ||
        stableJson(checkpoint.binding) !== stableJson(binding) ||
        checkpoint.networkUrlCount !== networkUrlCount ||
        !checkpoint.entries ||
        typeof checkpoint.entries !== 'object' ||
        !Number.isSafeInteger(checkpoint.totalBytes) ||
        checkpoint.totalBytes < 0 ||
        checkpoint.productionWrites !== false) {
        throw new Error('Existing media checkpoint does not match this materialization.');
    }
}

function verifyCompletedEntry(outputRoot, entry) {
    if (!entry ||
        !DIGEST.test(String(entry.sha256 || '')) ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 1 ||
        !TYPES[entry.contentType]) {
        throw new Error('Media checkpoint entry is invalid.');
    }
    const file = assertContainedRegularFile(outputRoot, entry.file, 'Checkpoint media file');
    const stat = fs.statSync(file);
    if (stat.size !== entry.bytes ||
        sha256(fs.readFileSync(file)) !== entry.sha256) {
        throw new Error('MEDIA_RESUME_HASH_MISMATCH');
    }
}

async function fetchImageResponse(rawUrl, options) {
    const {
        beforeAttempt,
        fetchImpl,
        maxRedirects = 4,
        retries = 2,
        sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
        timeoutMs = 30_000,
    } = options;
    let current = validatePublicImageUrl(rawUrl);
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        let response;
        let timeout;
        for (let attempt = 0; attempt <= retries; attempt += 1) {
            const release = await beforeAttempt();
            const controller = new AbortController();
            timeout = setTimeout(() => controller.abort(), timeoutMs);
            try {
                response = await fetchImpl(current, {
                    headers: {
                        Accept: 'image/jpeg,image/png,image/webp',
                        'User-Agent': 'DKH.TeaCatalogData catalog-source-media/1',
                    },
                    redirect: 'manual',
                    signal: controller.signal,
                });
            } catch (error) {
                release();
                clearTimeout(timeout);
                if (attempt >= retries) throw error;
                await sleep(500 * Math.pow(2, attempt));
                continue;
            }
            release();
            if ((response.status === 429 || response.status >= 500) &&
                attempt < retries) {
                clearTimeout(timeout);
                await cancelResponseBody(response);
                await sleep(retryDelayMs(response, attempt, 500));
                continue;
            }
            break;
        }
        if ([301, 302, 307, 308].includes(response.status)) {
            clearTimeout(timeout);
            await cancelResponseBody(response);
            if (redirectCount === maxRedirects) {
                throw new Error('MEDIA_REDIRECT_LIMIT_EXCEEDED');
            }
            const location = response.headers.get('location');
            if (!location) {
                throw new Error('MEDIA_REDIRECT_LOCATION_MISSING');
            }
            current = validatePublicImageUrl(new URL(location, current).toString());
            continue;
        }
        if (response.status !== 200) {
            clearTimeout(timeout);
            await cancelResponseBody(response);
            throw new Error('MEDIA_HTTP_STATUS_UNEXPECTED');
        }
        return {
            response,
            finalUrl: current.toString(),
            releaseTimeout: () => clearTimeout(timeout),
        };
    }
    throw new Error('MEDIA_REDIRECT_LIMIT_EXCEEDED');
}

async function downloadImage(rawUrl, outputRoot, options) {
    const {
        beforeAttempt,
        fetchImpl,
        maxFileBytes,
        remainingTotalBytes,
    } = options;
    const { response, finalUrl, releaseTimeout } = await fetchImageResponse(rawUrl, {
        beforeAttempt,
        fetchImpl,
        maxRedirects: options.maxRedirects,
        timeoutMs: options.timeoutMs,
    });
    try {
        const declaredLengthRaw = response.headers.get('content-length');
        if (declaredLengthRaw !== null) {
            const declaredLength = Number(declaredLengthRaw);
            if (!Number.isSafeInteger(declaredLength) ||
                declaredLength < 1 ||
                declaredLength > maxFileBytes ||
                declaredLength > remainingTotalBytes) {
                throw new Error('MEDIA_RESPONSE_TOO_LARGE');
            }
        }
        if (!response.body) {
            throw new Error('MEDIA_RESPONSE_BODY_MISSING');
        }

        const temporaryDirectory = path.join(outputRoot, '.partial');
        ensureRealDirectory(temporaryDirectory, 'Media partial directory');
        const temporaryFile = path.join(
            temporaryDirectory,
            `${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`,
        );
        const handle = fs.openSync(temporaryFile, 'wx', 0o600);
        const hash = crypto.createHash('sha256');
        let bytes = 0;
        let prefix = Buffer.alloc(0);
        try {
            for await (const chunkValue of response.body) {
                const chunk = Buffer.from(chunkValue);
                bytes += chunk.length;
                if (bytes > maxFileBytes || bytes > remainingTotalBytes) {
                    throw new Error('MEDIA_RESPONSE_TOO_LARGE');
                }
                if (prefix.length < 16) {
                    prefix = Buffer.concat([prefix, chunk]).subarray(0, 16);
                }
                hash.update(chunk);
                fs.writeSync(handle, chunk);
            }
        } catch (error) {
            fs.closeSync(handle);
            fs.rmSync(temporaryFile, { force: true });
            throw error;
        }
        fs.fsyncSync(handle);
        fs.closeSync(handle);
        if (bytes < 1) {
            fs.rmSync(temporaryFile, { force: true });
            throw new Error('MEDIA_RESPONSE_BODY_EMPTY');
        }

        let detected;
        try {
            detected = detectImageType(response.headers.get('content-type'), prefix);
        } catch (error) {
            fs.rmSync(temporaryFile, { force: true });
            throw error;
        }
        const digest = hash.digest('hex');
        const relativeFile =
            `blobs/${digest.slice(0, 2)}/${digest}.${detected.extension}`;
        const finalFile = path.join(outputRoot, relativeFile);
        const blobsDirectory = path.join(outputRoot, 'blobs');
        ensureRealDirectory(blobsDirectory, 'Media blobs directory');
        ensureRealDirectory(path.dirname(finalFile), 'Media digest directory');
        if (fs.existsSync(finalFile)) {
            const existing = fs.lstatSync(finalFile);
            if (existing.isSymbolicLink() ||
                !existing.isFile() ||
                existing.size !== bytes ||
                sha256(fs.readFileSync(finalFile)) !== digest) {
                fs.rmSync(temporaryFile, { force: true });
                throw new Error('MEDIA_CONTENT_ADDRESS_COLLISION');
            }
            fs.rmSync(temporaryFile, { force: true });
        } else {
            fs.renameSync(temporaryFile, finalFile);
        }
        return {
            bytes,
            contentType: detected.contentType,
            file: relativeFile,
            finalUrl,
            sha256: digest,
        };
    } finally {
        releaseTimeout();
    }
}

function buildOutputDocuments(options) {
    const {
        artifact,
        binding,
        candidates,
        checkpoint,
        manifestFileName = 'media-items.json',
    } = options;
    const orders = new Map();
    const seenProductHashes = new Set();
    const mediaItems = [];
    const sources = [];
    for (const candidate of candidates) {
        const entry = checkpoint.entries[candidate.url];
        if (!entry) {
            throw new Error(`Missing completed media entry for ${candidate.url}.`);
        }
        const productHashKey = `${candidate.productCode}|${entry.sha256}`;
        const duplicateForProduct = seenProductHashes.has(productHashKey);
        if (!duplicateForProduct) {
            seenProductHashes.add(productHashKey);
            const sortOrder = orders.get(candidate.productCode) || 0;
            orders.set(candidate.productCode, sortOrder + 1);
            mediaItems.push({
                productCode: candidate.productCode,
                role: 'gallery',
                file: entry.file,
                contentType: entry.contentType,
                sortOrder,
                altText: candidate.localizedName,
                sha256: entry.sha256,
                bytes: entry.bytes,
            });
        }
        sources.push({
            aliases: candidate.aliases,
            bytes: entry.bytes,
            contentType: entry.contentType,
            externalId: candidate.externalId,
            file: entry.file,
            finalUrl: entry.finalUrl,
            omittedDuplicateForProduct: duplicateForProduct,
            productCode: candidate.productCode,
            ...(candidate.productId
                ? { productId: candidate.productId }
                : {}),
            role: 'gallery',
            sha256: entry.sha256,
            sourceUrl: candidate.url,
        });
    }
    const receipt = {
        schemaVersion: RECEIPT_SCHEMA,
        sourceId: binding.sourceId,
        snapshotId: binding.snapshotId,
        inputArtifactSha256: binding.artifactSha256,
        inputMappingSha256: binding.mappingSha256,
        inputImageReferenceCount: artifact.items
            .reduce((sum, item) => sum + (item.images || []).length, 0),
        selectedOriginalCount: candidates.length,
        networkUrlCount: checkpoint.networkUrlCount,
        uniqueBlobCount: new Set(sources.map(entry => entry.sha256)).size,
        totalBytes: checkpoint.totalBytes,
        sources,
        productionWrites: false,
    };
    const mediaJson = stableJson(mediaItems);
    const receiptJson = stableJson(receipt);
    const manifest = {
        schemaVersion: MANIFEST_SCHEMA,
        complete: true,
        sourceId: binding.sourceId,
        snapshotId: binding.snapshotId,
        inputArtifactSha256: binding.artifactSha256,
        inputMappingSha256: binding.mappingSha256,
        selection: binding.onlyExternalId === null
            ? { mode: 'full-snapshot' }
            : { mode: 'one-product', externalId: binding.onlyExternalId },
        originalImageCount: candidates.length,
        mediaItemCount: mediaItems.length,
        uniqueBlobCount: receipt.uniqueBlobCount,
        totalBytes: checkpoint.totalBytes,
        mediaItemsFile: manifestFileName,
        mediaItemsSha256: sha256(mediaJson),
        receiptFile: 'media-receipt.json',
        receiptSha256: sha256(receiptJson),
        setupTool: {
            enabled: false,
            ownerKey: 'productCode',
            scope: 'products',
            source: 'manifest',
            path: manifestFileName,
            galleryStrategy: 'reconcile-source-managed',
        },
        productionWrites: false,
    };
    return { manifest, mediaItems, mediaJson, receipt, receiptJson };
}

function verifyCompleteOutput(outputRoot, manifest) {
    if (manifest.schemaVersion !== MANIFEST_SCHEMA ||
        manifest.complete !== true ||
        manifest.productionWrites !== false) {
        throw new Error('Existing media manifest is incomplete or unsupported.');
    }
    for (const [fileName, expectedDigest, label] of [
        [manifest.mediaItemsFile, manifest.mediaItemsSha256, 'Media items'],
        [manifest.receiptFile, manifest.receiptSha256, 'Media receipt'],
    ]) {
        const file = assertContainedRegularFile(outputRoot, fileName, label);
        if (!DIGEST.test(String(expectedDigest || '')) ||
            sha256(fs.readFileSync(file)) !== expectedDigest) {
            throw new Error(`${label} hash differs from the media manifest.`);
        }
    }
    const receipt = readJson(path.join(outputRoot, manifest.receiptFile));
    if (receipt.schemaVersion !== RECEIPT_SCHEMA ||
        receipt.productionWrites !== false ||
        !Array.isArray(receipt.sources)) {
        throw new Error('Existing media receipt is incomplete or unsupported.');
    }
    const verifiedFiles = new Set();
    for (const source of receipt.sources) {
        if (verifiedFiles.has(source.file)) continue;
        verifyCompletedEntry(outputRoot, source);
        verifiedFiles.add(source.file);
    }
}

function assertPriorMediaRoot(previousMediaDirectory) {
    const outputRoot = path.resolve(previousMediaDirectory);
    const bundleRoot = path.dirname(outputRoot);
    for (const [directory, label] of [
        [bundleRoot, 'Previous import bundle'],
        [outputRoot, 'Previous media cache'],
    ]) {
        if (!fs.existsSync(directory)) {
            throw new Error(`${label} does not exist.`);
        }
        const stat = fs.lstatSync(directory);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new Error(`${label} must be a real directory.`);
        }
    }
    return { bundleRoot, outputRoot };
}

function loadVerifiedPriorMedia(previousMediaDirectory, sourceId) {
    const { bundleRoot, outputRoot } =
        assertPriorMediaRoot(previousMediaDirectory);
    const bundleManifestFile = assertContainedRegularFile(
        bundleRoot,
        'import-bundle-manifest.json',
        'Previous import bundle manifest',
    );
    const bundleManifest = readJson(bundleManifestFile);
    const mediaInventory = bundleManifest.files?.mediaManifest;
    if (bundleManifest.schemaVersion !== 'catalog-source-import-bundle-v1' ||
        bundleManifest.complete !== true ||
        bundleManifest.productionWrites !== false ||
        bundleManifest.sourceId !== sourceId ||
        bundleManifest.directories?.media !== 'media' ||
        path.resolve(bundleRoot, bundleManifest.directories.media) !== outputRoot ||
        mediaInventory?.file !== 'media/media-manifest.json' ||
        !DIGEST.test(String(mediaInventory?.sha256 || '')) ||
        !Number.isSafeInteger(mediaInventory?.bytes) ||
        mediaInventory.bytes < 1) {
        throw new Error('Previous import bundle media binding is invalid.');
    }
    const manifestFile = assertContainedRegularFile(
        bundleRoot,
        mediaInventory.file,
        'Previous media manifest',
    );
    const manifestBytes = fs.readFileSync(manifestFile);
    if (manifestBytes.length !== mediaInventory.bytes ||
        sha256(manifestBytes) !== mediaInventory.sha256) {
        throw new Error('Previous media manifest hash differs from its import bundle.');
    }
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (manifest.sourceId !== sourceId ||
        manifest.snapshotId !== bundleManifest.snapshotId ||
        manifest.selection?.mode !== 'full-snapshot') {
        throw new Error('Previous media manifest is not a full source snapshot.');
    }
    verifyCompleteOutput(outputRoot, manifest);
    const receipt = readJson(path.join(outputRoot, manifest.receiptFile));
    if (receipt.sourceId !== manifest.sourceId ||
        receipt.snapshotId !== manifest.snapshotId ||
        receipt.inputArtifactSha256 !== manifest.inputArtifactSha256 ||
        receipt.inputMappingSha256 !== manifest.inputMappingSha256 ||
        receipt.selectedOriginalCount !== manifest.originalImageCount ||
        receipt.sources.length !== receipt.selectedOriginalCount ||
        receipt.uniqueBlobCount !== manifest.uniqueBlobCount ||
        receipt.totalBytes !== manifest.totalBytes) {
        throw new Error('Previous media receipt does not match its manifest.');
    }
    const entries = new Map();
    for (const source of receipt.sources) {
        const sourceUrl = validatePublicImageUrl(source.sourceUrl).toString();
        const finalUrl = validatePublicImageUrl(source.finalUrl).toString();
        if (sourceUrl !== source.sourceUrl ||
            finalUrl !== source.finalUrl ||
            !DIGEST.test(String(source.sha256 || '')) ||
            !Number.isSafeInteger(source.bytes) ||
            source.bytes < 1 ||
            !TYPES[source.contentType]) {
            throw new Error('Previous media receipt source is invalid.');
        }
        const expectedFile =
            `blobs/${source.sha256.slice(0, 2)}/${source.sha256}.` +
            TYPES[source.contentType].extension;
        if (source.file !== expectedFile) {
            throw new Error('Previous media receipt blob path is not content-addressed.');
        }
        const cached = {
            bytes: source.bytes,
            contentType: source.contentType,
            file: source.file,
            finalUrl,
            sha256: source.sha256,
        };
        const existing = entries.get(sourceUrl);
        if (existing && stableJson(existing) !== stableJson(cached)) {
            throw new Error('Previous media receipt has conflicting source URL entries.');
        }
        entries.set(sourceUrl, cached);
    }
    if (entries.size !== receipt.networkUrlCount ||
        new Set([...entries.values()].map(entry => entry.sha256)).size !==
            receipt.uniqueBlobCount ||
        [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0) !==
            receipt.totalBytes) {
        throw new Error('Previous media receipt totals are inconsistent.');
    }
    return { entries, outputRoot };
}

function copyVerifiedPriorBlob(priorRoot, outputRoot, entry) {
    const sourceFile = assertContainedRegularFile(
        priorRoot,
        entry.file,
        'Previous media blob',
    );
    const blobsDirectory = path.join(outputRoot, 'blobs');
    ensureRealDirectory(blobsDirectory, 'Media blobs directory');
    const finalFile = path.join(outputRoot, entry.file);
    ensureRealDirectory(path.dirname(finalFile), 'Media digest directory');
    if (fs.existsSync(finalFile)) {
        verifyCompletedEntry(outputRoot, entry);
        return;
    }
    const temporaryDirectory = path.join(outputRoot, '.partial');
    ensureRealDirectory(temporaryDirectory, 'Media partial directory');
    const temporaryFile = path.join(
        temporaryDirectory,
        `${process.pid}-${crypto.randomBytes(8).toString('hex')}.cache`,
    );
    fs.copyFileSync(
        sourceFile,
        temporaryFile,
        fs.constants.COPYFILE_FICLONE | fs.constants.COPYFILE_EXCL,
    );
    try {
        const copied = fs.readFileSync(temporaryFile);
        if (copied.length !== entry.bytes ||
            sha256(copied) !== entry.sha256) {
            throw new Error('MEDIA_PRIOR_CACHE_HASH_MISMATCH');
        }
        const detected = detectImageType(entry.contentType, copied.subarray(0, 16));
        if (detected.contentType !== entry.contentType ||
            detected.extension !== TYPES[entry.contentType].extension) {
            throw new Error('MEDIA_PRIOR_CACHE_TYPE_MISMATCH');
        }
        fs.renameSync(temporaryFile, finalFile);
    } catch (error) {
        fs.rmSync(temporaryFile, { force: true });
        throw error;
    }
}

function prefillCheckpointFromPrior(checkpoint, networkUrls, prior, outputRoot, limits) {
    for (const url of networkUrls) {
        const entry = prior.entries.get(url);
        if (!entry) continue;
        if (entry.bytes > limits.maxFileBytes ||
            checkpoint.totalBytes + entry.bytes > limits.maxTotalBytes) {
            throw new Error('MEDIA_PRIOR_CACHE_EXCEEDS_LIMIT');
        }
        copyVerifiedPriorBlob(prior.outputRoot, outputRoot, entry);
        checkpoint.entries[url] = { ...entry };
        checkpoint.totalBytes += entry.bytes;
        checkpoint.completedCount += 1;
    }
}

async function materializeVerifiedMedia(options) {
    const {
        artifactBundle,
        beforeAttempt: suppliedBeforeAttempt = null,
        fetchImpl = globalThis.fetch,
        mappingsBundle,
        maxFileBytes = DEFAULT_MAX_FILE_BYTES,
        maxRedirects = 4,
        maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
        minimumRequestIntervalMs = DEFAULT_MINIMUM_REQUEST_INTERVAL_MS,
        onlyExternalId = null,
        outputDirectory,
        previousMediaDirectory = null,
        timeoutMs = 30_000,
    } = options;
    assertPositiveInteger(maxFileBytes, 'Maximum file bytes', 500 * 1024 * 1024);
    assertPositiveInteger(maxTotalBytes, 'Maximum total bytes');
    if (maxTotalBytes < maxFileBytes) {
        throw new Error('Maximum total bytes must be at least maximum file bytes.');
    }
    if (!Number.isSafeInteger(minimumRequestIntervalMs) ||
        minimumRequestIntervalMs < 1000 ||
        minimumRequestIntervalMs > 60_000) {
        throw new Error('Minimum request interval must be between 1000 and 60000 milliseconds.');
    }
    if (onlyExternalId !== null && !/^[1-9]\d*$/.test(onlyExternalId)) {
        throw new Error('--only must be a canonical positive external ID.');
    }
    if (typeof fetchImpl !== 'function') {
        throw new Error('A fetch implementation is required.');
    }
    const outputRoot = assertSafeOutputRoot(outputDirectory);
    const candidates = selectOriginalImageCandidates(
        artifactBundle.artifact,
        mappingsBundle.mappings,
        onlyExternalId,
    );
    const networkUrls = [...new Set(candidates.map(candidate => candidate.url))].sort();
    const binding = checkpointBinding({
        artifactSha256: artifactBundle.manifest.artifactSha256,
        mappingSha256: mappingsBundle.manifest.mappingSha256,
        maxFileBytes,
        maxTotalBytes,
        minimumRequestIntervalMs,
        onlyExternalId,
        snapshotId: artifactBundle.manifest.snapshotId,
        sourceId: artifactBundle.manifest.sourceId,
    });
    const checkpointFile = path.join(outputRoot, 'media-checkpoint.json');
    const manifestFile = path.join(outputRoot, 'media-manifest.json');
    if (fs.existsSync(manifestFile)) {
        const manifest = readJson(manifestFile);
        const checkpoint = readJson(checkpointFile);
        assertCheckpoint(checkpoint, binding, networkUrls.length);
        for (const entry of Object.values(checkpoint.entries)) {
            verifyCompletedEntry(outputRoot, entry);
        }
        if (checkpoint.status !== 'complete' ||
            manifest.inputArtifactSha256 !== binding.artifactSha256 ||
            manifest.inputMappingSha256 !== binding.mappingSha256 ||
            manifest.sourceId !== binding.sourceId ||
            manifest.snapshotId !== binding.snapshotId ||
            stableJson(manifest.selection) !== stableJson(
                binding.onlyExternalId === null
                    ? { mode: 'full-snapshot' }
                    : { mode: 'one-product', externalId: binding.onlyExternalId },
            )) {
            throw new Error('Existing media manifest does not match this materialization.');
        }
        verifyCompleteOutput(outputRoot, manifest);
        return { candidates, manifest, outputDirectory: outputRoot, resumedComplete: true };
    }

    const checkpointExists = fs.existsSync(checkpointFile);
    const checkpoint = checkpointExists
        ? readJson(checkpointFile)
        : newCheckpoint(binding, networkUrls.length);
    assertCheckpoint(checkpoint, binding, networkUrls.length);
    const previousMediaStat = previousMediaDirectory === null
        ? undefined
        : fs.lstatSync(path.resolve(previousMediaDirectory), {
            throwIfNoEntry: false,
        });
    if (!checkpointExists && previousMediaStat !== undefined) {
        const prior = loadVerifiedPriorMedia(
            previousMediaDirectory,
            binding.sourceId,
        );
        prefillCheckpointFromPrior(
            checkpoint,
            networkUrls,
            prior,
            outputRoot,
            { maxFileBytes, maxTotalBytes },
        );
        if (checkpoint.completedCount > 0) {
            writeJsonAtomic(checkpointFile, checkpoint);
        }
    }
    for (const entry of Object.values(checkpoint.entries)) {
        verifyCompletedEntry(outputRoot, entry);
    }
    const recomputedBytes = Object.values(checkpoint.entries)
        .reduce((sum, entry) => sum + entry.bytes, 0);
    if (recomputedBytes !== checkpoint.totalBytes ||
        Object.keys(checkpoint.entries).length !== checkpoint.completedCount) {
        throw new Error('Media checkpoint totals are inconsistent.');
    }
    const beforeAttempt = suppliedBeforeAttempt || createRequestStartGate({
        minimumIntervalMs: minimumRequestIntervalMs,
    });
    for (const url of networkUrls) {
        if (checkpoint.entries[url]) continue;
        const entry = await downloadImage(url, outputRoot, {
            beforeAttempt,
            fetchImpl,
            maxFileBytes,
            maxRedirects,
            remainingTotalBytes: maxTotalBytes - checkpoint.totalBytes,
            timeoutMs,
        });
        checkpoint.entries[url] = entry;
        checkpoint.totalBytes += entry.bytes;
        checkpoint.completedCount += 1;
        writeJsonAtomic(checkpointFile, checkpoint);
    }
    checkpoint.status = 'complete';
    writeJsonAtomic(checkpointFile, checkpoint);

    const documents = buildOutputDocuments({
        artifact: artifactBundle.artifact,
        binding,
        candidates,
        checkpoint,
    });
    atomicWrite(path.join(outputRoot, 'media-items.json'), documents.mediaJson);
    atomicWrite(path.join(outputRoot, 'media-receipt.json'), documents.receiptJson);
    writeJsonAtomic(manifestFile, documents.manifest);
    return {
        candidates,
        documents,
        manifest: documents.manifest,
        outputDirectory: outputRoot,
        resumedComplete: false,
    };
}

module.exports = {
    CHECKPOINT_SCHEMA,
    DEFAULT_MAX_FILE_BYTES,
    DEFAULT_MAX_TOTAL_BYTES,
    DEFAULT_MINIMUM_REQUEST_INTERVAL_MS,
    MANIFEST_SCHEMA,
    RECEIPT_SCHEMA,
    buildOutputDocuments,
    canonicalImagePath,
    detectImageType,
    downloadImage,
    loadVerifiedPriorMedia,
    materializeVerifiedMedia,
    prefillCheckpointFromPrior,
    validateMappingCoverage,
    selectOriginalImageCandidates,
    verifyCompleteOutput,
};
