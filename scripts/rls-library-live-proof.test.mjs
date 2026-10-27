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
});
test('wrong target or identity refuses before runtime or credentials are used', async () => {
  await assert.rejects(run({POPDAM_ACCEPTANCE_BASE_URL:'https://other.example'}), /target/);
  await assert.rejects(run({POPDAM_ACCEPTANCE_BASE_URL:'https://dam.designflow.app', SUPABASE_PROJECT_ID:HOST.split('.')[0],POPDAM_TEST_USER:'other@example.test'}), /identity/);
});
