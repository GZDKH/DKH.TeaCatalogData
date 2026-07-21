const assert = require('assert');
const { createRequestStartGate } = require('./lib/request-start-gate');
const { parseRetryAfterMs, responseRetryDelay } = require('./lib/http');

async function main() {
    let currentTime = 1000;
    const sleeps = [];
    const gate = createRequestStartGate(550, {
        now: () => currentTime,
        sleep: async delay => {
            sleeps.push(delay);
            currentTime += delay;
        },
    });

    await Promise.all([gate(), gate(), gate()]);
    assert.deepStrictEqual(sleeps, [550, 550]);
    const immediateGate = createRequestStartGate(0, {
        now: () => currentTime,
        sleep: async delay => sleeps.push(delay),
    });
    await Promise.all([immediateGate(), immediateGate()]);
    assert.deepStrictEqual(sleeps, [550, 550]);
    assert.strictEqual(parseRetryAfterMs('12'), 12000);
    assert.strictEqual(parseRetryAfterMs('invalid'), null);
    assert.strictEqual(responseRetryDelay(429, {}, 500, 0), 60000);
    assert.strictEqual(responseRetryDelay(429, { 'retry-after': '3' }, 500, 0), 3000);
    assert.strictEqual(responseRetryDelay(500, {}, 500, 2), 2000);
    console.log('test-request-limits: OK');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
