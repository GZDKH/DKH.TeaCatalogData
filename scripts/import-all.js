const http = require('http');
const fs = require('fs');
const path = require('path');

const KEYCLOAK_URL = 'http://localhost:8080';
const GATEWAY_URL = 'http://localhost:5005';
const REALM = 'dkh';
const CLIENT_ID = 'dkh-admin-gateway';
const CLIENT_SECRET = 'admin-gateway-secret-change-me';
const USERNAME = 'superadmin';
const PASSWORD = 'superadmin123';

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

function parseResult(result) {
    if (result.status !== 200) {
        return { ok: false, msg: `HTTP ${result.status}: ${result.body.substring(0, 300)}` };
    }
    try {
        const json = JSON.parse(result.body);
        const d = json.data || json;
        return {
            ok: true,
            processed: d.processed,
            failed: d.failed,
            errors: d.errors || [],
        };
    } catch {
        return { ok: true, msg: result.body.substring(0, 300) };
    }
}

async function main() {
    console.log('Getting token...');
    const token = await getToken();
    console.log('Token obtained.\n');

    const importDir = path.join(__dirname, '..', 'import');

    // Full import order (fresh database)
    const imports = [
        // 01 - Reference data
        { profile: 'catalogs', file: '01-reference/catalogs.json' },
        { profile: 'tags', file: '01-reference/tags.json' },
        { profile: 'brands', file: '01-reference/brands.json' },
        { profile: 'packages', file: '01-reference/packages.json' },
        // 02 - Specifications
        { profile: 'specification_groups', file: '02-specifications/specification_groups.json' },
        { profile: 'specification_attributes', file: '02-specifications/specification_attributes.json' },
        { profile: 'specification_attribute_options', file: '02-specifications/specification_attribute_options.json' },
        // 03 - Categories
        { profile: 'categories', file: '03-categories/categories.json' },
    ];

    // 04 - All product files
    const productsDir = path.join(importDir, '04-products');
    const productFiles = fs.readdirSync(productsDir).filter(f => f.endsWith('.json')).sort();
    for (const f of productFiles) {
        imports.push({ profile: 'products', file: `04-products/${f}` });
    }

    let totalProcessed = 0;
    let totalFailed = 0;

    for (const imp of imports) {
        const filePath = path.join(importDir, imp.file);
        process.stdout.write(`[${imp.profile}] ${imp.file}... `);

        try {
            const result = await importFile(token, imp.profile, filePath);
            const parsed = parseResult(result);

            if (parsed.ok && parsed.processed !== undefined) {
                totalProcessed += parsed.processed;
                totalFailed += parsed.failed;
                const status = parsed.failed === 0 ? 'OK' : 'PARTIAL';
                console.log(`${status} (${parsed.processed} processed, ${parsed.failed} failed)`);

                if (parsed.failed > 0) {
                    const unique = [...new Set(parsed.errors)];
                    for (const err of unique.slice(0, 3)) {
                        console.log(`  ! ${err.substring(0, 200)}`);
                    }
                    if (unique.length > 3) console.log(`  ... +${unique.length - 3} more errors`);
                }
            } else {
                console.log(parsed.msg || 'Unknown response');
            }
        } catch (e) {
            console.log(`ERROR: ${e.message}`);
        }
    }

    console.log(`\n=== TOTAL: ${totalProcessed} processed, ${totalFailed} failed ===`);
}

main().catch(e => console.error(e));
