'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    CRAWLER_PRODUCT_TOKEN,
    CRAWLER_USER_AGENT,
    DETAIL_PATH_PATTERN,
    LIST_PATH,
    ROBOTS_URL,
    createZzcTeaConnector,
} = require('./zzctea/connector');
const {
    extractNuxtState,
    sanitizeDetailHtml,
    sanitizeTerminalProbeHtml,
} = require('./zzctea/nuxt');
const { MAXIMUM_ROBOTS_BYTES } = require('./zzctea/robots');

const FIXTURES = path.join(__dirname, 'zzctea', 'fixtures');

function fixture(name) {
    return fs.readFileSync(path.join(FIXTURES, name));
}

function nuxtHtml(data) {
    return Buffer.from(
        `<script>window.__NUXT__=${JSON.stringify({
            layout: 'default',
            data: [data],
        })};</script>`,
    );
}

function robotsResponse(body = fixture('robots.txt')) {
    return {
        status: 200,
        url: ROBOTS_URL,
        headers: new Headers({ 'content-type': 'text/plain; charset=utf-8' }),
        body,
    };
}

function requestWithRobots(handler) {
    return async (rawUrl, options) =>
        rawUrl === ROBOTS_URL
            ? robotsResponse()
            : handler(rawUrl, options);
}

function connectorWithRobotsPolicy(policy) {
    return createZzcTeaConnector({
        request: async rawUrl => {
            const url = new URL(rawUrl);
            if (rawUrl === ROBOTS_URL) {
                return robotsResponse(Buffer.from(policy));
            }
            return {
                status: 200,
                headers: new Headers({
                    'content-type': 'text/html; charset=utf-8',
                }),
                body: url.searchParams.get('page') === '2'
                    ? nuxtHtml({
                        initialHotTea: [],
                        initialSearch: { page: 2, pageSize: 36 },
                        totalPages: 1,
                    })
                    : fixture('list-page.html'),
            };
        },
    });
}

async function main() {
    const calls = [];
    const mockRequest = async (rawUrl, options) => {
        const url = new URL(rawUrl);
        calls.push({ url, options });
        assert.ok(!url.pathname.includes('/api/'));
        assert.ok(!url.pathname.includes('/official/'));
        if (rawUrl === ROBOTS_URL) return robotsResponse();
        if (options.method === 'HEAD') {
            return {
                status: 302,
                headers: new Headers({
                    location: 'https://www.zzctea.com/tea/fixture-case-tea.html',
                }),
                body: Buffer.alloc(0),
            };
        }
        return {
            status: 200,
            headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
            body: url.pathname === LIST_PATH
                ? url.searchParams.get('page') === '2'
                    ? nuxtHtml({
                        initialHotTea: [],
                        initialSearch: { page: 2, pageSize: 36 },
                        totalPages: 1,
                    })
                    : fixture('list-page.html')
                : fixture('detail-case.html'),
        };
    };
    const connector = createZzcTeaConnector({ request: mockRequest });
    assert.deepStrictEqual(connector.requestParameters().robotsPolicy, {
        cacheScope: 'connector-instance',
        crawlerProductToken: CRAWLER_PRODUCT_TOKEN,
        httpUserAgent: CRAWLER_USER_AGENT,
        url: ROBOTS_URL,
        validationVersion: 'zzctea-robots-agent-query-v2',
    });
    const pageRaw = await connector.fetchListPage({ page: 1, pageSize: 36 });
    const page = connector.parseListPage(pageRaw, 36);
    assert.strictEqual(page.page, 1);
    assert.strictEqual(page.pageSize, 36);
    assert.strictEqual(page.totalCount, null);
    assert.strictEqual(page.totalPages, 1);
    assert.strictEqual(page.items.length, 2);
    const terminalRaw = await connector.fetchTerminalProbe({
        page: 2,
        pageSize: 36,
        totalPages: 1,
    });
    connector.assertTerminalProbe({
        lastPageRaw: pageRaw,
        pageSize: 36,
        raw: terminalRaw,
        requestedPage: 2,
        totalPages: 1,
    });
    const repeatedTerminalRaw = sanitizeTerminalProbeHtml(
        nuxtHtml({
            initialHotTea: JSON.parse(pageRaw).data,
            initialSearch: { page: 1, pageSize: 36 },
            totalPages: 1,
        }),
        2,
        36,
        1,
    );
    connector.assertTerminalProbe({
        lastPageRaw: pageRaw,
        pageSize: 36,
        raw: repeatedTerminalRaw,
        requestedPage: 2,
        totalPages: 1,
    });
    const newItemTerminalRaw = sanitizeTerminalProbeHtml(
        nuxtHtml({
            initialHotTea: [{ id: 99999, name: 'Unexpected Tea' }],
            initialSearch: { page: 2, pageSize: 36 },
            totalPages: 1,
        }),
        2,
        36,
        1,
    );
    assert.throws(
        () => connector.assertTerminalProbe({
            lastPageRaw: pageRaw,
            pageSize: 36,
            raw: newItemTerminalRaw,
            requestedPage: 2,
            totalPages: 1,
        }),
        error => error.code === 'ZZCTEA_TERMINAL_PROBE_NOT_TERMINAL',
    );

    const detailRaw = await connector.fetchDetail({ externalId: '17627' });
    const detail = connector.parseDetail(detailRaw);
    assert.strictEqual(detail.externalId, '17627');
    assert.strictEqual(
        await connector.resolveCanonicalUrl({ externalId: '17627' }),
        'https://www.zzctea.com/tea/fixture-case-tea.html',
    );

    assert.deepStrictEqual(
        calls.map(call => `${call.url.pathname}${call.url.search}`),
        [
            '/robots.txt',
            '/teaList?page=1',
            '/teaList?page=2',
            '/teaDetail/17627.html',
            '/teaDetail/17627.html',
        ],
    );
    assert.strictEqual(calls.filter(call => call.url.pathname === '/robots.txt').length, 1);
    assert.strictEqual(calls[0].options.headers.Accept, 'text/plain');
    assert.strictEqual(calls[0].options.maxResponseBytes, MAXIMUM_ROBOTS_BYTES);
    assert.ok(calls.every(call =>
        call.options.headers['User-Agent'] === CRAWLER_USER_AGENT));
    assert.ok(calls.slice(1, 4).every(call =>
        call.options.headers.Accept === 'text/html,application/xhtml+xml'));
    assert.ok(calls.slice(1, 4).every(call =>
        call.options.acceptedStatuses.join(',') === '200'));
    assert.strictEqual(calls[4].options.method, 'HEAD');
    assert.deepStrictEqual(calls[4].options.acceptedStatuses, [301, 302, 307, 308]);
    assert.strictEqual(calls[4].options.maxResponseBytes, 0);
    assert.ok([pageRaw, terminalRaw, detailRaw].every(raw =>
        !/(?:sellList|buyList|phone|mobile|customer|avatar)/iu.test(raw.toString('utf8')) &&
        !/(?<!\d)1[3-9]\d{9}(?!\d)/u.test(raw.toString('utf8'))));

    const forbiddenSiblingKey = ['sell', 'List'].join('');
    const forbiddenValue = ['138', '0013', '8000'].join('');
    const detailWithExcludedSibling = nuxtHtml({
        teaDetail: {
            id: 17627,
            teaId: 17627,
            name: 'Fixture Case Tea',
            specification: '357克/片',
        },
        [forbiddenSiblingKey]: [{
            [['ph', 'one'].join('')]: forbiddenValue,
        }],
    });
    const sanitized = sanitizeDetailHtml(detailWithExcludedSibling, '17627');
    assert.strictEqual(
        JSON.parse(sanitized).data.name,
        'Fixture Case Tea',
    );
    assert.ok(!sanitized.includes(forbiddenValue));
    assert.ok(!sanitized.includes(forbiddenSiblingKey));

    const unsafeProductKey = ['ph', 'one'].join('');
    await assert.rejects(
        async () => sanitizeDetailHtml(nuxtHtml({
            teaDetail: {
                id: 17627,
                name: 'Fixture Case Tea',
                [unsafeProductKey]: forbiddenValue,
            },
        }), '17627'),
        error => error.code === 'ZZCTEA_PUBLIC_PAYLOAD_PII_DETECTED',
    );
    await assert.rejects(
        connector.fetchListPage({ page: 1, pageSize: 35 }),
        error => error.code === 'ZZCTEA_HTML_PAGE_SIZE_UNSUPPORTED',
    );
    await assert.rejects(
        async () => sanitizeDetailHtml(
            Buffer.from(
                '<script>window.__NUXT__={data:[{teaDetail:{id:17627,name:"A"}}]};' +
                '</script><script>window.__NUXT__={data:[]};</script>',
            ),
            '17627',
        ),
        error => error.code === 'ZZCTEA_NUXT_ASSIGNMENT_INVALID',
    );
    for (const serialization of [
        `{data:[{values:[${Array.from({ length: 10_001 }, () => 'null').join(',')}]}]}`,
        `{data:[{values:{${Array.from(
            { length: 2_001 },
            (_, index) => `p${index}:null`,
        ).join(',')}}}]}`,
        `(function(${Array.from(
            { length: 4_097 },
            (_, index) => `p${index}`,
        ).join(',')}){return {data:[{}]}})(${Array.from(
            { length: 4_097 },
            () => 'null',
        ).join(',')})`,
    ]) {
        assert.throws(
            () => extractNuxtState(Buffer.from(
                `<script>window.__NUXT__=${serialization};</script>`,
            )),
            error => error.code === 'ZZCTEA_NUXT_SERIALIZATION_INVALID',
        );
    }

    const missingRedirect = createZzcTeaConnector({
        request: requestWithRobots(async () => ({
            status: 302,
            headers: new Headers(),
            body: Buffer.alloc(0),
        })),
    });
    await assert.rejects(
        missingRedirect.resolveCanonicalUrl({ externalId: '17627' }),
        error => error.code === 'ZZCTEA_CANONICAL_REDIRECT_MISSING',
    );

    for (const [location, code] of [
        ['https://evil.example/tea/fixture-case-tea.html', 'SOURCE_HOST_NOT_ALLOWLISTED'],
        ['/tea/fixture-case-tea.html?tracking=1', 'ZZCTEA_CANONICAL_REDIRECT_INVALID'],
        ['/tea/fixture-case-tea.html#details', 'ZZCTEA_CANONICAL_REDIRECT_INVALID'],
        ['/tea/fixture_case.html', 'ZZCTEA_CANONICAL_REDIRECT_INVALID'],
        ['/teaDetail/17627.html', 'ZZCTEA_CANONICAL_REDIRECT_INVALID'],
        ['/tea/item-13800138000.html', 'ZZCTEA_PUBLIC_PAYLOAD_PII_DETECTED'],
    ]) {
        const invalidRedirect = createZzcTeaConnector({
            request: requestWithRobots(async () => ({
                status: 301,
                headers: new Headers({ location }),
                body: Buffer.alloc(0),
            })),
        });
        await assert.rejects(
            invalidRedirect.resolveCanonicalUrl({ externalId: '17627' }),
            error => error.code === code,
        );
    }

    for (const [response, code] of [
        [
            robotsResponse(Buffer.from(
                'User-agent: *\nDisallow: /teaList\nAllow: /teaDetail/\n',
            )),
            'ZZCTEA_ROBOTS_ROUTE_DISALLOWED',
        ],
        [
            robotsResponse(Buffer.from('this is not robots syntax')),
            'ZZCTEA_ROBOTS_POLICY_INVALID',
        ],
        [
            { ...robotsResponse(), status: 302 },
            'ZZCTEA_ROBOTS_HTTP_INVALID',
        ],
        [
            { ...robotsResponse(), url: 'https://www.zzctea.com/robots.txt' },
            'ZZCTEA_ROBOTS_HTTP_INVALID',
        ],
        [
            robotsResponse(Buffer.alloc(MAXIMUM_ROBOTS_BYTES + 1, 0x61)),
            'ZZCTEA_ROBOTS_POLICY_INVALID',
        ],
    ]) {
        const blocked = createZzcTeaConnector({
            request: async rawUrl => {
                assert.strictEqual(rawUrl, ROBOTS_URL);
                return response;
            },
        });
        await assert.rejects(
            blocked.fetchListPage({ page: 1, pageSize: 36 }),
            error => error.code === code,
        );
    }
    const queryBlocked = connectorWithRobotsPolicy(
        'User-agent: *\nAllow: /\nDisallow: /teaList?\n',
    );
    await assert.rejects(
        queryBlocked.fetchListPage({ page: 1, pageSize: 36 }),
        error => error.code === 'ZZCTEA_ROBOTS_ROUTE_DISALLOWED',
    );

    const specificBlocked = connectorWithRobotsPolicy(
        'User-agent: *\nAllow: /\n' +
        'User-agent: dkh.teacatalogdata\nDisallow: /teaList\n',
    );
    await assert.rejects(
        specificBlocked.fetchListPage({ page: 1, pageSize: 36 }),
        error => error.code === 'ZZCTEA_ROBOTS_ROUTE_DISALLOWED',
    );
    const longestAgentBlocked = connectorWithRobotsPolicy(
        'User-agent: DKH\nAllow: /\n' +
        'User-agent: dKh.TeAcAtAlOgDaTa\nDisallow: /teaList\n',
    );
    await assert.rejects(
        longestAgentBlocked.fetchListPage({ page: 1, pageSize: 36 }),
        error => error.code === 'ZZCTEA_ROBOTS_ROUTE_DISALLOWED',
    );

    for (const policy of [
        'User-agent: *\nDisallow: /teaList\n' +
            'User-agent: DKH.TEACATALOGDATA\nAllow: /teaList\n',
        'User-agent: *\nAllow: /teaList\n' +
            'User-agent: UnrelatedCrawler\nDisallow: /teaList\n',
        'User-agent: DKH\nDisallow: /teaList\n' +
            'User-agent: DKH.TeaCatalogData\nAllow: /teaList\n',
    ]) {
        const allowed = connectorWithRobotsPolicy(policy);
        assert.strictEqual(
            allowed.parseListPage(
                await allowed.fetchListPage({ page: 1, pageSize: 36 }),
                36,
            ).items.length,
            2,
        );
    }

    const equalGroupsCombined = connectorWithRobotsPolicy(
        'User-agent: DKH.TeaCatalogData\nAllow: /\n' +
        'User-agent: dkh.teacatalogdata\nDisallow: /teaList?\n',
    );
    await assert.rejects(
        equalGroupsCombined.fetchListPage({ page: 1, pageSize: 36 }),
        error => error.code === 'ZZCTEA_ROBOTS_ROUTE_DISALLOWED',
    );

    const probeQueryBlocked = connectorWithRobotsPolicy(
        'User-agent: DKH.TeaCatalogData\n' +
        'Allow: /teaList?page=1\nDisallow: /teaList?\n',
    );
    const probeListRaw = await probeQueryBlocked.fetchListPage({
        page: 1,
        pageSize: 36,
    });
    assert.strictEqual(
        probeQueryBlocked.parseListPage(probeListRaw, 36).items.length,
        2,
    );
    await assert.rejects(
        probeQueryBlocked.fetchTerminalProbe({
            page: 2,
            pageSize: 36,
            totalPages: 1,
        }),
        error => error.code === 'ZZCTEA_ROBOTS_ROUTE_DISALLOWED',
    );

    const detailBlocked = createZzcTeaConnector({
        request: async rawUrl => {
            assert.strictEqual(rawUrl, ROBOTS_URL);
            return robotsResponse(Buffer.from(
                'User-agent: *\nAllow: /teaList\nDisallow: /teaDetail/\n',
            ));
        },
    });
    await assert.rejects(
        detailBlocked.fetchDetail({ externalId: '17627' }),
        error => error.code === 'ZZCTEA_ROBOTS_ROUTE_DISALLOWED',
    );

    assert.strictEqual(DETAIL_PATH_PATTERN, '/teaDetail/{externalId}.html');
    console.log('test-zzctea-connector: OK');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
