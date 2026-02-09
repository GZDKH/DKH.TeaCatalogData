const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'import', '02-specifications', 'specification_attribute_options.json');

// Read original nested format
const raw = fs.readFileSync(filePath, 'utf-8');
// Remove BOM if present
const clean = raw.replace(/^\uFEFF/, '');
const groups = JSON.parse(clean);

// If already flat (no "options" property), skip
if (groups.length > 0 && !groups[0].options) {
    console.log('Already flat format, skipping');
    process.exit(0);
}

// Flatten
const flat = [];
for (const group of groups) {
    for (const opt of group.options) {
        flat.push({
            code: opt.code,
            attribute: group.attribute,
            order: opt.order,
            published: opt.published,
            translations: opt.translations
        });
    }
}

fs.writeFileSync(filePath, JSON.stringify(flat, null, 2), 'utf-8');
console.log(`Flattened: ${flat.length} options`);
