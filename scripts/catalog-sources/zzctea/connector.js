'use strict';

const {
    createRequestStartGate,
    requestBuffer,
    validateAllowedUrl,
} = require('../lib/http');
const { sha256, stableJson } = require('../lib/artifacts');
const { reject } = require('../lib/errors');
const {
    PARSER_VERSION,
    normalizeDetail,
    normalizeListPage,
} = require('./normalizer');
const { decodeSanitizedEnvelope } = require('./sanitized-envelope');
const {
    PUBLIC_CANONICAL_POLICY,
    PUBLIC_CANONICAL_POLICY_VERSION,
    PUBLIC_IMAGE_POLICY,
    PUBLIC_IMAGE_POLICY_VERSION,
    assertPublicOpaquePath,
    assertPublicText,
} = require('./policy');
const {
    MAXIMUM_HTML_BYTES,
    sanitizeDetailHtml,
    sanitizeListHtml,
    sanitizeTerminalProbeHtml,
} = require('./nuxt');
const {
    MAXIMUM_ROBOTS_BYTES,
    ROBOTS_POLICY_VERSION,
    createRobotsPolicy,
} = require('./robots');

const SOURCE_HOSTS = PUBLIC_CANONICAL_POLICY.allowedHosts;
const SOURCE_ORIGIN = 'https://zzctea.com';
const CRAWLER_PRODUCT_TOKEN = 'DKH.TeaCatalogData';
const CRAWLER_USER_AGENT = 'DKH.TeaCatalogData catalog-source-ingestion/1';
const ROBOTS_URL = `${SOURCE_ORIGIN}/robots.txt`;
const LIST_PATH = '/teaList';
const DETAIL_PATH_PATTERN = '/teaDetail/{externalId}.html';
const DEFAULT_MINIMUM_REQUEST_INTERVAL_MS = 1_000;
const MAXIMUM_CANONICAL_REDIRECTS = 4;
const BRAND_MANIFEST_SCHEMA = 'zzctea-reviewed-brand-manifest-v1';
const DISCOVERY_SCHEMA = 'zzctea-brand-list-discovery-v1';
const REVIEWED_BRANDS = Object.freeze([
    Object.freeze({ externalId: '2', name: '大益' }),
    Object.freeze({ externalId: '835', name: '文源' }),
    Object.freeze({ externalId: '6', name: '今大福' }),
    Object.freeze({ externalId: '5', name: '中茶' }),
    Object.freeze({ externalId: '32', name: '润元昌' }),
    Object.freeze({ externalId: '55', name: '福今' }),
    Object.freeze({ externalId: '15', name: '雨林' }),
    Object.freeze({ externalId: '19', name: '陈升号' }),
    Object.freeze({ externalId: '234', name: '佰年尚普' }),
    Object.freeze({ externalId: '251', name: '杨聘号' }),
    Object.freeze({ externalId: '117', name: '广隆' }),
    Object.freeze({ externalId: '132', name: '番顺' }),
    Object.freeze({ externalId: '840', name: '合智汇' }),
]);
const REVIEWED_BRAND_MANIFEST_SHA256 = sha256(stableJson(REVIEWED_BRANDS));

function externalIdFromProductCode(code) {
    if (typeof code !== 'string') return null;
    const trimmed = code.trim();
    if (!/^ZZC(?:-|$)/iu.test(trimmed)) return null;
    if (code !== trimmed || !/^ZZC-[1-9]\d*$/u.test(code)) {
        reject('ZZCTEA_PRODUCT_CODE_INVALID');
    }
    return code.slice('ZZC-'.length);
}

function compareNumericIds(left, right) {
    return left.length - right.length || left.localeCompare(right, 'en');
}

function createZzcTeaConnector(options = {}) {
    const minimumRequestIntervalMs = options.minimumRequestIntervalMs ??
        DEFAULT_MINIMUM_REQUEST_INTERVAL_MS;
    if (!Number.isSafeInteger(minimumRequestIntervalMs) ||
        minimumRequestIntervalMs < DEFAULT_MINIMUM_REQUEST_INTERVAL_MS ||
        minimumRequestIntervalMs > 60_000) {
        throw new Error(
            'ZZCTea minimum request interval must be between 1000 and 60000 milliseconds.',
        );
    }
    const testRequest = options.testMode === true
        ? options.testRequest
        : null;
    if ((options.testMode === true) !== (typeof options.testRequest === 'function')) {
        throw new Error('ZZCTea test request requires explicit testMode.');
    }
    const beforeAttempt = createRequestStartGate({
        minimumIntervalMs: minimumRequestIntervalMs,
        now: options.now,
        sleep: options.sleep,
    });
    const request = testRequest || ((rawUrl, requestOptions) =>
        requestBuffer(rawUrl, {
            ...requestOptions,
            beforeAttempt,
            fetchImpl: options.fetchImpl,
            sleep: options.sleep,
        }));
    let robotsPolicyPromise;
    const canonicalUrlPromises = new Map();
    const detailDocumentPromises = new Map();

    async function loadRobotsPolicy() {
        const response = await request(ROBOTS_URL, {
            acceptedStatuses: [200],
            allowedHosts: SOURCE_HOSTS,
            headers: {
                Accept: 'text/plain',
                'User-Agent': CRAWLER_USER_AGENT,
            },
            maxResponseBytes: MAXIMUM_ROBOTS_BYTES,
            retries: 2,
            timeoutMs: 20_000,
        });
        if (response.status !== 200 || response.url !== ROBOTS_URL) {
            reject('ZZCTEA_ROBOTS_HTTP_INVALID');
        }
        return createRobotsPolicy(response, CRAWLER_PRODUCT_TOKEN);
    }

    async function assertRouteAllowed(path) {
        robotsPolicyPromise ||= loadRobotsPolicy();
        const policy = await robotsPolicyPromise;
        policy.assertAllows([path]);
    }

    async function fetchHtml(url) {
        const response = await request(url.toString(), {
            acceptedStatuses: [200],
            allowedHosts: SOURCE_HOSTS,
            headers: {
                Accept: 'text/html,application/xhtml+xml',
                'User-Agent': CRAWLER_USER_AGENT,
            },
            maxResponseBytes: MAXIMUM_HTML_BYTES,
            retries: 3,
            timeoutMs: 30_000,
        });
        return response.body;
    }

    async function fetchBrandListEnvelope({ brandId, page, pageSize }) {
        if (!/^[1-9]\d*$/u.test(String(brandId)) ||
            !Number.isSafeInteger(page) ||
            page <= 0 ||
            pageSize !== 36) {
            reject('ZZCTEA_BRAND_DISCOVERY_ARGUMENT_INVALID');
        }
        const url = new URL(LIST_PATH, SOURCE_ORIGIN);
        url.searchParams.set('page', String(page));
        url.searchParams.set('brandIds', String(brandId));
        await assertRouteAllowed(`${url.pathname}${url.search}`);
        return {
            raw: await fetchHtml(url),
            target: `${url.pathname}${url.search}`,
        };
    }

    function assertTerminalProbeEnvelope({
        lastPageRaw,
        pageSize,
        raw,
        requestedPage,
        totalPages,
    }) {
        const probe = decodeSanitizedEnvelope(raw);
        const lastPage = decodeSanitizedEnvelope(lastPageRaw);
        if (probe.kind !== 'terminal-probe' ||
            lastPage.kind !== 'list' ||
            probe.requestedPage !== String(requestedPage) ||
            probe.pageSize !== String(pageSize) ||
            probe.totalPages !== String(totalPages) ||
            !Array.isArray(probe.data) ||
            !Array.isArray(lastPage.data)) {
            reject('ZZCTEA_TERMINAL_PROBE_INVALID');
        }
        if (probe.data.length === 0) return;
        if (probe.reportedPage !== String(totalPages) ||
            JSON.stringify(probe.data) !== JSON.stringify(lastPage.data)) {
            reject('ZZCTEA_TERMINAL_PROBE_NOT_TERMINAL');
        }
    }

    async function discoverExternalIds() {
        const externalIds = new Set();
        const envelopes = [];
        for (const brand of REVIEWED_BRANDS) {
            let lastPageRaw;
            let totalPages = null;
            for (let page = 1; totalPages === null || page <= totalPages; page += 1) {
                const response = await fetchBrandListEnvelope({
                    brandId: brand.externalId,
                    page,
                    pageSize: 36,
                });
                const raw = sanitizeListHtml(response.raw, page, 36);
                const parsed = normalizeListPage(raw, 36);
                totalPages ??= parsed.totalPages;
                if (parsed.totalPages !== totalPages) {
                    reject('ZZCTEA_BRAND_DISCOVERY_PAGING_DRIFT');
                }
                for (const item of parsed.items) {
                    if (item.facts?.brand?.externalId !== brand.externalId) {
                        reject('ZZCTEA_BRAND_DISCOVERY_BRAND_MISMATCH');
                    }
                    externalIds.add(item.externalId);
                }
                envelopes.push({
                    brandId: brand.externalId,
                    kind: 'page',
                    page,
                    sha256: sha256(raw),
                    target: response.target,
                });
                lastPageRaw = raw;
            }
            const requestedPage = totalPages + 1;
            const terminalResponse = await fetchBrandListEnvelope({
                brandId: brand.externalId,
                page: requestedPage,
                pageSize: 36,
            });
            const terminalRaw = sanitizeTerminalProbeHtml(
                terminalResponse.raw,
                requestedPage,
                36,
                totalPages,
            );
            assertTerminalProbeEnvelope({
                lastPageRaw,
                pageSize: 36,
                raw: terminalRaw,
                requestedPage,
                totalPages,
            });
            envelopes.push({
                brandId: brand.externalId,
                kind: 'terminal-probe',
                page: requestedPage,
                sha256: sha256(terminalRaw),
                target: terminalResponse.target,
            });
        }
        const sortedExternalIds = [...externalIds].sort(compareNumericIds);
        if (sortedExternalIds.length === 0) {
            reject('ZZCTEA_BRAND_DISCOVERY_EMPTY');
        }
        return {
            externalIds: sortedExternalIds,
            requestParameters: {
                brandManifest: {
                    schemaVersion: BRAND_MANIFEST_SCHEMA,
                    brands: REVIEWED_BRANDS,
                    sha256: REVIEWED_BRAND_MANIFEST_SHA256,
                },
                discovery: {
                    schemaVersion: DISCOVERY_SCHEMA,
                    itemCount: sortedExternalIds.length,
                    externalIdsSha256: sha256(stableJson(sortedExternalIds)),
                    envelopeCount: envelopes.length,
                    envelopesSha256: sha256(stableJson(envelopes)),
                },
            },
        };
    }

    function validateCanonicalDestination(location, currentUrl) {
        if (!location) reject('ZZCTEA_CANONICAL_REDIRECT_MISSING');
        const destination = validateAllowedUrl(
            new URL(location, currentUrl).toString(),
            SOURCE_HOSTS,
        );
        if (!/^\/tea\/[A-Za-z0-9][A-Za-z0-9-]*\.html$/u.test(
            destination.pathname,
        ) ||
            destination.search ||
            destination.hash) {
            reject('ZZCTEA_CANONICAL_REDIRECT_INVALID');
        }
        assertPublicText(destination.hostname);
        assertPublicOpaquePath(destination.pathname);
        return destination;
    }

    function stableDetailUrl(externalId) {
        if (!/^[1-9]\d*$/.test(String(externalId))) {
            throw new Error('ZZCTea external ID must be a positive integer.');
        }
        const key = String(externalId);
        const path = DETAIL_PATH_PATTERN.replace('{externalId}', key);
        return { key, path, url: new URL(path, SOURCE_ORIGIN) };
    }

    function observeCanonicalUrl(externalId) {
        const { key, url: stableUrl } = stableDetailUrl(externalId);
        if (canonicalUrlPromises.has(key)) {
            return canonicalUrlPromises.get(key);
        }
        const promise = (async () => {
            let currentUrl = stableUrl;
            for (let redirectCount = 0;
                redirectCount <= MAXIMUM_CANONICAL_REDIRECTS;
                redirectCount += 1) {
                await assertRouteAllowed(currentUrl.pathname);
                const response = await request(currentUrl.toString(), {
                    acceptedStatuses: [200, 301, 302, 307, 308],
                    allowedHosts: SOURCE_HOSTS,
                    headers: {
                        'User-Agent': CRAWLER_USER_AGENT,
                    },
                    maxResponseBytes: 0,
                    method: 'HEAD',
                    retries: 2,
                    timeoutMs: 20_000,
                });
                if (response.status === 200) {
                    if (currentUrl.href === stableUrl.href) {
                        reject('ZZCTEA_CANONICAL_REDIRECT_MISSING');
                    }
                    const observedDestination = validateCanonicalDestination(
                        currentUrl.toString(),
                        currentUrl,
                    ).toString();
                    return observedDestination;
                }
                if (redirectCount === MAXIMUM_CANONICAL_REDIRECTS) {
                    reject('ZZCTEA_CANONICAL_REDIRECT_LIMIT_EXCEEDED');
                }
                currentUrl = validateCanonicalDestination(
                    response.headers.get('location'),
                    currentUrl,
                );
            }
            reject('ZZCTEA_CANONICAL_REDIRECT_LIMIT_EXCEEDED');
        })();
        canonicalUrlPromises.set(key, promise);
        return promise;
    }

    async function fetchDetailDocument(externalId) {
        const { key, url: stableUrl } = stableDetailUrl(externalId);
        if (detailDocumentPromises.has(key)) {
            return detailDocumentPromises.get(key);
        }
        const promise = (async () => {
            let currentUrl = canonicalUrlPromises.has(key)
                ? new URL(await canonicalUrlPromises.get(key))
                : stableUrl;
            for (let redirectCount = 0;
                redirectCount <= MAXIMUM_CANONICAL_REDIRECTS;
                redirectCount += 1) {
                await assertRouteAllowed(currentUrl.pathname);
                const response = await request(currentUrl.toString(), {
                    acceptedStatuses: [200, 301, 302, 307, 308],
                    allowedHosts: SOURCE_HOSTS,
                    headers: {
                        Accept: 'text/html,application/xhtml+xml',
                        'User-Agent': CRAWLER_USER_AGENT,
                    },
                    maxResponseBytes: MAXIMUM_HTML_BYTES,
                    method: 'GET',
                    retries: 3,
                    timeoutMs: 30_000,
                });
                if (response.status === 200) {
                    if (currentUrl.href === stableUrl.href) {
                        reject('ZZCTEA_CANONICAL_REDIRECT_MISSING');
                    }
                    const observedCanonicalUrl = validateCanonicalDestination(
                        currentUrl.toString(),
                        currentUrl,
                    ).toString();
                    canonicalUrlPromises.set(
                        key,
                        Promise.resolve(observedCanonicalUrl),
                    );
                    return {
                        observedCanonicalUrl,
                        raw: sanitizeDetailHtml(response.body, key),
                    };
                }
                if (redirectCount === MAXIMUM_CANONICAL_REDIRECTS) {
                    reject('ZZCTEA_CANONICAL_REDIRECT_LIMIT_EXCEEDED');
                }
                currentUrl = validateCanonicalDestination(
                    response.headers.get('location'),
                    currentUrl,
                );
            }
            reject('ZZCTEA_CANONICAL_REDIRECT_LIMIT_EXCEEDED');
        })();
        detailDocumentPromises.set(key, promise);
        try {
            return await promise;
        } finally {
            if (detailDocumentPromises.get(key) === promise) {
                detailDocumentPromises.delete(key);
            }
        }
    }

    return Object.freeze({
        id: 'zzctea',
        connectorVersion: 'zzctea-public-html-v7',
        parserVersion: PARSER_VERSION,
        defaultPageSize: 36,
        maximumPageSize: 36,
        discoverExternalIds,
        externalIdFromProductCode,
        requestParameters() {
            return {
                listPagePattern: `${SOURCE_ORIGIN}${LIST_PATH}?page={page}`,
                detailPagePattern: `${SOURCE_ORIGIN}${DETAIL_PATH_PATTERN}`,
                detailRedirectMode: 'bounded-manual-get-chain',
                canonicalHeadPattern: `${SOURCE_ORIGIN}${DETAIL_PATH_PATTERN}`,
                canonicalDestinationPathPattern: '/tea/{slug}.html',
                maximumCanonicalRedirects: MAXIMUM_CANONICAL_REDIRECTS,
                publicCanonicalPolicy: PUBLIC_CANONICAL_POLICY,
                publicCanonicalPolicyVersion:
                    PUBLIC_CANONICAL_POLICY_VERSION,
                publicImagePolicy: PUBLIC_IMAGE_POLICY,
                publicImagePolicyVersion: PUBLIC_IMAGE_POLICY_VERSION,
                requestPacing: testRequest
                    ? { mode: 'offline-test-double' }
                    : {
                        minimumIntervalMs: minimumRequestIntervalMs,
                        mode: 'minimum-start-interval',
                        timer: 'monotonic',
                    },
                robotsPolicy: {
                    cacheScope: 'connector-instance',
                    crawlerProductToken: CRAWLER_PRODUCT_TOKEN,
                    httpUserAgent: CRAWLER_USER_AGENT,
                    url: ROBOTS_URL,
                    validationVersion: ROBOTS_POLICY_VERSION,
                },
                transport: 'robots-allowed-public-html',
            };
        },
        assertRawPayloadAllowed(raw) {
            decodeSanitizedEnvelope(raw);
        },
        async fetchListPage({ page, pageSize }) {
            if (!Number.isSafeInteger(page) || page <= 0) {
                throw new Error('page must be a positive integer.');
            }
            if (pageSize !== 36) {
                reject('ZZCTEA_HTML_PAGE_SIZE_UNSUPPORTED');
            }
            const url = new URL(LIST_PATH, SOURCE_ORIGIN);
            url.searchParams.set('page', String(page));
            await assertRouteAllowed(`${url.pathname}${url.search}`);
            return sanitizeListHtml(await fetchHtml(url), page, pageSize);
        },
        parseListPage: normalizeListPage,
        async fetchTerminalProbe({ page, pageSize, totalPages }) {
            if (!Number.isSafeInteger(page) ||
                !Number.isSafeInteger(totalPages) ||
                page !== totalPages + 1 ||
                pageSize !== 36) {
                reject('ZZCTEA_TERMINAL_PROBE_ARGUMENT_INVALID');
            }
            const url = new URL(LIST_PATH, SOURCE_ORIGIN);
            url.searchParams.set('page', String(page));
            await assertRouteAllowed(`${url.pathname}${url.search}`);
            return sanitizeTerminalProbeHtml(
                await fetchHtml(url),
                page,
                pageSize,
                totalPages,
            );
        },
        assertTerminalProbe({
            lastPageRaw,
            pageSize,
            raw,
            requestedPage,
            totalPages,
        }) {
            assertTerminalProbeEnvelope({
                lastPageRaw,
                pageSize,
                raw,
                requestedPage,
                totalPages,
            });
        },
        async fetchDetail({ externalId }) {
            return (await fetchDetailDocument(externalId)).raw;
        },
        parseDetail: normalizeDetail,
        async resolveCanonicalUrl({ externalId }) {
            return observeCanonicalUrl(externalId);
        },
    });
}

module.exports = {
    CRAWLER_PRODUCT_TOKEN,
    CRAWLER_USER_AGENT,
    BRAND_MANIFEST_SCHEMA,
    DEFAULT_MINIMUM_REQUEST_INTERVAL_MS,
    DETAIL_PATH_PATTERN,
    DISCOVERY_SCHEMA,
    LIST_PATH,
    REVIEWED_BRANDS,
    REVIEWED_BRAND_MANIFEST_SHA256,
    ROBOTS_URL,
    SOURCE_HOSTS,
    SOURCE_ORIGIN,
    createZzcTeaConnector,
    externalIdFromProductCode,
};
