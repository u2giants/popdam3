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
  assert(source.includes("DEPLOYED_FRONTEND_SHA:'a273bff8b14395d13191186a6cb83c98b7829dc1'"));
  for(const forbidden of ['createFixtureProtocol','protectedCounts','createClient','createRequire','rls-owned-fixture.mjs']) assert.equal(source.includes(forbidden),false);
  assert(source.indexOf('delete process.env.POPDAM_TEST_PASSWORD') < source.indexOf('await run(env, null)'));
});
