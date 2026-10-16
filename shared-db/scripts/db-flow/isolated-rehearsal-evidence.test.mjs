import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalJson, sha256 } from './evidence-bundle.mjs'
import { verifyIsolatedRehearsal, isolatedRehearsalForTarget } from './isolated-rehearsal-evidence.mjs'
import { buildPreviewGraph } from './preview-graph.mjs'
import { selectPreviewRoute } from './select-preview-route.mjs'

const version='20260920010000', predecessor='20260919010000', other='20260920020000'
function fixture(){
  const identity={repository:'popcre/shared-db',issue:3392,pr:4000,base_sha:'a'.repeat(40),head_sha:'b'.repeat(40),bundle_id:'c'.repeat(64),baseline_sha256:'d'.repeat(64),permission_setup_sha256:'e'.repeat(64),catalog_sha256:'f'.repeat(64),closure:[{version:predecessor,sha256:'1'.repeat(64)},{version,sha256:'2'.repeat(64)}],selected_versions:[version],contract_tests:['app-additive.sql'],producer:{repository:'popcre/shared-db',run_id:10,run_attempt:1,workflow_sha:'3'.repeat(40)},probe_manifest_sha256:'4'.repeat(64)}
  const manifest={schema_version:1,kind:'isolated-rehearsal',identity:structuredClone(identity),replay:identity.closure.map(row=>({...row,result:'passed'})),tests:[{name:'app-additive.sql',result:'passed',quarantined:false}]}
  const sign=()=>{delete manifest.manifest_sha256;manifest.manifest_sha256=sha256(canonicalJson(manifest));return manifest}
  const adapters={authenticateProducer:()=>true,verifyProbe:()=>true,classifyBoundary:()=>({verdict:'pass'}),previewRequiredReasons:()=>[]}
  return {identity,manifest:sign(),sign,adapters,target:{...identity,versions:[version]}}
}

test('only authenticated immutable exact evidence mints a capability',()=>{
  const f=fixture(),cap=verifyIsolatedRehearsal(f.manifest,f.identity,f.adapters)
  assert.equal(isolatedRehearsalForTarget(cap,f.target).manifest_sha256,f.manifest.manifest_sha256)
  f.manifest.identity.head_sha='9'.repeat(40)
  assert.equal(isolatedRehearsalForTarget(cap,f.target).identity.head_sha,'b'.repeat(40))
  assert.throws(()=>isolatedRehearsalForTarget(JSON.parse(JSON.stringify(cap)),f.target),/authenticated/)
  for(const field of ['repository','issue','pr','base_sha','head_sha','bundle_id']) assert.throws(()=>isolatedRehearsalForTarget(cap,{...f.target,[field]:'changed'}),/stale/)
  assert.throws(()=>isolatedRehearsalForTarget(cap,{...f.target,versions:[other]}),/versions/)
})

test('digest, baseline, closure and producer identities are independently bound',()=>{
  for(const field of Object.keys(fixture().identity)){
    const f=fixture();f.manifest.identity[field]=null;f.sign()
    assert.throws(()=>verifyIsolatedRehearsal(f.manifest,f.identity,f.adapters),/identity/)
  }
  const f=fixture();f.manifest.manifest_sha256='0'.repeat(64)
  assert.throws(()=>verifyIsolatedRehearsal(f.manifest,f.identity,f.adapters),/digest/)
})

test('each identity field validator refuses a matching expected identity',()=>{
  // Move BOTH the manifest identity and the expected identity together, so line 18's
  // equality check passes and the field-specific validators at 20-26 are the ones
  // that must refuse. Mutating only the manifest proves nothing about them.
  const cases=[
    ['repository','not-a-repo',/invalid source identity/],
    ['issue',1.5,/invalid source identity/],
    ['pr',0,/invalid source identity/],
    ['base_sha','z'.repeat(40),/invalid source identity/],
    ['head_sha','short',/invalid source identity/],
    ['bundle_id','not-a-digest',/missing bundle_id/],
    ['baseline_sha256','xyz',/missing baseline_sha256/],
    ['permission_setup_sha256','',/missing permission_setup_sha256/],
    ['catalog_sha256','a'.repeat(63),/missing catalog_sha256/],
    ['probe_manifest_sha256','a'.repeat(65),/missing probe_manifest_sha256/],
    ['producer',{repository:'popcre/shared-db',run_id:0,run_attempt:1,workflow_sha:'3'.repeat(40)},/invalid producer identity/],
    ['producer',{repository:'other/repo',run_id:10,run_attempt:0,workflow_sha:'3'.repeat(40)},/invalid producer identity/],
    ['producer',{repository:'popcre/shared-db',run_id:10,run_attempt:1,workflow_sha:'3'.repeat(39)},/invalid producer identity/],
    ['closure',[{version:'not-a-version',sha256:'1'.repeat(64)}],/invalid ordered dependency closure/],
    ['closure',[{version:predecessor,sha256:'1'.repeat(64)},{version:predecessor,sha256:'1'.repeat(64)}],/invalid ordered dependency closure/],
    ['selected_versions',[other],/outside closure/],
    ['contract_tests',[],/contract coverage is missing/],
    ['contract_tests',['dup','dup'],/contract coverage is missing/],
    ['contract_tests',[123],/contract coverage is missing/],
  ]
  for(const [field,value,pattern] of cases){
    const f=fixture()
    f.manifest.identity[field]=structuredClone(value)
    f.identity[field]=structuredClone(value)
    f.sign()
    assert.throws(()=>verifyIsolatedRehearsal(f.manifest,f.identity,f.adapters),pattern,`${field}=${JSON.stringify(value)} must be refused by its own validator`)
  }
})

test('failed prerequisites, retry successes, missing coverage and quarantines refuse',()=>{
  for(const mutate of [m=>m.replay[0].result='failed',m=>m.replay.shift(),m=>m.replay.reverse(),m=>m.replay.push({...m.replay[0],result:'passed'}),m=>m.tests[0].quarantined=true,m=>m.tests[0].result='failed',m=>m.tests=[]]){
    const f=fixture();mutate(f.manifest);f.sign();assert.throws(()=>verifyIsolatedRehearsal(f.manifest,f.identity,f.adapters),/prerequisite|contract/)
  }
})

test('authentication, probe and existing classifiers must run and pass literally',()=>{
  for(const [name,bad] of [['authenticateProducer',()=>Promise.resolve(true)],['authenticateProducer',()=>false],['verifyProbe',()=>({passed:true})],['classifyBoundary',()=>({verdict:'refuse'})],['previewRequiredReasons',()=>['unsupported SQL']],['previewRequiredReasons',()=>['unknown catalog or data-sensitive lock risk']]]){
    const f=fixture();assert.throws(()=>verifyIsolatedRehearsal(f.manifest,f.identity,{...f.adapters,[name]:bad}))
  }
  for(const name of Object.keys(fixture().adapters)){
    const f=fixture();delete f.adapters[name];assert.throws(()=>verifyIsolatedRehearsal(f.manifest,f.identity,f.adapters))
  }
  const f=fixture();f.adapters.authenticateProducer=m=>{m.identity.issue=1;return true}
  assert.throws(()=>verifyIsolatedRehearsal(f.manifest,f.identity,f.adapters),TypeError)
})

test('qualified route removes only its ledger edges; ordinary work keeps timestamp dependencies',()=>{
  const f=fixture(),cap=verifyIsolatedRehearsal(f.manifest,f.identity,f.adapters)
  const args={mainVersions:[],previewVersions:[predecessor],claims:[{issue:3392,pr:4000,versions:[version]},{issue:1,pr:2,versions:[other]}]}
  assert.equal(buildPreviewGraph(args).edges.length,2)
  const graph=buildPreviewGraph({...args,isolatedEvidence:cap,target:f.target})
  assert.deepEqual(graph.edges,[{from:predecessor,to:other,reason:'preview-ledger-predecessor-not-on-main'}])
  assert.throws(()=>buildPreviewGraph({...args,isolatedEvidence:{manifest_sha256:f.manifest.manifest_sha256},target:f.target}),/authenticated/)
})

test('selector needs an in-process capability; serialized input cannot bypass waiting',()=>{
  const f=fixture(),cap=verifyIsolatedRehearsal(f.manifest,f.identity,f.adapters)
  const {repository,issue,pr,base_sha,head_sha}=f.identity,target={repository,issue,pr,base_sha,head_sha}
  const files=[{path:'change.sql',sha256:'5'.repeat(64),impact:'database-structure',reason:'migration'}],applicable_checks=['database-preview']
  const database_preview={schema_version:1,...target,decision:'DATABASE_PREVIEW_REQUIRED',reason_code:'impact_database_structure',files,applicable_checks,invalidated_by:['file-content-change','file-set-change','impact-evidence-change','applicable-check-change','classifier-version-change'],inspected_digest:sha256(canonicalJson({classifier_version:1,...target,files,applicable_checks}))}
  const input={...f.target,database_preview,inspected_files:files.map(({path,sha256})=>({path,sha256})),dependency_closure_complete:true,main_versions:[],preview_versions:[predecessor],isolatedEvidence:cap}
  assert.equal(selectPreviewRoute(input).route,'WAITING')
  const result=selectPreviewRoute(input,{isolatedEvidence:cap})
  assert.equal(result.route,'ISOLATED_REHEARSAL');assert.equal(result.context.isolated_manifest_sha256,f.manifest.manifest_sha256);assert.deepEqual(result.context.blockers,[])
  assert.equal(selectPreviewRoute(input,{isolatedEvidence:{...cap}}).route,'UNVERIFIABLE')
  assert.equal(selectPreviewRoute({...input,preview_versions:[predecessor,version]},{isolatedEvidence:cap}).route,'UNVERIFIABLE')
})
