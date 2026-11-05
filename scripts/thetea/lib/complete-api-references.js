const { apiRequestLocale } = require('./locales');
// Only documented API routes/parameters are used. Raw pages are retained; a
// bounded query census is qualified only by the source's exact metadata totals.
const PLACE_ALPHABET = [...new Set('abcdefghijklmnopqrstuvwxyzāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüêńňǹḿ')];

function mergeRows(target, rows, keyOf, context) {
    for (const row of rows) {
        const key = keyOf(row);
        if (!key) throw new Error(`${context}: missing source identity.`);
        if (target.has(key) && JSON.stringify(target.get(key)) !== JSON.stringify(row)) {
            throw new Error(`${context}: conflicting repeated source identity ${key}.`);
        }
        target.set(key, row);
    }
}
function countsFromMeta(meta, property, key) {
    const rows = (meta.data || meta)[property];
    if (!Array.isArray(rows) || !rows.length || rows.some(row => !/^[a-z][a-z_]{0,39}$/.test(row[key] || '') || !Number.isInteger(row.count) || row.count < 0)) {
        throw new Error(`Source metadata has no valid ${property} census.`);
    }
    return rows.map(row => ({ key: row[key], count: row.count }));
}
function assertCounts(rows, expected, key, context) {
    for (const item of expected) {
        const count = rows.filter(row => row[key] === item.key).length;
        if (count !== item.count) throw new Error(`${context}: ${item.key} has ${count}/${item.count} source records.`);
    }
    if (rows.length !== expected.reduce((sum, item) => sum + item.count, 0)) throw new Error(`${context}: unexpected records.`);
}
async function fetchCompleteReferences({ meta, langs, fetch, seedText = '', priorPlaceQueries = {} }) {
    const placeCounts = countsFromMeta(meta, 'place_kinds', 'kind');
    const termCounts = countsFromMeta(meta, 'term_categories', 'category');
    const coverage = [];
    const placesFiles = [];
    const hanziSeeds = new Set();
    const addHanzi = text => { for (const char of String(text || '')) if (/\p{Script=Han}/u.test(char)) hanziSeeds.add(char); };
    addHanzi(seedText);
    const pending = [...langs];
    await Promise.all(Array.from({length: Math.min(4, langs.length)}, async () => {
      while (pending.length) {
        const lang = pending.shift();
        const requestLang = apiRequestLocale(lang, meta);
        const terms = new Map();
        const files = [];
        for (let offset = 0; ; offset += 500) {
            const rel = `raw/reference-pages/glossary/${requestLang === lang ? lang : `${lang}/${requestLang}`}/${offset}.json`;
            const page = await fetch(rel, `/api/v2/glossary?lang=${encodeURIComponent(requestLang)}&limit=500&offset=${offset}`);
            if (!Array.isArray(page.terms) || page.offset !== offset) throw new Error(`Invalid glossary pagination for ${lang}/${offset}.`);
            const before = terms.size;
            for (const term of page.terms) addHanzi(term.hanzi);
            mergeRows(terms, page.terms, row => Number.isInteger(row.term_id) ? row.term_id : null, `glossary/${lang}`);
            files.push(rel);
            if (page.terms.length < 500) break;
            if (terms.size === before || terms.size > 100000) throw new Error(`Non-progressing glossary pagination for ${lang}.`);
        }
        assertCounts([...terms.values()], termCounts, 'category', `glossary/${lang}`);
        coverage.push({ endpoint: 'glossary', lang, returnedCount: terms.size,
            expectedCount: terms.size, possiblyTruncated: false, strategy: 'metadata-counted-offset-pages', files });
      }
    }));
    const places = new Map();
    for (const { key: kind, count } of placeCounts) {
        const prior = priorPlaceQueries[kind] || [];
        if (prior.some(q => typeof q !== 'string' || [...q].length > 1)) throw new Error('Invalid retained place query.');
        const queries = [...new Set(['', ...prior, ...PLACE_ALPHABET, ...hanziSeeds])];
        for (const q of queries) {
            if ([...places.values()].filter(row => row.kind === kind).length === count) break;
            const token = q ? Buffer.from(q).toString('hex') : 'all';
            const rel = `raw/reference-pages/places/${kind}/${token}.json`;
            const page = await fetch(rel, `/api/v2/places?kind=${encodeURIComponent(kind)}&limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`);
            if (!Array.isArray(page.places) || page.places.some(row => row.kind !== kind)) throw new Error(`Invalid places page for ${kind}.`);
            placesFiles.push(rel);
            mergeRows(places, page.places, row => row.hanzi && `${row.kind}\0${row.hanzi}\0${row.pinyin || ''}`, 'places');
            // Some source rows have no Latin spelling. Continue with observed
            // Hanzi characters, using the same documented substring filter.
            for (const row of page.places) for (const char of String(row.hanzi || '')) {
                if (/\p{Script=Han}/u.test(char) && !queries.includes(char)) queries.push(char);
            }
            if (queries.length > 10000) throw new Error('Places query census exceeds its bound.');
        }
    }
    assertCounts([...places.values()], placeCounts, 'kind', 'places');
    for (const lang of langs) coverage.push({ endpoint: 'places', lang, returnedCount: places.size,
        expectedCount: places.size, possiblyTruncated: false, strategy: 'metadata-counted-query-census', files: placesFiles });
    return { coverage, placesFiles };
}
module.exports = { fetchCompleteReferences, mergeRows, assertCounts, PLACE_ALPHABET };
