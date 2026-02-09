const http = require('http');
const fs = require('fs');
const path = require('path');

const KEYCLOAK_URL = 'http://localhost:8080';
const GATEWAY_URL = 'http://localhost:5005';

async function getToken() {
    const body = new URLSearchParams({
        grant_type: 'password',
        client_id: 'dkh-admin-gateway',
        client_secret: 'admin-gateway-secret-change-me',
        username: 'superadmin',
        password: 'superadmin123',
    }).toString();

    return new Promise((resolve, reject) => {
        const req = http.request(`${KEYCLOAK_URL}/realms/dkh/protocol/openid-connect/token`, {
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

async function importFile(token, profile, filePath) {
    const fileName = path.basename(filePath);
    const fileContent = fs.readFileSync(filePath);
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);

    let body = '';
    body += `--${boundary}\r\nContent-Disposition: form-data; name="Profile"\r\n\r\n${profile}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="Format"\r\n\r\njson\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/json\r\n\r\n`;

    const bodyStart = Buffer.from(body, 'utf-8');
    const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const fullBody = Buffer.concat([bodyStart, fileContent, bodyEnd]);

    return new Promise((resolve, reject) => {
        const req = http.request(`${GATEWAY_URL}/api/v1/data-exchange/import`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': fullBody.length,
            },
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.write(fullBody);
        req.end();
    });
}

async function main() {
    console.log('Getting token...');
    const token = await getToken();
    console.log('Token obtained.\n');

    const importDir = path.join(__dirname, '..', 'import');

    const imports = [
        { profile: 'catalogs', file: '01-reference/catalogs.json' },
        { profile: 'tags', file: '01-reference/tags.json' },
        { profile: 'brands', file: '01-reference/brands.json' },
        { profile: 'packages', file: '01-reference/packages.json' },
        { profile: 'specification_groups', file: '02-specifications/specification_groups.json' },
        { profile: 'specification_attributes', file: '02-specifications/specification_attributes.json' },
        { profile: 'specification_attribute_options', file: '02-specifications/specification_attribute_options.json' },
        { profile: 'categories', file: '03-categories/categories.json' },
    ];

    for (const imp of imports) {
        const filePath = path.join(importDir, imp.file);
        const result = await importFile(token, imp.profile, filePath);
        const json = JSON.parse(result.body);
        const d = json.data || json;
        const status = d.failed === 0 ? 'OK' : 'WARN';
        console.log(`[${imp.profile}] ${status}: ${d.processed} processed, ${d.failed} failed`);
        if (d.failed > 0 && d.errors) {
            const unique = [...new Set(d.errors)];
            unique.slice(0, 3).forEach(e => console.log(`  ! ${e.substring(0, 150)}`));
        }
    }
}

main().catch(e => console.error(e));
