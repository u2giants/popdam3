import test from 'node:test'
import assert from 'node:assert/strict'
import {matchesCatalogRecovery,verifyProductionEvidence} from './production-catalog-recovery.mjs'
const v='20261007002113',hash='f'.repeat(64),apply='a'.repeat(40),main='b'.repeat(40),digest=`sha256:${'c'.repeat(64)}`
function fixture(){
 const evidence={production_commit_sha:apply,production_artifact_id:2,production_artifact_digest:digest,production_recovery_commit_sha:main,production_recovery_artifact_id:4,production_recovery_artifact_digest:digest}
 return {evidence,applyRun:{id:1,status:'completed',conclusion:'failure',event:'workflow_dispatch',path:'.github/workflows/shared-supabase-migrations.yml',head_sha:apply},recoveryRun:{status:'completed',conclusion:'success',event:'workflow_dispatch',path:'.github/workflows/production-catalog-verification-recovery.yml',head_sha:main},recoveryArtifact:{id:4,expired:false,name:'production-catalog-recovery-1',digest},binding:{schema_version:1,project_ref:'qsllyeztdwjgirsysgai',main_sha:main,apply_main_sha:apply,apply_run_id:1,apply_artifact_id:2,apply_artifact_digest:digest,allowlist:[v],migration_hashes:{[v]:hash},ledger_added:[v],ledger_removed:[],catalog_enforced:true,original_failure:'Post-apply catalog verification',verification_only:true},catalog:{allowlist:[v],enforcing:true,errors:[],behavior_checks:[{id:'exact',kind:'catalog_contract',contract:'exact_contract',migration_version:v,migration_sha256:hash,expected_count:1}],behavior_results:{behavior_checks:[{id:'exact',actual_count:1,expected_count:1}]}},versions:[v],manifest:{[v]:hash},jobs:{jobs:[{name:'SQL migration guards',conclusion:'success'},{name:'Production apply review (immutable evidence + hard guards)',conclusion:'success'},{name:'Production apply (automatic evidence gates)',conclusion:'failure',steps:[...['Build bounded checkout','Fresh dry-run, then apply','Capture production migration record (after)','Save apply evidence','Release the exclusive production lane with ownership proof'].map(name=>({name,conclusion:'success'})),{name:'Post-apply catalog verification',conclusion:'failure'}]}]},ledgerBefore:' | 20260101000000 |\n',ledgerAfter:` | 20260101000000 |\n | ${v} |\n`,ledgerLive:` | 20260101000000 |\n | ${v} |\n`}
}
test('catalog-only failure and completely bound verification recovery accepted',()=>assert.equal(matchesCatalogRecovery(fixture()),true))
const mutations={
 'failed recovery':x=>x.recoveryRun.conclusion='failure',
 'incomplete original':x=>x.applyRun.status='in_progress',
 'wrong original workflow':x=>x.applyRun.path='other.yml',
 'wrong recovery workflow':x=>x.recoveryRun.path='other.yml',
 'wrong recovery main':x=>x.recoveryRun.head_sha=apply,
 'expired artifact':x=>x.recoveryArtifact.expired=true,
 'wrong original run binding':x=>x.binding.apply_run_id=8,
 'wrong original artifact binding':x=>x.binding.apply_artifact_digest='bad',
 'wrong target':x=>x.binding.project_ref='other',
 'write recovery':x=>x.binding.verification_only=false,
 'missing binding':x=>x.binding=null,
 'wrong allowlist':x=>x.binding.allowlist=[],
 'invented delta':x=>x.binding.ledger_added=[],
 'additional ledger write':x=>x.ledgerAfter+=' | 20261007003000 |\n',
 'removed ledger row':x=>x.ledgerAfter=` | ${v} |\n`,
 'not present live':x=>x.ledgerLive=x.ledgerBefore,
 'changed SQL':x=>x.manifest[v]='0'.repeat(64),
 'absent prerequisite':x=>x.jobs.jobs[0].conclusion='skipped',
 'apply failed':x=>x.jobs.jobs[2].steps[1].conclusion='failure',
 'second failed job':x=>x.jobs.jobs.push({name:'other',conclusion:'failure'}),
 'cancelled extra step':x=>x.jobs.jobs[2].steps.push({name:'other',conclusion:'cancelled'}),
 'timed out extra step':x=>x.jobs.jobs[2].steps.push({name:'other',conclusion:'timed_out'}),
 'neutral extra step':x=>x.jobs.jobs[2].steps.push({name:'other',conclusion:'neutral'}),
 'unenforced catalog':x=>x.catalog.enforcing=false,
 'missing named assertion':x=>x.catalog.behavior_checks=[],
 'assertion mismatch':x=>x.catalog.behavior_results.behavior_checks[0].actual_count=0,
 'duplicate result':x=>x.catalog.behavior_results.behavior_checks.push(x.catalog.behavior_results.behavior_checks[0]),
 'different catalog hash':x=>x.catalog.behavior_checks[0].migration_sha256='0'.repeat(64),
}
for(const [name,change] of Object.entries(mutations))test(`refuses ${name}`,()=>{const x=fixture();change(x);assert.equal(matchesCatalogRecovery(x),false)})

test('successful-apply route retains its existing verifier and performs no recovery reads',()=>{
 let calls=0
 assert.equal(verifyProductionEvidence({}, {verifyProductionApply:()=>{calls++;return true}},()=>{throw Error('unexpected recovery read')},'popcre/shared-db'),true)
 assert.equal(calls,1)
})
function adapterFixture(){
 const x=fixture();x.evidence.production_evidence='https://github.com/popcre/shared-db/actions/runs/1';x.evidence.production_recovery_evidence='https://github.com/popcre/shared-db/actions/runs/3';x.evidence.merge_sha=apply;x.evidence.merge_pr=7
 const original=new Map([['production-apply.txt','actually applied'],['production-ledger-before.txt',x.ledgerBefore],['production-ledger-after.txt',x.ledgerAfter],['migration-content-manifest.json',JSON.stringify(x.manifest)]])
 const recovered=new Map([['production-catalog-recovery-binding.json',JSON.stringify(x.binding)],['production-catalog-verification.json',JSON.stringify(x.catalog)],['production-ledger-recovery.txt',x.ledgerLive]])
 const io={verifyProductionApply:()=>{throw Error('failed whole apply must not use successful route')},mergeCommitInMain:()=>true,getPrFiles:()=>[{filename:`supabase/migrations/${v}_exact.sql`}],readArtifactFiles:(_repo,id)=>id===2?original:recovered}
 const read=([_api,url])=>url.includes('/compare/')?{status:'ahead',behind_by:0}:url.endsWith('/1/artifacts')?{artifacts:[{id:2,name:`production-migration-apply-${apply}`,expired:false,digest}]}:url.endsWith('/3/artifacts')?{artifacts:[x.recoveryArtifact]}:url.includes('/1/jobs?')?x.jobs:url.endsWith('/1')?x.applyRun:url.endsWith('/3')?x.recoveryRun:(()=>{throw Error(`unexpected endpoint ${url}`)})()
 return {x,io,read,recovered}
}
test('composite adapter independently re-derives exact run artifacts, jobs and ancestry',()=>{
 const {x,io,read}=adapterFixture();assert.equal(verifyProductionEvidence(x.evidence,io,read,'popcre/shared-db'),true)
 io.mergeCommitInMain=()=>false;assert.equal(verifyProductionEvidence(x.evidence,io,read,'popcre/shared-db'),false)
})
test('composite adapter refuses an existing recovery artifact without its new binding',()=>{
 const {x,io,read,recovered}=adapterFixture();recovered.delete('production-catalog-recovery-binding.json');assert.equal(verifyProductionEvidence(x.evidence,io,read,'popcre/shared-db'),false)
})
test('composite adapter refuses foreign recovery URL before using its artifacts',()=>{
 const {x,io,read}=adapterFixture();x.evidence.production_recovery_evidence='https://github.com/foreign/project/actions/runs/3';assert.equal(verifyProductionEvidence(x.evidence,io,read,'popcre/shared-db'),false)
})
