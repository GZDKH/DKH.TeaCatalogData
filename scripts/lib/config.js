const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env from repo root (no external dependencies)
const envPath = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
            process.env[key] = value;
        }
    }
}

function required(name) {
    const val = process.env[name];
    if (!val) {
        console.error(`ERROR: ${name} is required. Set it in .env or as an environment variable.`);
        process.exit(1);
    }
    return val;
}

const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://localhost:8080';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:5005';
const REALM = process.env.KEYCLOAK_REALM || 'dkh';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'dkh-admin-gateway';
const ADMIN_GATEWAY_ACCESS_TOKEN = process.env.ADMIN_GATEWAY_ACCESS_TOKEN || process.env.DKH_ADMIN_GATEWAY_ACCESS_TOKEN || '';
const CLIENT_SECRET = ADMIN_GATEWAY_ACCESS_TOKEN ? process.env.KEYCLOAK_CLIENT_SECRET || '' : required('KEYCLOAK_CLIENT_SECRET');
const USERNAME = process.env.KEYCLOAK_USERNAME || '';
const PASSWORD = process.env.KEYCLOAK_PASSWORD || '';
const GRANT_TYPE = process.env.KEYCLOAK_GRANT_TYPE || (isPlaceholder(USERNAME) || !PASSWORD ? 'client_credentials' : 'password');
const TOKEN_RETRIES = Number(process.env.KEYCLOAK_TOKEN_RETRIES || 8);
const TOKEN_RETRY_DELAY_MS = Number(process.env.KEYCLOAK_TOKEN_RETRY_DELAY_MS || 500);
const TOKEN_TIMEOUT_MS = Number(process.env.KEYCLOAK_TOKEN_TIMEOUT_MS || 30000);

function isPlaceholder(value) {
    return !value || /^<.*>$/.test(value) || value.includes('your-');
}

async function getToken() {
    if (ADMIN_GATEWAY_ACCESS_TOKEN) {
        return ADMIN_GATEWAY_ACCESS_TOKEN;
    }

    const tokenParams = {
        grant_type: GRANT_TYPE,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
    };

    if (GRANT_TYPE === 'password') {
        if (isPlaceholder(USERNAME) || !PASSWORD) {
            throw new Error('KEYCLOAK_USERNAME and KEYCLOAK_PASSWORD are required for password grant.');
        }
        tokenParams.username = USERNAME;
        tokenParams.password = PASSWORD;
    }

    const body = new URLSearchParams(tokenParams).toString();

    let lastError = null;
    for (let attempt = 0; attempt <= TOKEN_RETRIES; attempt++) {
        try {
            return await requestToken(body);
        } catch (error) {
            lastError = error;
            if (attempt === TOKEN_RETRIES) break;
            await sleep(TOKEN_RETRY_DELAY_MS * Math.pow(2, attempt));
        }
    }

    throw lastError;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function requestToken(body) {
    return new Promise((resolve, reject) => {
        const tokenUrl = new URL(`/realms/${REALM}/protocol/openid-connect/token`, KEYCLOAK_URL);
        const transport = tokenUrl.protocol === 'https:' ? https : http;
        const req = transport.request(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                const json = JSON.parse(data);
                if (json.access_token) resolve(json.access_token);
                else reject(new Error('Token error: ' + data));
            });
        });
        req.on('error', reject);
        req.setTimeout(TOKEN_TIMEOUT_MS, () => {
            req.destroy(new Error(`Timeout after ${TOKEN_TIMEOUT_MS}ms for ${tokenUrl}`));
        });
        req.write(body);
        req.end();
    });
}

module.exports = {
    KEYCLOAK_URL,
    GATEWAY_URL,
    REALM,
    CLIENT_ID,
    CLIENT_SECRET,
    ADMIN_GATEWAY_ACCESS_TOKEN,
    USERNAME,
    PASSWORD,
    GRANT_TYPE,
    getToken,
};
