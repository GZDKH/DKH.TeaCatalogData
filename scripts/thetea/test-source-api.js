#!/usr/bin/env node
const assert = require('assert');
const { sourceHeaders } = require('./lib/source-api');
const { buildEntityInventory } = require('./lib/source-entities');
const { referenceCoverage, assertCurrentSourceReferences } = require('./lib/source-reference-coverage');
const key = 'fixture-key';
assert.deepStrictEqual(sourceHeaders('https://api.thetea.app/api/v2/meta', key), { Authorization: `Bearer ${key}` });
for (const url of ['https://tea.support/skill/SKILL.md', 'http://api.thetea.app/api/v2/meta', 'https://api.thetea.app.evil.test/', 'https://evil.test/?api.thetea.app']) {
    assert.deepStrictEqual(sourceHeaders(url, key), {});
}
assert.throws(() => sourceHeaders('https://user@api.thetea.app/', key), /credentials/);
const inventory = buildEntityInventory({ teas: [{ slug: 'tea-one' }], categories: [{ slug: 'tea-class' }] });
assert.strictEqual(inventory.entities.find(item => item.slug === 'tea-class').entityKind, 'category');
assert.strictEqual(inventory.entities.filter(item => item.entityKind === 'tea').length, 1);
const cached = { count: 200, places: Array.from({ length: 200 }, (_, index) => ({ id: index })) };
assert.strictEqual(referenceCoverage('places', 'en', 200, cached, 'places').possiblyTruncated, true);
assert.throws(() => assertCurrentSourceReferences({ langs: ['en'], referenceCoverage: [] }), /complete source references/);
assert.throws(() => assertCurrentSourceReferences({ langs: ['en'], referenceCoverage: [referenceCoverage('places', 'en', 200, cached, 'places')] }), /capped reference/);
assert.doesNotThrow(() => assertCurrentSourceReferences({ langs: ['en'], referenceCoverage: [
    referenceCoverage('places', 'en', 200, { places: [] }, 'places'),
    referenceCoverage('glossary', 'en', 500, { terms: [] }, 'terms'),
] }));
assert.doesNotThrow(() => assertCurrentSourceReferences({ fieldSource: 'cloudflare-d1-packs', d1Files: ['raw/d1/manifest.json'], fieldPackFiles: ['raw/d1/field-packs/tea.json.gz'] }));
console.log('test-source-api: OK');
const { validateCardLanguage } = require('./lib/source-entities');
assert.strictEqual(validateCardLanguage({ lang: 'zh' }, 'zh-CN').ok, true);
assert.strictEqual(validateCardLanguage({ lang: 'en' }, 'zh-CN').ok, false);
assert.strictEqual(validateCardLanguage({ lang: 'zh-TW' }, 'zh-CN').ok, false);
const { mergeRows, assertCounts } = require('./lib/complete-api-references');
const rows = new Map();
mergeRows(rows, [{ id: 1, kind: 'name' }], row => row.id, 'fixture');
mergeRows(rows, [{ id: 1, kind: 'name' }], row => row.id, 'fixture');
assert.throws(() => mergeRows(rows, [{ id: 1, kind: 'toponym' }], row => row.id, 'fixture'), /conflicting/);
assert.throws(() => assertCounts([...rows.values()], [{ key: 'name', count: 2 }], 'kind', 'fixture'), /1\/2/);
assert.doesNotThrow(() => assertCounts([...rows.values()], [{ key: 'name', count: 1 }], 'kind', 'fixture'));
const { apiRequestLocale } = require('./lib/locales');
const localeMeta = {locales:[{code:'NO',bcp47:'nb'},{code:'ZH',bcp47:'zh-CN'}]};
assert.strictEqual(apiRequestLocale('nb',localeMeta),'no');
assert.strictEqual(apiRequestLocale('zh-CN',localeMeta),'zh');
assert.strictEqual(apiRequestLocale('en',localeMeta),'en');
assert.throws(()=>apiRequestLocale('nb',{locales:[{code:'../bad',bcp47:'nb'}]}),/Unsafe/);

async function checkFreshDiscovery() {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const vm = require('node:vm');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thetea-fresh-'));
    const env = require('./lib/env');
    const inventoryRequests = [];
    const requests = {
        '/api/v2/meta': { locales: [{ bcp47: 'en' }, { bcp47: 'ru' }],
            place_kinds: [{ kind: 'name', count: 0 }], term_categories: [{ category: 'tea', count: 0 }] },
        '/api/v2/family': {}, '/api/v2/glossary': { terms: [], offset: 0 }, '/api/v2/map': {},
    };
    let resume = false;
    try {
        const run = () => vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'fetch-snapshot.js'), 'utf8'), {
            Buffer,
            console: { log() {}, error(message) { throw new Error(message); } },
            process: { env: {}, stdout: { write() {} }, exit(code) { throw new Error(`Exit ${code}`); } },
            require(name) {
                if (name === './lib/env') return { ...env, REPO_ROOT: root, loadDotEnv() {}, getTheTeaApiKey: () => '',
                    parseArgs: () => ({ snapshot: 'fresh', langs: 'ru', resume, 'min-interval-ms': '0' }) };
                if (name === './lib/http') return {
                    requestText: async () => ({ body: 'fixture' }),
                    async requestJson(url) {
                        const route = new URL(url);
                        if (['/api/v2/teas', '/api/v2/infusions', '/api/v2/categories'].includes(route.pathname)) {
                            inventoryRequests.push([route.pathname, route.searchParams.get('lang')]);
                            return { items: [], count: 0 };
                        }
                        assert(Object.hasOwn(requests, route.pathname), `Unexpected request ${route.pathname}`);
                        return requests[route.pathname];
                    },
                };
                return require(name);
            },
        });
        await run();
        assert.deepStrictEqual(inventoryRequests, [
            ['/api/v2/teas', 'en'], ['/api/v2/categories', 'en'], ['/api/v2/infusions', 'en'],
        ]);
        const manifestPath = path.join(root, 'sources/thetea/snapshots/fresh/manifest.json');
        const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        previous.requestLocales.ru = 'rus';
        fs.writeFileSync(manifestPath, JSON.stringify(previous));
        resume = true;
        await assert.rejects(run, /Source request code changed for ru/);
        assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).requestLocales.ru, 'rus');
        delete previous.requestLocales;
        fs.writeFileSync(manifestPath, JSON.stringify(previous));
        const metaPath = path.join(path.dirname(manifestPath), 'raw/meta.json');
        const legacyMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        legacyMeta.locales.find(locale => locale.bcp47 === 'ru').code = 'rus';
        fs.writeFileSync(metaPath, JSON.stringify(legacyMeta));
        await assert.rejects(run, /Source request code changed for ru/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
checkFreshDiscovery().catch(error => { console.error(error); process.exitCode = 1; });
