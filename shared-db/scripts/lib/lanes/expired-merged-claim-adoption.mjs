// #3618 owns this narrow operation and future consolidation into the canonical
// transfer module. Ordinary open-PR adoption remains unchanged in the manager.
import { isDeepStrictEqual } from 'node:util'
import { LaneError, parseAuthorLease, validateClaimObjects, assertLaneAvailable } from './claims.mjs'
import { WORKTREE_STATES, MUTEX_REF, MAX_AUTHOR_LEASE_HOURS } from './constants.mjs'
import { EXCLUSIVE_REFS } from './queue-routing.mjs'
import { normalizeWorktreePath } from './claim-versions.mjs'
import { workstreamKey, migrationVersions, renewalIssueScope, assertMergeCommitInMainHistory, observedWorktreeState, requireDereferenceableRecoveryArtifact, replaceLeaseLocation, replaceLeaseExpiry, replaceCapacityState } from './claim-maintenance.mjs'
import { assertClaimNotRetired, assertRetirementIdentityAvailable } from './retirement.mjs'
import { acquireMutex, requireOwnedRef, releaseOwnedRef, readRefAfterWrite } from './holds-and-refs.mjs'
import { normalizeObject } from '../../check-dispatch-collision.mjs'
import { canonicalJson, sha256 } from '../../orchestrator-flow/evidence-bundle.mjs'
import { githubIo, assertAbandonmentEvidence } from '../../manage-migration-author-lanes.mjs'

export const MERGED_ADOPTION_REF_PREFIX='refs/db-merged-claim-author-adoptions/'
const PREFIX='db-coordination expired-merged-claim-author-adoption '
const SHA=/^[0-9a-f]{40}$/
const refuse=message=>{throw new LaneError(`expired merged adoption refused: ${message}`)}
const REQUEST_KEYS=['issue','claim','pr','headSha','oldOwner','newOwner','branch','worktree','targetWorktree','abandonmentIssue','worktreeState','authorizationChatId','authorizationQuote','recoveryArtifact','leaseHours']
export function validateMergedAdoptionRequest(options){
  const request=Object.fromEntries(REQUEST_KEYS.map(key=>[key,options[key]??(key==='recoveryArtifact'?'':undefined)]))
  for(const key of ['issue','claim','pr','abandonmentIssue'])if(!Number.isSafeInteger(request[key])||request[key]<=0)refuse(`exact positive ${key} required`)
  for(const key of ['oldOwner','newOwner','branch','worktree','targetWorktree','authorizationChatId','authorizationQuote'])if(typeof request[key]!=='string'||!request[key]||request[key]!==request[key].trim()||/[\r\n`]/.test(request[key]))refuse(`invalid ${key}`)
  if(!SHA.test(request.headSha)||request.oldOwner===request.newOwner||/\s/.test(request.branch)||normalizeWorktreePath(request.worktree)===normalizeWorktreePath(request.targetWorktree)||!WORKTREE_STATES.includes(request.worktreeState)||typeof request.recoveryArtifact!=='string'||request.authorizationQuote.length<20||!Number.isFinite(request.leaseHours)||request.leaseHours<=0||request.leaseHours>MAX_AUTHOR_LEASE_HOURS)refuse('exact source, distinct successor, preservation state, quote and bounded lease required')
  return request
}
function adoptionBody(body,request,expiresAt){
  const fences=[...String(body).matchAll(/```db-author-lease\s*\n([\s\S]*?)```/g)]
  if(fences.length!==1||(fences[0][1].match(/^owner:/gm)??[]).length!==1)refuse('exact single author lease required')
  const changed=body.slice(0,fences[0].index)+fences[0][0].replace(fences[0][1],()=>fences[0][1].replace(/^owner:.*$/m,`owner: ${request.newOwner}`))+body.slice(fences[0].index+fences[0][0].length)
  return replaceLeaseExpiry(replaceLeaseLocation(replaceCapacityState(changed,'active'),request.branch,request.targetWorktree),expiresAt)
}
function readReceipt(ref,request,io){
  const sha=io.readRef(ref)
  if(!sha)return null
  const message=String(io.getCommit(sha)?.message??'')
  let record
  try{if(!message.startsWith(PREFIX))throw Error();record=JSON.parse(message.slice(PREFIX.length))}catch{refuse('immutable receipt unreadable')}
  const fields=['schema_version','kind','human_identity_authenticated','request','version','source_merge_sha','main_sha','reservation_sha','original_body_sha256','adopted_body_sha256','created_at']
  if(!record||Array.isArray(record)||Object.keys(record).length!==fields.length||fields.some(key=>!Object.hasOwn(record,key))||record.schema_version!==1||record.kind!=='expired-merged-operator-adoption'||record.human_identity_authenticated!==false||!isDeepStrictEqual(record.request,request)||!/^\d{14}$/.test(record.version)||!['source_merge_sha','main_sha','reservation_sha'].every(key=>SHA.test(record[key]))||!['original_body_sha256','adopted_body_sha256'].every(key=>/^[0-9a-f]{64}$/.test(record[key]))||!Number.isFinite(Date.parse(record.created_at)))refuse('immutable receipt differs from exact request or has invalid fields')
  return {sha,record}
}
export function proveExpiredMergedAdoption(request,now,io,prior=null){
  const claim=io.getIssue(request.claim),lease=parseAuthorLease(claim?.body??'',now)
  const adopted=Boolean(prior)&&lease.owner===request.newOwner&&lease.worktree===request.targetWorktree
  if(claim?.state!=='open'||workstreamKey(claim.title)!==`#${request.issue}`||lease.legacy||lease.branch!==request.branch||(!adopted&&(lease.owner!==request.oldOwner||lease.worktree!==request.worktree||lease.capacityState!=='expired-unconfirmed')))refuse('exact expired-unconfirmed old-author claim required; active and relinquished leases refuse')
  if(prior&&(lease.version!==prior.record.version||sha256(claim.body)!==(adopted?prior.record.adopted_body_sha256:prior.record.original_body_sha256)))refuse('claim body changed from immutable receipt')
  assertClaimNotRetired(lease.version,'adopted',io)
  renewalIssueScope(io.getIssue(request.issue),lease,[request.issue],{allowClaimSuperset:true})
  const authority=io.orchestratorFlowAdapter().resolveMarker()
  if(!authority?.live||authority.task!==request.authorizationChatId||authority.calling_task!==authority.task)refuse('current declared session and authorization chat must agree')
  if(!adopted){
    const abandonmentAudit=assertAbandonmentEvidence({claim:request.claim,blockedOn:`issue:#${request.abandonmentIssue}`,worktreeState:request.worktreeState},lease,`issue:#${request.abandonmentIssue}`,io)
    if(!abandonmentAudit)refuse('exact abandonment audit proof is absent')
    const observed=observedWorktreeState(request.worktree,io)
    if(observed!==request.worktreeState&&!(observed==='absent'&&request.worktreeState==='remote'))refuse('old worktree differs from preservation declaration')
  }
  if(request.worktreeState!=='clean')requireDereferenceableRecoveryArtifact(request.recoveryArtifact,io)
  const pr=io.getPr(request.pr),mergeSha=String(pr?.merge_commit_sha??'')
  if(!(pr?.merged===true||pr?.merged_at)&&String(pr?.state).toLowerCase()!=='merged')refuse('exact merged source PR required')
  if(!SHA.test(mergeSha)||pr?.head?.sha!==request.headSha||pr?.head?.ref!==request.branch)refuse('merged source head, branch or merge commit changed')
  const mainSha=io.mainSha()
  if(!SHA.test(mainSha??''))refuse('exact current main required')
  assertMergeCommitInMainHistory(mergeSha,mainSha,io)
  if(prior){if(prior.record.source_merge_sha!==mergeSha)refuse('immutable source merge changed');assertMergeCommitInMainHistory(prior.record.main_sha,mainSha,io)}
  const versions=migrationVersions(io.getPrFiles(request.pr))
  if(versions.length!==1||versions[0]!==lease.version)refuse('source migration does not match permanent version')
  // Canonical exact-head parser exists on main; merged sources are never
  // injected into the open-PR roster or represented as OPEN.
  const objects=io.prStructuralObjects(request.pr,request.headSha)
  if(!Array.isArray(objects)||objects.length===0)refuse('source parser object evidence absent')
  const held=new Set(lease.objects.map(normalizeObject))
  if(validateClaimObjects(objects).some(object=>!held.has(object)))refuse('source writes outside claimed objects')
  const claims=io.openClaims(),self=claims.filter(row=>Number(row.number)===request.claim)
  if(self.length!==1||self[0].body!==claim.body)refuse('claim changed in open roster')
  if(claims.some(row=>Number(row.number)!==request.claim&&normalizeWorktreePath(parseAuthorLease(row.body,now).worktree)===normalizeWorktreePath(request.targetWorktree)))refuse('successor worktree belongs to another claim')
  assertRetirementIdentityAvailable({branch:'',worktree:request.targetWorktree},io)
  assertLaneAvailable(claims.filter(row=>Number(row.number)!==request.claim),lease.objects,now,{prSources:io.prSources()})
  const reservationSha=io.readRef(`refs/db-claims/${lease.version}`)
  if(!SHA.test(reservationSha??'')||!io.getCommit(reservationSha)||prior&&prior.record.reservation_sha!==reservationSha)refuse('permanent version reservation absent or changed')
  for(const [kind,ref]of Object.entries(EXCLUSIVE_REFS))if(io.readRef(ref))refuse(`${kind} stage is held`)
  if(!io.localClean(request.targetWorktree)||io.localHead(request.targetWorktree)!==request.headSha||io.localBranch(request.targetWorktree)!==request.branch)refuse('successor worktree must be clean at exact source head and branch')
  return {claim,lease,adopted,mergeSha,mainSha,reservationSha}
}
export function transferExpiredMergedClaimAuthor(options,now=new Date(),io=githubIo){
  const request=validateMergedAdoptionRequest(options)
  if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))refuse('valid operation clock required')
  const ref=MERGED_ADOPTION_REF_PREFIX+request.claim+'-'+sha256(canonicalJson(request)).slice(0,24)
  const mutex=io.makeOwnerCommit(`db-coordination expired-merged-adoption-mutex claim=${request.claim}`)
  acquireMutex(mutex,io)
  let before=null,changed=false,created=false,receiptSha=null
  try{
    const prior=readReceipt(ref,request,io),proof=proveExpiredMergedAdoption(request,now,io,prior)
    if(proof.adopted)return {claim:request.claim,version:proof.lease.version,owner:request.newOwner,worktree:request.targetWorktree,ref,sha:prior.sha,idempotent:true}
    before=proof.claim.body
    const createdAt=prior?.record.created_at??now.toISOString(),after=adoptionBody(before,request,new Date(Date.parse(createdAt)+request.leaseHours*3600000))
    const record={schema_version:1,kind:'expired-merged-operator-adoption',human_identity_authenticated:false,request,version:proof.lease.version,source_merge_sha:proof.mergeSha,main_sha:prior?.record.main_sha??proof.mainSha,reservation_sha:proof.reservationSha,original_body_sha256:sha256(before),adopted_body_sha256:sha256(after),created_at:createdAt}
    if(prior&&!isDeepStrictEqual(record,prior.record))refuse('immutable receipt differs from current proof')
    receiptSha=prior?.sha
    if(!receiptSha){receiptSha=io.makeOwnerCommit(PREFIX+JSON.stringify(record));if(!io.createRef(ref,receiptSha))refuse('immutable receipt creation failed');created=true;if(readRefAfterWrite(ref,receiptSha,io)!==receiptSha)refuse('immutable receipt readback failed')}
    requireOwnedRef(MUTEX_REF,mutex,io)
    // Reprove after receipt I/O: a renewed old lease, moving main/source,
    // newly held stage or foreign object claim cannot race the author change.
    const fresh=proveExpiredMergedAdoption(request,now,io,{sha:receiptSha,record})
    if(fresh.adopted||fresh.claim.body!==before||fresh.mainSha!==proof.mainSha)refuse('claim or main moved before mutation')
    changed=true;io.updateIssue(request.claim,{body:after})
    if(io.getIssue(request.claim)?.body!==after)refuse('claim readback failed')
    if(io.readRef(`refs/db-claims/${proof.lease.version}`)!==proof.reservationSha||!io.getCommit(proof.reservationSha))refuse('permanent reservation changed after adoption')
    requireOwnedRef(MUTEX_REF,mutex,io)
    return {claim:request.claim,version:proof.lease.version,owner:request.newOwner,worktree:request.targetWorktree,ref,sha:receiptSha,idempotent:false}
  }catch(error){
    if(io.readRef(MUTEX_REF)!==mutex)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
    const failures=[]
    if(changed)try{io.updateIssue(request.claim,{body:before});if(io.getIssue(request.claim)?.body!==before)throw Error('claim rollback readback failed')}catch(e){failures.push(e.message)}
    if(created&&/receipt readback failed|could not be read back/.test(error.message))try{if(io.readRef(ref)===receiptSha)releaseOwnedRef(ref,receiptSha,io)}catch(e){failures.push(e.message)}
    if(failures.length)throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${failures.join('; ')}`)
    throw error
  }finally{if(io.readRef(MUTEX_REF)===mutex)releaseOwnedRef(MUTEX_REF,mutex,io)}
}
