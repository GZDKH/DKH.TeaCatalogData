'use strict';

const assert = require('assert');
const { requestBuffer, retryDelayMs, validateAllowedUrl } = require('./lib/http');

async function main() {
    assert.strictEqual(
        validateAllowedUrl('https://zzctea.com/official/api/web/tea/hot', ['zzctea.com']).hostname,
        'zzctea.com',
    );
    for (const url of [
        'http://zzctea.com/official/api/web/tea/hot',
        'https://user@zzctea.com/official/api/web/tea/hot',
        'https://zzctea.com:444/official/api/web/tea/hot',
        'https://127.0.0.1/official/api/web/tea/hot',
        'https://localhost/official/api/web/tea/hot',
        'https://evil.example/official/api/web/tea/hot',
    ]) {
        assert.throws(() => validateAllowedUrl(url, ['zzctea.com']));
    }

    let attempts = 0;
    const response = await requestBuffer('https://zzctea.com/test', {
        allowedHosts: ['zzctea.com'],
        fetchImpl: async () => {
            attempts += 1;
            return attempts === 1
                ? new Response('', { status: 503 })
                : new Response('ok', { status: 200 });
        },
        retries: 1,
        sleep: async () => {},
    });
    assert.strictEqual(response.body.toString(), 'ok');
    assert.strictEqual(attempts, 2);

    await assert.rejects(
        requestBuffer('https://zzctea.com/test', {
            allowedHosts: ['zzctea.com'],
            fetchImpl: async () => new Response('123456789', { status: 200 }),
            maxResponseBytes: 8,
            retries: 0,
        }),
        error => error.code === 'SOURCE_RESPONSE_TOO_LARGE',
    );
    assert.strictEqual(
        retryDelayMs(
            { headers: new Headers({ 'retry-after': '86400' }) },
            0,
            500,
            60_000,
        ),
        60_000,
    );

    console.log('test-catalog-source-http: OK');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
