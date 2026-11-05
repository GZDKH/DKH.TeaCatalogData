#!/usr/bin/env node
const assert = require('assert');
const crypto = require('crypto');
const { fetchCompleteReferences } = require('./lib/complete-api-references');
const { cardSectionDetails } = require('./lib/card-section-source');
async function main() {
    const terms = Array.from({length: 501}, (_, i) => ({term_id: i + 1, category: 'tasting'}));
    const calls = [];
    const meta = {place_kinds: [{kind:'toponym',count:2}],term_categories:[{category:'tasting',count:501}]};
    const fetch = async (file, endpoint) => {
        calls.push({file,endpoint}); const url = new URL(endpoint, 'https://api.thetea.app');
        if (url.pathname.endsWith('/places')) return {places:[{kind:'toponym',hanzi:'山',pinyin:'shān'},{kind:'toponym',hanzi:'山',pinyin:'shàn'}]};
        const offset = Number(url.searchParams.get('offset'));
        return {offset,terms:terms.slice(offset,offset+500)};
    };
    const result = await fetchCompleteReferences({meta,langs:['en','ru'],fetch});
    assert.strictEqual(result.coverage.length,4);
    assert.strictEqual(calls.filter(call=>call.endpoint.includes('/places')).length,1);
    assert.strictEqual(calls.filter(call=>call.endpoint.includes('offset=500')).length,2);
    assert(result.coverage.every(row=>!row.possiblyTruncated && row.files.length));
    await assert.rejects(fetchCompleteReferences({meta:{...meta,place_kinds:[{kind:'toponym',count:3}]},langs:['en'],fetch}), /2\/3/);
    await assert.rejects(fetchCompleteReferences({meta:{...meta,term_categories:[{category:'tasting',count:502}]},langs:['en'],fetch}), /501\/502/);
    const commonPlaces = Array.from({length:200}, (_, i) => ({kind:'tea_name',hanzi:`茶${i}`,pinyin:'chá'}));
    const rarePlace = {kind:'tea_name',hanzi:'罕',pinyin:null};
    const seeded = await fetchCompleteReferences({meta:{place_kinds:[{kind:'tea_name',count:201}],term_categories:[{category:'tasting',count:1}]},langs:['en'],seedText:'罕',fetch:async (file,endpoint)=>{
        const url=new URL(endpoint,'https://api.thetea.app');
        return url.pathname.endsWith('/glossary') ? {offset:0,terms:[{term_id:1,category:'tasting',hanzi:'茶'}]}
            : {places:url.searchParams.get('q')==='罕'?[rarePlace]:commonPlaces};
    }});
    assert.strictEqual(seeded.coverage.find(row=>row.endpoint==='places').returnedCount,201);
    const resumed = await fetchCompleteReferences({meta:{place_kinds:[{kind:'tea_name',count:201}],term_categories:[{category:'tasting',count:1}]},langs:['en'],priorPlaceQueries:{tea_name:['罕']},fetch:async (file,endpoint)=>{
        const url=new URL(endpoint,'https://api.thetea.app');
        if (url.pathname.endsWith('/glossary')) return {offset:0,terms:[{term_id:1,category:'tasting'}]};
        const q=url.searchParams.get('q');
        if(q && q!=='罕') throw Error('Unnecessary uncached query');
        return {places:q==='罕'?[rarePlace]:commonPlaces};
    }});
    assert.strictEqual(resumed.coverage.find(row=>row.endpoint==='places').returnedCount,201);
    await assert.rejects(fetchCompleteReferences({meta:{place_kinds:[{kind:'../unsafe',count:1}],term_categories:meta.term_categories},langs:['en'],fetch}), /valid place_kinds/);
    const card={sections:{origin:{cultivar:{value:'text',num:null,unit:null}}}};
    const bytes=Buffer.from(JSON.stringify(card));
    const evidence={slug:'tea',lang:'en',entityKind:'tea',source:'api-card-sections',sourceFile:'raw/cards/en/tea.json',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),expected:[{section:'origin',field:'cultivar'}],fetched:[{section:'origin',field:'cultivar'}],missing:[]};
    const input={card,bytes,file:evidence.sourceFile,manifest:{fieldCoverage:[evidence]},slug:'tea',lang:'en',entityKind:'tea'};
    assert.strictEqual(cardSectionDetails(input)[0].payload.value,'text');
    assert.throws(()=>cardSectionDetails({...input,bytes:Buffer.from('changed')}), /changed/);
    assert.throws(()=>cardSectionDetails({...input,manifest:{fieldCoverage:[{...evidence,fetched:[]}]}}), /Incomplete/);
    console.log('test-complete-api-references: OK');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
