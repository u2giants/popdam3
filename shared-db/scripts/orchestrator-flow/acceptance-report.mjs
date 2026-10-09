import { median } from '../throughput-guard/ledger-lib.mjs'
import { canonicalJson, sha256 } from './evidence-bundle.mjs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export class AcceptanceReportError extends Error {}

export const ACCEPTANCE_PHASES=Object.freeze([
  ['request_to_dispatch','entered','dispatched'],
  ['dispatch_to_implementation','dispatched','implementation_complete'],
  ['implementation_to_review','implementation_complete','review_ready'],
  ['review_ci_wait','review_ready','preview_verified'],
  ['merge','preview_verified','merged'],
  ['production_decision_wait','merged','production_authorized'],
  ['production_apply','production_authorized','production_applied'],
  ['live_verification','production_applied','live_verified'],
])

const minutes=(start,end)=>{const value=(Date.parse(end)-Date.parse(start))/60000;if(!Number.isFinite(value)||value<0)throw new AcceptanceReportError('outcome timestamps must be chronological ISO instants');return value}
const SHA=/^[0-9a-f]{40}$/i, DIGEST=/^sha256:[0-9a-f]{64}$/i, EVENT_ID=/^[0-9a-f]{64}$/i
const EVIDENCE=/^(?:https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull|actions\/runs)\/[^\s]+|artifact:[A-Za-z0-9][A-Za-z0-9._:\/-]*)$/

function validateCohort(cohort,outcomes,io){
  if(typeof io?.readCohortArtifact!=='function')throw new AcceptanceReportError('authoritative cohort artifact reader is required')
  if(!cohort||cohort.schema_version!==1||!EVIDENCE.test(cohort.source_evidence??'')||!Number.isInteger(cohort.artifact_id)||cohort.artifact_id<1||!DIGEST.test(cohort.artifact_digest??'')||!SHA.test(cohort.ledger_head_sha??''))throw new AcceptanceReportError('authoritative cohort proof is incomplete')
  if(!Array.isArray(cohort.ordered_work_issues)||cohort.ordered_work_issues.length!==5||new Set(cohort.ordered_work_issues).size!==5||cohort.ordered_work_issues.some((n)=>!Number.isInteger(n)||n<1))throw new AcceptanceReportError('authoritative cohort must name five unique ordered work issues')
  const identity={schema_version:cohort.schema_version,source_evidence:cohort.source_evidence,artifact_id:cohort.artifact_id,artifact_digest:cohort.artifact_digest,ledger_head_sha:cohort.ledger_head_sha,ordered_work_issues:cohort.ordered_work_issues}
  const expected=`sha256:${sha256(canonicalJson(identity))}`
  if(cohort.cohort_digest!==expected)throw new AcceptanceReportError('authoritative cohort digest does not match its exact identity')
  const authoritative=io.readCohortArtifact(cohort.source_evidence,cohort.artifact_id)
  if(!authoritative||authoritative.source_evidence!==cohort.source_evidence||authoritative.artifact_id!==cohort.artifact_id||authoritative.ledger_head_sha!==cohort.ledger_head_sha||!authoritative.content||typeof authoritative.content!=='object')throw new AcceptanceReportError('authoritative cohort artifact readback does not match the requested source, id, or head')
  if(`sha256:${sha256(canonicalJson(authoritative.content))}`!==cohort.artifact_digest)throw new AcceptanceReportError('authoritative cohort artifact digest does not match its canonical content')
  const authoritativeIdentity={schema_version:authoritative.content.schema_version,source_evidence:authoritative.source_evidence,artifact_id:authoritative.artifact_id,artifact_digest:cohort.artifact_digest,ledger_head_sha:authoritative.ledger_head_sha,ordered_work_issues:authoritative.content.ordered_work_issues}
  if(canonicalJson(authoritativeIdentity)!==canonicalJson(identity))throw new AcceptanceReportError('authoritative cohort artifact readback does not match the claimed exact identity')
  if(outcomes.some((row,index)=>row.issue!==cohort.ordered_work_issues[index]))throw new AcceptanceReportError('caller outcome order does not match the authoritative consecutive cohort')
  return identity
}

function validateSamples(name,value){
  if(!Array.isArray(value?.samples)||!value.samples.length||value.samples.some((n)=>!Number.isFinite(n)||n<=0))throw new AcceptanceReportError(`raw ${name} samples are required`)
  if(value.n!==value.samples.length)throw new AcceptanceReportError(`${name} n does not match its raw samples`)
  const computed=median(value.samples)
  if(value.median_request_to_live_minutes!==computed)throw new AcceptanceReportError(`${name} median does not match its raw samples`)
  return computed
}

function boundDigest(value,keys){return `sha256:${sha256(canonicalJson(Object.fromEntries(keys.map((key)=>[key,value[key]]))))}`}

function artifactFile(root,sourceEvidence,artifactId){
  if(typeof root!=='string'||!path.isAbsolute(root))throw new AcceptanceReportError('trusted acceptance artifact root is not configured as an absolute path')
  const key=sha256(canonicalJson({source_evidence:sourceEvidence,artifact_id:artifactId}))
  const resolvedRoot=path.resolve(root),file=path.resolve(resolvedRoot,`artifact-${key}.json`)
  if(!file.startsWith(`${resolvedRoot}${path.sep}`))throw new AcceptanceReportError('artifact path escaped the trusted acceptance root')
  return file
}

function readTrustedArtifact(root,sourceEvidence,artifactId){
  let value
  try{value=JSON.parse(readFileSync(artifactFile(root,sourceEvidence,artifactId),'utf8'))}catch{throw new AcceptanceReportError(`trusted artifact ${artifactId} is unreadable`)}
  if(value?.source_evidence!==sourceEvidence||value?.artifact_id!==artifactId||!SHA.test(value?.ledger_head_sha??'')||!value.content||typeof value.content!=='object'||Array.isArray(value.content))throw new AcceptanceReportError('trusted artifact does not return the requested source, id, head, and content')
  return value
}

export function trustedArtifactReaders(root){return{
  readCohortArtifact:(sourceEvidence,artifactId)=>readTrustedArtifact(root,sourceEvidence,artifactId),
  readRefusalLedger:(sourceEvidence,artifactId)=>readTrustedArtifact(root,sourceEvidence,artifactId),
}}

function validateRefusalLedger(refusalLedger,refusalEvidence,io){
  if(typeof io?.readRefusalLedger!=='function')throw new AcceptanceReportError('authoritative refusal ledger reader is required')
  if(!refusalLedger||!EVIDENCE.test(refusalLedger.source_evidence??'')||!Number.isInteger(refusalLedger.artifact_id)||refusalLedger.artifact_id<1||!DIGEST.test(refusalLedger.artifact_digest??'')||!SHA.test(refusalLedger.ledger_head_sha??'')||!Number.isInteger(refusalLedger.count)||refusalLedger.count<1||!DIGEST.test(refusalLedger.set_digest??''))throw new AcceptanceReportError('authoritative refusal ledger identity is incomplete')
  const authoritative=io.readRefusalLedger(refusalLedger.source_evidence,refusalLedger.artifact_id)
  if(!authoritative||authoritative.source_evidence!==refusalLedger.source_evidence||authoritative.artifact_id!==refusalLedger.artifact_id||authoritative.ledger_head_sha!==refusalLedger.ledger_head_sha||!authoritative.content||!Array.isArray(authoritative.content.entries))throw new AcceptanceReportError('authoritative refusal ledger readback does not match the requested source, id, or head')
  if(`sha256:${sha256(canonicalJson(authoritative.content))}`!==refusalLedger.artifact_digest)throw new AcceptanceReportError('authoritative refusal ledger artifact digest does not match its canonical content')
  if(authoritative.content.entries.length!==refusalLedger.count||`sha256:${sha256(canonicalJson(authoritative.content.entries))}`!==refusalLedger.set_digest)throw new AcceptanceReportError('authoritative refusal ledger count or set digest does not match readback')
  if(canonicalJson(authoritative.content.entries)!==canonicalJson(refusalEvidence))throw new AcceptanceReportError('refusal evidence is a filtered or changed subset of the authoritative refusal ledger')
}

export function buildFiveOutcomeAcceptanceReport({outcomes,cohort,baseline,refusal_evidence=[],refusal_ledger},io={}){
  if(!Array.isArray(outcomes)||outcomes.length!==5)throw new AcceptanceReportError('exactly five consecutive outcomes are required')
  const cohortIdentity=validateCohort(cohort,outcomes,io),baselineMedian=validateSamples('baseline',baseline)
  const rows=outcomes.map((row,index)=>{
    if(row.work_type!=='structural'||!['urgent-application','standard-application'].includes(row.service_class))throw new AcceptanceReportError(`outcome #${row.issue} is not an admitted structural service outcome`)
    if(row.unchanged_poll_count!==0||row.manual_reconstruction_count!==0)throw new AcceptanceReportError(`outcome #${row.issue} used unchanged polling or manual queue reconstruction`)
    const identity=row.lifecycle_identity
    if(!identity||identity.work_issue!==row.issue||!EVENT_ID.test(identity.event_id??'')||!SHA.test(identity.head_sha??'')||!EVIDENCE.test(identity.evidence??'')||!DIGEST.test(identity.evidence_digest??''))throw new AcceptanceReportError(`outcome #${row.issue} lacks an exact issue-bound durable lifecycle identity`)
    if(identity.evidence_digest!==boundDigest(identity,['work_issue','event_id','head_sha','evidence']))throw new AcceptanceReportError(`outcome #${row.issue} lifecycle evidence digest is not bound to its issue, event, head, and evidence`)
    const events=row.events??[]
    const requiredTypes=['entered',...ACCEPTANCE_PHASES.map(([, ,to])=>to)]
    if(events.length!==requiredTypes.length||requiredTypes.some((type,eventIndex)=>events[eventIndex]?.event_type!==type)||events.some((event)=>event.work_issue!==row.issue||event.result!=='succeeded'))throw new AcceptanceReportError(`outcome #${row.issue} lifecycle is duplicated, incomplete, failed, foreign, or out of order`)
    const live=events.at(-1)
    if(live.event_type!=='live_verified'||live.event_id!==identity.event_id||live.head_sha!==identity.head_sha||(live.evidence_urls??[]).includes(identity.evidence)===false)throw new AcceptanceReportError(`outcome #${row.issue} live_verified event does not match its durable lifecycle identity`)
    const byType=new Map(events.map((event)=>[event.event_type,event]))
    const phases={}
    for(const [name,from,to] of ACCEPTANCE_PHASES){if(!byType.has(from)||!byType.has(to))throw new AcceptanceReportError(`outcome #${row.issue} is missing ${from} or ${to}`);phases[name]=minutes(byType.get(from).timestamp,byType.get(to).timestamp)}
    const requestToLive=minutes(byType.get('entered').timestamp,byType.get('live_verified').timestamp)
    const dispatchTarget=row.service_class==='urgent-application'?10:60
    if(phases.request_to_dispatch>dispatchTarget)throw new AcceptanceReportError(`outcome #${row.issue} missed its ${dispatchTarget}-minute dispatch target`)
    const waits={owner:0,external:0}
    for(const wait of row.waits??[]){if(!['owner','external'].includes(wait.kind))throw new AcceptanceReportError(`outcome #${row.issue} has an unknown wait kind`);waits[wait.kind]+=minutes(wait.started_at,wait.ended_at)}
    return{cohort_index:index+1,issue:row.issue,service_class:row.service_class,state:'live_verified',lifecycle_identity:identity,phase_minutes:phases,wait_minutes:waits,request_to_live_minutes:requestToLive,exceptions:[...(row.exceptions??[])]}
  })
  if(!Array.isArray(refusal_evidence)||!refusal_evidence.length||refusal_evidence.some((row)=>row?.result!=='refused'||!Number.isInteger(row?.work_issue)||row.work_issue<1||!SHA.test(row?.head_sha??'')||!EVENT_ID.test(row?.event_id??'')||!EVIDENCE.test(row?.evidence??'')||!DIGEST.test(row?.evidence_digest??'')))throw new AcceptanceReportError('durable issue/head/digest-bound refusal-preservation evidence is required')
  if(refusal_evidence.some((row)=>row.evidence_digest!==boundDigest(row,['result','work_issue','event_id','head_sha','evidence'])))throw new AcceptanceReportError('refusal evidence digest is not bound to its exact refused issue, event, head, and evidence')
  validateRefusalLedger(refusal_ledger,refusal_evidence,io)
  const currentSamples=rows.map((row)=>row.request_to_live_minutes),currentMedian=median(currentSamples),improvement=(baselineMedian-currentMedian)/baselineMedian
  if(improvement<0.5)throw new AcceptanceReportError(`median request-to-live improvement is ${(improvement*100).toFixed(1)}%, below 50%`)
  return{schema_version:1,status:'accepted',cohort:{...cohortIdentity,cohort_digest:cohort.cohort_digest},sample:{n:rows.length,issues:cohort.ordered_work_issues},baseline:{n:baseline.n,samples:[...baseline.samples],median_request_to_live_minutes:baselineMedian},current:{n:rows.length,samples:currentSamples,median_request_to_live_minutes:currentMedian,improvement_percent:Number((improvement*100).toFixed(1))},outcomes:rows,refusal_evidence,exceptions:rows.flatMap((row)=>row.exceptions.map((value)=>({issue:row.issue,detail:value})))}
}

export function main(argv,{artifactRoot=process.env.DB_ACCEPTANCE_ARTIFACT_ROOT}={}){if(argv.length!==2||argv[0]!=='--input'||!argv[1]){console.error('REFUSED: exactly --input <five-outcome.json> is required; cohort and refusal paths come only from the trusted artifact store');return 2}try{console.log(JSON.stringify(buildFiveOutcomeAcceptanceReport(JSON.parse(readFileSync(argv[1],'utf8')),trustedArtifactReaders(artifactRoot)),null,2));return 0}catch(error){console.error(`REFUSED: ${error.message}`);return 2}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=main(process.argv.slice(2))
