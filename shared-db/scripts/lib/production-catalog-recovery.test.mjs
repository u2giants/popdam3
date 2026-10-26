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

// Issue #4214: a pg_cron or curated data migration has no catalog object; its
// recovery proof is a hash-bound exact row count, and the verifier records the
// data-only route as an informational line that is not a failure.
test('data-only recovery accepts a hash-bound exact row count and only the verifier data-only notice',()=>{
  const dataOnly=(mutate=()=>{})=>{const row=fixture();row.catalog.behavior_checks=[{id:'row',kind:'exact_row_count',relation:'cron.job',filters:[{column:'jobname',type:'text',equals:'x'}],migration_version:v,migration_sha256:hash,expected_count:1}];row.catalog.behavior_results={behavior_checks:[{id:'row',actual_count:1,expected_count:1}]};row.catalog.errors=['the allowlisted migrations named no catalog object, but supplied 1 hash-bound behavioral assertion(s).'];mutate(row);return row}
  assert.equal(matchesCatalogRecovery(dataOnly()),true)
  assert.equal(matchesCatalogRecovery(dataOnly(r=>{r.catalog.errors=[]})),true)
  for(const [name,mutate] of [
    ['other error',r=>{r.catalog.errors.push('behavioral query failed: x')}],
    ['notice with suffix',r=>{r.catalog.errors=['the allowlisted migrations named no catalog object, but supplied 1 hash-bound behavioral assertion(s). extra']}],
    ['zero assertions notice',r=>{r.catalog.errors=['the allowlisted migrations named no catalog object, but supplied 0 hash-bound behavioral assertion(s).']}],
    ['errors not a list',r=>{r.catalog.errors='x'}],
    ['wrong hash',r=>{r.catalog.behavior_checks[0].migration_sha256='0'.repeat(64)}],
    ['empty filters',r=>{r.catalog.behavior_checks[0].filters=[]}],
    ['bad relation',r=>{r.catalog.behavior_checks[0].relation='cron.job; drop'}],
    ['unknown kind',r=>{r.catalog.behavior_checks[0].kind='row_count_guess'}],
    ['failed count',r=>{r.catalog.behavior_results.behavior_checks[0].actual_count=0}],
  ])assert.equal(matchesCatalogRecovery(dataOnly(mutate)),false,name)
})

import {CURRENT_LIVE_KIND,assertCurrentLiveProducer,validateCurrentLiveBinding} from './production-catalog-recovery.mjs'
function liveFixture(){
 const original={id:10,run_attempt:1,head_branch:'main',head_sha:apply,path:'.github/workflows/shared-supabase-migrations.yml',event:'workflow_dispatch',status:'completed',conclusion:'success'};
 const names=['SQL migration guards','Production apply review (immutable evidence + hard guards)','Production apply (automatic evidence gates)'];
 const jobs={total_count:3,jobs:names.map((name,i)=>({id:20+i,run_id:10,run_attempt:1,name,status:'completed',conclusion:'success'}))};
 const run={...original,run_attempt:2,conclusion:'failure'};
 const laterJobs={total_count:3,jobs:jobs.jobs.map(j=>({...j,run_attempt:2,conclusion:j.name===names[2]?'skipped':'success'}))};
 const producer={original,jobs,later:[{run,jobs:laterJobs}],latestAttempt:2,artifact:null,absence:'authenticated-404',upload:{artifact_id:30,digest,name:`production-migration-apply-${apply}`,job_id:22,log_sha256:hash}};
 const source={work_issue:3869,source_pr:4735,head_sha:apply,merge_sha:main,migrations:[{version:v,path:`supabase/migrations/${v}_source.sql`,sha256:hash}]};
 const ledger={[v]:hash};const catalog=fixture().catalog;
 const binding={schema:CURRENT_LIVE_KIND,verifier_run_id:40,verifier_run_attempt:1,repository_id:100,owner_id:200,read_only:true,target:'qsllyeztdwjgirsysgai',historical_ledger_delta:null,verifier_sha:main,verified_at:'2026-01-01T00:00:00Z',source,producer,ledger_fingerprints:ledger,catalog_sha256:hash};
 return {binding,source,ledger,catalog,producer};
}
test('separate current-state proof accepts successful original and later skipped apply without historical delta',()=>{const x=liveFixture();assert.equal(assertCurrentLiveProducer(x.producer),true);assert.equal(validateCurrentLiveBinding(x.binding,x),true)})
for(const [name,change] of Object.entries({
 'failed original':x=>x.producer.original.conclusion='failure',
 'non-main original':x=>x.producer.original.head_branch='other',
 'duplicate native job':x=>{x.producer.jobs.jobs.push(x.producer.jobs.jobs[0]);x.producer.jobs.total_count++},
 'incomplete job enumeration':x=>x.producer.jobs.total_count++,
 'missing later attempt':x=>x.producer.later=[],
 'later applied':x=>x.producer.later[0].jobs.jobs[2].conclusion='success',
 'later in progress':x=>x.producer.later[0].run.status='in_progress',
 'later wrong source':x=>x.producer.later[0].run.head_sha=main,
 'unverified absence':x=>x.producer.absence='not-found',
 'available original':x=>{x.producer.artifact={id:30,name:x.producer.upload.name,digest,expired:false,workflow_run:{id:10,head_sha:apply}};x.producer.absence='verified-expiration'},
 'wrong upload hash':x=>x.producer.upload.digest='bad',
 'missing repository ID':x=>delete x.binding.repository_id,
 'missing producer attempt':x=>delete x.binding.verifier_run_attempt,
 'invented historical delta':x=>x.binding.historical_ledger_delta=[v],
 'missing ledger':x=>x.ledger={},
 'changed catalogue SQL':x=>x.catalog.behavior_checks[0].migration_sha256='0'.repeat(64),
 'catalogue failure':x=>x.catalog.errors=['error'],
 'failed behavior':x=>x.catalog.behavior_results.behavior_checks[0].actual_count=0,
 'extra behavior result':x=>x.catalog.behavior_results.behavior_checks.push(x.catalog.behavior_results.behavior_checks[0]),
}))test(`current-state refuses ${name}`,()=>{const x=liveFixture();change(x);assert.throws(()=>validateCurrentLiveBinding(x.binding,x))})

import {createHash} from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
import {verifyCurrentLiveEvidence} from './production-catalog-recovery.mjs'
function nativeLiveFixture(){
 const x=liveFixture(),bytes='-- exact source\n',digest=x=>createHash('sha256').update(x).digest('hex'),approval=JSON.stringify({result:{approved:true},verdicts:[{ref:'synthetic'}]});
 x.source.migrations[0].sha256=digest(bytes);x.catalog.behavior_checks[0].migration_sha256=digest(bytes);
 const cat=JSON.stringify(x.catalog);x.binding.catalog_sha256=digest(cat);x.binding.approval_sha256=digest(approval);
 const e={work_issue:3869,merge_pr:4735,merge_sha:main,production_evidence:'https://github.com/popcre/shared-db/actions/runs/10',production_commit_sha:apply,production_artifact_id:30,production_artifact_digest:x.producer.upload.digest,production_proof_kind:CURRENT_LIVE_KIND,production_reverification_evidence:'https://github.com/popcre/shared-db/actions/runs/40',production_reverification_commit_sha:main,production_reverification_artifact_id:50,production_reverification_artifact_digest:'sha256:'+'d'.repeat(64)};
 const run={id:40,run_attempt:1,status:'completed',conclusion:'success',event:'workflow_dispatch',path:'.github/workflows/production-catalog-verification-recovery.yml',head_branch:'main',head_sha:main};
 const artifact={id:50,expired:false,digest:e.production_reverification_artifact_digest,name:'production-current-live-4735-10-1',workflow_run:{id:40,head_sha:main}};
 const files=new Map([['current-live-binding.json',JSON.stringify(x.binding)],['production-catalog-verification.json',cat]]);
 const io={closingIssuesForPr:()=>[{number:3869}],mergeCommitInMain:()=>true,getPr:()=>({base:{ref:'main'},merged_at:'2026-01-01',head:{sha:apply},merge_commit_sha:main}),getPrFiles:()=>[{filename:x.source.migrations[0].path,status:'added'}],readArtifactFiles:()=>files};
 const read=([_,url])=>{
  const p=url.replace('repos/popcre/shared-db/','');
  if(p==='repos/popcre/shared-db')return {full_name:'popcre/shared-db',id:100,owner:{id:200}};
  if(p==='commits/main')return {sha:main};
  if(p.startsWith('contents/'))return {encoding:'base64',content:Buffer.from(p.includes('_source.sql')?bytes:'identical verifier').toString('base64')};
  if(p.startsWith('compare/'))return {status:'ahead',behind_by:0};
  if(p==='actions/runs/40')return run;
  if(p==='actions/runs/40/attempts/1/jobs?per_page=100')return {total_count:1,jobs:[{name:'Current live reverification',run_id:40,run_attempt:1,status:'completed',conclusion:'success'}]};
  if(p==='actions/runs/40/artifacts?per_page=100')return {total_count:1,artifacts:[artifact]};
  if(p==='actions/runs/10')return {...x.producer.original,run_attempt:2};
  for(const row of [{run:x.producer.original,jobs:x.producer.jobs},...x.producer.later]){if(p===`actions/runs/10/attempts/${row.run.run_attempt}`)return row.run;if(p===`actions/runs/10/attempts/${row.run.run_attempt}/jobs?per_page=100`)return row.jobs;}
  throw Error(`unexpected ${p}`)
 };
 return {x,e,run,artifact,files,io,read,prove:()=>approval};
}
test('native current-live route verifies trusted certificate without a database call',()=>{const f=nativeLiveFixture();assert.equal(verifyCurrentLiveEvidence(f.e,f.io,f.read,'popcre/shared-db',f.prove,()=>f.files,()=>f.files),true)})
for(const [name,change] of Object.entries({
 'foreign certificate':f=>f.e.production_reverification_evidence='https://github.com/foreign/repo/actions/runs/40',
 'wrong certificate kind':f=>f.e.production_proof_kind='legacy',
 'failed certifier':f=>f.run.conclusion='failure',
 'wrong verifier main':f=>f.run.head_sha=apply,
 'expired certificate':f=>f.artifact.expired=true,
 'changed certificate digest':f=>f.artifact.digest='sha256:'+'0'.repeat(64),
 'changed original pin':f=>f.e.production_artifact_id=99,
 'invented binding':f=>f.files.set('current-live-binding.json','{}'),
 'changed catalogue bytes':f=>f.files.set('production-catalog-verification.json','{}'),
 'missing actual approval':f=>f.prove=()=> 'Merged pull request approval audit verified:',
 'unreadable GitHub':f=>f.read=()=>{throw Error('403')},
}))test(`native current-live refuses ${name}`,()=>{const f=nativeLiveFixture();change(f);assert.equal(verifyCurrentLiveEvidence(f.e,f.io,f.read,'popcre/shared-db',f.prove,()=>f.files,()=>f.files),false)})

import {execFileSync} from 'node:child_process'
import {openCurrentLivePackage,retainedCurrentLivePackage,assertEquivalentRetainedCurrentLiveReceipt} from './production-catalog-recovery.mjs'
function retainedFixture(){
 const x=liveFixture(),proof={work_issue:3869,source_pr:4735,run_id:10,proof_kind:CURRENT_LIVE_KIND,reverification_run_id:40,artifact_id:50,artifact_digest:'sha256:'+'d'.repeat(64)};
 const zip=execFileSync('python3',['-c','import sys,json,zipfile,io;b=io.BytesIO();z=zipfile.ZipFile(b,"w");[z.writestr(k,v) for k,v in json.load(sys.stdin).items()];z.close();sys.stdout.buffer.write(b.getvalue())'],{input:JSON.stringify({'current-live-binding.json':JSON.stringify(x.binding),'production-catalog-verification.json':JSON.stringify(x.catalog)})});
 const bundle=Buffer.from('synthetic verification bundle'),hash=createHash('sha256').update(zip).digest('hex');
 const receipt={schema:'shared-db-current-live-reverification-receipt/v1',source:x.source,ledger_fingerprints:x.ledger,proof,certificate:{zip_base64:zip.toString('base64'),bundle_base64:bundle.toString('base64')}};
 const authenticate=({zipBytes,bundleBytes})=>{assert.equal(createHash('sha256').update(zipBytes).digest('hex'),hash);assert.equal(bundleBytes.toString(),bundle.toString())};
 return {receipt,proof,authenticate};
}
test('retained exact inner ZIP and bundle roundtrip without artifact or log dependency',()=>{
 const f=retainedFixture(),files=openCurrentLivePackage(retainedCurrentLivePackage(f.receipt,f.proof),{},f.authenticate);
 const retainedZip=files.certificate.zip_gzip_base64?Buffer.from(files.certificate.zip_gzip_base64,'base64'):Buffer.from(files.certificate.zip_base64,'base64');
 assert.deepEqual(files.certificate.zip_gzip_base64?gunzipSync(retainedZip):retainedZip,Buffer.from(f.receipt.certificate.zip_base64,'base64'));assert.equal(files.certificate.bundle_base64,f.receipt.certificate.bundle_base64);
});
test('bare ref, mutated signed authorizing fields, altered inner bytes and oversized retention refuse',()=>{
 for(const mutate of [f=>delete f.receipt.certificate,f=>f.receipt.source={...f.receipt.source,source_pr:99},f=>f.receipt.ledger_fingerprints={},f=>f.receipt.proof={...f.receipt.proof,run_id:99},f=>f.receipt.certificate.zip_base64=Buffer.from('forged').toString('base64'),f=>f.receipt.certificate.bundle_base64=Buffer.from('forged').toString('base64'),f=>f.receipt.certificate.zip_base64='A'.repeat(100*1024)]){
  const f=retainedFixture();mutate(f);assert.throws(()=>openCurrentLivePackage(retainedCurrentLivePackage(f.receipt,f.proof),{},f.authenticate));
 }
});
test('native retained receipt permits authentic expiry or404 but rejects403/network and available mismatch',()=>{
 for(const state of ['expired','404','403','network','mismatch']){
  const f=nativeLiveFixture(),r=retainedFixture();r.receipt.proof={work_issue:3869,source_pr:4735,run_id:10,proof_kind:CURRENT_LIVE_KIND,reverification_run_id:40,artifact_id:50,artifact_digest:f.e.production_reverification_artifact_digest};
  f.io.readRef=()=> 'e'.repeat(40);f.io.getCommit=()=>({message:'designflow-db-current-live-receipt '+JSON.stringify(r.receipt)});
  const metadata=()=>{if(state==='403'||state==='network')throw Error(state);if(state==='404')return null;return {...f.artifact,expired:state==='expired',...(state==='mismatch'?{digest:'sha256:'+'0'.repeat(64)}:{})}};
  assert.equal(verifyCurrentLiveEvidence(f.e,f.io,f.read,'popcre/shared-db',f.prove,()=>f.files,()=>f.files,metadata),state==='expired'||state==='404');
 }
});

test('lossless gzip retention fits the cap while old uncompressed input still refuses',()=>{
 const f=retainedFixture(),x=liveFixture(),proof=f.proof;
 const zip=execFileSync('python3',['-c','import sys,json,zipfile,io;b=io.BytesIO();z=zipfile.ZipFile(b,"w");[z.writestr(k,v) for k,v in json.load(sys.stdin).items()];z.close();sys.stdout.buffer.write(b.getvalue())'],{input:JSON.stringify({'current-live-binding.json':JSON.stringify({...x.binding,padding:'x'.repeat(120000)}),'production-catalog-verification.json':JSON.stringify({...x.catalog,padding:'x'.repeat(120000)})})});
 const old={...f.receipt,certificate:{zip_base64:zip.toString('base64'),bundle_base64:f.receipt.certificate.bundle_base64}};
 assert.throws(()=>retainedCurrentLivePackage(old,proof),/exceeds reviewed size bound/);
 const compressed=gzipSync(zip),modern={...f.receipt,certificate:{zip_gzip_base64:compressed.toString('base64'),bundle_base64:f.receipt.certificate.bundle_base64}};
 const files=retainedCurrentLivePackage(modern,proof);assert.deepEqual(files.get('current-live-content.zip'),zip);
});

test('large gzip receipt roundtrips through authenticated open and preserves subject bytes',()=>{
 const f=retainedFixture(),x=liveFixture(),proof=f.proof,bundle=Buffer.from('synthetic attestation bundle'.repeat(2000));
 const zip=execFileSync('python3',['-c','import sys,json,zipfile,io;b=io.BytesIO();z=zipfile.ZipFile(b,"w");[z.writestr(k,v) for k,v in json.load(sys.stdin).items()];z.close();sys.stdout.buffer.write(b.getvalue())'],{input:JSON.stringify({'current-live-binding.json':JSON.stringify({...x.binding,padding:'x'.repeat(120000)}),'production-catalog-verification.json':JSON.stringify({...x.catalog,padding:'x'.repeat(120000)})})});
 const subjectHash=createHash('sha256').update(zip).digest('hex'),calls=[];
 const authenticate=({zipBytes,bundleBytes})=>{calls.push({zip:zipBytes,bundle:bundleBytes});assert.equal(createHash('sha256').update(zipBytes).digest('hex'),subjectHash);assert.deepEqual(bundleBytes,bundle)};
 const opened=openCurrentLivePackage(new Map([['current-live-content.zip',zip],['current-live-attestation.jsonl',bundle]]),{},authenticate);
 const receipt={schema:'shared-db-current-live-reverification-receipt/v1',source:x.source,ledger_fingerprints:x.ledger,proof,certificate:opened.certificate};
 assert.ok(Buffer.byteLength(JSON.stringify(receipt))<96*1024);
 const retained=retainedCurrentLivePackage(receipt,proof),reopened=openCurrentLivePackage(retained,{},authenticate);
 assert.deepEqual(reopened.get('current-live-binding.json'),opened.get('current-live-binding.json'));assert.deepEqual(reopened.get('production-catalog-verification.json'),opened.get('production-catalog-verification.json'));assert.equal(calls.length,2);
});

test('gzip receipt never bypasses authentication or authorizing-field checks',()=>{
 const f=retainedFixture(),x=liveFixture(),zip=Buffer.from(f.receipt.certificate.zip_base64,'base64'),bundle=Buffer.from(f.receipt.certificate.bundle_base64,'base64'),hash=createHash('sha256').update(zip).digest('hex');
 const cert={zip_gzip_base64:gzipSync(zip).toString('base64'),bundle_base64:bundle.toString('base64')},receipt={...f.receipt,certificate:cert};
 const authenticate=({zipBytes,bundleBytes})=>{assert.equal(createHash('sha256').update(zipBytes).digest('hex'),hash);assert.deepEqual(bundleBytes,bundle)};
 const changedZip=execFileSync('python3',['-c','import sys,json,zipfile,io;b=io.BytesIO();z=zipfile.ZipFile(b,"w");[z.writestr(k,v) for k,v in json.load(sys.stdin).items()];z.close();sys.stdout.buffer.write(b.getvalue())'],{input:JSON.stringify({'current-live-binding.json':'{}','production-catalog-verification.json':'{}'})});
 assert.throws(()=>openCurrentLivePackage(new Map([['current-live-content.zip',changedZip],['current-live-attestation.jsonl',bundle]]),{},authenticate));
 assert.throws(()=>openCurrentLivePackage(new Map([['current-live-content.zip',zip],['current-live-attestation.jsonl',Buffer.from('changed')]]),{},authenticate));
 assert.throws(()=>openCurrentLivePackage(retainedCurrentLivePackage({...receipt,source:{...receipt.source,source_pr:99}},f.proof),{},authenticate));
 assert.throws(()=>openCurrentLivePackage(retainedCurrentLivePackage({...receipt,proof:{...f.proof,run_id:99}},f.proof),{},authenticate));
});

test('gzip retention refuses mixed keys, corrupt or truncated data, noncanonical base64 and oversized output',()=>{
 const f=retainedFixture(),zip=Buffer.from(f.receipt.certificate.zip_base64,'base64'),good=gzipSync(zip);
 for(const [index,certificate] of [
  {zip_gzip_base64:good.toString('base64'),zip_base64:f.receipt.certificate.zip_base64,bundle_base64:f.receipt.certificate.bundle_base64},
  {zip_gzip_base64:Buffer.from('not-gzip').toString('base64'),bundle_base64:f.receipt.certificate.bundle_base64},
  {zip_gzip_base64:good.subarray(0,good.length-2).toString('base64'),bundle_base64:f.receipt.certificate.bundle_base64},
  {zip_gzip_base64:good.toString('base64')+'\n',bundle_base64:f.receipt.certificate.bundle_base64},
  {zip_gzip_base64:gzipSync(Buffer.alloc(0)).toString('base64'),bundle_base64:f.receipt.certificate.bundle_base64},
  {zip_gzip_base64:gzipSync(Buffer.alloc(4*1024*1024+1)).toString('base64'),bundle_base64:f.receipt.certificate.bundle_base64},
  {zip_gzip_base64:good.toString('base64'),bundle_base64:f.receipt.certificate.bundle_base64,extra:'refused'},
 ].entries()) assert.throws(()=>retainedCurrentLivePackage({...f.receipt,certificate},f.proof),undefined,`mutation ${index}`);
});

test('legacy retained receipts remain immutable while equivalent gzip encodings are accepted',()=>{
 const f=retainedFixture(),old=f.receipt,authenticated=retainedCurrentLivePackage(old,f.proof),zip=authenticated.get('current-live-content.zip'),bundle=authenticated.get('current-live-attestation.jsonl');
 const desired={...old,certificate:{zip_gzip_base64:gzipSync(zip,{level:9}).toString('base64'),bundle_base64:bundle.toString('base64')}};
 assert.equal(assertEquivalentRetainedCurrentLiveReceipt(old,desired,authenticated),true);
 const alternate={...old,certificate:{zip_gzip_base64:gzipSync(zip,{level:1}).toString('base64'),bundle_base64:bundle.toString('base64')}};
 assert.equal(assertEquivalentRetainedCurrentLiveReceipt(old,alternate,authenticated),true);
 for(const mutate of [
  r=>({...r,source:{...r.source,source_pr:99}}),
  r=>({...r,ledger_fingerprints:{}}),
  r=>({...r,proof:{...r.proof,run_id:99}}),
  r=>({...r,certificate:{...r.certificate,extra:'refused'}}),
  r=>({...r,certificate:{zip_gzip_base64:gzipSync(Buffer.from('changed')).toString('base64'),bundle_base64:r.certificate.bundle_base64}}),
  r=>({...r,certificate:{zip_gzip_base64:r.certificate.zip_gzip_base64,bundle_base64:Buffer.from('changed').toString('base64')}}),
  r=>({...r,certificate:{zip_gzip_base64:'A'.repeat(100*1024),bundle_base64:r.certificate.bundle_base64}}),
 ])assert.throws(()=>assertEquivalentRetainedCurrentLiveReceipt(old,mutate(desired),authenticated));
});

import {selectCurrentLivePackageFiles} from './production-catalog-recovery.mjs'
import {readZipEntries} from './zip-entries.mjs'
import {selectArtifactFiles} from './lanes/review-leases.mjs'
test('current-live artifact ZIP selection preserves non-UTF8 signed ZIP and bundle bytes',()=>{
 const zipBytes=Buffer.from([0x50,0x4b,0x03,0x04,0xff,0x80,0x00,0xfe]);
 const bundleBytes=Buffer.from([0xff,0x00,0x81,0x7b,0x7d]);
 const archive=execFileSync('python3',['-c','import sys,json,zipfile,io,base64;b=io.BytesIO();z=zipfile.ZipFile(b,"w",zipfile.ZIP_DEFLATED);[z.writestr(k,base64.b64decode(v)) for k,v in json.load(sys.stdin).items()];z.close();sys.stdout.buffer.write(b.getvalue())'],{input:JSON.stringify({'current-live-content.zip':zipBytes.toString('base64'),'current-live-attestation.jsonl':bundleBytes.toString('base64')})});
 const entries=readZipEntries(archive);
 const textFiles=selectArtifactFiles(entries,['current-live-content.zip','current-live-attestation.jsonl']);
 assert.equal(typeof textFiles.get('current-live-content.zip'),'string');
 assert.notDeepEqual(Buffer.from(textFiles.get('current-live-content.zip')),zipBytes);
 const files=selectCurrentLivePackageFiles(entries);
 assert.deepEqual(files.get('current-live-content.zip'),zipBytes);
 assert.deepEqual(files.get('current-live-attestation.jsonl'),bundleBytes);
 assert.throws(()=>readZipEntries(Buffer.from('malformed archive')));
});
test('current-live package selector refuses missing ambiguous malformed or excessive members',()=>{
 const valid=()=>new Map([['current-live-content.zip',Buffer.from('zip')],['current-live-attestation.jsonl',Buffer.from('bundle')]]);
 for(const mutate of [m=>m.delete('current-live-content.zip'),m=>m.set('nested/current-live-content.zip',Buffer.from('other')),m=>m.set('unexpected',Buffer.from('other')),m=>{m.delete('current-live-content.zip');m.set('../current-live-content.zip',Buffer.from('zip'))},m=>m.set('current-live-content.zip','zip'),m=>m.set('current-live-attestation.jsonl',Buffer.alloc(0)),m=>m.set('current-live-content.zip',Buffer.alloc(4*1024*1024+1))]){
  const members=valid();mutate(members);assert.throws(()=>selectCurrentLivePackageFiles(members));
 }
 assert.throws(()=>selectCurrentLivePackageFiles({}));
});
