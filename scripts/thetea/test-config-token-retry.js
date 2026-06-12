#!/usr/bin/env node
const assert = require('assert');
const http = require('http');

async function listen(server) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return server.address().port;
}

(async () => {
    let calls = 0;
    const server = http.createServer((req, res) => {
        calls++;
        if (calls === 1) {
            req.socket.destroy();
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'retry-token' }));
    });

    const port = await listen(server);
    process.env.KEYCLOAK_URL = `http://127.0.0.1:${port}`;
    process.env.KEYCLOAK_REALM = 'dkh';
    process.env.KEYCLOAK_CLIENT_ID = 'dkh-admin-gateway';
    process.env.KEYCLOAK_CLIENT_SECRET = 'secret';
    process.env.KEYCLOAK_GRANT_TYPE = 'client_credentials';

    try {
        const { getToken } = require('../lib/config');
        const token = await getToken();
        assert.strictEqual(token, 'retry-token');
        assert.strictEqual(calls, 2);
        console.log('test-config-token-retry: OK');
    } finally {
        server.close();
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
