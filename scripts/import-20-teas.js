/**
 * Import script for 20 curated tea products.
 *
 * Reads files from import/04-products/<REGION>/<file>.json by an explicit
 * manifest (no recursive globbing — protects from importing stray files).
 *
 * Usage:
 *   node scripts/import-20-teas.js              # import all 20
 *   node scripts/import-20-teas.js --dry        # validate only, no DB writes
 *   node scripts/import-20-teas.js --only=1,6   # import specific item numbers
 *
 * Requires .env with KEYCLOAK_* and GATEWAY_URL. See .env.prod.example.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { GATEWAY_URL, getToken } = require('./lib/config');

// --- Manifest of 20 teas ---
// Ordered as the user provided. Relative paths from import/04-products/.
const MANIFEST = [
    { n: 1,  file: 'CHINA-GREEN TEA/moli-longzhu.json',               title: 'Мо Ли Лун Чжу' },
    { n: 2,  file: 'CHINA-WHITE TEA/baijian-baicha.json',             title: 'Бай Цзянь Бай Ча' },
    { n: 3,  file: 'CHINA-OOLONG TEA/guifei-wulong.json',             title: 'Гуй Фэй Улун' },
    { n: 4,  file: 'CHINA-GREEN TEA/lu-jia-ye.json',                  title: 'Люй Цзя Е' },
    { n: 5,  file: 'CHINA-RED-BLACK TEA/hong-jia-ye.json',            title: 'Хун Цзя Е' },
    { n: 6,  file: 'CHINA-RED-BLACK TEA/riyuetan-hongcha.json',       title: 'Жи Юэ Тань Хун Ча' },
    { n: 7,  file: 'CHINA-WHITE TEA/baihao-yinzhen.json',             title: 'Бай Хао Инь Чжэнь' },
    { n: 8,  file: 'CHINA-OOLONG TEA/renshen-wulong.json',            title: 'Жэнь Шэнь У Лун' },
    { n: 9,  file: 'CHINA-RED-BLACK TEA/jin-jun-mei.json',            title: 'Цзинь Цзюнь Мэй' },
    { n: 10, file: 'CHINA-RED-BLACK TEA/hei-jin.json',                title: 'Хэй Цзинь' },
    { n: 11, file: 'CHINA-RED-BLACK TEA/zhengshan-xiaozhong.json',    title: 'Чжэн Шань Сяо Чжун' },
    { n: 12, file: 'CHINA-GREEN TEA/moli-piaoxue.json',               title: 'Мо Ли Пяо Сюэ' },
    { n: 13, file: 'CHINA-DARK TEA/liubao.json',                      title: 'Лю Бао Хэй Ча' },
    { n: 14, file: 'CHINA-RED-BLACK TEA/hong-yu-jia-ye.json',         title: 'Хун Юй Цзя Е' },
    { n: 15, file: 'CHINA-OOLONG TEA/hongshui-wulong.json',           title: 'Хун Шуэй У Лун' },
    { n: 16, file: 'CHINA-OOLONG TEA/lishan-jia-ye.json',             title: 'Ли Шань Цзя Е' },
    { n: 17, file: 'CHINA-GREEN TEA/xihu-longjing.json',              title: 'Си Ху Лун Цзин' },
    { n: 18, file: 'CHINA-GREEN TEA/zhejiang-yesheng-maojian.json',   title: 'Дикий Мао Цзянь (Чжэцзян)' },
    { n: 19, file: 'CHINA-OOLONG TEA/tieguanyin-huaxiang.json',       title: 'Те Гуань Инь Хуа Сян' },
    { n: 20, file: 'CHINA-OOLONG TEA/dong-ding-wulong.json',          title: 'Дун Дин Улун' },
];

// --- CLI args ---
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry') || args.includes('--dry-run');
const onlyArg = args.find(a => a.startsWith('--only='));
const onlyNumbers = onlyArg
    ? onlyArg.substring('--only='.length).split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean)
    : null;

const selected = onlyNumbers ? MANIFEST.filter(m => onlyNumbers.includes(m.n)) : MANIFEST;
if (selected.length === 0) {
    console.error('No items selected. Check --only= argument.');
    process.exit(1);
}

// --- HTTP request helper (http or https based on GATEWAY_URL scheme) ---
function request(url, options, body) {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const req = lib.request(url, options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

// --- multipart/form-data builder ---
function buildMultipart(profile, format, jsonContent, fileName) {
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const fileBuf = Buffer.from(JSON.stringify(jsonContent), 'utf-8');
    let head = '';
    head += `--${boundary}\r\nContent-Disposition: form-data; name="Profile"\r\n\r\n${profile}\r\n`;
    head += `--${boundary}\r\nContent-Disposition: form-data; name="Format"\r\n\r\n${format}\r\n`;
    head += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/json\r\n\r\n`;
    const headBuf = Buffer.from(head, 'utf-8');
    const tailBuf = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const fullBody = Buffer.concat([headBuf, fileBuf, tailBuf]);
    return { boundary, body: fullBody };
}

async function importOne(token, profile, jsonContent, fileName, dryRun) {
    const endpoint = dryRun
        ? `${GATEWAY_URL}/api/v1/data-exchange/import/validate`
        : `${GATEWAY_URL}/api/v1/data-exchange/import`;

    const { boundary, body } = buildMultipart(profile, 'json', jsonContent, fileName);

    return request(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
        },
    }, body);
}

// --- Main ---
async function main() {
    console.log(`DKH Tea Import — ${selected.length} product(s)${isDryRun ? ' [DRY-RUN]' : ''}`);
    console.log(`Gateway: ${GATEWAY_URL}\n`);

    console.log('Obtaining Keycloak token...');
    const token = await getToken();
    console.log('Token OK.\n');

    const baseDir = path.join(__dirname, '..', 'import', '04-products');
    const results = [];

    for (const item of selected) {
        const filePath = path.join(baseDir, item.file);
        if (!fs.existsSync(filePath)) {
            console.log(`[${item.n.toString().padStart(2)}] ${item.title.padEnd(30)} MISSING FILE: ${item.file}`);
            results.push({ ...item, status: 'missing_file' });
            continue;
        }

        const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
        let products;
        try {
            products = JSON.parse(raw);
        } catch (e) {
            console.log(`[${item.n.toString().padStart(2)}] ${item.title.padEnd(30)} JSON PARSE ERROR: ${e.message}`);
            results.push({ ...item, status: 'parse_error', error: e.message });
            continue;
        }

        const fileName = path.basename(item.file);
        let res;
        try {
            res = await importOne(token, 'products', products, fileName, isDryRun);
        } catch (e) {
            console.log(`[${item.n.toString().padStart(2)}] ${item.title.padEnd(30)} NETWORK ERROR: ${e.message}`);
            results.push({ ...item, status: 'network_error', error: e.message });
            continue;
        }

        if (res.status === 200) {
            let payload;
            try { payload = JSON.parse(res.body); } catch { payload = {}; }
            const d = payload.data || payload;
            const processed = d.processed || d.validRecords || 0;
            const failed = d.failed || 0;
            const errors = d.errors || [];
            if (failed === 0) {
                console.log(`[${item.n.toString().padStart(2)}] ${item.title.padEnd(30)} OK (${processed} processed)`);
                results.push({ ...item, status: 'ok', processed });
            } else {
                const firstErr = errors[0] ? String(errors[0]).substring(0, 120) : 'unknown';
                console.log(`[${item.n.toString().padStart(2)}] ${item.title.padEnd(30)} PARTIAL (${processed}/${processed + failed}) — ${firstErr}`);
                results.push({ ...item, status: 'partial', processed, failed, errors });
            }
        } else {
            const snippet = String(res.body).substring(0, 200);
            console.log(`[${item.n.toString().padStart(2)}] ${item.title.padEnd(30)} HTTP ${res.status} — ${snippet}`);
            results.push({ ...item, status: 'http_error', httpStatus: res.status, body: res.body });
        }
    }

    console.log('\n=== SUMMARY ===');
    const ok = results.filter(r => r.status === 'ok').length;
    const partial = results.filter(r => r.status === 'partial').length;
    const failed = results.filter(r => r.status !== 'ok' && r.status !== 'partial').length;
    console.log(`OK:      ${ok}`);
    console.log(`PARTIAL: ${partial}`);
    console.log(`FAILED:  ${failed}`);
    console.log(`TOTAL:   ${results.length}`);

    if (failed > 0 || partial > 0) {
        console.log('\nIssues:');
        for (const r of results.filter(r => r.status !== 'ok')) {
            const detail = r.error || r.body || (r.errors && r.errors[0]) || `HTTP ${r.httpStatus}`;
            console.log(`  #${r.n} ${r.title}: ${r.status} — ${String(detail).substring(0, 200)}`);
        }
    }

    // Save full log
    const logDir = path.join(__dirname, '..', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(logDir, `import-${ts}${isDryRun ? '-dry' : ''}.json`);
    fs.writeFileSync(logPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        gateway: GATEWAY_URL,
        dryRun: isDryRun,
        results,
    }, null, 2));
    console.log(`\nFull log: ${logPath}`);

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(2);
});
