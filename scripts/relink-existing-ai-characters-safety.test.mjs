import test from 'node:test';import assert from 'node:assert/strict';
import {hasReceipt,verifyPreimage,appendPayload,assetOutcome} from './relink-existing-ai-characters-safety.mjs';
const pre={asset:{id:'a'},tags:[{id:'t',source:'ai',status:'active',created_by:null,model:null,created_at:'2020-01-01'}],links:[{character_id:'old',source:'manual'}],legacy:[{name:'old'}]};
test('all receipt statuses protect assets, including accepted and completed',()=>{for(const status of ['pending','accepted','completed','failed'])assert.equal(hasReceipt({task:{status,external_job:{asset_ids:['a']}}},'a'),true);assert.equal(hasReceipt({task:{status:'running',params:{asset_ids:['a']}}},'a'),false);});
test('NULL model remains unknown and original AI timestamp is preserved',()=>{const entry={preimage:pre,sourceTagId:'t',model:null,assetId:'a',characterId:'new',licensorId:'lic',character:{status:'active',licensor_id:'lic'}};assert.deepEqual(appendPayload(entry),{asset_id:'a',character_id:'new',source:'ai',model:null,tagged_at:'2020-01-01'});assert.equal(pre.links[0].source,'manual');assert.throws(()=>appendPayload({...entry,model:'invented'}));});
test('any changed source tag, asset, canonical or legacy link fails before append',()=>{verifyPreimage(pre,structuredClone(pre),{});for(const key of ['asset','tags','links','legacy']){const changed=structuredClone(pre);if(key==='asset')changed.asset.id='different';else changed[key].push({different:true});assert.throws(()=>verifyPreimage(pre,changed,{}));}assert.throws(()=>verifyPreimage(pre,pre,{owner:{external_job:{asset_ids:['a']}}}));});

test('overlapping resolver work cannot assign another asset its append outcome',async()=>{
 const manifest=[];let release;const gate=new Promise(resolve=>release=resolve);const oldStart=manifest.length;
 const noMatch=(async()=>{await gate;return assetOutcome(manifest,'no-match');})();
 const match=(async()=>{manifest.push({assetId:'matched',characterId:'new'});release();return assetOutcome(manifest,'matched');})();
 const [empty,linked]=await Promise.all([noMatch,match]);
 assert.equal(manifest.length-oldStart,1,'the old global delta falsely reports an append for the no-match resolver');
 assert.equal(empty.outcome,'no_missing_unambiguous_new_character');assert.equal(empty.appends,0);
 assert.equal(linked.outcome,'append_missing_links');assert.equal(linked.appends,1);
 assert.equal(empty.appends+linked.appends,manifest.length);
});
