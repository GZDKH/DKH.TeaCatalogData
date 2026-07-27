'use strict';

const crypto = require('crypto');
const { requestBuffer, validateAllowedUrl } = require('../lib/http');
const { reject } = require('../lib/errors');
const {
    PARSER_VERSION,
    assertPublicCatalogPayload,
    normalizeDetail,
    normalizeListPage,
} = require('./normalizer');
const { decodeEnvelope } = require('./decoder');

const SOURCE_HOSTS = Object.freeze(['zzctea.com', 'www.zzctea.com']);
const API_ORIGIN = 'https://zzctea.com';
const LIST_PATH = '/official/api/web/tea/hot';
const DETAIL_PATH = '/official/api/web/tea/single';
const PUBLIC_SIGNATURE_SUFFIX = 'rfq12';

function createZzcTeaConnector(options = {}) {
    const clock = options.clock || (() => Date.now());
    const request = options.request || requestBuffer;

    function signedUrl(path, query) {
        if (path !== LIST_PATH && path !== DETAIL_PATH) {
            reject('ZZCTEA_ENDPOINT_NOT_ALLOWLISTED');
        }
        const timestamp = String(clock());
        const sign = crypto
            .createHash('md5')
            .update(`${timestamp}${PUBLIC_SIGNATURE_SUFFIX}`)
            .digest('hex')
            .toUpperCase();
        const url = new URL(path, API_ORIGIN);
        for (const [key, value] of Object.entries({
            sign,
            timestamp,
            zzcVersion: '2',
            ...query,
        })) {
            url.searchParams.set(key, String(value));
        }
        return url;
    }

    async function fetchApi(path, query) {
        const url = signedUrl(path, query);
        if (url.pathname !== path) reject('ZZCTEA_ENDPOINT_NOT_ALLOWLISTED');
        const response = await request(url.toString(), {
            acceptedStatuses: [200],
            allowedHosts: SOURCE_HOSTS,
            maxResponseBytes: 8 * 1024 * 1024,
            retries: 3,
            timeoutMs: 30_000,
        });
        return response.body;
    }

    return Object.freeze({
        id: 'zzctea',
        connectorVersion: 'zzctea-connector-v2',
        parserVersion: PARSER_VERSION,
        defaultPageSize: 36,
        maximumPageSize: 250,
        requestParameters() {
            return {
                listEndpoint: `${API_ORIGIN}${LIST_PATH}`,
                detailEndpoint: `${API_ORIGIN}${DETAIL_PATH}`,
                canonicalHeadPattern: `${API_ORIGIN}/teaDetail/{externalId}.html`,
                filters: {
                    brandIds: '',
                    keywords: '',
                    platformId: '2',
                    year: '',
                    zzcVersion: '2',
                },
            };
        },
        assertRawPayloadAllowed(raw) {
            assertPublicCatalogPayload(decodeEnvelope(raw));
        },
        fetchListPage({ page, pageSize }) {
            if (!Number.isSafeInteger(page) || page <= 0) {
                throw new Error('page must be a positive integer.');
            }
            return fetchApi(LIST_PATH, {
                platformId: '2',
                page,
                pageSize,
                keywords: '',
                year: '',
                brandIds: '',
            });
        },
        parseListPage: normalizeListPage,
        fetchDetail({ externalId }) {
            if (!/^[1-9]\d*$/.test(String(externalId))) {
                throw new Error('ZZCTea external ID must be a positive integer.');
            }
            return fetchApi(DETAIL_PATH, { teaId: String(externalId) });
        },
        parseDetail: normalizeDetail,
        async resolveCanonicalUrl({ externalId }) {
            if (!/^[1-9]\d*$/.test(String(externalId))) {
                throw new Error('ZZCTea external ID must be a positive integer.');
            }
            const stable = `${API_ORIGIN}/teaDetail/${externalId}.html`;
            const response = await request(stable, {
                acceptedStatuses: [301, 302, 307, 308],
                allowedHosts: SOURCE_HOSTS,
                maxResponseBytes: 0,
                method: 'HEAD',
                retries: 2,
                timeoutMs: 20_000,
            });
            const location = response.headers.get('location');
            if (!location) reject('ZZCTEA_CANONICAL_REDIRECT_MISSING');
            const destination = validateAllowedUrl(new URL(location, stable).toString(), SOURCE_HOSTS);
            if (!/^\/tea\/[A-Za-z0-9][A-Za-z0-9-]*\.html$/.test(destination.pathname) ||
                destination.search ||
                destination.hash) {
                reject('ZZCTEA_CANONICAL_REDIRECT_INVALID');
            }
            destination.hostname = 'zzctea.com';
            return destination.toString();
        },
    });
}

module.exports = {
    API_ORIGIN,
    DETAIL_PATH,
    LIST_PATH,
    SOURCE_HOSTS,
    createZzcTeaConnector,
};
