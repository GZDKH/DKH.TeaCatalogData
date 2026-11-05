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
const HISTORICAL_MANIFEST = path.join(OUTPUT, 'legacy-normalized-manifest-2026-08-01.json');

function main() {
    const check = process.argv.includes('--check');
    const historical = process.argv.includes('--historical');
    const snapshot = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
    const currentManifest = normalizeTieguanyinSnapshot(snapshot);
    if (check) {
        let currentUnsupported = false;
        try {
            buildFixtureSet(currentManifest);
        } catch (error) {
            if (error.code !== 'CATALOG_SELLABLE_EXCHANGE_CURRENT_CONTRACT_UNSUPPORTED') throw error;
            currentUnsupported = true;
        }
        if (!currentUnsupported) throw new Error('CATALOG_SELLABLE_EXCHANGE_REVIEW_CURRENT_CONTRACT');
    }
    const manifest = check || historical
        ? JSON.parse(fs.readFileSync(HISTORICAL_MANIFEST, 'utf8'))
        : currentManifest;
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
        `Historical catalog sellable exchange fixtures ${check ? 'verified' : 'generated'}: ${fixtures.size} files.\n`,
    );
}

main();
