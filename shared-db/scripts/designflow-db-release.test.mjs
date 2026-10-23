import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson, sha256 } from './db-flow/evidence-bundle.mjs';
import { manifestDigest } from './lib/designflow-db-release.mjs';
import { assessRelease, runObserver, releasePolicy, dispatchTitle, verifyApplyReceipt, verifyAppliedFiles, workflowRuns, artifactContainsSource, assertObserverSource, publishAppStatus, prepareReleaseReady, productionRunMatches } from './designflow-db-release.mjs';

const head = 'a'.repeat(40), repository = 'popcre/designflow-tracking';
const path = 'supabase/migrations/20261022194647_synthetic.sql', content = '-- synthetic only\n';
const requirement = { work_issue: 4646, source_pr: 4653, migrations: [{ version: '20261022194647', path,
  sha256: createHash('sha256').update(content).digest('hex') }] };
function fixture() {
  const manifest = { schema_version: 1, repository, production_project_ref: 'qsllyeztdwjgirsysgai', requirements: [structuredClone(requirement)],
    contracts: [{ schema: 'dflow_prod', relation: 'synthetic', columns: ['id'], privileges: [{ role: 'designflow_prod_backend_runtime', privileges: ['SELECT'] }] }] };
  const policy = { schema_version: 1, production_project_ref: manifest.production_project_ref, branch: 'develop',
    repositories: [{ repository, roles: ['designflow_prod_backend_runtime'], schemas: ['dflow_prod'], required_sources: [{ work_issue: 4646, source_pr: 4653 }],
      contract_manifest_sha256: manifestDigest({ ...manifest, requirements: [] }) }] };
  const effects = [];
  const io = { applicationHead: async () => head,
    sourceFacts: async () => ({ repository: 'popcre/shared-db', base_branch: 'main', merged: true, source_pr: 4653, work_issue: 4646,
      head_sha40: 'b'.repeat(40), merge_sha40: 'c'.repeat(40), merge_in_main: true, files: [{ path, content }] }),
    productionEvidence: async () => ({ source_pr: 4653, run_id: 123, artifact_digest: 'sha256:' + 'd'.repeat(64) }),
    promote: async () => { effects.push('promote'); return { state: 'dispatched' }; },
    catalog: async () => { effects.push('catalog'); return { checked_contracts: 1, failures: [] }; },
    manifest: async () => manifest, status: async (...args) => effects.push(args) };
  return { manifest, policy, io, effects };
}
const assess = f => assessRelease({ repository, head, manifest: f.manifest, policy: f.policy }, f.io);

test('exact applied source plus current catalog contracts yields readiness, no dispatch', async () => {
  const f = fixture(), result = await assess(f);
  assert.equal(result.status, 'ready'); assert.equal(result.head_sha, head);
  assert.equal(result.manifest_sha256, manifestDigest(f.manifest));
  assert.deepEqual(f.effects, ['catalog']);
});
test('missing production proof dispatches only native promotion and never reports ready', async () => {
  const f = fixture(); f.io.productionEvidence = async () => null;
  const result = await assess(f); assert.equal(result.status, 'waiting');
  assert.deepEqual(f.effects, ['promote']);
});
test('unmerged or altered canonical migration never dispatches or checks catalog', async () => {
  for (const change of [s => s.merged = false, s => s.files[0].content += 'altered']) {
    const f = fixture(), original = f.io.sourceFacts;
    f.io.sourceFacts = async () => { const s = await original(); change(s); return s; };
    await assert.rejects(assess(f)); assert.deepEqual(f.effects, []);
  }
});
test('omitted baseline migration and weakened central contracts refuse', async () => {
  for (const change of [m => m.requirements = [], m => m.contracts = [], m => m.contracts[0].columns = ['other']]) {
    const f = fixture(); change(f.manifest); await assert.rejects(assess(f)); assert.deepEqual(f.effects, []);
  }
});
test('contract fingerprint does not permit an unapproved role or schema', () => {
  for (const change of [m => m.contracts[0].privileges[0].role = 'postgres', m => m.contracts[0].schema = 'coldlion']) {
    const f = fixture(); change(f.manifest);
    f.policy.repositories[0].contract_manifest_sha256 = manifestDigest({ ...f.manifest, requirements: [] });
    assert.throws(() => releasePolicy(f.manifest, f.policy));
  }
});
test('app repository, exact commit and production target must match', async () => {
  const f = fixture(); await assert.rejects(assessRelease({ repository, head: 'main', manifest: f.manifest, policy: f.policy }, f.io));
  f.manifest.repository = 'popcre/designflow-backend'; await assert.rejects(assess(f));
  f.manifest.production_project_ref = 'xupnyeifmpsacrqahwwm'; await assert.rejects(assess(f));
  assert.deepEqual(f.effects, []);
});
test('head drift before promotion has no side effect', async () => {
  const f = fixture(); let reads = 0;
  f.io.applicationHead = async () => ++reads === 1 ? head : 'e'.repeat(40);
  f.io.productionEvidence = async () => null;
  await assert.rejects(assess(f), /changed before promotion/); assert.deepEqual(f.effects, []);
});
test('head drift after catalog cannot publish readiness', async () => {
  const f = fixture(); let reads = 0;
  f.io.applicationHead = async () => ++reads === 1 ? head : 'e'.repeat(40);
  await assert.rejects(assess(f), /changed before readiness/); assert.deepEqual(f.effects, ['catalog']);
});
test('catalog failure cannot produce a successful status', async () => {
  const f = fixture(); f.io.catalog = async () => { throw Error('column absent'); };
  const results = await runObserver(f.policy, f.io);
  assert.equal(results[0].status, 'blocked');
  assert.equal(f.effects.at(-1)[2], 'failure');
  assert.ok(!f.effects.some(x => Array.isArray(x) && x[2] === 'success'));
});
test('source unavailability fails closed while other repositories still receive assessment', async () => {
  const f = fixture(); f.policy.repositories.unshift({ repository: 'popcre/designflow-backend' });
  f.io.applicationHead = async repo => { if (repo.endsWith('backend')) throw Error('unavailable'); return head; };
  const results = await runObserver(f.policy, f.io);
  assert.deepEqual(results.map(x => x.status), ['blocked', 'ready']);
});
test('waiting never creates success and an applied repeat does not dispatch twice', async () => {
  const f = fixture(); f.io.productionEvidence = async () => null;
  assert.equal((await runObserver(f.policy, f.io))[0].status, 'waiting');
  assert.equal(f.effects.at(-1)[2], 'pending');
  const fresh = fixture(); await assess(fresh); await assess(fresh);
  assert.deepEqual(fresh.effects, ['catalog', 'catalog']);
});
test('dispatch correlation is deterministic and admits only bounded preview inputs', () => {
  const m = { target: 'preview', commit_sha: head, merged_preview_source_pr: '4653', preview_allowlist: '20261022194647' };
  assert.equal(dispatchTitle(m, 'apply'), `DB preview apply ${head} PR4653 20261022194647`);
  for (const change of [x => x.target = 'production', x => x.commit_sha = 'main', x => x.preview_allowlist += '\n', x => x.merged_preview_source_pr = '-1']) {
    const x = { ...m }; change(x); assert.throws(() => dispatchTitle(x, 'apply'));
  }
  assert.throws(() => dispatchTitle(m, 'production'));
});

test('main requires an authenticated develop-to-main source tree and cannot initiate promotion', async () => {
  const f = fixture();
  await assert.rejects(assessRelease({ repository, head, manifest: f.manifest, policy: f.policy, branch: 'main' }, f.io), /source tree/);
  assert.deepEqual(f.effects, []);
  f.io.sourceAllowed = async () => true; f.io.productionEvidence = async () => null;
  const result = await assessRelease({ repository, head, manifest: f.manifest, policy: f.policy, branch: 'main' }, f.io);
  assert.equal(result.status, 'waiting'); assert.deepEqual(f.effects, []);
});
test('develop and main readiness are independently checked and published', async () => {
  const f = fixture(); f.policy.release_branches = ['develop', 'main']; f.io.sourceAllowed = async () => true;
  const result = await runObserver(f.policy, f.io);
  assert.deepEqual(result.map(r => [r.branch, r.status]), [['develop', 'ready'], ['main', 'ready']]);
  assert.equal(f.effects.filter(x => Array.isArray(x) && x[2] === 'success').length, 2);
});

async function receiptFixture() {
  const f = fixture(), facts = await f.io.sourceFacts();
  const version = requirement.migrations[0].version, fingerprint = '9'.repeat(64);
  const ledger = { [version]: fingerprint };
  const receipt = { schema_version: 1, work_issue: 4646, source_pr: 4653,
    source_head_sha: facts.head_sha40, source_merge_sha: facts.merge_sha40,
    production_main_sha: 'f'.repeat(40), production_run_id: 123, production_run_attempt: 1,
    artifact_id: 456, artifact_digest: 'sha256:' + '8'.repeat(64),
    migration_hashes: { [version]: requirement.migrations[0].sha256 }, ledger_fingerprints: ledger,
    catalog_sha256: '7'.repeat(64), captured_at: '2020-01-01T00:00:00.000Z' };
  return { facts, ledger, receipt, version };
}
test('preserved exact-source apply receipt survives artifact retention without waiving ledger drift', async () => {
  const f = await receiptFixture();
  assert.equal(verifyApplyReceipt(requirement, f.facts, f.receipt, f.ledger).run_id, 123);
  assert.throws(() => verifyApplyReceipt(requirement, f.facts, f.receipt, { [f.version]: '6'.repeat(64) }), /fingerprint changed/);
});
test('apply receipt refuses altered source, missing/extra migrations, wrong identities and future proof', async () => {
  const mutations = [
    r => r.source_head_sha = 'e'.repeat(40), r => r.source_merge_sha = 'e'.repeat(40),
    r => r.work_issue++, r => r.source_pr++, r => r.production_run_id = 0,
    r => r.production_run_attempt = 0, r => r.artifact_digest = 'unhashed',
    r => r.migration_hashes[requirement.migrations[0].version] = '1'.repeat(64),
    r => r.ledger_fingerprints = {}, r => r.migration_hashes.extra = '2'.repeat(64),
    r => r.captured_at = '9999-01-01T00:00:00.000Z', r => r.authorized = true,
  ];
  for (const mutate of mutations) {
    const f = await receiptFixture(); mutate(f.receipt);
    assert.throws(() => verifyApplyReceipt(requirement, f.facts, f.receipt, f.ledger));
  }
});

function appliedFiles() {
  const version = requirement.migrations[0].version, baseline = '20200101000000';
  return new Map([
    ['migration-content-manifest.json', JSON.stringify({ [baseline]: '1'.repeat(64), [version]: requirement.migrations[0].sha256 })],
    ['production-catalog-verification.json', JSON.stringify({ enforcing: true, errors: [], allowlist: [version] })],
    ['production-ledger-before.txt', ` ${baseline} | ${baseline} | old\n`],
    ['production-ledger-after.txt', ` ${baseline} | ${baseline} | old\n ${version} | ${version} | new\n`],
  ]);
}
test('real apply file shape includes historical manifest hashes but only exact required ledger additions', () => {
  assert.deepEqual(verifyAppliedFiles(requirement, appliedFiles()), { [requirement.migrations[0].version]: requirement.migrations[0].sha256 });
});
test('apply files refuse changed hashes, unexpected ledger changes and unenforced catalog', () => {
  const mutations = [
    f => f.set('migration-content-manifest.json', '{}'),
    f => f.set('production-ledger-after.txt', f.get('production-ledger-after.txt') + ' 20210101000000 | 20210101000000 | extra\n'),
    f => f.set('production-ledger-after.txt', f.get('production-ledger-after.txt').split('\n').slice(1).join('\n')),
    f => f.set('production-catalog-verification.json', JSON.stringify({ enforcing: false, errors: [], allowlist: [requirement.migrations[0].version] })),
    f => f.set('production-catalog-verification.json', JSON.stringify({ enforcing: true, errors: ['failed'], allowlist: [requirement.migrations[0].version] })),
    f => f.set('production-catalog-verification.json', JSON.stringify({ enforcing: true, errors: [], allowlist: ['20200101000000'] })),
  ];
  for (const mutate of mutations) { const f = appliedFiles(); mutate(f); assert.throws(() => verifyAppliedFiles(requirement, f)); }
});


test('producer discovery reads subsequent pages and refuses truncated history', () => {
  const visited=[];
  const read=url=>{visited.push(url);return {workflow_runs: url.endsWith('page=1') ? Array.from({length:100},(_,i)=>({id:i+1})) : [{id:101}]};};
  assert.equal(workflowRuns(read,'runs?event=workflow_dispatch').at(-1).id,101);
  assert.equal(visited.length,2);
  assert.throws(()=>workflowRuns(()=>({workflow_runs:Array(100).fill({id:1})}),'runs',2),/incomplete/);
  assert.throws(()=>workflowRuns(()=>({}),'runs'),/unreadable/);
});
test('unrelated production artifacts cannot block or supply a required source', () => {
  const files = new Map([['migration-content-manifest.json',JSON.stringify({'20261022194647':'0'.repeat(64)})], ['production-catalog-verification.json',JSON.stringify({allowlist:['20261022194647']})]]);
  assert.equal(artifactContainsSource(requirement,files),false);
  files.set('migration-content-manifest.json',JSON.stringify({[requirement.migrations[0].version]:requirement.migrations[0].sha256,other:'historical'}));
  assert.equal(artifactContainsSource(requirement,files),true);
  files.set('production-catalog-verification.json',JSON.stringify({allowlist:['20261022194648']}));
  assert.equal(artifactContainsSource(requirement,files),false);
});


test('observer execution is bound to its exact producer commit and designated App, no fallback', () => {
  const env={GITHUB_REPOSITORY:'popcre/shared-db',GITHUB_REF:'refs/heads/main',GITHUB_SHA:head,DFLOW_READINESS_STATUS_TOKEN:'synthetic-fixture-token',DFLOW_READINESS_APP_SLUG:'pop-ai-watchers'};
  assert.doesNotThrow(()=>assertObserverSource(env,head));
  for(const change of [e=>e.GITHUB_SHA='b'.repeat(40),e=>e.GITHUB_REPOSITORY='fork/shared-db',e=>e.GITHUB_REF='refs/heads/unreviewed',e=>delete e.DFLOW_READINESS_STATUS_TOKEN,e=>e.DFLOW_READINESS_APP_SLUG='another-app']){
    const changed={...env};change(changed);assert.throws(()=>assertObserverSource(changed,head));
  }
});
test('readiness statuses require designated App identity and exact bounded application', () => {
  const body={state:'success',context:'database/production-ready'},calls=[];
  const send=(endpoint,value,options)=>{calls.push({endpoint,value,options});return {...value,creator:{login:'pop-ai-watchers[bot]'}};};
  assert.equal(publishAppStatus(repository,head,body,'synthetic-token',send).state,'success');
  assert.equal(calls[0].options.token,'synthetic-token');
  for(const [repo,sha,token] of [['fork/designflow-tracking',head,'fixture'],[repository,'main','fixture'],[repository,head,'']])assert.throws(()=>publishAppStatus(repo,sha,body,token,send));
  assert.equal(calls.length,1);
  assert.throws(()=>publishAppStatus(repository,head,body,'fixture',()=>({...body,creator:{login:'u2giants'}})),/designated App/);
  assert.throws(()=>publishAppStatus(repository,head,body,'fixture',()=>({...body,state:'pending',creator:{login:'pop-ai-watchers[bot]'}})),/designated App/);
});

test('a failed tracking prerequisite does not hold an unrelated backend release', async () => {
  const f=fixture(), other=structuredClone(f.manifest);
  other.repository='popcre/designflow-backend'; other.requirements=[];
  f.policy.repositories.push({repository:other.repository,roles:['designflow_prod_backend_runtime'],schemas:['dflow_prod'],required_sources:[],contract_manifest_sha256:manifestDigest({...other,requirements:[]})});
  f.io.manifest=async repo=>repo===repository?f.manifest:other;
  f.io.sourceFacts=async()=>{throw Error('Tracking source is not merged');};
  const results=await runObserver(f.policy,f.io);
  assert.equal(results.find(r=>r.repository===repository).status,'blocked');
  assert.equal(results.find(r=>r.repository===other.repository).status,'ready');
  assert.equal(f.effects.filter(x=>x==='catalog').length,1);
  assert.ok(!f.effects.includes('promote'));
});

// Compose real admission and native preview preparation over synthetic GitHub IO.
function nativeReleaseFixture() {
  const refs=new Map(), events=[], effects=[];
  const state={closed:false,sql:'create table core.synthetic(id bigint);',linked:4646,race:null};
  const current={issue:4646,pr:4653,head_sha:'b'.repeat(40),bundle_id:'d'.repeat(64),route:'merged_rehearsal',route_context:head,
    manifest:{target:'preview',commit_sha:head,merged_preview_source_pr:'4653',preview_allowlist:requirement.migrations[0].version}};
  const body=['```db-work-scope','status: ready','work_type: structural','route: claim-first','service_class: standard-application','change_type: migration','application_return_to: popcre/designflow-tracking','live_assertion: synthetic full-triple read succeeds','generated_types: not-applicable','priority: 5','depends_on:','writes:','  - table core.synthetic','```'].join('\n');
  const flow={resolveMarker:()=>({live:true,task:'release',calling_task:'release'}),selectCurrent:()=>current,
    actor:()=> 'release',now:()=> '2026-10-22T00:00:00.000Z',events:()=>events,
    readRef:r=>refs.get(r),createRef:(r,d,record)=>{effects.push('ref');if(refs.has(r))return false;refs.set(r,{digest:d,record});return true;},
    listReady:()=>[...refs].filter(([r])=>r.startsWith('refs/db-preview-ready/')).map(([,v])=>v),
    withMutex:fn=>{effects.push('mutex');state.race?.();return fn();}};
  const native={getIssue:()=>({number:4646,state:state.closed?'closed':'open',body,createdAt:'2026-10-22T00:00:00Z'}),
    getPr:()=>({head:{sha:'b'.repeat(40)},merged_at:'2026-10-22T00:00:00Z'}),closingIssuesForPr:()=>[{number:state.linked}],
    getPrFiles:()=>[{filename:requirement.migrations[0].path,status:'added'}],getFileAt:()=>state.sql,
    issueComments:()=>[],updateIssue:()=>{effects.push('ISSUE_UPDATE');throw Error('unexpected issue update');},
    commentIssue:(_issue,body)=>{const json=body.match(/```db-coordination-event\s*([\s\S]*?)```/);if(!json)throw Error('unexpected non-ready comment');events.push(JSON.parse(json[1]));effects.push('event');},
    flowAdapter:()=>flow};
  return {native,flow,state,current,refs,events,effects};
}
test('native release preparation emits exactly one event/ref across repeat and two-app calls without issue mutations',()=>{
 const f=nativeReleaseFixture();const first=prepareReleaseReady(requirement,f.native);
 const before=f.effects.slice();assert.equal(prepareReleaseReady(structuredClone(requirement),f.native).ready_id,first.ready_id);
 assert.deepEqual(f.effects,before);assert.deepEqual(f.effects,['mutex','event','ref']);assert.equal(f.events.length,1);assert.equal(f.refs.size,1);
});
test('under-lock competing application preparation converges on one native ready identity',()=>{
 const f=nativeReleaseFixture();let raced=false;
 f.state.race=()=>{if(raced)return;raced=true;f.state.race=null;prepareReleaseReady(requirement,f.native);};
 const ready=prepareReleaseReady(requirement,f.native);assert.ok(ready.ready_id);assert.equal(f.events.length,1);assert.equal(f.refs.size,1);assert.equal(f.effects.filter(x=>x==='event').length,1);
});
test('real admission refuses closed unfinished and wrong exact source PR without writes',()=>{
 for(const mutate of [f=>f.state.closed=true,f=>f.state.linked=999,f=>f.state.sql='create table core.undeclared(id bigint);']){
  const f=nativeReleaseFixture();mutate(f);assert.throws(()=>prepareReleaseReady(requirement,f.native));assert.deepEqual(f.effects,[]);
 }
});
test('candidate source versions and route must match requirement before native writes',()=>{
 for(const mutate of [f=>f.current.pr++,f=>f.current.manifest.preview_allowlist='20200101000000',f=>f.current.route='ordinary_preview_apply']){
  const f=nativeReleaseFixture();mutate(f);assert.throws(()=>prepareReleaseReady(requirement,f.native));assert.deepEqual(f.effects,[]);
 }
});
test('corrupt stored ready digest or missing/duplicate event fails without mutex or writes',()=>{
 for(const mutate of [f=>[...f.refs.values()][0].digest='0'.repeat(64),f=>[...f.refs.values()][0].record.head_sha='e'.repeat(40),f=>f.events.length=0,f=>f.events.push({...f.events[0]})]){
  const f=nativeReleaseFixture();prepareReleaseReady(requirement,f.native);mutate(f);const before=f.effects.slice();assert.throws(()=>prepareReleaseReady(requirement,f.native));assert.deepEqual(f.effects,before);
 }
});
test('orphan native event without immutable ready refuses rather than appending another',()=>{
 const f=nativeReleaseFixture();prepareReleaseReady(requirement,f.native);f.refs.clear();const count=f.events.length;
 assert.throws(()=>prepareReleaseReady(requirement,f.native),/reconciliation/);assert.equal(f.events.length,count);assert.equal(f.refs.size,0);
});
test('production discovery compares exact unique version sets independent of ordering',()=>{
 const req={...requirement,migrations:[...requirement.migrations,{version:'20261022194648'}]};
 const prefix=`DB production apply ${head} PR4653 `;
 assert.equal(productionRunMatches(prefix+'20261022194648,20261022194647',req),true);
 for(const versions of ['20261022194647','20261022194647,20261022194647','20261022194647,20261022194649','20261022194647,20261022194648,20261022194649'])assert.equal(productionRunMatches(prefix+versions,req),false);
 assert.equal(productionRunMatches(prefix.replace('PR4653','PR4654')+'20261022194647,20261022194648',req),false);
 assert.equal(productionRunMatches(undefined,req),false);
});
test('admission and session authority are rechecked under mutex before any ready writes',()=>{
 for(const mutate of [f=>f.state.closed=true,f=>f.state.sql='create table core.foreign_source(id bigint);',f=>f.flow.resolveMarker=()=>({live:true,task:'other',calling_task:'release'})]){
  const f=nativeReleaseFixture();f.state.race=()=>{f.state.race=null;mutate(f);};
  assert.throws(()=>prepareReleaseReady(requirement,f.native));assert.deepEqual(f.effects,['mutex']);assert.equal(f.events.length,0);assert.equal(f.refs.size,0);
 }
});

test('sealed protection requests use one GitHub status-check schema and preserve exact enforcement',()=>{
 const policy=JSON.parse(readFileSync(new URL('../config/designflow-db-releases.json',import.meta.url),'utf8'));
 assert.equal(policy.repositories.length,6);
 for(const app of policy.repositories){
  const {baseline,baseline_sha256,settings}=app.main_protection;
  assert.equal(baseline_sha256,sha256(canonicalJson(baseline)));
  // GitHub oneOf rejects contexts and checks together, even when contexts is empty.
  assert.equal(Object.hasOwn(settings.required_status_checks,'contexts'),false);
  assert.deepEqual(settings.required_status_checks,{strict:true,checks:[{context:policy.status_context,app_id:5112061}]});
  assert.equal(settings.enforce_admins,true);assert.equal(settings.allow_force_pushes,false);assert.equal(settings.allow_deletions,false);
  assert.equal(settings.required_pull_request_reviews.required_approving_review_count,app.repository.endsWith('frontend')?1:0);
  assert.deepEqual(settings.required_pull_request_reviews.bypass_pull_request_allowances,{users:[],teams:[],apps:[]});
 }
});
