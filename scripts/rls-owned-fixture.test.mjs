import test from 'node:test';
import assert from 'node:assert/strict';
import {FIXTURE_ID,FIXED_COUNTS,digest,fixturePayload,validateManifest,protectedCounts,createFixtureProtocol} from './rls-owned-fixture.mjs';
import {browserEnvironment} from './rls-library-live-proof.mjs';
import {BROWSER_PACKAGE} from './rls-browser-custody.mjs';
const manifest = () => ({schema_version:1,issue:4427,id:FIXTURE_ID,sku:`AI-QA-4427-${FIXTURE_ID}`,folder_path:`__AI_QA_4427__/${FIXTURE_ID}`,original:'other',temporary:'product_ideas',latest_file_date:'2026-10-27T00:00:00.000Z',project:'qsllyeztdwjgirsysgai',host:'aws-1-us-east-1.pooler.supabase.com',port:6543,ca_sha256:digest('synthetic CA'),dependencies:{sdk:'2.97.0',pg:'8.23.1'}});
const counts = n => ({groups:n,documents:n,keys:n,assets:0,tags:0,bridges:0});
test('Chromium environment never inherits QA/DB secrets, proxy or Node injection',()=>{
  const env=browserEnvironment({POPDAM_PLAYWRIGHT_PACKAGE:BROWSER_PACKAGE,POPDAM_TEST_PASSWORD:'QA_CANARY',PROD_DB_PASSWORD:'DB_CANARY',NODE_OPTIONS:'NODE_CANARY',HTTP_PROXY:'PROXY_CANARY',PLAYWRIGHT_BROWSERS_PATH:'/tmp/fixed-browser'});
  assert.deepEqual(Object.keys(env).sort(),['HOME','PATH','TMPDIR']);
  assert.equal(JSON.stringify(env).includes('CANARY'),false);
});
test('fixed prospective identity refuses arbitrary fixtures, payload has no business references', () => {
  const m = manifest(); assert.equal(fixturePayload(m).asset_count,0);
  for (const change of [{id:'00000000-0000-4000-8000-000000000000'},{sku:'existing'},{original:'approved'},{host:'other.example'},{port:5432}]) assert.throws(()=>validateManifest({...m,...change}));
  assert.equal(fixturePayload(m).primary_asset_id,null);
  assert.equal(fixturePayload(m).is_licensed,false);
});
for (const failure of ['none','identity','query','begin']) test(`protected PG ${failure} always rolls back/closes and never accepts SQL input`, async () => {
  const events=[];
  class Client {
    constructor(config) { assert.equal(config.ssl.rejectUnauthorized,true); assert.equal(config.user,'postgres.qsllyeztdwjgirsysgai'); }
    async connect() {events.push('connect');}
    async end() {events.push('end');}
    async query(sql,params) {
      events.push(sql);
      if (failure==='begin' && sql==='BEGIN READ ONLY') throw new Error('synthetic');
      if (sql.startsWith('SELECT current_setting')) return {rows:[{ro:failure==='identity'?'off':'on',default_ro:'on',database_name:'postgres',project_ref:'qsllyeztdwjgirsysgai'}]};
      if (sql===FIXED_COUNTS) {assert.deepEqual(params,[FIXTURE_ID,manifest().sku,manifest().folder_path]); if(failure==='query')throw new Error('synthetic'); return {rows:[counts(0)]};}
      return {rows:[]};
    }
  }
  const operation = protectedCounts({Client,password:'TEST_CANARY',ca:'synthetic CA',manifest:manifest()});
  if (failure==='none') assert.deepEqual(await operation,counts(0)); else await assert.rejects(operation);
  assert.equal(events.at(-2),'ROLLBACK');assert.equal(events.at(-1),'end');
  assert.equal(events.some(s=>/INSERT|UPDATE|DELETE|SET ROLE|jwt/i.test(s)),false);
});
function fixtureMock({insertThrows=false,patchBody=null,deleteBody=null}={}) {
  const m=manifest(); let row=null,deleted=0,signouts=0,clock=0,protectedRefs=0,protocol,countCalls=0;
  const deleteFilters=[];
  const client={auth:{signInWithPassword:async()=>({}),getUser:async()=>({data:{user:{email:'ai-admin@designflow.app',id:'synthetic-user'}}}),signOut:async options=>{assert.deepEqual(options,{scope:'local'});signouts++;return {}; }},from(table){
    let action='read',payload;
    const q={select(){return q;},eq(k,v){if(action==='delete')deleteFilters.push([k,v]);return q;},is(k,v){if(action==='delete')deleteFilters.push([k,v]);return q;},limit(){return q;},insert(value){action='insert';payload=value;return q;},delete(){action='delete';return q;},then(resolve,reject){
      if(table==='user_roles')return Promise.resolve({data:[{role:'admin'}]}).then(resolve,reject);
      if(action==='insert') {row={...payload,stage:null,customer:null,program:null,updated_at:'2026-10-27T00:00:01.000Z'};if(insertThrows)return Promise.reject(new Error('transport uncertainty')).then(resolve,reject);}
      let data=row?[structuredClone(row)]:[];
      if(action==='delete')data=deleteBody===null?(row?[{id:row.id}]:[]):deleteBody;
      if(action==='delete'){deleted++;row=null;}
      return Promise.resolve({data}).then(resolve,reject);
    }}; return q;
  }};
  const page={getByText(){const text={waitFor:async()=>{},first(){return text;}};return text;},getByRole(role,options){
    const handle={filter(){return handle;},count:async()=>1,click:async()=>{
      if(role==='option') {
        const status=options.name.test('product ideas')?'product_ideas':'other';
        const url=new URL(`https://${m.project}.supabase.co/rest/v1/style_groups?id=in.(${m.id})&select=id`);
        for(const bad of [{workflow_status:status,sku:'FOREIGN'},{workflow_status:'approved'},null,[]]) assert.equal(protocol.permitPatch(url,bad),false);
        assert.equal(protocol.permitPatch(new URL(url.href.replace(m.id,'00000000-0000-4000-8000-000000000000')),{workflow_status:status}),false);
        assert.equal(protocol.permitPatch(new URL(`https://${m.project}.supabase.co/rest/v1/style_groups?id=in.(${m.id})&select=id`),{workflow_status:status}),true);
        row.workflow_status=status;row.updated_at=`2026-10-27T00:00:0${++clock+1}.000Z`;
      }
    }};return handle;
  },waitForResponse:async(predicate)=>({json:async()=>String(predicate).includes("=== 'PATCH'")?(patchBody===null?[{id:m.id}]:patchBody):(row?[structuredClone(row)]:[])}),reload:async()=>{}};
  protocol=createFixtureProtocol({client,manifest:m,credentials:{email:'ai-admin@designflow.app',password:'UNIT_CANARY'},counts:async()=>{countCalls++;return {...counts(row?1:0),assets:protectedRefs};}});
  return {protocol,page,setRefs:n=>protectedRefs=n,mutate:()=>row.sku='FOREIGN',prune:()=>row=null,deleteFilters,get countCalls(){return countCalls;},get deleted(){return deleted;},get signouts(){return signouts;}};
}
test('normal UI change/restore plus exact fixture cleanup has three protected count phases', async()=>{
  const f=fixtureMock();await f.protocol.prepare();await f.protocol.exercise(f.page);await f.protocol.cleanup();
  assert.equal(f.protocol.summary().passed,true);assert.equal(f.deleted,1);assert.equal(f.signouts,1);
  assert.equal(f.countCalls,3);
  assert.deepEqual(Object.fromEntries(f.deleteFilters),{id:FIXTURE_ID,sku:manifest().sku,folder_path:manifest().folder_path,workflow_status:'other',updated_at:'2026-10-27T00:00:03.000Z',asset_count:0,is_licensed:false,latest_file_date:manifest().latest_file_date,primary_asset_id:null,licensor_id:null,property_id:null,customer_id:null});
  assert.equal(f.protocol.permitPatch(new URL('https://other.example'),{workflow_status:'other'}),false);
});
test('new inbound reference refuses delete and retains pending fixture', async()=>{
  const f=fixtureMock();await f.protocol.prepare();await f.protocol.exercise(f.page);f.setRefs(1);
  await assert.rejects(f.protocol.cleanup());assert.equal(f.deleted,0);assert.equal(f.protocol.summary().pending_fixture,true);assert.equal(f.signouts,1);
});
test('changed marker refuses delete and never overwrites foreign state', async()=>{
  const f=fixtureMock();await f.protocol.prepare();f.mutate();await assert.rejects(f.protocol.cleanup());
  assert.equal(f.deleted,0);assert.equal(f.protocol.summary().passed,false);assert.equal(f.protocol.summary().pending_fixture,true);
});
test('cleanup before local capability preparation performs no SDK authentication/signout',async()=>{
  const f=fixtureMock();await f.protocol.cleanup();assert.equal(f.signouts,0);assert.equal(f.countCalls,0);assert.equal(f.protocol.summary().sdk_auth_attempted,false);
});
test('ambiguous INSERT throw preserves pending custody and cannot delete an unproved row',async()=>{
  const f=fixtureMock({insertThrows:true});await assert.rejects(f.protocol.prepare());
  assert.equal(f.protocol.summary().pending_fixture,true);assert.equal(f.protocol.summary().created,false);
  await f.protocol.cleanup();assert.equal(f.deleted,0);assert.equal(f.protocol.summary().pending_fixture,true);
});
for(const body of [[],[{id:'FOREIGN'}],[{id:FIXTURE_ID},{id:FIXTURE_ID}],{},[{id:FIXTURE_ID,extra:true}]]) test(`UI rejects wrong PATCH returned identity shape ${JSON.stringify(body)}`,async()=>{
  const f=fixtureMock({patchBody:body});await f.protocol.prepare();await assert.rejects(f.protocol.exercise(f.page));
  assert.equal(f.protocol.summary().ui_changed,false);assert.equal(f.protocol.summary().passed,false);
});
for(const body of [[],[{id:'FOREIGN'}],[{id:FIXTURE_ID},{id:FIXTURE_ID}]]) test(`cleanup refuses ambiguous DELETE receipt ${JSON.stringify(body)}`,async()=>{
  const f=fixtureMock({deleteBody:body});await f.protocol.prepare();await f.protocol.exercise(f.page);await assert.rejects(f.protocol.cleanup());
  assert.equal(f.protocol.summary().deleted,false);assert.equal(f.protocol.summary().pending_fixture,true);assert.equal(f.signouts,1);
});
test('worker prune does not become our successful DELETE permission proof',async()=>{
  const f=fixtureMock();await f.protocol.prepare();await f.protocol.exercise(f.page);f.prune();await assert.rejects(f.protocol.cleanup());
  assert.equal(f.deleted,0);assert.equal(f.protocol.summary().passed,false);assert.equal(f.protocol.summary().pending_fixture,true);
});

test('group3 refuses both spent identities and uses fixed non-inspection entry',async()=>{
 const {readFileSync}=await import('node:fs');
 for(const id of ['acfe841c-e9ab-4e37-a064-ad77fe83583b','e542ea4e-9bf2-4bc0-8b7c-c6e2b1441792']){const m=manifest();m.id=id;m.sku=`AI-QA-4427-${id}`;m.folder_path=`__AI_QA_4427__/${id}`;assert.throws(()=>validateManifest(m));}
 const entry=readFileSync(new URL('./run-rls-owned-group3.mjs',import.meta.url),'utf8');
 assert(entry.includes('/tmp/4427-prospective-group3-01a17b07.json'));
 assert(entry.includes('/tmp/popdam-4427-owned-group3-private-01a17a03/fixture-proof.json'));
 assert(entry.includes('await run(env,protocol,false)'));
 assert(entry.includes("m.owner_session !== '01a17a03-63b6-7081-ab54-29fa144bf678'"));
 assert(entry.includes("m.deployed_sha !== 'eb405c02479f1d76b319f2f2e89150493bcade45'"));
 assert(entry.indexOf('digest(bytes) !== MANIFEST_SHA256')<entry.indexOf('createFixtureProtocol({'));
 assert.equal(entry.includes('inspectVisibleAssetCandidate'),false);
});
