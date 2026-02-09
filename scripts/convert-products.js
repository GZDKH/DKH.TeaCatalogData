const fs = require('fs');
const path = require('path');

const importDir = path.join(__dirname, '..', 'import');
const productsDir = path.join(importDir, '04-products');

// --- Spec attribute code mapping ---
const specAttrMap = {
    'TEA_TYPE': 'SPEC-TEA-TYPE',
    'CAFFEINE_LEVEL': 'SPEC-CAFFEINE',
    'ORIGIN_COUNTRY': null,  // no equivalent, remove
    'BREWING_TEMP': 'SPEC-BREW-TEMP',
    'BREWING_TIME': 'SPEC-BREW-TIME',
    'BREWING_AMOUNT': 'SPEC-BREW-AMOUNT',
};

// --- Spec option code mapping (by attribute) ---
const specOptionMap = {
    'SPEC-TEA-TYPE': {
        'GREEN': 'SPEC-TYPE-GREEN',
        'WHITE': 'SPEC-TYPE-WHITE',
        'YELLOW': 'SPEC-TYPE-YELLOW',
        'OOLONG': 'SPEC-TYPE-OOLONG',
        'BLACK': 'SPEC-TYPE-RED',
        'DARK': 'SPEC-TYPE-DARK',
    },
    'SPEC-CAFFEINE': {
        'NONE': 'SPEC-CAFF-NONE',
        'LOW': 'SPEC-CAFF-LOW',
        'MEDIUM': 'SPEC-CAFF-MED',
        'HIGH': 'SPEC-CAFF-HIGH',
    },
};

// --- Tag code normalization: lowercase → TAG-UPPERCASE ---
function normalizeTagCode(code) {
    if (code.startsWith('TAG-')) return code;
    return 'TAG-' + code.toUpperCase().replace(/-/g, '-');
}

// --- Convert non-China product file ---
function convertProduct(product) {
    const result = { ...product };

    // Convert specifications
    if (result.specifications) {
        const newSpecs = [];
        let order = 1;
        for (const spec of result.specifications) {
            const oldCode = spec.code;
            if (oldCode) {
                // This is a non-China format spec with "code" field
                const newAttr = specAttrMap[oldCode];
                if (newAttr === null) continue; // skip ORIGIN_COUNTRY

                const newSpec = {
                    attribute: newAttr || oldCode,
                    type: spec.type || 'Option',
                    showOnPage: true,
                    order: order++,
                };

                if (spec.type === 'Option' && spec.option) {
                    const optionMap = specOptionMap[newAttr];
                    newSpec.option = optionMap?.[spec.option] || spec.option;
                } else if (spec.type === 'CustomText' && spec.value) {
                    newSpec.value = spec.value;
                }

                // Remove old "code" field
                newSpecs.push(newSpec);
            } else {
                // Already in correct format (has "attribute" field)
                newSpecs.push(spec);
            }
        }
        result.specifications = newSpecs;
    }

    // Convert origins
    if (result.origins) {
        result.origins = result.origins.map(o => {
            const newOrigin = { country: o.country };

            if (o.state) newOrigin.state = o.state;
            else if (o.region) newOrigin.state = o.region;

            if (o.place) newOrigin.place = o.place;
            else if (o.area) newOrigin.place = o.area;

            if (o.latitude != null && o.longitude != null) {
                newOrigin.coordinates = { lat: o.latitude, lng: o.longitude };
            } else if (o.coordinates) {
                newOrigin.coordinates = o.coordinates;
            }

            if (typeof o.altitude === 'number') {
                newOrigin.altitude = { min: o.altitude, max: o.altitude, unit: 'm' };
            } else if (o.altitude && typeof o.altitude === 'object') {
                newOrigin.altitude = o.altitude;
            }

            if (o.notes) newOrigin.notes = o.notes;

            return newOrigin;
        });
    }

    // Normalize tag codes
    if (result.tags) {
        result.tags = result.tags.map(t => ({
            code: normalizeTagCode(t.code)
        }));
    }

    return result;
}

// --- Process all files ---
const files = fs.readdirSync(productsDir).filter(f => f.endsWith('.json'));
let convertedCount = 0;
let skippedCount = 0;

for (const file of files.sort()) {
    const filePath = path.join(productsDir, file);
    const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);

    const isWrapped = !Array.isArray(data);
    const products = isWrapped ? data.products : data;

    // Check if conversion needed
    const needsConversion = isWrapped ||
        products.some(p => p.specifications?.some(s => s.code && !s.attribute)) ||
        products.some(p => p.origins?.some(o => o.region || o.area || (typeof o.latitude === 'number'))) ||
        products.some(p => p.tags?.some(t => !t.code.startsWith('TAG-')));

    if (!needsConversion) {
        skippedCount++;
        continue;
    }

    const converted = products.map(p => convertProduct(p));
    fs.writeFileSync(filePath, JSON.stringify(converted, null, 2), 'utf-8');
    convertedCount++;
    console.log(`Converted: ${file} (${converted.length} products)`);
}

console.log(`\nDone: ${convertedCount} converted, ${skippedCount} skipped`);

// --- Generate missing tags ---
console.log('\n--- Generating missing tags ---');
const tagsFile = path.join(importDir, '01-reference', 'tags.json');
const existingTags = JSON.parse(fs.readFileSync(tagsFile, 'utf-8').replace(/^\uFEFF/, ''));
const existingCodes = new Set(existingTags.map(t => t.code));

// Collect all tag codes from all product files
const allTags = new Set();
for (const file of files) {
    const raw = fs.readFileSync(path.join(productsDir, file), 'utf-8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    const products = Array.isArray(data) ? data : data.products;
    for (const p of products) {
        for (const t of (p.tags || [])) {
            allTags.add(t.code);
        }
    }
}

// Generate entries for missing tags
const missingTags = [...allTags].filter(code => !existingCodes.has(code)).sort();
let nextOrder = existingTags.length + 1;

for (const code of missingTags) {
    // Generate readable name from code: TAG-BLACK-TEA → Black Tea
    const name = code.replace(/^TAG-/, '').split('-').map(w =>
        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    ).join(' ');

    existingTags.push({
        code: code,
        order: nextOrder++,
        published: true,
        translations: [
            { lang: 'en-US', name: name },
            { lang: 'ru-RU', name: name },
            { lang: 'zh-CN', name: name }
        ]
    });
}

fs.writeFileSync(tagsFile, JSON.stringify(existingTags, null, 2), 'utf-8');
console.log(`Added ${missingTags.length} missing tags (total: ${existingTags.length})`);
