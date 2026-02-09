const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'import', '04-products');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

const tagsByFile = {};
const allTags = new Set();

for (const file of files.sort()) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf-8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    const products = Array.isArray(data) ? data : data.products;
    const tags = new Set();
    for (const p of products) {
        for (const t of (p.tags || [])) {
            tags.add(t.code);
            allTags.add(t.code);
        }
    }
    tagsByFile[file] = [...tags].sort();
}

// Existing tags
const tagsFile = path.join(__dirname, '..', 'import', '01-reference', 'tags.json');
const existingTags = JSON.parse(fs.readFileSync(tagsFile, 'utf-8').replace(/^\uFEFF/, '')).map(t => t.code);

console.log('=== Existing tags ===');
console.log(existingTags.join(', '));
console.log('');

const missing = [...allTags].filter(t => !existingTags.includes(t)).sort();
console.log('=== Missing tags (' + missing.length + ') ===');
console.log(missing.join('\n'));

// Spec codes and options used in non-China files
const specAttrs = new Set();
const specOptions = {};

for (const file of files.filter(f => !f.includes('china') && !f.includes('sample'))) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf-8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    const products = Array.isArray(data) ? data : data.products;
    for (const p of products) {
        for (const s of (p.specifications || [])) {
            const key = s.code || s.attribute;
            specAttrs.add(key);
            if (s.option) {
                if (!specOptions[key]) specOptions[key] = new Set();
                specOptions[key].add(s.option);
            }
        }
    }
}

console.log('\n=== Non-China spec attributes and options ===');
for (const attr of [...specAttrs].sort()) {
    const opts = specOptions[attr] ? [...specOptions[attr]].sort() : ['(CustomText)'];
    console.log(`${attr}: ${opts.join(', ')}`);
}
