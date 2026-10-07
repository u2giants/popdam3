import {ghJson} from './lanes/github-wire.mjs'
import {currentRepository,isThisRepositoryOrHistorical} from './repository-identity.mjs'
const APPLY_PATH='.github/workflows/shared-supabase-migrations.yml'
const RECOVERY_PATH='.github/workflows/production-catalog-verification-recovery.yml'
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
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
  if(catalog?.enforcing!==true||!same(catalog.errors,[])||!same(catalog.allowlist,wanted))return false
  for(const version of wanted){
    const checks=(catalog.behavior_checks??[]).filter(c=>c.kind==='catalog_contract'&&c.migration_version===version&&c.migration_sha256===binding.migration_hashes[version]&&typeof c.contract==='string'&&c.contract.length>0&&typeof c.id==='string'&&c.id.length>0)
    if(!checks.length)return false
    for(const check of checks){const results=(catalog.behavior_results?.behavior_checks??[]).filter(r=>r.id===check.id);if(!Number.isSafeInteger(check.expected_count)||check.expected_count<1||results.length!==1||results[0].actual_count!==check.expected_count||results[0].expected_count!==check.expected_count)return false}
  }
  return true
}

export function verifyProductionEvidence(evidence,io,read=ghJson,repository=currentRepository()){
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
