const http = require('http');
const { GATEWAY_URL, getToken } = require('./lib/config');

async function apiGet(token, path) {
    return new Promise((resolve, reject) => {
        const req = http.request(`${GATEWAY_URL}${path}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.end();
    });
}

async function main() {
    const token = await getToken();
    console.log('=== Data Verification ===\n');

    // Check products count
    const productsRes = await apiGet(token, '/api/v1/products?pageSize=1&pageIndex=0');
    if (productsRes.status === 200) {
        const json = JSON.parse(productsRes.body);
        const d = json.data || json;
        console.log(`Products: ${d.totalCount || d.total || 'N/A'} total`);
    } else {
        console.log(`Products: HTTP ${productsRes.status}`);
    }

    // Check categories
    const catsRes = await apiGet(token, '/api/v1/categories?pageSize=1&pageIndex=0');
    if (catsRes.status === 200) {
        const json = JSON.parse(catsRes.body);
        const d = json.data || json;
        console.log(`Categories: ${d.totalCount || d.total || 'N/A'} total`);
    } else {
        console.log(`Categories: HTTP ${catsRes.status}`);
    }

    // Check tags
    const tagsRes = await apiGet(token, '/api/v1/tags?pageSize=1&pageIndex=0');
    if (tagsRes.status === 200) {
        const json = JSON.parse(tagsRes.body);
        const d = json.data || json;
        console.log(`Tags: ${d.totalCount || d.total || 'N/A'} total`);
    } else {
        console.log(`Tags: HTTP ${tagsRes.status}`);
    }

    // Check brands
    const brandsRes = await apiGet(token, '/api/v1/brands?pageSize=1&pageIndex=0');
    if (brandsRes.status === 200) {
        const json = JSON.parse(brandsRes.body);
        const d = json.data || json;
        console.log(`Brands: ${d.totalCount || d.total || 'N/A'} total`);
    } else {
        console.log(`Brands: HTTP ${brandsRes.status}`);
    }

    // Check specification groups
    const specGroupsRes = await apiGet(token, '/api/v1/specification-groups?pageSize=1&pageIndex=0');
    if (specGroupsRes.status === 200) {
        const json = JSON.parse(specGroupsRes.body);
        const d = json.data || json;
        console.log(`Specification Groups: ${d.totalCount || d.total || 'N/A'} total`);
    } else {
        console.log(`Specification Groups: HTTP ${specGroupsRes.status}`);
    }

    // Check specification attributes
    const specAttrsRes = await apiGet(token, '/api/v1/specification-attributes?pageSize=1&pageIndex=0');
    if (specAttrsRes.status === 200) {
        const json = JSON.parse(specAttrsRes.body);
        const d = json.data || json;
        console.log(`Specification Attributes: ${d.totalCount || d.total || 'N/A'} total`);
    } else {
        console.log(`Specification Attributes: HTTP ${specAttrsRes.status}`);
    }

    // Fetch a sample product with details
    console.log('\n--- Sample Product ---');
    const sampleRes = await apiGet(token, '/api/v1/products?pageSize=3&pageIndex=0');
    if (sampleRes.status === 200) {
        const json = JSON.parse(sampleRes.body);
        const d = json.data || json;
        const items = d.items || d.data || d;
        if (Array.isArray(items) && items.length > 0) {
            for (const p of items.slice(0, 3)) {
                console.log(`  ${p.code || p.sku}: ${p.name || p.translations?.[0]?.name || 'N/A'} (published: ${p.published})`);
            }
        } else {
            console.log(`  Response: ${JSON.stringify(d).substring(0, 300)}`);
        }
    } else {
        console.log(`  HTTP ${sampleRes.status}: ${sampleRes.body.substring(0, 300)}`);
    }
}

main().catch(e => console.error(e));
