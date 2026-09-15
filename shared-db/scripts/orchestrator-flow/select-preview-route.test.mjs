import assert from 'node:assert/strict'
import test from 'node:test'
import { bindSenderPreviewClassification, databasePreviewRequiredFromEvidenceBundle, selectPreviewRoute } from './select-preview-route.mjs'
import { canonicalJson, sha256 } from './evidence-bundle.mjs'

test('current sender format binds only to independently matching live Git evidence',()=>{
  const target={repository:'u2giants/shared-db',issue:2912,pr:2795,base_sha:'a'.repeat(40),head_sha:'b'.repeat(40)}
  const file={path:'docs/canary.md',sha256:'c'.repeat(64),mode:'100644',impact:'documentation',reason:'Harmless documentation',change_type:'present'}
  const sender={schema_version:1,decision:'NO_DATABASE_PREVIEW',reason_code:'proven_non_database_change',base_sha:target.base_sha,head_sha:target.head_sha,files:[file],applicable_checks:['docs-check'],invalidated_by:['file-content-change','file-set-change','impact-evidence-change','applicable-check-change','classifier-version-change']}
  sender.inspected_digest=sha256(canonicalJson({classifier_version:1,base_sha:sender.base_sha,head_sha:sender.head_sha,files:sender.files,applicable_checks:sender.applicable_checks}))
  const live=[{path:file.path,sha256:file.sha256,mode:file.mode,impact:file.impact,status:'added',blob_sha:'d'.repeat(40),base:null,head:{type:'blob',mode:file.mode,sha256:file.sha256,blob_sha:'d'.repeat(40)}}]
  const result=bindSenderPreviewClassification(sender,live,target)
  assert.equal(result.decision,'NO_DATABASE_PREVIEW');assert.equal(result.issue,2912);assert.equal(result.files[0].blob_sha,'d'.repeat(40))
  for(const mutation of [{sha256:'e'.repeat(64)},{mode:'100755'},{impact:'database-behavior'},{status:'removed'}])assert.throws(()=>bindSenderPreviewClassification(sender,[{...live[0],...mutation}],target))
  assert.throws(()=>bindSenderPreviewClassification(sender,[],target))
  assert.throws(()=>bindSenderPreviewClassification({...sender,inspected_digest:'0'.repeat(64)},live,target))
  assert.throws(()=>bindSenderPreviewClassification(sender,live,{...target,head_sha:'f'.repeat(40)}))
})

const invalidated_by=['file-content-change','file-set-change','impact-evidence-change','applicable-check-change','classifier-version-change']
const target={repository:'u2giants/shared-db',issue:1720,pr:1721,base_sha:'9'.repeat(40),head_sha:'a'.repeat(40)}
const classification=(impact='database-structure',identity=target)=>{const files=[{path:'change.sql',status:'modified',mode:'100644',blob_sha:'d'.repeat(40),sha256:'c'.repeat(64),impact,reason:`proved ${impact}`}],applicable_checks=['unit-tests'],required=!['documentation','reviewer-tooling','ci-workflow','read-only-test','application-only'].includes(impact);return{schema_version:1,...identity,decision:required?'DATABASE_PREVIEW_REQUIRED':'NO_DATABASE_PREVIEW',reason_code:required?`impact_${impact.replaceAll('-','_')}`:'proven_non_database_change',inspected_digest:sha256(canonicalJson({classifier_version:1,...identity,files,applicable_checks})),files,applicable_checks,invalidated_by}}
const baseClassification=classification()
const base={...target,bundle_id:'b'.repeat(64),database_preview:baseClassification,inspected_files:baseClassification.files.map(({path,status,mode,blob_sha,sha256})=>({path,status,mode,blob_sha,sha256})),versions:['20260828030000'],main_versions:['20260828010000'],preview_versions:['20260828010000'],claims:[],dependency_closure_complete:true,merged:false}
test('ordinary open work selects the manual normal-preview route',()=>assert.equal(selectPreviewRoute(base).route,'NORMAL_PREVIEW'))
test('#1713/#1720 preview ordering becomes WAITING without a failed run',()=>{
  const result=selectPreviewRoute({...base,preview_versions:['20260828010000','20260828020000'],claims:[{issue:1713,pr:1715,versions:['20260828020000'],merged:false}]})
  assert.equal(result.status,'WAITING');assert.equal(result.route,'WAITING');assert.deepEqual(result.context.blockers,['20260828020000'])
})
test('merged missing versions select post-merge rehearsal',()=>assert.equal(selectPreviewRoute({...base,merged:true,main_versions:[...base.main_versions,...base.versions]}).route,'POST_MERGE_REHEARSAL'))
test('already-applied bytes never reapply and require original apply evidence',()=>{
  assert.equal(selectPreviewRoute({...base,preview_versions:[...base.preview_versions,...base.versions]}).route,'UNVERIFIABLE')
  assert.equal(selectPreviewRoute({...base,preview_versions:[...base.preview_versions,...base.versions],original_apply_evidence:{type:'preview-apply',run_id:'123'}}).route,'HISTORICAL_RECOVERY')
  assert.equal(selectPreviewRoute({...base,preview_versions:[...base.preview_versions,...base.versions],original_apply_evidence:{type:'preview-ledger-reconciliation',run_id:'456'}}).route,'HISTORICAL_RECOVERY')
})
test('#1646 two-version closure is refused until complete',()=>assert.equal(selectPreviewRoute({...base,versions:['20260828030000','20260828030001'],dependency_closure_complete:false}).route,'UNVERIFIABLE'))
test('decision identity is deterministic and exact-head changes it',()=>{const first=selectPreviewRoute(base),second=selectPreviewRoute(base),moved=selectPreviewRoute({...base,head_sha:'c'.repeat(40)});assert.equal(first.decision_id,second.decision_id);assert.notEqual(first.decision_id,moved.decision_id)})
test('proven non-database work selects no preview without migration inputs',()=>{const identity={repository:'u2giants/shared-db',issue:1,pr:2,base_sha:'9'.repeat(40),head_sha:'a'.repeat(40)},database_preview=classification('application-only',identity),result=selectPreviewRoute({...identity,bundle_id:'b'.repeat(64),database_preview,inspected_files:database_preview.files});assert.equal(result.route,'NO_DATABASE_PREVIEW');assert.deepEqual(result.context.applicable_checks,['unit-tests'])})
test('missing, forged, mixed, or changed classification fails closed',()=>{
  assert.equal(selectPreviewRoute({...base,database_preview:null}).route,'UNVERIFIABLE')
  assert.equal(selectPreviewRoute({...base,inspected_files:[]}).route,'UNVERIFIABLE')
  assert.equal(selectPreviewRoute({...base,inspected_files:[{path:'other',sha256:'c'.repeat(64)}]}).route,'UNVERIFIABLE')
  for(const mutate of [
    (c)=>({...c,decision:'NO_DATABASE_PREVIEW'}),
    (c)=>({...c,reason_code:'proven_non_database_change'}),
    (c)=>({...c,inspected_digest:'d'.repeat(64)}),
    (c)=>({...c,invalidated_by:c.invalidated_by.slice(1)}),
    (c)=>({...c,files:[...c.files,{...c.files[0],path:'other.sql',impact:'ambiguous'}]}),
    (c)=>({...c,undigested_input:'unsafe'}),
    (c)=>({...c,applicable_checks:['unit-tests','unit-tests']}),
  ])assert.equal(selectPreviewRoute({...base,database_preview:mutate(classification())}).route,'UNVERIFIABLE')
})
test('classification bytes, impact evidence, checks, and exact head all invalidate decision identity',()=>{
  const first=selectPreviewRoute({...base,database_preview:classification('documentation')})
  for(const changed of [classification('read-only-test'),{...classification('documentation'),applicable_checks:['other-check']},{...base,database_preview:classification('documentation'),head_sha:'e'.repeat(40)}]){
    const input=changed.head_sha?changed:{...base,database_preview:changed,inspected_files:changed.files.map(({path,sha256})=>({path,sha256}))}
    const result=selectPreviewRoute(input);assert.ok(result.route==='UNVERIFIABLE'||result.decision_id!==first.decision_id)
  }
})
test('classification cannot replay across issue, PR, base, or head even when file bytes match',()=>{
  const database_preview=classification('application-only')
  for(const changed of [{repository:'attacker/fork'},{issue:999},{pr:999},{base_sha:'8'.repeat(40)},{head_sha:'7'.repeat(40)}])assert.equal(selectPreviewRoute({...base,...changed,database_preview,inspected_files:database_preview.files}).route,'UNVERIFIABLE')
})
test('database evidence bundle produces an explicit preview-required classification bound to every evidence file',()=>{
  const identity={migrations:[{path:'supabase/migrations/20260101000000_x.sql',sha256:'1'.repeat(64)}],focused_files:[{path:'supabase/tests/x.sql',sha256:'2'.repeat(64)}],verification_files:[],global_invalidators:[{path:'AGENTS.md',sha256:'3'.repeat(64)}]}
  const bundle={identity,metadata:{issue:1,pr:2,base_main_sha:'4'.repeat(40),integration_sha:'5'.repeat(40)},bundle_id:sha256(canonicalJson(identity))},result=databasePreviewRequiredFromEvidenceBundle(bundle)
  assert.equal(result.decision,'DATABASE_PREVIEW_REQUIRED');assert.equal(result.files.length,3)
  assert.throws(()=>databasePreviewRequiredFromEvidenceBundle({...bundle,bundle_id:'0'.repeat(64)}),/changed/)
})
