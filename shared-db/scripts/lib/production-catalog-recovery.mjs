import {verifyCurrentLiveAttestation,readMetadataZip} from './current-live-attestation.mjs'
import {runGitHubCommand} from './github-transport.mjs'
import {readZipEntries} from './zip-entries.mjs'
import {selectArtifactFiles} from './lanes/review-leases.mjs'
import {createHash} from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
import {execFileSync} from 'node:child_process'
import {ghJson} from './lanes/github-wire.mjs'
import {currentRepository,isThisRepositoryOrHistorical} from './repository-identity.mjs'
const APPLY_PATH='.github/workflows/shared-supabase-migrations.yml'
const RECOVERY_PATH='.github/workflows/production-catalog-verification-recovery.yml'
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
export const DATA_ONLY_NOTICE=/^the allowlisted migrations named no catalog object, but supplied [1-9][0-9]* hash-bound behavioral assertion\(s\)\.$/
const namedAssertion=(c)=>c?.kind==='catalog_contract'?typeof c.contract==='string'&&c.contract.length>0
  :c?.kind==='exact_row_count'?typeof c.relation==='string'&&/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(c.relation)&&Array.isArray(c.filters)&&c.filters.length>0
  :false
export function matchesCatalogRecovery({evidence,applyRun,recoveryRun,recoveryArtifact,binding,catalog,versions,manifest,jobs,ledgerBefore,ledgerAfter,ledgerLive}) {
  if(applyRun?.status!=='completed'||applyRun.conclusion!=='failure'||applyRun.event!=='workflow_dispatch'||applyRun.path!==APPLY_PATH||applyRun.head_sha!==evidence.production_commit_sha)return false
  if(recoveryRun?.status!=='completed'||recoveryRun.conclusion!=='success'||recoveryRun.event!=='workflow_dispatch'||recoveryRun.path!==RECOVERY_PATH||recoveryRun.head_sha!==evidence.production_recovery_commit_sha)return false
  if(recoveryArtifact?.expired!==false||recoveryArtifact.name!==`production-catalog-recovery-${applyRun.id}`||Number(recoveryArtifact.id)!==evidence.production_recovery_artifact_id||recoveryArtifact.digest!==evidence.production_recovery_artifact_digest)return false
  const failed=(jobs?.jobs??[]).filter(j=>j.conclusion==='failure')
  if(failed.length!==1||failed[0].name!=='Production apply (automatic evidence gates)'||(jobs?.jobs??[]).some(j=>!['success','skipped','failure'].includes(j.conclusion)))return false
  const steps=failed[0].steps??[]
  if(steps.some(s=>!['success','skipped','failure'].includes(s.conclusion)))return false
  for(const name of ['SQL migration guards','Production apply review (immutable evidence + hard guards)'])if((jobs?.jobs??[]).filter(j=>j.name===name&&j.conclusion==='success').length!==1)return false
  if(!same(steps.filter(s=>s.conclusion==='failure').map(s=>s.name),['Post-apply catalog verification']))return false
  for(const name of ['Build bounded checkout','Fresh dry-run, then apply','Capture production migration record (after)','Save apply evidence','Release the exclusive production lane with ownership proof'])if(steps.filter(s=>s.name===name&&s.conclusion==='success').length!==1)return false
  const wanted=[...versions].sort()
  if(!wanted.length||new Set(wanted).size!==wanted.length)return false
  const ledger=text=>new Set(String(text??'').split(/\r?\n/).map(line=>/^\s*(?:\d{14})?\s*\|\s*(\d{14})\s*\|/.exec(line)?.[1]).filter(Boolean))
  const before=ledger(ledgerBefore),after=ledger(ledgerAfter),live=ledger(ledgerLive)
  if(!same([...after].filter(v=>!before.has(v)).sort(),wanted)||[...before].some(v=>!after.has(v))||[...after].some(v=>!live.has(v)))return false
  if(binding?.schema_version!==1||binding.project_ref!=='qsllyeztdwjgirsysgai'||binding.main_sha!==evidence.production_recovery_commit_sha||binding.apply_main_sha!==evidence.production_commit_sha||binding.apply_run_id!==applyRun.id||binding.apply_artifact_id!==evidence.production_artifact_id||binding.apply_artifact_digest!==evidence.production_artifact_digest||!same(binding.allowlist,wanted)||!same(binding.ledger_added,wanted)||!same(binding.ledger_removed,[])||binding.catalog_enforced!==true||binding.verification_only!==true||binding.original_failure!=='Post-apply catalog verification')return false
  if(!same(Object.keys(binding.migration_hashes??{}).sort(),wanted)||wanted.some(v=>!/^[a-f0-9]{64}$/.test(binding.migration_hashes[v])||manifest?.[v]!==binding.migration_hashes[v]))return false
  // Mirrors scripts/production_catalog_recovery_evidence.py (issue #4214): only the
  // verifier's informational data-only line is tolerated in errors, and a version
  // may be proved by a catalog contract or a hash-bound exact row count.
  if(catalog?.enforcing!==true||!Array.isArray(catalog.errors)||catalog.errors.some(e=>!(typeof e==='string'&&DATA_ONLY_NOTICE.test(e)))||!same(catalog.allowlist,wanted))return false
  for(const version of wanted){
    const checks=(catalog.behavior_checks??[]).filter(c=>namedAssertion(c)&&c.migration_version===version&&c.migration_sha256===binding.migration_hashes[version]&&typeof c.id==='string'&&c.id.length>0)
    if(!checks.length)return false
    for(const check of checks){const results=(catalog.behavior_results?.behavior_checks??[]).filter(r=>r.id===check.id);if(!Number.isSafeInteger(check.expected_count)||check.expected_count<1||results.length!==1||results[0].actual_count!==check.expected_count||results[0].expected_count!==check.expected_count)return false}
  }
  return true
}

export function verifyProductionEvidence(evidence,io,read=ghJson,repository=currentRepository()){
  if(evidence.production_proof_kind!==undefined)return verifyCurrentLiveEvidence(evidence,io,read,repository)
  if(!evidence.production_recovery_evidence)return io.verifyProductionApply(evidence)===true
  const match=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)$/.exec(String(evidence.production_evidence??''))
  if(!match||!isThisRepositoryOrHistorical(match[1],repository))return false
  const run=read(['api',`repos/${repository}/actions/runs/${match[2]}`])
  const recoveryMatch=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)$/.exec(evidence.production_recovery_evidence)
  if(!recoveryMatch||!isThisRepositoryOrHistorical(recoveryMatch[1],repository))return false
  const recoveryRun=read(['api',`repos/${repository}/actions/runs/${recoveryMatch[2]}`])
  for(const [base,head] of [[evidence.merge_sha,evidence.production_commit_sha],[evidence.production_commit_sha,evidence.production_recovery_commit_sha]]){
    const ancestry=read(['api',`repos/${repository}/compare/${base}...${head}`]);if(!['identical','ahead'].includes(ancestry?.status)||Number(ancestry?.behind_by)!==0)return false
  }
  if(!io.mergeCommitInMain(evidence.production_recovery_commit_sha))return false
  const artifact=(read(['api',`repos/${repository}/actions/runs/${match[2]}/artifacts`])?.artifacts??[]).find(row=>Number(row.id)===evidence.production_artifact_id)
  if(artifact?.expired!==false||artifact.name!==`production-migration-apply-${evidence.production_commit_sha}`||artifact.digest!==evidence.production_artifact_digest)return false
  const original=io.readArtifactFiles(repository,artifact.id,['production-apply.txt','production-ledger-before.txt','production-ledger-after.txt','migration-content-manifest.json'])
  if(!original.get('production-apply.txt')?.trim())return false
  const recoveryArtifact=(read(['api',`repos/${repository}/actions/runs/${recoveryMatch[2]}/artifacts`])?.artifacts??[]).find(row=>Number(row.id)===evidence.production_recovery_artifact_id)
  if(!recoveryArtifact)return false
  const recovered=io.readArtifactFiles(repository,recoveryArtifact.id,['production-catalog-recovery-binding.json','production-catalog-verification.json','production-ledger-recovery.txt'])
  const versions=io.getPrFiles(Number(evidence.merge_pr)).map(file=>/^supabase\/migrations\/(\d{14})_[^/]+\.sql$/.exec(String(file?.filename??''))?.[1]).filter(Boolean)
  try{return matchesCatalogRecovery({evidence,applyRun:run,recoveryRun,recoveryArtifact,binding:JSON.parse(recovered.get('production-catalog-recovery-binding.json')),catalog:JSON.parse(recovered.get('production-catalog-verification.json')),versions,manifest:JSON.parse(original.get('migration-content-manifest.json')),jobs:read(['api',`repos/${repository}/actions/runs/${match[2]}/jobs?per_page=100`]),ledgerBefore:original.get('production-ledger-before.txt'),ledgerAfter:original.get('production-ledger-after.txt'),ledgerLive:recovered.get('production-ledger-recovery.txt')})}catch{return false}
}

// Separate present-state evidence. Never interprets this as a historical apply delta.
export const CURRENT_LIVE_KIND='shared-db-current-live-reverification/v1'
const SHA=/^[a-f0-9]{40}$/
const HEX=/^[a-f0-9]{64}$/
const APPLY_JOBS=['SQL migration guards','Production apply review (immutable evidence + hard guards)','Production apply (automatic evidence gates)']
export function assertCurrentLiveProducer({original,jobs,later,latestAttempt,artifact,upload,absence}) {
  const refuse=()=>{throw Error('Current-live original producer or archive custody refused')}
  if(!original||original.path!==APPLY_PATH||original.head_branch!=='main'||original.event!=='workflow_dispatch'||original.status!=='completed'||original.conclusion!=='success'||!SHA.test(original.head_sha)||!Number.isSafeInteger(original.id)||original.id<1||!Number.isSafeInteger(original.run_attempt)||original.run_attempt<1)refuse()
  const checkJobs=(run,envelope)=>{
    if(!envelope||!Array.isArray(envelope.jobs)||envelope.total_count!==envelope.jobs.length||envelope.total_count>100||envelope.jobs.some(j=>j.run_id!==run.id||j.run_attempt!==run.run_attempt||j.status!=='completed'||!['success','skipped','failure','cancelled','timed_out'].includes(j.conclusion)))refuse()
  }
  checkJobs(original,jobs)
  for(const name of APPLY_JOBS){const selected=jobs.jobs.filter(j=>j.name===name);if(selected.length!==1||selected[0].conclusion!=='success')refuse()}
  if(!Number.isSafeInteger(latestAttempt)||latestAttempt<original.run_attempt||latestAttempt-original.run_attempt>100||!Array.isArray(later)||later.length!==latestAttempt-original.run_attempt)refuse()
  for(let i=0;i<later.length;i++){
    const {run,jobs:envelope}=later[i]
    if(run?.id!==original.id||run.run_attempt!==original.run_attempt+i+1||run.head_sha!==original.head_sha||run.path!==APPLY_PATH||run.head_branch!=='main'||run.event!=='workflow_dispatch'||run.status!=='completed')refuse()
    checkJobs(run,envelope)
    const apply=envelope.jobs.filter(j=>j.name===APPLY_JOBS[2]);if(apply.length!==1||apply[0].conclusion!=='skipped')refuse()
  }
  if(!upload||!Number.isSafeInteger(upload.artifact_id)||upload.artifact_id<1||!/^sha256:[a-f0-9]{64}$/.test(upload.digest)||upload.name!==`production-migration-apply-${original.head_sha}`||!HEX.test(upload.log_sha256)||!Number.isSafeInteger(upload.job_id)||!jobs.jobs.some(j=>j.id===upload.job_id&&j.name===APPLY_JOBS[2]))refuse()
  if(artifact){
    if(artifact.id!==upload.artifact_id||artifact.name!==upload.name||artifact.digest!==upload.digest||artifact.expired!==true||artifact.workflow_run?.id!==original.id||artifact.workflow_run?.head_sha!==original.head_sha||absence!=='verified-expiration')refuse()
  }else if(absence!=='authenticated-404')refuse()
  return true
}
export function validateCurrentLiveBinding(binding,{source,ledger,catalog,producer}) {
  if(binding?.schema!==CURRENT_LIVE_KIND||![binding.verifier_run_id,binding.verifier_run_attempt,binding.repository_id,binding.owner_id].every(n=>Number.isSafeInteger(n)&&n>0)||binding.read_only!==true||binding.target!=='qsllyeztdwjgirsysgai'||binding.historical_ledger_delta!==null||!SHA.test(binding.verifier_sha)||!HEX.test(binding.catalog_sha256)||!Number.isFinite(Date.parse(binding.verified_at))||Date.parse(binding.verified_at)>Date.now())throw Error('Malformed current-live binding')
  assertCurrentLiveProducer(producer)
  if(!same(binding.source,source)||!same(binding.producer,producer)||!same(binding.ledger_fingerprints,ledger)||!source?.migrations?.length||!same(Object.keys(ledger).sort(),source.migrations.map(m=>m.version).sort())||Object.values(ledger).some(x=>!HEX.test(x)))throw Error('Current-live source or ledger changed')
  if(!catalog||catalog.enforcing!==true||!Array.isArray(catalog.errors)||catalog.errors.some(e=>!(typeof e==='string'&&DATA_ONLY_NOTICE.test(e)))||!same(catalog.allowlist,source.migrations.map(m=>m.version)))throw Error('Current-live catalogue is not enforcing the exact source')
  if(new Set(source.migrations.map(m=>m.version)).size!==source.migrations.length||new Set(source.migrations.map(m=>m.path)).size!==source.migrations.length)throw Error('Duplicate current-live source')
  for(const m of source.migrations){
    if(!/^\d{14}$/.test(m.version)||!HEX.test(m.sha256))throw Error('Malformed current-live migration')
    const checks=(catalog.behavior_checks??[]).filter(c=>namedAssertion(c)&&typeof c.id==='string'&&c.id.length>0&&c.migration_version===m.version&&c.migration_sha256===m.sha256)
    if(!checks.length)throw Error('Current-live source has no hash-bound catalogue assertion')
    for(const c of checks){const results=(catalog.behavior_results?.behavior_checks??[]).filter(r=>r.id===c.id);if(!Number.isSafeInteger(c.expected_count)||c.expected_count<1||results.length!==1||results[0].actual_count!==c.expected_count||results[0].expected_count!==c.expected_count)throw Error('Current-live catalogue assertion failed')}
  }
  return true
}

// GitHub-only native acceptance. Live ledger/catalogue contact belongs exclusively
// to the trusted read-only certificate producer and the central readiness observer.
export function proveCurrentLiveAssignedSource(pr){
 const program=`import {gatherApprovalInput,requireDurableVerdictInput,evaluateExactHeadApproval} from './scripts/check-exact-head-approval.mjs';const input=requireDurableVerdictInput(gatherApprovalInput({...process.env,PR_NUMBER:process.env.CURRENT_LIVE_SOURCE_PR,APPROVAL_AUDIT:''}));const result=evaluateExactHeadApproval(input);if(result.approved!==true||result.owner_no_reviewer||result.documents_only)throw Error('Actual assigned approval required');console.log(JSON.stringify({result,verdicts:input.verdicts.map(({ref,sha,assignment_sha,findings_digest,reviewer,head_sha,verdict})=>({ref,sha,assignment_sha,findings_digest,reviewer,head_sha,verdict})).sort((a,b)=>a.ref.localeCompare(b.ref))}));`;
 return execFileSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',env:{...process.env,CURRENT_LIVE_SOURCE_PR:String(pr)},timeout:180000,maxBuffer:4*1024*1024});
}
const currentLiveApproval=e=>proveCurrentLiveAssignedSource(e.merge_pr)
export const CURRENT_LIVE_RECEIPT_PREFIX='designflow-db-current-live-receipt '
export function authenticatedArtifact404(error){
 if(error?.transientTransport||error?.rateLimitExhausted||!error?.stdout)throw Error('Artifact absence is not authenticated');
 const raw=String(error.stdout),status=[...raw.matchAll(/^HTTP\/\S+\s+(\d{3})\b/gm)];
 if(status.length!==1||status[0][1]!=='404')throw Error('Only authenticated artifact404 accepted');
 const offset=raw.search(/\r?\n\r?\n/);if(offset<0)throw Error('Artifact envelope missing');
 const body=JSON.parse(raw.slice(offset).trim());if(body.message!=='Not Found'||String(body.status)!=='404')throw Error('Artifact absence envelope differs');return true;
}
export function currentLiveArtifactMetadata(repository,id){
 try{const raw=String(runGitHubCommand(['api','-i',`repos/${repository}/actions/artifacts/${id}`],{timeoutMs:60000,maxBuffer:1024*1024}));const i=raw.search(/\r?\n\r?\n/);if(i<0)throw Error('Artifact envelope missing');return JSON.parse(raw.slice(i).trim())}catch(error){authenticatedArtifact404(error);return null}
}
export function openCurrentLivePackage(packageFiles,expected,authenticate=verifyCurrentLiveAttestation){
 const zipBytes=packageFiles.get('current-live-content.zip'),bundleBytes=packageFiles.get('current-live-attestation.jsonl');
 authenticate({zipBytes,bundleBytes,...expected});
 const files=readMetadataZip(zipBytes);
 if(packageFiles.retainedReceipt){const r=packageFiles.retainedReceipt,b=JSON.parse(files.get('current-live-binding.json'));if(!same(r.source,b.source)||!same(r.ledger_fingerprints,b.ledger_fingerprints)||r.proof.work_issue!==b.source.work_issue||r.proof.source_pr!==b.source.source_pr||r.proof.run_id!==b.producer.original.id||r.proof.reverification_run_id!==b.verifier_run_id||r.proof.proof_kind!==CURRENT_LIVE_KIND)throw Error('Retained authorizing fields differ from signed inner subject')}
 const originalZipBase64=zipBytes.toString('base64'),gzipZipBase64=gzipSync(zipBytes).toString('base64');
 files.certificate=gzipZipBase64.length<originalZipBase64.length?{zip_gzip_base64:gzipZipBase64,bundle_base64:bundleBytes.toString('base64')}:{zip_base64:originalZipBase64,bundle_base64:bundleBytes.toString('base64')};return files;
}
export function retainedCurrentLivePackage(receipt,expected){
 if(Buffer.byteLength(JSON.stringify(receipt))>96*1024)throw Error('Retained receipt exceeds reviewed size bound');
 if(!receipt||Object.keys(receipt).sort().join(',')!=='certificate,ledger_fingerprints,proof,schema,source')throw Error('Malformed retained certificate fields');
 const certificateKeys=Object.keys(receipt.certificate??{}).sort().join(','),oldEncoding=certificateKeys==='bundle_base64,zip_base64',gzipEncoding=certificateKeys==='bundle_base64,zip_gzip_base64';
 if(!oldEncoding&&!gzipEncoding)throw Error('Malformed retained certificate fields');
 if(receipt?.schema!=='shared-db-current-live-reverification-receipt/v1'||!same(receipt.proof,expected))throw Error('Retained current-live locator differs');
 const decode=value=>{if(typeof value!=='string'||value.length>8*1024*1024)throw Error('Retained certificate bound exceeded');const b=Buffer.from(value,'base64');if(!b.length||b.toString('base64')!==value)throw Error('Malformed retained certificate');return b};
 let zipBytes=decode(oldEncoding?receipt.certificate.zip_base64:receipt.certificate.zip_gzip_base64);
 if(gzipEncoding){try{zipBytes=gunzipSync(zipBytes,{maxOutputLength:4*1024*1024})}catch{throw Error('Malformed retained gzip certificate')}if(!zipBytes.length)throw Error('Malformed retained gzip certificate')}
 const files=new Map([['current-live-content.zip',zipBytes],['current-live-attestation.jsonl',decode(receipt.certificate.bundle_base64)]]);files.retainedReceipt=receipt;return files;
}
export function assertEquivalentRetainedCurrentLiveReceipt(priorReceipt,desiredReceipt,authenticatedPackageFiles){
 const priorFiles=retainedCurrentLivePackage(priorReceipt,desiredReceipt.proof);
 const desiredFiles=retainedCurrentLivePackage(desiredReceipt,desiredReceipt.proof);
 if(!same(priorReceipt.source,desiredReceipt.source)||!same(priorReceipt.ledger_fingerprints,desiredReceipt.ledger_fingerprints))throw Error('Prior retained authorizing fields differ');
 const priorZip=priorFiles.get('current-live-content.zip'),priorBundle=priorFiles.get('current-live-attestation.jsonl'),candidateZip=authenticatedPackageFiles?.get('current-live-content.zip'),candidateBundle=authenticatedPackageFiles?.get('current-live-attestation.jsonl');
 const desiredZip=desiredFiles.get('current-live-content.zip'),desiredBundle=desiredFiles.get('current-live-attestation.jsonl');
 if(!Buffer.isBuffer(candidateZip)||!Buffer.isBuffer(candidateBundle)||!priorZip.equals(candidateZip)||!priorBundle.equals(candidateBundle)||!desiredZip.equals(candidateZip)||!desiredBundle.equals(candidateBundle))throw Error('Prior retained certificate bytes differ');
 return true;
}
const readCurrentLiveArchive=(repository,artifact)=>{
 const bytes=runGitHubCommand(['api',`repos/${repository}/actions/artifacts/${artifact.id}/zip`],{encoding:null,timeoutMs:60000,maxBuffer:16*1024*1024})
 if(`sha256:${createHash('sha256').update(bytes).digest('hex')}`!==artifact.digest)throw Error('Certificate ZIP digest differs')
 return selectArtifactFiles(readZipEntries(bytes),['current-live-content.zip','current-live-attestation.jsonl'])
}
export function verifyCurrentLiveEvidence(e,io,read=ghJson,repository=currentRepository(),proveApproval=currentLiveApproval,readArchive=readCurrentLiveArchive,openPackage=openCurrentLivePackage,artifactMetadata=currentLiveArtifactMetadata) {
 try {
  if(e.production_proof_kind!==CURRENT_LIVE_KIND||e.production_recovery_evidence)return false
  const url=value=>{const m=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/([1-9][0-9]*)$/.exec(String(value));if(!m||!isThisRepositoryOrHistorical(m[1],repository))throw Error('Foreign certificate');return Number(m[2])}
  const originalId=url(e.production_evidence),id=url(e.production_reverification_evidence)
  const get=path=>read(['api',`repos/${repository}/${path}`])
  const run=get(`actions/runs/${id}`)
  if(run.id!==id||run.status!=='completed'||run.conclusion!=='success'||run.event!=='workflow_dispatch'||run.path!==RECOVERY_PATH||run.head_branch!=='main'||run.head_sha!==e.production_reverification_commit_sha||!io.mergeCommitInMain(run.head_sha))return false
  const main=get('commits/main').sha
  if(!SHA.test(main))return false
  for(const path of ['.github/workflows/production-catalog-verification-recovery.yml','scripts/designflow-db-release.mjs','scripts/lib/production-catalog-recovery.mjs','scripts/lib/current-live-attestation.mjs','scripts/production_catalog_recovery_evidence.py','scripts/production_catalog_verification.py','scripts/check-exact-head-approval.mjs','scripts/check-applied-migration-edit.mjs','scripts/atomic_migration_apply.py']){
   const producer=get(`contents/${path}?ref=${run.head_sha}`),current=get(`contents/${path}?ref=${main}`)
   if(producer.encoding!=='base64'||current.encoding!=='base64'||producer.content!==current.content)return false
  }
  const jobs=get(`actions/runs/${id}/attempts/${run.run_attempt}/jobs?per_page=100`)
  if(jobs.total_count!==jobs.jobs?.length||jobs.total_count>100||jobs.jobs.filter(j=>j.name==='Current live reverification'&&j.run_id===id&&j.run_attempt===run.run_attempt&&j.status==='completed'&&j.conclusion==='success').length!==1)return false
  const repo=read(['api',`repos/${repository}`]);if(repo.full_name!==repository)return false
  const expectedProof={work_issue:e.work_issue,source_pr:e.merge_pr,run_id:originalId,proof_kind:CURRENT_LIVE_KIND,reverification_run_id:id,artifact_id:e.production_reverification_artifact_id,artifact_digest:e.production_reverification_artifact_digest};
  const sourceHead=io.getPr(e.merge_pr)?.head?.sha,ref=`refs/designflow-db-current-live-receipts/${e.work_issue}/${e.merge_pr}/${sourceHead}/${id}`,retained=io.readRef?.(ref);
  let packageFiles,a;
  if(retained){
   const message=io.getCommit(retained)?.message;if(!message?.startsWith(CURRENT_LIVE_RECEIPT_PREFIX))return false;
   const receipt=JSON.parse(message.slice(CURRENT_LIVE_RECEIPT_PREFIX.length));
   a=artifactMetadata(repository,e.production_reverification_artifact_id);
   if(a&&(a.id!==e.production_reverification_artifact_id||a.digest!==e.production_reverification_artifact_digest||a.workflow_run?.id!==id||a.workflow_run?.head_sha!==run.head_sha))return false;
   if(!a||a.expired===true)packageFiles=retainedCurrentLivePackage(receipt,expectedProof);
   else packageFiles=readArchive(repository,a);
  }else{
   const artifacts=get(`actions/runs/${id}/artifacts?per_page=100`);
   if(artifacts.total_count!==artifacts.artifacts?.length||artifacts.total_count>100)return false;
   a=artifacts.artifacts.find(a=>a.id===e.production_reverification_artifact_id);
   if(!a||a.expired!==false||a.digest!==e.production_reverification_artifact_digest||a.workflow_run?.id!==id||a.workflow_run?.head_sha!==run.head_sha)return false;
   packageFiles=readArchive(repository,a);
  }
  const files=openPackage(packageFiles,{repositoryId:repo.id,ownerId:repo.owner?.id,verifierSha:run.head_sha,runId:id,runAttempt:run.run_attempt});
  const b=JSON.parse(files.get('current-live-binding.json')),catalogBytes=files.get('production-catalog-verification.json'),catalog=JSON.parse(catalogBytes)
  const digest=x=>createHash('sha256').update(x).digest('hex')
  if(b.verifier_sha!==run.head_sha||b.catalog_sha256!==digest(catalogBytes)||b.source.work_issue!==e.work_issue||b.source.source_pr!==e.merge_pr||b.source.merge_sha!==e.merge_sha||b.producer.original.id!==originalId||b.producer.original.head_sha!==e.production_commit_sha||b.producer.upload.artifact_id!==e.production_artifact_id||b.producer.upload.digest!==e.production_artifact_digest||(a&&a.name!==`production-current-live-${e.merge_pr}-${originalId}-${b.producer.original.run_attempt}`)||b.repository_id!==repo.id||b.owner_id!==repo.owner?.id||b.verifier_run_id!==id||b.verifier_run_attempt!==run.run_attempt)return false
  const linked=io.closingIssuesForPr(e.merge_pr)
  if(linked.length!==1||Number(linked[0].number)!==e.work_issue)return false
  const pr=io.getPr(e.merge_pr)
  if(pr.base?.ref!=='main'||!pr.merged_at||pr.head?.sha!==b.source.head_sha||pr.merge_commit_sha!==e.merge_sha||!io.mergeCommitInMain(e.merge_sha))return false
  const sourceFiles=io.getPrFiles(e.merge_pr).filter(f=>/^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(f.filename))
  if(sourceFiles.length!==b.source.migrations.length)return false
  for(const m of b.source.migrations){
   if(!sourceFiles.some(f=>f.filename===m.path&&f.status==='added'))return false
   const blob=get(`contents/${m.path}?ref=${e.merge_sha}`)
   const current=get(`contents/${m.path}?ref=${main}`)
   if(blob.encoding!=='base64'||current.encoding!=='base64'||digest(Buffer.from(blob.content,'base64'))!==m.sha256||digest(Buffer.from(current.content,'base64'))!==m.sha256)return false
  }
  for(const [base,head] of [[e.merge_sha,e.production_commit_sha],[e.production_commit_sha,run.head_sha]]){const c=get(`compare/${base}...${head}`);if(!['identical','ahead'].includes(c.status)||c.behind_by!==0)return false}
  const p=b.producer,attempt=p.original.run_attempt
  if(!same(get(`actions/runs/${originalId}/attempts/${attempt}`),p.original)||!same(get(`actions/runs/${originalId}/attempts/${attempt}/jobs?per_page=100`),p.jobs))return false
  for(const later of p.later){const n=later.run.run_attempt;if(!same(get(`actions/runs/${originalId}/attempts/${n}`),later.run)||!same(get(`actions/runs/${originalId}/attempts/${n}/jobs?per_page=100`),later.jobs))return false}
  const latest=get(`actions/runs/${originalId}`);if(latest.id!==originalId||latest.head_sha!==e.production_commit_sha||latest.path!==APPLY_PATH||latest.event!=='workflow_dispatch'||latest.run_attempt!==p.latestAttempt||latest.status!=='completed')return false
  validateCurrentLiveBinding(b,{source:b.source,ledger:b.ledger_fingerprints,catalog,producer:p})
  const output=proveApproval(e)
  const approval=JSON.parse(output);if(approval.result?.approved!==true||!approval.verdicts?.length||digest(output)!==b.approval_sha256)return false
  return true
 }catch{return false}
}
