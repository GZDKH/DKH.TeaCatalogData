const fs = require('fs');
const d = fs.readFileSync('D:/projects/GZDKH/DKH.TeaCatalogData/import/02-specifications/specification_attribute_options.json', 'utf-8').replace(/^\uFEFF/, '');
const j = JSON.parse(d);
console.log('Parsed OK, length:', j.length, 'first code:', j[0].code, 'has options:', !!j[0].options);
if (j[0].translations) {
    console.log('First translations:', JSON.stringify(j[0].translations));
}
