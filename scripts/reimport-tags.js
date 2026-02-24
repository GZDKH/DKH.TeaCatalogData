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
    const filePath = path.join(__dirname, '..', 'import', '01-reference', 'tags.json');

    console.log('Re-importing tags with fixed translations...');
    const result = await importFile(token, 'tags', filePath);
    const json = JSON.parse(result.body);
    const d = json.data || json;
    console.log(`Tags: ${d.processed} processed, ${d.failed} failed`);
    if (d.failed > 0 && d.errors) {
        const unique = [...new Set(d.errors)];
        unique.slice(0, 5).forEach(e => console.log(`  ! ${e.substring(0, 200)}`));
    }
}

main().catch(e => console.error(e));
