#!/usr/bin/env node
const assert = require('assert');

process.env.ADMIN_GATEWAY_ACCESS_TOKEN = 'direct-admin-token';
process.env.KEYCLOAK_URL = 'http://127.0.0.1:9';
process.env.KEYCLOAK_TOKEN_RETRIES = '0';
delete process.env.KEYCLOAK_USERNAME;
delete process.env.KEYCLOAK_PASSWORD;

const { getToken } = require('../lib/config');

getToken()
    .then(token => {
        assert.strictEqual(token, 'direct-admin-token');
        console.log('test-config-access-token: OK');
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
