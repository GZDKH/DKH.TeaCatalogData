'use strict';

const { performance } = require('perf_hooks');
const { reject } = require('./errors');

function createRequestStartGate(options = {}) {
    const {
        minimumIntervalMs = 0,
        now = () => performance.now(),
        sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
    } = options;
    if (typeof now !== 'function' ||
        typeof sleep !== 'function') {
        throw new Error('Request-start gate dependencies must be functions.');
    }
    if (!Number.isSafeInteger(minimumIntervalMs) ||
        minimumIntervalMs < 0 ||
        minimumIntervalMs > 60_000) {
        throw new Error('Minimum request interval must be between 0 and 60000 milliseconds.');
    }

    let nextStartAt = 0;
    let previousTurn = Promise.resolve();
    return async () => {
        let releaseTurn;
        const currentTurn = new Promise(resolve => {
            releaseTurn = resolve;
        });
        const waitForTurn = previousTurn;
        previousTurn = currentTurn;
        await waitForTurn;
        try {
            while (nextStartAt > now()) {
                await sleep(Math.max(1, Math.ceil(nextStartAt - now())));
            }
            nextStartAt = now() + minimumIntervalMs;
        } catch (error) {
            releaseTurn();
            throw error;
        }
        let released = false;
        return () => {
            if (released) return;
            released = true;
            releaseTurn();
        };
    };
}

function validateAllowedUrl(rawUrl, allowedHosts) {
    let url;
    try {
        url = new URL(rawUrl);
    } catch (error) {
        reject('SOURCE_URL_INVALID', error);
    }

    if (url.protocol !== 'https:' || url.username || url.password || url.port) {
        reject('SOURCE_URL_NOT_SAFE');
    }
    const hosts = new Set(allowedHosts.map(host => String(host).toLowerCase()));
    if (!hosts.has(url.hostname.toLowerCase())) {
        reject('SOURCE_HOST_NOT_ALLOWLISTED');
    }
    return url;
}

function retryDelayMs(response, attempt, baseDelayMs, maximumDelayMs = 60_000) {
    const retryAfter = response?.headers?.get?.('retry-after');
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.min(maximumDelayMs, Math.ceil(seconds * 1000));
        }
        const date = Date.parse(retryAfter);
        if (Number.isFinite(date)) {
            return Math.min(maximumDelayMs, Math.max(0, date - Date.now()));
        }
    }
    return Math.min(maximumDelayMs, baseDelayMs * Math.pow(2, attempt));
}

async function readBoundedBody(response, maxResponseBytes) {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        reject('SOURCE_RESPONSE_TOO_LARGE');
    }

    if (!response.body) {
        return Buffer.alloc(0);
    }

    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        length += buffer.length;
        if (length > maxResponseBytes) {
            reject('SOURCE_RESPONSE_TOO_LARGE');
        }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks, length);
}

async function requestBuffer(rawUrl, options = {}) {
    const {
        allowedHosts,
        acceptedStatuses = [200],
        beforeAttempt = async () => () => {},
        fetchImpl = globalThis.fetch,
        headers = {},
        maximumRetryDelayMs = 60_000,
        maxResponseBytes = 8 * 1024 * 1024,
        method = 'GET',
        retries = 3,
        retryBaseDelayMs = 500,
        sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
        timeoutMs = 30_000,
    } = options;

    if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
        throw new Error('requestBuffer requires an explicit host allowlist.');
    }
    if (typeof beforeAttempt !== 'function') {
        throw new Error('requestBuffer beforeAttempt must be a function.');
    }
    const url = validateAllowedUrl(rawUrl, allowedHosts);
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const releaseAttemptStart = await beforeAttempt();
        if (typeof releaseAttemptStart !== 'function') {
            throw new Error('requestBuffer beforeAttempt must return a release function.');
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            let responsePromise;
            try {
                responsePromise = fetchImpl(url, {
                    method,
                    headers: {
                        Accept: method === 'HEAD' ? '*/*' : 'application/json',
                        'User-Agent': 'DKH.TeaCatalogData catalog-source-ingestion/1',
                        ...headers,
                    },
                    redirect: 'manual',
                    signal: controller.signal,
                });
            } finally {
                releaseAttemptStart();
            }
            const response = await responsePromise;
            if (!acceptedStatuses.includes(response.status)) {
                if ((response.status === 429 || response.status >= 500) && attempt < retries) {
                    await sleep(retryDelayMs(
                        response,
                        attempt,
                        retryBaseDelayMs,
                        maximumRetryDelayMs,
                    ));
                    continue;
                }
                reject('SOURCE_HTTP_STATUS_UNEXPECTED');
            }
            return {
                body: method === 'HEAD'
                    ? Buffer.alloc(0)
                    : await readBoundedBody(response, maxResponseBytes),
                headers: response.headers,
                status: response.status,
                url: url.toString(),
            };
        } catch (error) {
            lastError = error;
            if (error?.code === 'SOURCE_RESPONSE_TOO_LARGE' ||
                error?.code === 'SOURCE_HTTP_STATUS_UNEXPECTED' ||
                attempt >= retries) {
                throw error;
            }
            await sleep(Math.min(
                maximumRetryDelayMs,
                retryBaseDelayMs * Math.pow(2, attempt),
            ));
        } finally {
            releaseAttemptStart();
            clearTimeout(timeout);
        }
    }
    reject('SOURCE_REQUEST_FAILED', lastError);
}

module.exports = {
    createRequestStartGate,
    readBoundedBody,
    requestBuffer,
    retryDelayMs,
    validateAllowedUrl,
};
