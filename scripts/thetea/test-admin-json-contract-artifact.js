#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
    createArtifactManifest,
    readArtifactBundle,
    writeJson,
} = require('./lib/artifact-bundle');

function mkdirp(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
}

function write(file, value) {
    mkdirp(file);
    writeJson(file, value);
}

function read(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thetea-admin-json-contract-'));
const source = path.join(root, 'source');
const target = path.join(root, 'target');

write(path.join(source, '01-reference/catalogs.json'), [{
    code: 'CATALOG-TEA',
    translations: [{ lang: 'en-US', name: 'Tea' }],
}]);
write(path.join(source, '02-specifications/specification_groups.json'), [{
    code: 'SPEC-GROUP',
    order: 1,
    published: true,
    translations: [{ lang: 'en-US', name: 'Group' }],
}]);
write(path.join(source, '02-specifications/specification_attributes.json'), [{
    code: 'SPEC-ATTRIBUTE',
    group: 'SPEC-GROUP',
    type: 'Option',
    order: 1,
    published: true,
    translations: [{ lang: 'en-US', name: 'Attribute' }],
}]);
write(path.join(source, '02-specifications/specification_attribute_options.json'), [{
    code: 'SPEC-OPTION',
    attribute: 'SPEC-ATTRIBUTE',
    order: 1,
    published: true,
    translations: [{ lang: 'en-US', name: 'Option' }],
}]);
write(path.join(source, '03-categories/categories.json'), [{
    code: 'CAT-ROOT',
    order: 0,
    published: true,
    translations: [{ lang: 'en-US', name: 'Root', seo: 'root' }],
}]);
write(path.join(source, '04-products/CAT/TEA-ONE.json'), [{
    code: 'TEA-ONE',
    sku: 'ONE',
    published: false,
    translations: [{ lang: 'en-US', name: 'Tea One' }],
    tags: [{ code: 'TAG-ONE', name: 'One', lang: 'en-US' }],
    catalogs: [{ catalog: 'CATALOG-TEA', category: 'CAT-ROOT', order: 3, published: true }],
}]);
write(path.join(source, '05-catalog-bindings/catalogs.json'), [{
    code: 'CATALOG-TEA',
    translations: [{ lang: 'en-US', name: 'Tea' }],
    categories: [{ category: 'CAT-ROOT', order: 1, published: true, products: [] }],
}]);
write(path.join(source, '06-routed-content/articles/index.json'), []);
write(path.join(source, '06-routed-content/metaobjects/index.json'), []);

createArtifactManifest(source, {
    snapshotId: 'test',
    generatedAt: '2026-07-25T00:00:00.000Z',
    requiredLocales: ['en-US'],
    productCodes: ['TEA-ONE'],
    products: [{ code: 'TEA-ONE', path: '04-products/CAT/TEA-ONE.json' }],
});

execFileSync(process.execPath, [
    path.join(__dirname, 'build-admin-json-contract-artifact.js'),
    source,
    target,
], { stdio: 'pipe' });

const bundle = readArtifactBundle(target);
assert.strictEqual(bundle.valid, true, bundle.errors.join('\n'));

const groups = read(path.join(target, '02-specifications/specification_groups.json'));
assert.strictEqual(groups[0]['translations.en-US.name'], 'Group');
assert.strictEqual(groups[0]['attributes.code'], 'SPEC-ATTRIBUTE');
assert.strictEqual(groups[0]['translations/0/name'], 'Group');
assert.strictEqual(groups[0]['attributes/0/code'], 'SPEC-ATTRIBUTE');
assert.strictEqual(groups[0]['attributes/0/options/0/code'], 'SPEC-OPTION');

assert.strictEqual(
    fs.existsSync(path.join(target, '02-specifications/specification_attribute_options.json')),
    false,
);

const categories = read(path.join(target, '03-categories/categories.json'));
assert.strictEqual(categories[0]['translations.en-US.name'], 'Root');
assert.strictEqual(categories[0]['translations/0/name'], 'Root');

const product = read(path.join(target, '04-products/CAT/TEA-ONE.json'))[0];
assert.strictEqual(product['translations.en-US.name'], 'Tea One');
assert.strictEqual(product['tags.code'], 'TAG-ONE');
assert.strictEqual(product['translations/0/name'], 'Tea One');
assert.strictEqual(product['tags/0/code'], 'TAG-ONE');

const catalogBinding = read(path.join(target, '05-catalog-bindings/catalogs.json'))[0];
assert.deepStrictEqual(catalogBinding.categories[0].products, [{
    product: 'TEA-ONE',
    order: 3,
    published: true,
}]);

fs.rmSync(root, { recursive: true, force: true });
console.log('test-admin-json-contract-artifact: OK');
