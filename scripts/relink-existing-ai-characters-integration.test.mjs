import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stripTypeScriptTypes as nativeStrip,createRequire} from 'node:module';
// Some distribution builds of Node omit its TypeScript support. Use an installed
// compiler in those environments; never fetch a dependency while running tests.
const require=createRequire(import.meta.url);
function stripTypeScriptTypes(source) {
 try {return nativeStrip(source);} catch(error) {
  if(error.code!=='ERR_NO_TYPESCRIPT')throw error;
  return require('@babel/core').transformSync(source,{configFile:false,babelrc:false,plugins:[[require('@babel/plugin-transform-typescript'),{allowDeclareFields:true}]]}).code;
 }
}
import {createHash} from 'node:crypto';

// Execute the actual entry points offline, retaining their loops and manifest/receipt writes.
// The actual application name resolver runs against a small in-memory query client.
const worker=readFileSync(new URL('../apps/worker/src/handlers/ai-tagging-shared.ts',import.meta.url),'utf8');
const resolverSource=worker.slice(worker.indexOf('export async function addNamedCharacters('),worker.indexOf('export interface TaggingPromptOptions'));
const constants=worker.slice(worker.indexOf('export const NOT_A_CHARACTER'),worker.indexOf('/**',worker.indexOf('function normalizedCharacterName')));
const displayCharacterName=s=>s;
const resolveCharacterScope=async(_client,asset)=>{if(asset.scopeFailure)throw Error('scope read');return {licensor_id:'lic',property_id:null,unlicensed:false};};
const addNamedCharacters=new Function('resolveCharacterScope','displayCharacterName',stripTypeScriptTypes(constants.replace('export const','const')+resolverSource.replace('export async','async'))+';return addNamedCharacters;')(resolveCharacterScope,displayCharacterName);
const character={id:'NEW',name:'Mickey',status:'approved',licensor_id:'lic'};
function candidate(id,extra={}) {return {asset:{id,style_group_id:null,...extra},tags:[{id:'t',tag:'Mickey',source:'ai',status:'active',created_by:null,model:null,created_at:'2020-01-01'}],matchingTagIds:['t'],links:[],legacy:[]};}
function entry(item) {return {assetId:item.asset.id,characterId:'NEW',licensorId:'lic',propertyId:null,sourceTagId:'t',sourceTag:item.tags[0],model:null,character,preimage:item,groupPreimage:null};}
function fixture(items,options={}) {
 let releaseMatch;const matched=new Promise(resolve=>releaseMatch=resolve);
 const inserts=[],rows=new Map(items.map(x=>[x.asset.id,structuredClone(x)]));let inserted=false;
 const client={schema(){return this;},from(table){const filters={};let payload;
  const q={select(){return q;},eq(k,v){filters[k]=v;return q;},ilike(k,v){filters[k]=v;return q;},limit(){return q;},order(){return q;},in(){return q;},single(){return q;},maybeSingle(){return q;},insert(value){payload=value;return q;},then(resolve,reject){return (async()=>{
   const id=filters.asset_id??filters.id,item=rows.get(id);
   if(table==='admin_config')return {data:{value:inserted&&options.claimOnInsert?{job:{external_job:{items:[{asset_id:inserts[0].asset_id}]}}}:{}},error:null};
   if(table==='style_groups')return {data:options.group??null,error:options.failGroup?{code:'missing'}:null};
   if(table==='character'&&options.overlap&&filters.name?.startsWith('nobody'))await matched;
   if(table==='character'&&options.overlap&&filters.name?.startsWith('mickey'))releaseMatch();
   if(table==='character')return {data:filters.id?character:filters.name?.startsWith('nobody')?[]:[character],error:null};
   if(table==='character_alias')return {data:[],error:null};
   if(payload){inserts.push(...payload);inserted=true;const target=rows.get(payload[0].asset_id);target.links.push(...payload);target.asset.updated_at='trigger timestamp';return {data:payload,error:null};}
   if(options.failAsset===id||(options.failPostRead&&inserted&&table==='assets'))return {data:null,error:{code:'deleted'}};
   return {data:table==='assets'?item.asset:table==='asset_tags'?item.tags:table==='asset_licensor_characters'?item.links:item.legacy,error:null};
  })().then(resolve,reject);}};return q;}};
 return {client,inserts};
}
let runId=0;
async function run(script,items,options={}) {
 const dir=mkdtempSync(join(tmpdir(),'relink-test-')),oldArgv=process.argv,oldURL=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const f=fixture(items,options);globalThis.__relinkTest={createClient:()=>f.client,addNamedCharacters,resolveCharacterScope,displayCharacterName};
 const target='https://qsllyeztdwjgirsysgai.supabase.co',input=join(dir,'input'),output=join(dir,'output'),catalog=join(dir,'catalog');
 const packet=JSON.stringify({target,manifest:items.map(entry)});
 writeFileSync(input,script==='apply'?packet:JSON.stringify(items));
 writeFileSync(catalog,JSON.stringify([{kind:'characters',data:[character]},{kind:'operations',data:[{}]}]));
 process.env.SUPABASE_URL=target;process.env.SUPABASE_SERVICE_ROLE_KEY='offline-test';
 process.argv=['node','test',input,...(script==='apply'?[output,...(options.apply?[createHash('sha256').update(packet).digest('hex')]:[])]:[catalog,output])];
 try {
  const filename=script==='apply'?'apply-existing-ai-character-relinks.mts':'relink-existing-ai-characters.mts';
  let source=readFileSync(new URL(filename,import.meta.url),'utf8');
  source=source.replace(/import\s*\{([^}]+)\}\s*from\s*['"](?:@supabase\/supabase-js|\.\.\/apps\/worker\/[^'"]+)['"];?/g,(_,names)=>`const {${names}}=globalThis.__relinkTest;`);
  source=source.replace(/(['"])\.\/relink-existing-ai-characters-safety.mjs\1/g,JSON.stringify(new URL('relink-existing-ai-characters-safety.mjs',import.meta.url).href));
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)+`\n// run ${runId++}`).toString('base64'));
  return {result:JSON.parse(readFileSync(output,'utf8')),inserts:f.inserts};
 } finally {process.argv=oldArgv;if(oldURL===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldURL;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;delete globalThis.__relinkTest;rmSync(dir,{recursive:true,force:true});}
}
test('real apply loop continues after a failed dependency and completes its receipt',async()=>{
 const {result,inserts}=await run('apply',[candidate('deleted'),candidate('good')],{apply:true,failAsset:'deleted'});
 assert.deepEqual(result.outcomes.map(x=>x.status),['abstained_dependency_failure','appended']);assert.ok(result.completedAt);assert.equal(inserts.length,1);
});
test('dry run writes nothing; apply accepts case-normalized IDs, active-like status and timestamp side effects',async()=>{
 const dry=await run('apply',[candidate('a')]);assert.equal(dry.result.outcomes[0].status,'dry_run_ready');assert.equal(dry.inserts.length,0);
 const applied=await run('apply',[candidate('a')],{apply:true});assert.equal(applied.result.outcomes[0].status,'appended');assert.equal(applied.inserts[0].model,null);assert.equal(applied.inserts[0].tagged_at,'2020-01-01');
});
test('group preimage mismatch abstains before insert',async()=>{
 const {result,inserts}=await run('apply',[candidate('a',{style_group_id:'g'})],{apply:true,group:{id:'g',changed:true}});assert.equal(result.outcomes[0].status,'abstained_changed_group');assert.equal(inserts.length,0);
});
test('claim appearing during insert is recorded as a conflict, never a verified append',async()=>{
 const {result,inserts}=await run('apply',[candidate('a')],{apply:true,claimOnInsert:true});assert.equal(result.outcomes[0].status,'appended_receipt_conflict');assert.deepEqual(result.outcomes[0].inserted,inserts);assert.ok(result.completedAt);
});
test('real planner continues after group and scope failures',async()=>{
 const {result}=await run('plan',[candidate('group',{style_group_id:'g'}),candidate('scope',{scopeFailure:true}),candidate('good')],{failGroup:true});assert.equal(result.manifest.length,1);assert.equal(result.manifest[0].assetId,'good');assert.equal(result.outcomes.filter(x=>x.outcome==='abstained_dependency_failure').length,2);
});
test('overlapping real resolver calls keep manifest outcomes with their asset',async()=>{
 const empty=candidate('empty');empty.tags[0].tag='Nobody';
 const {result}=await run('plan',[empty,candidate('matched')],{overlap:true});assert.equal(result.manifest.length,1);assert.equal(result.outcomes.find(x=>x.assetId==='empty').appends,0);assert.equal(result.outcomes.find(x=>x.assetId==='matched').appends,1);
});

test('a failed post-insert read preserves the append evidence and completion marker',async()=>{
 const {result,inserts}=await run('apply',[candidate('a')],{apply:true,failPostRead:true});assert.equal(result.outcomes[0].status,'appended_verification_failed');assert.deepEqual(result.outcomes[0].inserted,inserts);assert.ok(result.completedAt);
});
