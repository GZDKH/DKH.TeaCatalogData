const http = require('http');
const fs = require('fs');
const path = require('path');
const { GATEWAY_URL, getToken } = require('./lib/config');

async function importJson(token, profile, jsonContent, fileName) {
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const fileContent = Buffer.from(JSON.stringify(jsonContent), 'utf-8');

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

    const importDir = path.join(__dirname, '..', 'import', '04-products');
    const files = fs.readdirSync(importDir).filter(f => f.endsWith('.json')).sort();

    let totalCreated = 0;
    let totalFailed = 0;
    let totalCustomTextErrors = 0;
    let totalSpecOptionErrors = 0;
    const failedProducts = [];

    for (const file of files) {
        const raw = fs.readFileSync(path.join(importDir, file), 'utf-8').replace(/^\uFEFF/, '');
        const products = JSON.parse(raw);

        let fileCreated = 0;
        let fileFailed = 0;

        for (const product of products) {
            // Send each product as a single-element array
            const result = await importJson(token, 'products', [product], file);

            if (result.status === 200) {
                const json = JSON.parse(result.body);
                const d = json.data || json;

                if (d.failed === 0) {
                    fileCreated++;
                } else {
                    // Check if errors are only CustomText/spec-option warnings (product itself created)
                    const errors = d.errors || [];
                    const onlySpecErrors = errors.every(e =>
                        e.includes('Product specification attributes support only Option type') ||
                        e.includes('SpecificationAttributeOptionId, code, or') ||
                        e.includes('SpecificationAttributeId, code, or')
                    );

                    if (onlySpecErrors && d.processed === 1) {
                        fileCreated++;
                        totalCustomTextErrors += errors.filter(e => e.includes('only Option type')).length;
                        totalSpecOptionErrors += errors.filter(e => e.includes('SpecificationAttribute')).length;
                    } else {
                        fileFailed++;
                        failedProducts.push({ file, code: product.code, errors: errors.slice(0, 2) });
                    }
                }
            } else {
                fileFailed++;
                failedProducts.push({ file, code: product.code, error: `HTTP ${result.status}` });
            }
        }

        totalCreated += fileCreated;
        totalFailed += fileFailed;
        const status = fileFailed === 0 ? 'OK' : 'PARTIAL';
        console.log(`${file}: ${status} (${fileCreated}/${products.length} created, ${fileFailed} failed)`);
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Products created: ${totalCreated}`);
    console.log(`Products failed:  ${totalFailed}`);
    console.log(`CustomText spec warnings: ${totalCustomTextErrors} (expected - not supported)`);
    console.log(`Missing spec option refs: ${totalSpecOptionErrors}`);

    if (failedProducts.length > 0) {
        console.log(`\nFailed products:`);
        for (const f of failedProducts) {
            console.log(`  ${f.file} / ${f.code}: ${(f.errors || [f.error]).join('; ').substring(0, 200)}`);
        }
    }
}

main().catch(e => console.error(e));
