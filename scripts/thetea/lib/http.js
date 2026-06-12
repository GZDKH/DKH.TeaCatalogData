const http = require('http');
const https = require('https');

const maxSockets = Number(process.env.THETEA_HTTP_MAX_SOCKETS || 256);
const agents = {
    http: new http.Agent({ keepAlive: true, maxSockets }),
    https: new https.Agent({ keepAlive: true, maxSockets }),
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function requestText(url, options = {}) {
    const {
        headers = {},
        timeoutMs = 30000,
        retries = 2,
        retryDelayMs = 500,
    } = options;

    return attempt(url, headers, timeoutMs, retries, retryDelayMs, 0);
}

function attempt(url, headers, timeoutMs, retries, retryDelayMs, attemptNumber) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'http:' ? http : https;
        const agent = parsed.protocol === 'http:' ? agents.http : agents.https;

        const req = lib.request(parsed, {
            method: 'GET',
            agent,
            headers: {
                'Accept': 'application/json, text/markdown;q=0.9, text/plain;q=0.8',
                'User-Agent': 'DKH.TeaCatalogData TheTea ETL',
                ...headers,
            },
        }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => body += chunk);
            res.on('end', async () => {
                const status = res.statusCode || 0;
                if (status >= 200 && status < 300) {
                    resolve({ status, headers: res.headers, body });
                    return;
                }

                const retryable = status === 429 || status >= 500;
                if (retryable && attemptNumber < retries) {
                    await sleep(retryDelayMs * Math.pow(2, attemptNumber));
                    attempt(url, headers, timeoutMs, retries, retryDelayMs, attemptNumber + 1)
                        .then(resolve, reject);
                    return;
                }

                const error = new Error(`HTTP ${status} for ${url}: ${body.slice(0, 240)}`);
                error.status = status;
                error.body = body;
                reject(error);
            });
        });

        req.on('error', async error => {
            if (attemptNumber < retries) {
                await sleep(retryDelayMs * Math.pow(2, attemptNumber));
                attempt(url, headers, timeoutMs, retries, retryDelayMs, attemptNumber + 1)
                    .then(resolve, reject);
                return;
            }
            reject(error);
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Timeout after ${timeoutMs}ms for ${url}`));
        });

        req.end();
    });
}

async function requestJson(url, options = {}) {
    const response = await requestText(url, options);
    return JSON.parse(response.body);
}

module.exports = {
    requestText,
    requestJson,
};
