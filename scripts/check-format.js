const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'import', '04-products');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

for (const file of files.sort()) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf-8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    const isWrapped = !Array.isArray(data);
    const products = isWrapped ? data.products : data;
    const first = products[0];

    const specField = first.specifications?.[0] ? Object.keys(first.specifications[0])[0] : 'N/A';
    const originFields = first.origins?.[0] ? Object.keys(first.origins[0]).join(',') : 'N/A';
    const hasCustomText = products.some(p => p.specifications?.some(s => s.type === 'CustomText'));

    console.log(`${file}: wrapped=${isWrapped}, count=${products.length}, specField=${specField}, origins=[${originFields}], customText=${hasCustomText}`);
}
