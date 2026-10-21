#!/usr/bin/env node
// #3618: preserve-only bridge into the existing expired-author transfer route.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { githubIo, assertAbandonmentEvidence } from './manage-migration-author-lanes.mjs'
import { parseAuthorLease, validateClaimObjects, assertLaneAvailable, LaneError } from './lib/lanes/claims.mjs'
import { workstreamKey, migrationVersions, renewalIssueScope, observedWorktreeState, requireDereferenceableRecoveryArtifact } from './lib/lanes/claim-maintenance.mjs'
import { assertClaimNotRetired } from './lib/lanes/retirement.mjs'
import { MUTEX_REF } from './lib/lanes/constants.mjs'
import { EXCLUSIVE_REFS, parseQueueScope } from './lib/lanes/queue-routing.mjs'
import { acquireMutex, requireOwnedRef, releaseMutexOnExit, readRefAfterWrite } from './lib/lanes/holds-and-refs.mjs'
import { normalizeObject } from './check-dispatch-collision.mjs'
import { canonicalJson, sha256 } from './db-flow/evidence-bundle.mjs'

export const BLOCKER_REBIND_REF_PREFIX='refs/db-expired-claim-blocker-rebindings/'
const PREFIX='db-coordination expired-claim-blocker-rebind '
const SHA=/^[0-9a-f]{40}$/
const KEYS=['issue','claim','pr','headSha','oldOwner','branch','worktree','expectedBlockedOn','abandonmentIssue','authorizationChatId','authorizationQuote']
const fail=message=>{throw new LaneError(`expired blocker rebind refused: ${message}`)}
export function validateRequest(options){
  if(!options||Object.keys(options).some(key=>!KEYS.includes(key)))fail('unknown request field')
  const request=Object.fromEntries(KEYS.map(key=>[key,options[key]]))
  for(const key of ['issue','claim','pr','abandonmentIssue'])if(!Number.isSafeInteger(request[key])||request[key]<=0)fail(`exact positive ${key} required`)
  for(const key of KEYS.filter(key=>!['issue','claim','pr','abandonmentIssue'].includes(key)))if(typeof request[key]!=='string'||!request[key]||request[key]!==request[key].trim()||/[\r\n`]/.test(request[key]))fail(`invalid ${key}`)
  const checkpoint=`artifact:${request.headSha}`
  const workIssueBlocker=/^issue:#\d+$/.test(request.expectedBlockedOn)
  if(!SHA.test(request.headSha)||/\s/.test(request.branch)||request.authorizationQuote.length<20||(request.expectedBlockedOn!==checkpoint&&!workIssueBlocker))fail('exact source checkpoint or work-issue blocker, and current-chat quote required')
  return request
}
function reboundBody(body,request){
  const fences=[...body.matchAll(/```db-author-lease\s*\n([\s\S]*?)```/g)]
  if(fences.length!==1||(fences[0][1].match(/^blocked_on:/gm)??[]).length!==1)fail('single exact lease blocker required')
  const fence=fences[0],block=fence[1],changed=block.replace(/^blocked_on:.*$/m,`blocked_on: issue:#${request.abandonmentIssue}`)
  return body.slice(0,fence.index)+fence[0].replace(block,()=>changed)+body.slice(fence.index+fence[0].length)
}
function receipt(ref,request,io){
  const sha=io.readRef(ref);if(!sha)return null
  let record
  try{const message=String(io.getCommit(sha)?.message??'');if(!message.startsWith(PREFIX))throw Error();record=JSON.parse(message.slice(PREFIX.length))}catch{fail('immutable receipt unreadable')}
  const fields=['schema_version','human_identity_authenticated','request','original_body_sha256','rebound_body_sha256','audit_body_sha256','version','reservation_sha','main_sha','created_at']
  if(!record||Array.isArray(record)||Object.keys(record).length!==fields.length||fields.some(key=>!Object.hasOwn(record,key))||record.schema_version!==1||record.human_identity_authenticated!==false||!isDeepStrictEqual(record.request,request)||!/^\d{14}$/.test(record.version)||!SHA.test(record.reservation_sha)||!SHA.test(record.main_sha)||!Number.isFinite(Date.parse(record.created_at))||!['original_body_sha256','rebound_body_sha256','audit_body_sha256'].every(key=>/^[0-9a-f]{64}$/.test(record[key])))fail('immutable receipt differs or has invalid fields')
  return {sha,record}
}
function prove(request,now,io,prior=null){
  const claim=io.getIssue(request.claim)
  if((claim?.body?.match(/```db-author-lease\s*\n/g)??[]).length!==1)fail('exact single author lease required')
  const lease=parseAuthorLease(claim?.body??'',now)
  const rebound=Boolean(prior)&&lease.blockedOn===`issue:#${request.abandonmentIssue}`
  const checkpoint=`artifact:${request.headSha}`
  // #3618 preserved-checkpoint recovery: a worker may leave a dirty claim whose
  // source was later published as a clean preservation commit at the exact PR
  // head. Dirty is then qualified by that published head, not by a local clean
  // re-observation. Clean claims keep the original same-machine custody check.
  const declaredClean=lease.worktreeState==='clean'
  const declaredDirty=lease.worktreeState==='dirty'
  if(claim?.state!=='open'||workstreamKey(claim.title)!==`#${request.issue}`||lease.legacy||lease.capacityState!=='relinquished'||lease.active||lease.relinquishmentMetadataLegacy||lease.owner!==request.oldOwner||lease.branch!==request.branch||lease.worktree!==request.worktree||!(declaredClean||declaredDirty)||lease.blockedOn!==(rebound?`issue:#${request.abandonmentIssue}`:request.expectedBlockedOn))fail('exact expired relinquished original lease required')
  if(lease.recoveryArtifact&&lease.recoveryArtifact!==checkpoint&&lease.recoveryArtifact!==request.expectedBlockedOn)fail('preserved recovery must be the source checkpoint or the recorded blocker')
  if(prior&&(lease.version!==prior.record.version||sha256(claim.body)!==(rebound?prior.record.rebound_body_sha256:prior.record.original_body_sha256)))fail('claim body differs from immutable receipt')
  assertClaimNotRetired(lease.version,'rebound',io)
  renewalIssueScope(io.getIssue(request.issue),lease,[request.issue],{allowClaimSuperset:true})
  const authority=io.flowAdapter().resolveMarker()
  if(!authority?.live||authority.task!==request.authorizationChatId||authority.calling_task!==authority.task)fail('actual current session and quote must agree')
  const audit=io.getIssue(request.abandonmentIssue),scope=parseQueueScope(audit?.body??'')
  if(scope?.workType!=='repo-maintenance'||scope.status!=='ready'||scope.route!=='repo-maintenance'||scope.writes.length||scope.reads.length)fail('audit must be ready repository maintenance without database claims')
  if((audit?.body?.match(/```abandonment-audit\s*\n/g)??[]).length!==1)fail('exact single abandonment audit required')
  if(!assertAbandonmentEvidence({claim:request.claim,worktreeState:'clean'},lease,`issue:#${request.abandonmentIssue}`,io))fail('exact abandonment audit proof absent')
  const auditHash=sha256(audit.body)
  if(prior&&auditHash!==prior.record.audit_body_sha256)fail('audit body differs from immutable receipt')
  if(declaredClean){
    if(observedWorktreeState(request.worktree,io)!=='clean'||!io.localClean(request.worktree)||io.localHead(request.worktree)!==request.headSha||io.localBranch(request.worktree)!==request.branch)fail('original clean source custody changed')
  }
  // Dirty declared custody is qualified by the published open PR at the exact
  // preservation head (proved below), not by a same-machine clean re-read.
  if(lease.recoveryArtifact)requireDereferenceableRecoveryArtifact(lease.recoveryArtifact,io)
  const pr=io.getPr(request.pr)
  if(pr?.state!=='open'||pr.head?.sha!==request.headSha||pr.head?.ref!==request.branch)fail('exact open source changed')
  const versions=migrationVersions(io.getPrFiles(request.pr))
  if(versions.length!==1||versions[0]!==lease.version)fail('permanent source version changed')
  const sources=io.prSources(),self=sources.filter(source=>new RegExp(`^PR #${request.pr}(?:\\s|$)`).test(source.label))
  if(self.length!==1||self[0].branch!==request.branch||self[0].versions?.length!==1||self[0].versions[0]!==lease.version||!self[0].objects?.length)fail('exact source parser evidence absent')
  const held=new Set(lease.objects.map(normalizeObject))
  if(validateClaimObjects(self[0].objects).some(object=>!held.has(object)))fail('source writes outside protected claim')
  const claims=io.openClaims(),matches=claims.filter(row=>Number(row.number)===request.claim)
  if(matches.length!==1||matches[0].body!==claim.body)fail('claim changed in open roster')
  assertLaneAvailable(claims.filter(row=>Number(row.number)!==request.claim),lease.objects,now,{prSources:sources.filter(source=>source!==self[0])})
  const reservationSha=io.readRef(`refs/db-claims/${lease.version}`),mainSha=io.mainSha()
  if(!SHA.test(reservationSha??'')||!io.getCommit(reservationSha)||!SHA.test(mainSha??'')||prior&&reservationSha!==prior.record.reservation_sha)fail('permanent reservation or current main unreadable/changed')
  if(!SHA.test(pr.base?.sha??''))fail('source base unreadable')
  for(const base of [pr.base.sha,...(prior?[prior.record.main_sha]:[])]){
    const comparison=io.compareCommits(base,mainSha)
    if(!comparison||!['ahead','identical'].includes(comparison.status)||comparison.behind_by!==0)fail('source or receipt main is not in current main history')
  }
  for(const [kind,ref]of Object.entries(EXCLUSIVE_REFS))if(io.readRef(ref))fail(`${kind} stage held`)
  return {claim,lease,rebound,auditHash,reservationSha,mainSha}
}
export function rebindExpiredClaimBlocker(options,now=new Date(),io=githubIo){
  const request=validateRequest(options)
  if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))fail('valid operation clock required')
  // Read-only qualification prevents an ineligible lease from creating even a mutex commit.
  const ref=BLOCKER_REBIND_REF_PREFIX+request.claim+'-'+sha256(canonicalJson(request)).slice(0,24)
  prove(request,now,io,receipt(ref,request,io))
  const mutex=io.makeOwnerCommit(`db-coordination claim-author-transfer-mutex claim=${request.claim} operation=expired-blocker-rebind`)
  acquireMutex(mutex,io)
  let before=null,after=null,receiptSha=null,changed=false,completed=null,failure=null
  const mutationEvidence=()=>{
    let observed='not-attempted'
    if(changed){try{const body=io.getIssue(request.claim)?.body;observed=body===after?'rebound':body===before?'original':'other'}catch{observed='unreadable'}}
    return {claim:request.claim,mutation_attempted:changed,observed_state:observed,ref,receipt_sha:receiptSha,original_body_sha256:before?sha256(before):null,expected_body_sha256:after?sha256(after):null}
  }
  try{
    const prior=receipt(ref,request,io),proof=prove(request,now,io,prior)
    if(proof.rebound){completed={claim:request.claim,version:proof.lease.version,ref,sha:prior.sha,idempotent:true};return completed}
    before=proof.claim.body
    after=reboundBody(before,request)
    const record={schema_version:1,human_identity_authenticated:false,request,original_body_sha256:sha256(before),rebound_body_sha256:sha256(after),audit_body_sha256:proof.auditHash,version:proof.lease.version,reservation_sha:proof.reservationSha,main_sha:prior?.record.main_sha??proof.mainSha,created_at:prior?.record.created_at??now.toISOString()}
    if(prior&&!isDeepStrictEqual(prior.record,record))fail('receipt differs from current exact proof')
    let sha=prior?.sha;receiptSha=sha??null
    if(!sha){sha=io.makeOwnerCommit(PREFIX+JSON.stringify(record));receiptSha=sha;if(!io.createRef(ref,sha))fail('create-only receipt failed');if(readRefAfterWrite(ref,sha,io)!==sha)fail('receipt readback failed')}
    requireOwnedRef(MUTEX_REF,mutex,io)
    const fresh=prove(request,now,io,{sha,record})
    if(fresh.rebound||fresh.claim.body!==before||fresh.mainSha!==proof.mainSha)fail('claim or main moved before mutation')
    changed=true;io.updateIssue(request.claim,{body:after})
    if(io.getIssue(request.claim)?.body!==after)fail('exact one-field claim readback failed')
    prove(request,now,io,{sha,record})
    requireOwnedRef(MUTEX_REF,mutex,io)
    completed={claim:request.claim,version:proof.lease.version,ref,sha,idempotent:false};return completed
  }catch(error){
    failure=error
    let owner
    try{owner=io.readRef(MUTEX_REF)}catch(readError){
      const evidence=mutationEvidence()
      failure=new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership is unknown (${readError.message}); MUTATION_EVIDENCE ${JSON.stringify(evidence)}`)
      failure.mutationEvidence=evidence;throw failure
    }
    if(owner!==mutex){const evidence=mutationEvidence();failure=new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost; MUTATION_EVIDENCE ${JSON.stringify(evidence)}`);failure.mutationEvidence=evidence;throw failure}
    if(changed){try{io.updateIssue(request.claim,{body:before});if(io.getIssue(request.claim)?.body!==before)throw Error('exact rollback readback failed')}catch(rollback){failure=new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${rollback.message}`);throw failure}}
    throw error
  }finally{
    try{releaseMutexOnExit(mutex,io)}catch(cleanup){
      const error=new LaneError(`${failure?failure.message+'; ':''}${cleanup.message}${completed?'; OPERATION_COMPLETED '+JSON.stringify(completed):''}`)
      if(completed)error.completedResult=completed
      if(failure?.mutationEvidence)error.mutationEvidence=failure.mutationEvidence
      throw error
    }
  }
}
const FLAGS={'--issue':'issue','--claim-number':'claim','--pr':'pr','--head-sha':'headSha','--old-owner':'oldOwner','--branch':'branch','--worktree':'worktree','--expected-blocked-on':'expectedBlockedOn','--abandonment-issue':'abandonmentIssue','--authorization-chat-id':'authorizationChatId','--authorization-quote-file':'quoteFile'}
export function parseArgs(argv){
  const out={}
  for(let i=0;i<argv.length;i+=2){const key=FLAGS[argv[i]],value=argv[i+1];if(!key||Object.hasOwn(out,key)||!value||value.startsWith('--'))fail('unknown, duplicate or missing argument');out[key]=value}
  if(!out.quoteFile)fail('quote file required')
  out.authorizationQuote=readFileSync(out.quoteFile,'utf8').trim();delete out.quoteFile
  for(const key of ['issue','claim','pr','abandonmentIssue'])out[key]=Number(out[key])
  return validateRequest(out)
}
export function main(argv,now=new Date(),io,output=console){
  try{output.log(JSON.stringify(rebindExpiredClaimBlocker(parseArgs(argv),now,io)));return 0}catch(error){output.error(error.message);return 1}
}
if(process.argv[1]&&path.resolve(fileURLToPath(import.meta.url))===path.resolve(process.argv[1]))process.exitCode=main(process.argv.slice(2))
