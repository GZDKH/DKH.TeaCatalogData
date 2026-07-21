function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function createRequestStartGate(minIntervalMs, options = {}) {
    const interval = Math.max(0, Number(minIntervalMs) || 0);
    const now = options.now || Date.now;
    const wait = options.sleep || sleep;
    let nextStartAt = 0;
    let tail = Promise.resolve();

    return function waitForRequestStart() {
        const turn = tail.then(async () => {
            const delay = Math.max(0, nextStartAt - now());
            if (delay > 0) await wait(delay);
            nextStartAt = now() + interval;
        });
        tail = turn.catch(() => {});
        return turn;
    };
}

module.exports = { createRequestStartGate };
