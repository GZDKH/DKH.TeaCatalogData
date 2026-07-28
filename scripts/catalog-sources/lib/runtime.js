'use strict';

const fs = require('fs');
const path = require('path');
const {
    atomicWrite,
    ensureDirectory,
    readJson,
    readJsonIfExists,
    safeSegment,
    sha256,
    stableJson,
    writeJsonAtomic,
} = require('./artifacts');
const { reject } = require('./errors');
const {
    hasForbiddenPublicText,
    isAllowedPublicImageReference,
    isForbiddenPublicKey,
} = require('./public-pii');

const CHECKPOINT_SCHEMA = 'catalog-source-checkpoint-v1';
const ARTIFACT_SCHEMA = 'catalog-source-artifact-v1';
const MANIFEST_SCHEMA = 'catalog-source-artifact-manifest-v1';

function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from(
        { length: Math.min(Math.max(1, limit), Math.max(1, items.length)) },
        async () => {
            while (true) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= items.length) return;
                results[index] = await worker(items[index], index);
            }
        },
    );
    return Promise.all(workers).then(() => results);
}

function relativeRawFile(kind, value) {
    if (kind === 'page') {
        return `raw/list/page-${String(value).padStart(5, '0')}.envelope.json`;
    }
    return `raw/details/${safeSegment(value, 'external ID')}.envelope.json`;
}

function validateCheckpoint(checkpoint, expected) {
    if (checkpoint.schemaVersion !== CHECKPOINT_SCHEMA ||
        checkpoint.sourceId !== expected.sourceId ||
        checkpoint.snapshotId !== expected.snapshotId ||
        checkpoint.connectorVersion !== expected.connectorVersion ||
        checkpoint.parserVersion !== expected.parserVersion ||
        checkpoint.artifactSchemaVersion !== ARTIFACT_SCHEMA ||
        checkpoint.pageSize !== expected.pageSize ||
        stableJson(checkpoint.requestParameters) !== stableJson(expected.requestParameters)) {
        reject('SOURCE_CHECKPOINT_INCOMPATIBLE');
    }
}

function createCheckpoint({ connector, snapshotId, pageSize, observedAt }) {
    return {
        schemaVersion: CHECKPOINT_SCHEMA,
        sourceId: connector.id,
        snapshotId,
        connectorVersion: connector.connectorVersion,
        parserVersion: connector.parserVersion,
        artifactSchemaVersion: ARTIFACT_SCHEMA,
        requestParameters: connector.requestParameters(),
        observedAt,
        pageSize,
        status: 'partial',
        totalCount: null,
        totalPages: null,
        terminalProbe: null,
        pages: [],
        details: {},
        diagnostics: [],
    };
}

function pageEntryByNumber(checkpoint, page) {
    return checkpoint.pages.find(entry => entry.page === page);
}

function parseStoredPage(snapshotDirectory, checkpointEntry, connector, pageSize) {
    const file = path.join(snapshotDirectory, checkpointEntry.file);
    const raw = fs.readFileSync(file);
    if (sha256(raw) !== checkpointEntry.sha256) {
        reject('SOURCE_CHECKPOINT_RAW_DIGEST_MISMATCH');
    }
    connector.assertRawPayloadAllowed(raw);
    return { raw, parsed: connector.parseListPage(raw, pageSize) };
}

async function verifyTerminalProbe(context, lastPageRaw, totalPages) {
    const {
        checkpoint,
        checkpointFile,
        connector,
        pageSize,
        snapshotDirectory,
    } = context;
    if (typeof connector.fetchTerminalProbe !== 'function' ||
        typeof connector.assertTerminalProbe !== 'function') {
        reject('SOURCE_TERMINAL_PROBE_UNSUPPORTED');
    }
    const requestedPage = totalPages + 1;
    let raw;
    if (checkpoint.terminalProbe) {
        raw = fs.readFileSync(path.join(
            snapshotDirectory,
            checkpoint.terminalProbe.file,
        ));
        if (sha256(raw) !== checkpoint.terminalProbe.sha256) {
            reject('SOURCE_CHECKPOINT_RAW_DIGEST_MISMATCH');
        }
    } else {
        raw = await connector.fetchTerminalProbe({
            page: requestedPage,
            pageSize,
            totalPages,
        });
        connector.assertRawPayloadAllowed(raw);
        const file = 'raw/list/terminal-probe.envelope.json';
        atomicWrite(path.join(snapshotDirectory, file), raw);
        checkpoint.terminalProbe = {
            file,
            requestedPage,
            sha256: sha256(raw),
        };
        writeJsonAtomic(checkpointFile, checkpoint);
    }
    connector.assertRawPayloadAllowed(raw);
    connector.assertTerminalProbe({
        lastPageRaw,
        pageSize,
        raw,
        requestedPage,
        totalPages,
    });
}

function validatePage(parsed, page, pageSize, expectedTotalCount, expectedTotalPages) {
    const hasTotalCount = parsed.totalCount !== null &&
        parsed.totalCount !== undefined;
    const hasTotalPages = parsed.totalPages !== null &&
        parsed.totalPages !== undefined;
    if (hasTotalCount === hasTotalPages) {
        reject('SOURCE_PAGINATION_METADATA_INVALID');
    }
    if (!Array.isArray(parsed.items) ||
        parsed.items.length === 0 ||
        parsed.items.length > pageSize) {
        reject('SOURCE_PAGE_COUNT_INVALID');
    }
    if (hasTotalCount) {
        if (!Number.isSafeInteger(parsed.totalCount) ||
            parsed.totalCount <= 0 ||
            parsed.totalCount > 100_000) {
            reject('SOURCE_TOTAL_COUNT_IMPLAUSIBLE');
        }
        if (expectedTotalPages !== null ||
            (expectedTotalCount !== null && parsed.totalCount !== expectedTotalCount)) {
            reject('SOURCE_TOTAL_COUNT_CHANGED_DURING_RUN');
        }
        if (parsed.items.length > parsed.totalCount) {
            reject('SOURCE_PAGE_COUNT_INVALID');
        }
    } else {
        if (!Number.isSafeInteger(parsed.totalPages) ||
            parsed.totalPages <= 0 ||
            parsed.totalPages > 10_000 ||
            parsed.page !== page ||
            parsed.pageSize !== pageSize) {
            reject('SOURCE_TOTAL_PAGES_IMPLAUSIBLE');
        }
        if (expectedTotalCount !== null ||
            (expectedTotalPages !== null && parsed.totalPages !== expectedTotalPages)) {
            reject('SOURCE_TOTAL_PAGES_CHANGED_DURING_RUN');
        }
        if (page > parsed.totalPages ||
            (page < parsed.totalPages && parsed.items.length !== pageSize)) {
            reject('SOURCE_INCOMPLETE_PAGINATION');
        }
    }
    const ids = parsed.items.map(item => String(item.externalId));
    if (new Set(ids).size !== ids.length) {
        reject('SOURCE_PAGE_DUPLICATE_EXTERNAL_ID');
    }
}

function assertCountDrift(totalCount, lastGoodManifest, options) {
    if (!lastGoodManifest) return;
    const previous = Number(lastGoodManifest.itemCount);
    if (!Number.isSafeInteger(previous) || previous <= 0) {
        reject('SOURCE_LAST_GOOD_MANIFEST_INVALID');
    }
    const dropRatio = (previous - totalCount) / previous;
    const growthRatio = totalCount / previous;
    if (dropRatio > options.maximumDropRatio ||
        growthRatio > options.maximumGrowthRatio) {
        reject('SOURCE_TOTAL_COUNT_DRIFT');
    }
}

async function collectPages(context) {
    const {
        checkpoint,
        checkpointFile,
        connector,
        pageSize,
        snapshotDirectory,
    } = context;
    const allItems = [];
    const allIds = new Set();
    const pageDigests = new Set();
    let page = 1;
    let totalPages = checkpoint.totalPages ?? null;
    let totalCount = totalPages === null
        ? checkpoint.totalCount
        : null;

    while (true) {
        let raw;
        let parsed;
        let entry = pageEntryByNumber(checkpoint, page);
        if (entry) {
            ({ raw, parsed } = parseStoredPage(snapshotDirectory, entry, connector, pageSize));
        } else {
            raw = await connector.fetchListPage({ page, pageSize });
            connector.assertRawPayloadAllowed(raw);
            parsed = connector.parseListPage(raw, pageSize);
            const file = relativeRawFile('page', page);
            atomicWrite(path.join(snapshotDirectory, file), raw);
            entry = {
                page,
                file,
                sha256: sha256(raw),
                itemIds: parsed.items.map(item => String(item.externalId)),
            };
            checkpoint.pages.push(entry);
            writeJsonAtomic(checkpointFile, checkpoint);
        }

        validatePage(parsed, page, pageSize, totalCount, totalPages);
        if (parsed.totalCount !== null && parsed.totalCount !== undefined) {
            totalCount = parsed.totalCount;
            checkpoint.totalCount = totalCount;
        } else {
            totalPages = parsed.totalPages;
            checkpoint.totalPages = totalPages;
        }

        if (pageDigests.has(entry.sha256)) {
            reject('SOURCE_PAGINATION_LOOP');
        }
        pageDigests.add(entry.sha256);
        for (const item of parsed.items) {
            const externalId = String(item.externalId);
            if (allIds.has(externalId)) {
                reject('SOURCE_CROSS_PAGE_DUPLICATE_EXTERNAL_ID');
            }
            allIds.add(externalId);
            allItems.push({
                externalId,
                listPayloadDigest: entry.sha256,
            });
        }

        if (totalPages !== null) {
            if (page === totalPages) {
                await verifyTerminalProbe(context, raw, totalPages);
                totalCount = allItems.length;
                checkpoint.totalCount = totalCount;
                break;
            }
        } else {
            if (allItems.length === totalCount) break;
            if (allItems.length > totalCount ||
                parsed.items.length < pageSize ||
                page >= Math.ceil(totalCount / pageSize) + 1) {
                reject('SOURCE_INCOMPLETE_PAGINATION');
            }
        }
        page += 1;
    }

    writeJsonAtomic(checkpointFile, checkpoint);
    return allItems;
}

function parseStoredDetail(snapshotDirectory, entry, connector, expectedExternalId) {
    const raw = fs.readFileSync(path.join(snapshotDirectory, entry.file));
    if (sha256(raw) !== entry.sha256) {
        reject('SOURCE_CHECKPOINT_RAW_DIGEST_MISMATCH');
    }
    connector.assertRawPayloadAllowed(raw);
    const item = connector.parseDetail(raw);
    if (String(item.externalId) !== expectedExternalId) {
        reject('SOURCE_DETAIL_EXTERNAL_ID_MISMATCH');
    }
    return { item, raw };
}

async function collectDetails(context, listItems) {
    const {
        checkpoint,
        checkpointFile,
        concurrency,
        connector,
        snapshotDirectory,
    } = context;
    const results = [];

    for (let offset = 0; offset < listItems.length; offset += concurrency) {
        const batch = listItems.slice(offset, offset + concurrency);
        const batchResults = await mapLimit(batch, concurrency, async listItem => {
            const externalId = listItem.externalId;
            const existing = checkpoint.details[externalId];
            if (existing) {
                const { item } = parseStoredDetail(
                    snapshotDirectory,
                    existing,
                    connector,
                    externalId,
                );
                return {
                    ...item,
                    sourceLinks: {
                        ...item.sourceLinks,
                        observedCanonicalUrl: existing.observedCanonicalUrl,
                    },
                    provenance: {
                        parserVersion: connector.parserVersion,
                        listPayloadDigest: listItem.listPayloadDigest,
                        detailPayloadDigest: existing.sha256,
                        observedAt: checkpoint.observedAt,
                    },
                };
            }

            const raw = await connector.fetchDetail({ externalId });
            connector.assertRawPayloadAllowed(raw);
            const item = connector.parseDetail(raw);
            if (String(item.externalId) !== externalId) {
                reject('SOURCE_DETAIL_EXTERNAL_ID_MISMATCH');
            }
            const observedCanonicalUrl = await connector.resolveCanonicalUrl({ externalId });
            const file = relativeRawFile('detail', externalId);
            const digest = sha256(raw);
            atomicWrite(path.join(snapshotDirectory, file), raw);
            return {
                ...item,
                sourceLinks: {
                    ...item.sourceLinks,
                    observedCanonicalUrl,
                },
                provenance: {
                    parserVersion: connector.parserVersion,
                    listPayloadDigest: listItem.listPayloadDigest,
                    detailPayloadDigest: digest,
                    observedAt: checkpoint.observedAt,
                },
                _checkpoint: {
                    file,
                    sha256: digest,
                    observedCanonicalUrl,
                },
            };
        });

        for (const result of batchResults) {
            const checkpointDetail = result._checkpoint;
            if (checkpointDetail) {
                checkpoint.details[String(result.externalId)] = checkpointDetail;
                delete result._checkpoint;
            }
            results.push(result);
        }
        writeJsonAtomic(checkpointFile, checkpoint);
    }
    return results;
}

function assertArtifactSafe(artifact) {
    function visit(current, path = []) {
        if (typeof current === 'string') {
            const isImageUrl =
                path.at(-1) === 'url' && path.at(-3) === 'images';
            const imageReferencePolicy =
                artifact.source?.imageReferencePolicy;
            if (isImageUrl && imageReferencePolicy) {
                if (!isAllowedPublicImageReference(
                    current,
                    imageReferencePolicy,
                ) || hasForbiddenPublicText(current, {
                    allowOpaqueImageNumericIdentifier: true,
                })) {
                    reject('SOURCE_ARTIFACT_PII_POLICY_VIOLATION');
                }
                return;
            }
            if (hasForbiddenPublicText(current)) {
                reject('SOURCE_ARTIFACT_PII_POLICY_VIOLATION');
            }
            return;
        }
        if (!current || typeof current !== 'object') return;
        for (const [key, child] of Object.entries(current)) {
            if (isForbiddenPublicKey(key)) {
                reject('SOURCE_ARTIFACT_PII_POLICY_VIOLATION');
            }
            visit(child, [...path, key]);
        }
    }
    visit(artifact);
}

function artifactSemanticDigest(artifact) {
    const semanticProjection = {
        ...artifact,
        semanticDigest: undefined,
        snapshot: {
            ...artifact.snapshot,
            observedAt: undefined,
        },
        items: artifact.items.map(item => ({
            ...item,
            provenance: {
                ...item.provenance,
                observedAt: undefined,
            },
        })),
    };
    return sha256(stableJson(semanticProjection));
}

function buildArtifact(checkpoint, items) {
    const sortedItems = [...items].sort((left, right) =>
        String(left.externalId).localeCompare(String(right.externalId), 'en', { numeric: true }));
    const rawPayloadDigest = sha256(stableJson({
        pages: checkpoint.pages
            .map(page => ({ page: page.page, sha256: page.sha256 }))
            .sort((left, right) => left.page - right.page),
        details: Object.entries(checkpoint.details)
            .map(([externalId, detail]) => ({ externalId, sha256: detail.sha256 }))
            .sort((left, right) => left.externalId.localeCompare(right.externalId, 'en', { numeric: true })),
        terminalProbe: checkpoint.terminalProbe
            ? {
                requestedPage: checkpoint.terminalProbe.requestedPage,
                sha256: checkpoint.terminalProbe.sha256,
            }
            : null,
    }));
    const artifact = {
        schemaVersion: ARTIFACT_SCHEMA,
        source: {
            id: checkpoint.sourceId,
            connectorVersion: checkpoint.connectorVersion,
            imageReferencePolicy:
                checkpoint.requestParameters?.publicImagePolicy || null,
            kind: 'public-reference-catalog',
            referencePricesAreRetailPrices: false,
        },
        snapshot: {
            id: checkpoint.snapshotId,
            observedAt: checkpoint.observedAt,
            parserVersion: checkpoint.parserVersion,
            rawPayloadDigest,
            complete: true,
            authoritativeForDeletion: false,
        },
        itemCount: sortedItems.length,
        items: sortedItems,
        deletions: [],
        diagnostics: [...checkpoint.diagnostics].sort(),
    };
    artifact.semanticDigest = artifactSemanticDigest(artifact);
    assertArtifactSafe(artifact);
    return artifact;
}

function publishArtifact(context, artifact, options = {}) {
    const {
        artifactDirectory,
        checkpoint,
        checkpointFile,
        lastGoodFile,
    } = context;
    const serialized = stableJson(artifact);
    const artifactSha256 = sha256(serialized);
    const artifactFileName = `${ARTIFACT_SCHEMA}.${artifactSha256}.json`;
    const artifactFile = path.join(artifactDirectory, artifactFileName);
    atomicWrite(artifactFile, serialized);
    checkpoint.status = 'complete';
    checkpoint.artifactSha256 = artifactSha256;
    writeJsonAtomic(checkpointFile, checkpoint);
    const portableCheckpointFileName = 'source-checkpoint.json';
    const portableCheckpoint = stableJson(checkpoint);
    atomicWrite(path.join(artifactDirectory, portableCheckpointFileName), portableCheckpoint);
    const manifest = {
        schemaVersion: MANIFEST_SCHEMA,
        sourceId: checkpoint.sourceId,
        connectorVersion: checkpoint.connectorVersion,
        snapshotId: checkpoint.snapshotId,
        parserVersion: checkpoint.parserVersion,
        observedAt: checkpoint.observedAt,
        itemCount: artifact.itemCount,
        rawPayloadDigest: artifact.snapshot.rawPayloadDigest,
        semanticDigest: artifact.semanticDigest,
        artifactFile: artifactFileName,
        artifactSha256,
        checkpointFile: portableCheckpointFileName,
        checkpointSha256: sha256(portableCheckpoint),
        complete: true,
        authoritativeForDeletion: false,
    };
    // The bundle manifest is deliberately the final file published in the artifact directory.
    writeJsonAtomic(path.join(artifactDirectory, 'artifact-manifest.json'), manifest);
    if (options.updateLastGood !== false) {
        writeJsonAtomic(lastGoodFile, manifest);
    }
    return { artifact, artifactFile, manifest };
}

function resolvePaths(options, connector) {
    const sourceId = safeSegment(connector.id, 'source ID');
    const snapshotId = safeSegment(options.snapshotId, 'snapshot ID');
    const snapshotDirectory = path.join(
        options.repositoryRoot,
        'sources',
        'catalog-sources',
        sourceId,
        'snapshots',
        snapshotId,
    );
    return {
        artifactDirectory: path.join(
            options.repositoryRoot,
            'artifacts',
            'catalog-sources',
            sourceId,
            snapshotId,
        ),
        checkpointFile: path.join(snapshotDirectory, 'checkpoint.json'),
        lastGoodFile: path.join(
            options.repositoryRoot,
            'sources',
            'catalog-sources',
            sourceId,
            'last-good.json',
        ),
        snapshotDirectory,
        snapshotId,
        sourceId,
    };
}

async function ingestSourceSnapshot(options) {
    const {
        concurrency = 4,
        connector,
        maximumDropRatio = 0.25,
        maximumGrowthRatio = 2,
        now = () => new Date(),
        pageSize = connector.defaultPageSize,
        repositoryRoot,
        resume = false,
        snapshotId,
    } = options;
    if (!connector || !repositoryRoot || !snapshotId) {
        throw new Error('connector, repositoryRoot, and snapshotId are required.');
    }
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || pageSize > connector.maximumPageSize) {
        throw new Error(`Page size must be between 1 and ${connector.maximumPageSize}.`);
    }
    if (!Number.isSafeInteger(concurrency) || concurrency <= 0 || concurrency > 32) {
        throw new Error('Concurrency must be between 1 and 32.');
    }
    if (!Number.isFinite(maximumDropRatio) ||
        maximumDropRatio < 0 ||
        maximumDropRatio >= 1 ||
        !Number.isFinite(maximumGrowthRatio) ||
        maximumGrowthRatio < 1) {
        throw new Error('Count-drift ratios are invalid.');
    }

    const paths = resolvePaths({ repositoryRoot, snapshotId }, connector);
    const existingCheckpoint = readJsonIfExists(paths.checkpointFile);
    if (existingCheckpoint && !resume) {
        throw new Error(`Snapshot '${paths.snapshotId}' already exists. Pass --resume.`);
    }
    const checkpoint = existingCheckpoint || createCheckpoint({
        connector,
        snapshotId: paths.snapshotId,
        pageSize,
        observedAt: now().toISOString(),
    });
    validateCheckpoint(checkpoint, {
        sourceId: connector.id,
        snapshotId: paths.snapshotId,
        connectorVersion: connector.connectorVersion,
        parserVersion: connector.parserVersion,
        pageSize,
        requestParameters: connector.requestParameters(),
    });
    const context = {
        ...paths,
        checkpoint,
        concurrency,
        connector,
        pageSize,
    };
    ensureDirectory(paths.snapshotDirectory);
    writeJsonAtomic(paths.checkpointFile, checkpoint);

    const listItems = await collectPages(context);
    assertCountDrift(
        listItems.length,
        readJsonIfExists(paths.lastGoodFile),
        { maximumDropRatio, maximumGrowthRatio },
    );
    const items = await collectDetails(context, listItems);
    if (items.length !== listItems.length) {
        reject('SOURCE_DETAIL_COUNT_MISMATCH');
    }
    return publishArtifact(context, buildArtifact(checkpoint, items));
}

async function replaySourceSnapshot(options) {
    const { connector, repositoryRoot, snapshotId } = options;
    const paths = resolvePaths({ repositoryRoot, snapshotId }, connector);
    const checkpoint = readJson(paths.checkpointFile);
    validateCheckpoint(checkpoint, {
        sourceId: connector.id,
        snapshotId: paths.snapshotId,
        connectorVersion: connector.connectorVersion,
        parserVersion: connector.parserVersion,
        pageSize: checkpoint.pageSize,
        requestParameters: connector.requestParameters(),
    });
    if (!checkpoint.totalCount || checkpoint.pages.length === 0) {
        reject('SOURCE_REPLAY_SNAPSHOT_INCOMPLETE');
    }
    const listItems = await collectPages({
        ...paths,
        checkpoint,
        connector,
        pageSize: checkpoint.pageSize,
    });
    const items = listItems.map(listItem => {
        const entry = checkpoint.details[listItem.externalId];
        if (!entry) reject('SOURCE_REPLAY_SNAPSHOT_INCOMPLETE');
        const { item } = parseStoredDetail(
            paths.snapshotDirectory,
            entry,
            connector,
            listItem.externalId,
        );
        return {
            ...item,
            sourceLinks: {
                ...item.sourceLinks,
                observedCanonicalUrl: entry.observedCanonicalUrl,
            },
            provenance: {
                parserVersion: connector.parserVersion,
                listPayloadDigest: listItem.listPayloadDigest,
                detailPayloadDigest: entry.sha256,
                observedAt: checkpoint.observedAt,
            },
        };
    });
    if (items.length !== checkpoint.totalCount) {
        reject('SOURCE_REPLAY_SNAPSHOT_INCOMPLETE');
    }
    return publishArtifact(
        {
            ...paths,
            checkpoint,
        },
        buildArtifact(checkpoint, items),
        { updateLastGood: false },
    );
}

module.exports = {
    ARTIFACT_SCHEMA,
    CHECKPOINT_SCHEMA,
    MANIFEST_SCHEMA,
    artifactSemanticDigest,
    assertArtifactSafe,
    buildArtifact,
    ingestSourceSnapshot,
    mapLimit,
    replaySourceSnapshot,
};
