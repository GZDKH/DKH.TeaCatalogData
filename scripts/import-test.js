const http = require('http');
const fs = require('fs');
const path = require('path');
const { GATEWAY_URL, getToken } = require('./lib/config');

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
    const token = await getToken();
    console.log('Token obtained.\n');

    // Test with tags
    const tagsPath = path.join(__dirname, '..', 'import', '01-reference', 'tags.json');
    console.log('=== Testing tags import ===');
    const r = await importFile(token, 'tags', tagsPath);
    console.log(`Status: ${r.status}`);
    console.log(`Body (first 2000 chars): ${r.body.substring(0, 2000)}`);

    // Test with spec options
    const specPath = path.join(__dirname, '..', 'import', '02-specifications', 'specification_attribute_options.json');
    console.log('\n=== Testing spec options import ===');
    const r2 = await importFile(token, 'specification_attribute_options', specPath);
    console.log(`Status: ${r2.status}`);
    console.log(`Body (first 2000 chars): ${r2.body.substring(0, 2000)}`);

    // Test with one product file
    const prodPath = path.join(__dirname, '..', 'import', '04-products', 'products-nepal.json');
    console.log('\n=== Testing Nepal products import ===');
    const r3 = await importFile(token, 'products', prodPath);
    console.log(`Status: ${r3.status}`);
    console.log(`Body (first 3000 chars): ${r3.body.substring(0, 3000)}`);
}

main().catch(e => console.error(e));
