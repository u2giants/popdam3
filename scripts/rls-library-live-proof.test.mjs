import test from 'node:test';
import assert from 'node:assert/strict';
import { permittedRequest, HOST, run } from './rls-library-live-proof.mjs';
const request = (path, method = 'POST', host = HOST) => permittedRequest({url: `https://${host}${path}`, method});
test('business writes and unrelated RPCs fail closed', () => {
  for (const verb of ['POST','PATCH','PUT','DELETE']) assert.equal(request('/rest/v1/assets', verb), false);
  for (const rpc of ['assign_role','delete_asset','search_style_tracker_link_candidates']) assert.equal(request(`/rest/v1/rpc/${rpc}`), false);
  for (const rpc of ['get_filter_counts','get_path_facets','get_dam_material_facets','get_dam_customer_facets']) {
    assert.equal(request(`/rest/v1/rpc/${rpc}`), true);
    assert.equal(request(`/rest/v1/rpc/${rpc}`, 'DELETE'), false);
  }
});
test('only exact password token and existing normal logout endpoints permit auth writes', () => {
  assert.equal(request('/auth/v1/token?grant_type=password'), true);
  assert.equal(request('/auth/v1/token?grant_type=refresh_token'), false);
  assert.equal(request('/auth/v1/signup'), false);
  assert.equal(request('/auth/v1/recover'), false);
  assert.equal(request('/auth/v1/logout?scope=global'), true);
  assert.equal(request('/auth/v1/token?grant_type=password','POST','other.supabase.co'), false);
});
test('OAuth navigation and insecure targets are refused', () => {
  assert.equal(request('/auth/v1/authorize?provider=azure', 'GET'), false);
  for (const host of ['login.microsoftonline.com','login.live.com','auth.designflow.app']) assert.equal(request('/', 'GET', host), false);
  assert.equal(permittedRequest({url:`http://${HOST}/rest/v1/assets`,method:'GET'}), false);
  assert.equal(request('/rest/v1/style_groups','GET'), true);
  assert.equal(request('/collect','GET','unexpected.example'), false);
  assert.equal(request('/auth/callback','GET','dam.designflow.app'), false);
  assert.equal(request('/functions/v1/arbitrary','GET'), false);
  assert.equal(request('/thumbnails/synthetic.jpg','GET','popdam.nyc3.digitaloceanspaces.com'), true);
  assert.equal(request('/private/synthetic.jpg','GET','popdam.nyc3.digitaloceanspaces.com'), false);
  assert.equal(permittedRequest({url:'https://dam.designflow.app:8443/library',method:'GET'}), false);
  assert.equal(permittedRequest({url:'https://user:secret@dam.designflow.app/library',method:'GET'}), false);
});
test('wrong target or identity refuses before runtime or credentials are used', async () => {
  await assert.rejects(run({POPDAM_ACCEPTANCE_BASE_URL:'https://other.example'}), /target/);
  await assert.rejects(run({POPDAM_ACCEPTANCE_BASE_URL:'https://dam.designflow.app', SUPABASE_PROJECT_ID:HOST.split('.')[0],POPDAM_TEST_USER:'other@example.test'}), /identity/);
});
test('only app-declared Google font GET paths are allowed', () => {
  assert.equal(request('/css2?family=Inter&display=swap','GET','fonts.googleapis.com'), true);
  assert.equal(request('/s/inter/synthetic.woff2','GET','fonts.gstatic.com'), true);
  for (const verb of ['POST','PATCH','DELETE','HEAD']) {
    assert.equal(request('/css2?family=Inter',verb,'fonts.googleapis.com'), false);
    assert.equal(request('/s/inter/font.woff2',verb,'fonts.gstatic.com'), false);
  }
  assert.equal(request('/other','GET','fonts.googleapis.com'), false);
  assert.equal(request('/other/font.woff2','GET','fonts.gstatic.com'), false);
});
test('default filter lookup permits exactly its read-only action, never admin writes', () => {
  const url = `https://${HOST}/functions/v1/admin-api`;
  assert.equal(permittedRequest({url,method:'POST',body:{action:'get-filter-options'}}), true);
  assert.equal(permittedRequest({url,method:'OPTIONS'}), true);
  assert.equal(permittedRequest({url,method:'GET'}), false);
  for (const body of [undefined,{},[],{action:'set-config'},{action:'get-filter-options',value:'extra'},{action:'get-filter-options',licensor_id:'synthetic'}]) {
    assert.equal(permittedRequest({url,method:'POST',body}), false);
  }
  assert.equal(permittedRequest({url:url+'?action=get-filter-options',method:'POST',body:{action:'get-filter-options'}}), false);
});

test('diagnostics retain only fixed route kinds, bounded status counts and safe error classes', async () => {
  const {diagnosticRoute,errorClass,incrementStatus,requireReadonlyDiagnosticEnvironment} = await import('./rls-library-live-proof.mjs');
  const counts = {};
  incrementStatus(counts, `https://${HOST}/rest/v1/style_groups?sku=PRIVATE_CANARY`, 403);
  incrementStatus(counts, 'https://unexpected.example/PRIVATE_CANARY?token=SECRET_CANARY', 500);
  incrementStatus(counts, 'https://unexpected.example/', 999);
  assert.deepEqual(counts, {'library:403':1,'static-other:500':1});
  counts['library:403']=10000;
  incrementStatus(counts, `https://${HOST}/rest/v1/style_groups`,403);
  assert.equal(counts['library:403'],10000);
  assert.equal(errorClass({name:'SECRET_CANARY',message:'PRIVATE_CANARY'}),'OtherError');
  assert.equal(errorClass(new TypeError('PRIVATE_CANARY')),'TypeError');
  assert.equal(diagnosticRoute('https://dam.designflow.app/login?secret=CANARY'),'app-page');
  assert.equal(JSON.stringify(counts).includes('CANARY'),false);
  requireReadonlyDiagnosticEnvironment({});
  for (const key of ['PROD_DB_PASSWORD','DATABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ACCESS_TOKEN']) assert.throws(()=>requireReadonlyDiagnosticEnvironment({[key]:'CANARY'}));
});

test('fixed readonly entry cannot instantiate fixture or database client and binds exact deployed source', async () => {
  const {readFileSync} = await import('node:fs');
  const source = readFileSync(new URL('./run-rls-read-diagnostic.mjs',import.meta.url),'utf8');
  assert(source.includes('await run(env, null)'));
  assert(source.includes('requireReadonlyDiagnosticEnvironment(process.env)'));
  assert(source.includes("DEPLOYED_FRONTEND_SHA:'eb405c02479f1d76b319f2f2e89150493bcade45'"));
  for(const forbidden of ['createFixtureProtocol','protectedCounts','createClient','createRequire','rls-owned-fixture.mjs']) assert.equal(source.includes(forbidden),false);
  assert(source.indexOf('delete process.env.POPDAM_TEST_PASSWORD') < source.indexOf('await run(env, null)'));
});

test('actual shared library response predicate accepts only exact GET 200 or 206', async () => {
  const {successfulLibraryResponse} = await import('./rls-library-live-proof.mjs');
  const response = (status,method='GET',url=`https://${HOST}/rest/v1/style_groups?select=*&offset=0&limit=200`) => ({status:()=>status,url:()=>url,request:()=>({method:()=>method})});
  assert.equal(successfulLibraryResponse(response(200)),true);
  assert.equal(successfulLibraryResponse(response(206)),true);
  for(const status of [201,202,204,205,207,301,302,304,400,401,403,404,429,500,503]) assert.equal(successfulLibraryResponse(response(status)),false);
  for(const method of ['POST','PATCH','DELETE','HEAD']) assert.equal(successfulLibraryResponse(response(206,method)),false);
  for(const url of [`https://other.supabase.co/rest/v1/style_groups`,`https://${HOST}/rest/v1/assets`,`https://${HOST}/rest/v1/style_groups/extra`,`http://${HOST}/rest/v1/style_groups`,`https://${HOST}:8443/rest/v1/style_groups`,`https://PRIVATE_CANARY:SECRET_CANARY@${HOST}/rest/v1/style_groups`]) assert.equal(successfulLibraryResponse(response(206,'GET',url)),false);
});
test('facet diagnostics expose only four fixed admitted names and no private URL or query', async () => {
  const {diagnosticRoute,incrementStatus} = await import('./rls-library-live-proof.mjs');
  for(const name of ['get_filter_counts','get_path_facets','get_dam_material_facets','get_dam_customer_facets']) {
    assert.equal(diagnosticRoute(`https://${HOST}/rest/v1/rpc/${name}?private=PRIVATE_CANARY`),`facet-${name}`);
  }
  const counts={};
  incrementStatus(counts,`https://${HOST}/rest/v1/rpc/PRIVATE_CANARY?token=SECRET_CANARY`,500);
  incrementStatus(counts,`https://${HOST}/rest/v1/rpc/get_filter_counts?token=SECRET_CANARY`,500);
  assert.deepEqual(counts,{'supabase-read:500':1,'facet-get_filter_counts:500':1});
  assert.equal(JSON.stringify(counts).includes('CANARY'),false);
});

test('operation hydration admits exact read-only key body and rejects all broader admin requests',()=>{
 const url=`https://${HOST}/functions/v1/admin-api`, body={action:'get-config',keys:['BULK_OPERATIONS']};
 assert.equal(permittedRequest({url,method:'POST',body}),true);
 for(const bad of [null,[],{},Object.assign(Object.create(null),body),{...body,extra:true},{action:'get-config',keys:[]},{action:'get-config',keys:['*']},{action:'get-config',keys:['OTHER']},{action:'get-config',keys:['BULK_OPERATIONS','BULK_OPERATIONS']},{action:'get-config'},{action:'set-config',keys:['BULK_OPERATIONS']},{action:'update-bulk-op',keys:['BULK_OPERATIONS']}])assert.equal(permittedRequest({url,method:'POST',body:bad}),false);
 for(const method of ['GET','PUT','PATCH','DELETE'])assert.equal(permittedRequest({url,method,body}),false);
 for(const target of [url+'?private=CANARY',`https://other.supabase.co/functions/v1/admin-api`,`https://${HOST}/functions/v1/other`])assert.equal(permittedRequest({url:target,method:'POST',body}),false);
});
test('normal deployed operation mount callchain matches admitted resource without starting work',async()=>{
 const {readFileSync}=await import('node:fs');
 const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
 assert(read('../src/components/library/BulkActionBar.tsx').includes('usePersistentOperation("ai-tag-groups")'));
 assert(read('../src/hooks/usePersistentOperation.ts').includes('call("get-config", { keys: [CONFIG_KEY] })'));
 assert(read('../src/hooks/usePersistentOperation.ts').includes('const CONFIG_KEY = "BULK_OPERATIONS"'));
 assert(read('../src/hooks/useAdminApi.ts').includes('body: { action, ...payload }'));
});
test('denial enums and facet errors never export raw URL/body/query/message canaries',async()=>{
 const {deniedRequestKind,safeErrorCode,facetResponseFact,fixedFilterCountResponse}=await import('./rls-library-live-proof.mjs');
 assert.equal(deniedRequestKind({url:`https://${HOST}/functions/v1/admin-api?PRIVATE_CANARY=SECRET_CANARY`,method:'POST',body:{action:'PRIVATE_CANARY'}}),'admin-other:POST');
 assert.equal(deniedRequestKind({url:`https://${HOST}/rest/v1/PRIVATE_CANARY`,method:'PRIVATE_CANARY',body:{secret:'SECRET_CANARY'}}),'supabase-other:OTHER');
 for(const code of ['57014','42501','42703','42883','PGRST202','PGRST204','XX000'])assert.equal(safeErrorCode(code),code);
 for(const code of ['PRIVATE_CANARY','57014\nSECRET_CANARY',null,{},500])assert.equal(safeErrorCode(code),'OTHER');
 const response={status:()=>500,headers:()=>({'content-length':'75'}),text:async()=>JSON.stringify({code:'57014',message:'PRIVATE_CANARY SECRET_CANARY'})};
 const fact=await facetResponseFact(response);assert.deepEqual(fact,{state:'completed',status:500,error_code:'57014'});assert.equal(JSON.stringify(fact).includes('CANARY'),false);
 let read=0;assert.equal((await facetResponseFact({...response,headers:()=>({}),text:async()=>{read++;return '{}';}})).error_code,'OTHER');assert.equal(read,0);
 assert.equal((await facetResponseFact({...response,headers:()=>({'content-length':'99999'})})).error_code,'OTHER');
 const r={url:()=>`https://${HOST}/rest/v1/rpc/get_filter_counts?PRIVATE_CANARY`,request:()=>({method:()=> 'POST'})};
 assert.equal(fixedFilterCountResponse(r),true);assert.equal(fixedFilterCountResponse({...r,request:()=>({method:()=> 'GET'})}),false);
});
test('facet observation is bounded25seconds with truthful pending and fixed readonly inspection entry',async t=>{
 const {boundedFacetWait}=await import('./rls-library-live-proof.mjs');
 let duration;
 t.mock.method(globalThis,'setTimeout',(callback,ms)=>{duration=ms;queueMicrotask(callback);return 123;});
 const result=await boundedFacetWait(new Promise(()=>{}));assert.equal(duration,25000);assert.deepEqual(result,{state:'pending',status:null,error_code:null});
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('./run-rls-read-inspection.mjs',import.meta.url),'utf8');
 assert(source.includes('await run(env, null, true)'));assert(source.includes('requireReadonlyDiagnosticEnvironment(process.env)'));
 assert(source.includes('/tmp/popdam-4427-read-inspection-private-01a17a03/proof.json'));
 for(const forbidden of ['createFixtureProtocol','protectedCounts','createClient','createRequire','rls-owned-fixture.mjs'])assert.equal(source.includes(forbidden),false);
 await assert.rejects(run({},null,()=>{}),/fixed inspection flag/);
});
