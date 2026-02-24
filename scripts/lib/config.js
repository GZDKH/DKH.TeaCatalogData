const http = require('http');
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
const CLIENT_SECRET = required('KEYCLOAK_CLIENT_SECRET');
const USERNAME = required('KEYCLOAK_USERNAME');
const PASSWORD = required('KEYCLOAK_PASSWORD');

async function getToken() {
    const body = new URLSearchParams({
        grant_type: 'password',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        username: USERNAME,
        password: PASSWORD,
    }).toString();

    return new Promise((resolve, reject) => {
        const req = http.request(`${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`, {
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
    USERNAME,
    PASSWORD,
    getToken,
};
