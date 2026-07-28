'use strict';

const assert = require('assert');
const {
    createRequestStartGate,
    requestBuffer,
    retryDelayMs,
    validateAllowedUrl,
} = require('./lib/http');

async function main() {
    assert.strictEqual(
        validateAllowedUrl('https://zzctea.com/teaList?page=1', ['zzctea.com']).hostname,
        'zzctea.com',
    );
    for (const url of [
        'http://zzctea.com/teaList?page=1',
        'https://user@zzctea.com/teaList?page=1',
        'https://zzctea.com:444/teaList?page=1',
        'https://127.0.0.1/teaList?page=1',
        'https://localhost/teaList?page=1',
        'https://evil.example/teaList?page=1',
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

    let clock = 0;
    const starts = [];
    const sleeps = [];
    const gate = createRequestStartGate({
        minimumIntervalMs: 1_000,
        now: () => clock,
        sleep: async delay => {
            sleeps.push(delay);
            clock += delay;
        },
    });
    await Promise.all(['first', 'second', 'third'].map(async value => {
        const release = await gate();
        starts.push({ clock, value });
        release();
    }));
    assert.deepStrictEqual(starts, [
        { clock: 0, value: 'first' },
        { clock: 1_000, value: 'second' },
        { clock: 2_000, value: 'third' },
    ]);
    assert.deepStrictEqual(sleeps, [1_000, 1_000]);
    assert.throws(
        () => createRequestStartGate({ minimumIntervalMs: -1 }),
        /Minimum request interval/,
    );

    let retryClock = 0;
    let retryAttempts = 0;
    const retryStarts = [];
    const retryGate = createRequestStartGate({
        minimumIntervalMs: 1_000,
        now: () => retryClock,
        sleep: async delay => {
            retryClock += delay;
        },
    });
    const pacedRetryResponse = await requestBuffer('https://zzctea.com/test', {
        allowedHosts: ['zzctea.com'],
        beforeAttempt: retryGate,
        fetchImpl: async () => {
            retryStarts.push(retryClock);
            retryAttempts += 1;
            return retryAttempts === 1
                ? new Response('', { status: 503 })
                : new Response('paced-ok', { status: 200 });
        },
        retries: 1,
        sleep: async delay => {
            retryClock += delay;
        },
    });
    assert.strictEqual(pacedRetryResponse.body.toString(), 'paced-ok');
    assert.deepStrictEqual(retryStarts, [0, 1_000]);

    let earlyWakeClock = 0;
    let earlyWakeCount = 0;
    const earlyWakeGate = createRequestStartGate({
        minimumIntervalMs: 1_000,
        now: () => earlyWakeClock,
        sleep: async delay => {
            earlyWakeCount += 1;
            earlyWakeClock += earlyWakeCount === 1 ? delay - 1 : delay;
        },
    });
    (await earlyWakeGate())();
    (await earlyWakeGate())();
    assert.strictEqual(earlyWakeClock, 1_000);
    assert.strictEqual(earlyWakeCount, 2);

    let timeoutSignalWasAborted;
    const timeoutResponse = await requestBuffer('https://zzctea.com/test', {
        allowedHosts: ['zzctea.com'],
        beforeAttempt: async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return () => {};
        },
        fetchImpl: async (_url, options) => {
            timeoutSignalWasAborted = options.signal.aborted;
            return new Response('not-aborted', { status: 200 });
        },
        retries: 0,
        timeoutMs: 1,
    });
    assert.strictEqual(timeoutSignalWasAborted, false);
    assert.strictEqual(timeoutResponse.body.toString(), 'not-aborted');

    console.log('test-catalog-source-http: OK');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
