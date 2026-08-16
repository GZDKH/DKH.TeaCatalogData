#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeTieguanyinSnapshot } = require('./thetea-shop/tieguanyin-normalizer');
const { buildFixtureSet } = require('./thetea-shop/catalog-sellable-exchange');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = path.join(
    ROOT,
    'scripts/catalog-sources/thetea-shop/fixtures/tieguanyin-price-base-2026-08-01.json',
);
const OUTPUT = path.join(
    ROOT,
    'scripts/catalog-sources/thetea-shop/fixtures/catalog-sellable-exchange',
);

function main() {
    const check = process.argv.includes('--check');
    const snapshot = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
    const manifest = normalizeTieguanyinSnapshot(snapshot);
    const { fixtures } = buildFixtureSet(manifest);

    if (!check) fs.mkdirSync(OUTPUT, { recursive: true });
    for (const [name, expected] of fixtures) {
        const file = path.join(OUTPUT, name);
        if (check) {
            if (!fs.existsSync(file) || !fs.readFileSync(file).equals(expected)) {
                throw new Error(`CATALOG_SELLABLE_FIXTURE_DRIFT: ${name}`);
            }
        } else {
            fs.writeFileSync(file, expected);
        }
    }
    process.stdout.write(
        `Catalog sellable exchange fixtures ${check ? 'verified' : 'generated'}: ${fixtures.size} files.\n`,
    );
}

main();
