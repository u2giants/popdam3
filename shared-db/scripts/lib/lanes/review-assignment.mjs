// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { LaneError } from './claims.mjs'
import { MUTEX_REF, REVIEW_ASSIGNMENT_REF_PREFIX, REVIEW_QUEUE_REF_PREFIX, REVIEW_QUEUE_TTL_HOURS, REVIEW_REPLACEMENT_REF_PREFIX } from './constants.mjs'
import { parseAssignmentRef, parseReviewCursor, readReviewReturns } from './review-records.mjs'
import { assertReviewerAllowlistConsistency } from './reviewer-roster.mjs'
import { reviewLeaseAgeHours } from './review-leases.mjs'
import { releaseOwnedRef, requireOwnedRef } from './holds-and-refs.mjs'
import { assignNextReviewer, githubIo } from '../../manage-migration-author-lanes.mjs'

// One shared set of namespace listings resolves slot 1 (fail-fast + allowlist
// for slot 2+) AND every other live peer slot for this exact head. Combining
// the two reads keeps the 25-request wire budget: the assignment and
// replacement listings are paid once and answer both questions. This is the
// symmetry fix for #3427 -- previously slot 2's fill skipped higher peers and
// a draw order like 1→3→2 could duplicate a provider.
export function resolvePeerSlots(issue,pr,headSha,slot,io){
  const head=String(headSha).toLowerCase()
  const requesting=Number(slot)
  if(!Number.isInteger(requesting)||requesting<1)throw new LaneError('review assignment slot must be a positive integer')
  const assignmentBase=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${Number(issue)}-${Number(pr)}-${head}`
  const replacementBase=`${REVIEW_REPLACEMENT_REF_PREFIX}/${Number(issue)}-${Number(pr)}-${head}`
  // The first slot-one replacement writer used this exact unsuffixed ref.
  // Other consumers intentionally keep the shared parser strict, so only this
  // peer resolver admits that legacy link into slot-one history.
  const namedPeerRef=(ref)=>parseAssignmentRef(ref)??(ref===replacementBase?{replacement:true,issue:Number(issue),pr:Number(pr),headSha:head,slot:1,replacementSequence:null}:null)
  const missingSlotOne=()=>new LaneError(`slot ${requesting} requires slot 1 to already be assigned for issue #${issue} PR #${pr} head ${head}. Run --assign-reviewer --issue ${issue} --pr ${pr} --head-sha ${head} (default --review-slot 1) first, then request --review-slot ${requesting}.`)
  const returned=new Set()
  const peers=new Map()
  let slotOne=null
  const slotOneHistory=[]
  const accept=(row,named,parsed)=>{
    if(!named||named.issue!==Number(issue)||named.pr!==Number(pr)||named.headSha!==head)return
    if(parsed.issue!==named.issue||parsed.pr!==named.pr||String(parsed.headSha).toLowerCase()!==named.headSha||(parsed.slot??1)!==named.slot)throw new LaneError(`other reviewer slot ${named.slot} has an invalid durable assignment`)
    if(named.slot===1){
      if(requesting===1)return
      slotOneHistory.push(parsed)
      const previous=slotOne&&slotOne.sequence
      if(!slotOne||parsed.sequence>previous)slotOne={...parsed,sha:row.sha}
      return
    }
    if(named.slot===requesting)return
    const previous=peers.get(named.slot)
    if(!previous||parsed.sequence>previous.sequence)peers.set(named.slot,{...parsed,sha:row.sha})
  }
  // Returns are only consulted when peer candidates exist. Slot 1's record is
  // not filtered by returns (matching slot 1's historical behaviour), and a
  // slot-2 draw with no higher peers pays no listing for them.
  const filterReturned=()=>{
    if(!peers.size)return
    for(const row of readReviewReturns(issue,pr,head,io))returned.add(row.assignmentSha)
    for(const [slotNum,record] of [...peers])if(returned.has(record.sha))peers.delete(slotNum)
  }
  if(typeof io.readReviewRecords==='function'){
    // The batched reader lists both namespaces and hydrates all matching
    // commits in one snapshot, regardless of how high the live slot number is.
    const probeRefs=[assignmentBase]
    const records=io.readReviewRecords(probeRefs,replacementBase,null,assignmentBase)
    for(const row of (records.matching??[])){
      const named=namedPeerRef(row.ref)
      if(!named||named.headSha!==head)continue
      if(named.slot===requesting&&!named.replacement)continue
      if(returned.has(row.sha))continue
      const parsed=parseReviewCursor(row.commit??io.getCommit(row.sha))
      accept(row,named,parsed)
    }
    for(const ref of probeRefs){
      const record=records.get(ref)
      if(!record?.sha)continue
      const named=parseAssignmentRef(ref)
      if(named?.slot===requesting)continue
      const parsed=parseReviewCursor(record.commit??io.getCommit(record.sha))
      accept({ref,sha:record.sha},named,parsed)
    }
    assertReviewerAllowlistConsistency(slotOneHistory)
    filterReturned()
    if(requesting>=2&&!slotOne)throw missingSlotOne()
    return {slotOne,peers}
  }
  if(typeof io.listRefs!=='function')throw new LaneError('peer review slot records cannot be listed; independent draw refused')
  const assignmentRows=io.listRefs(assignmentBase)
  for(const row of assignmentRows){
    const named=namedPeerRef(row.ref)
    if(named?.replacement||named?.slot===requesting)continue
    accept(row,named,parseReviewCursor(row.commit??io.getCommit(row.sha)))
  }
  const replacementRows=io.listRefs(replacementBase)
  for(const row of replacementRows){
    const named=namedPeerRef(row.ref)
    if(!named?.replacement)continue
    accept(row,named,parseReviewCursor(row.commit??io.getCommit(row.sha)))
  }
  assertReviewerAllowlistConsistency(slotOneHistory)
  filterReturned()
  if(requesting>=2&&!slotOne)throw missingSlotOne()
  return {slotOne,peers}
}

// AGENTS.md section 4 rule 2 is merge-first, so a migration reaching main and only
// THEN owing an exact-head approval is an expected state, not an anomaly (#1817:
// plm.wwe_* merged at 8d3c31a with no approval at that head, and assignment refused
// outright because the pull request was closed). A MERGED pull request whose merge
// commit is really in main is therefore an eligible assignment target.
//
// A closed-but-UNMERGED pull request stays refused: an abandoned branch has no claim
// on a reviewer's time, and nothing downstream will ever consume the verdict. Every
// other guard is unchanged -- the issue must still be open, the exact head SHA must
// still match, and an existing verdict for that head still refuses.
// The GraphQL projection readReviewStates hands to every post-mutex gate. Exported and
// kept separate from the query so it can be tested directly: it previously carried no
// merge SHA at all, which silently rejected every merged pull request after the mutex,
// and a hand-written fixture in the tests could not catch that.
export function projectReviewPr(pr){
  return {state:String(pr?.state??'').toLowerCase(),merged:pr?.merged===true,merge_commit_sha:pr?.mergeCommit?.oid??'',head:{sha:pr?.headRefOid}}
}

export function projectReviewerOperationRouteSnapshot(data){
  if(data?.errors?.length||!data?.data?.repository?.pullRequest)throw new LaneError('reviewer operation routing snapshot returned GraphQL errors or no pull request')
  const row=data.data.repository.pullRequest,files=row.files,linked=row.closingIssuesReferences
  if(!Array.isArray(files?.nodes)||files.pageInfo?.hasNextPage!==false||!Array.isArray(linked?.nodes)||linked.pageInfo?.hasNextPage!==false)throw new LaneError('reviewer operation routing snapshot is incomplete or paginated')
  return {
    pr:{state:String(row.state??'').toLowerCase(),merged_at:row.merged===true?row.mergedAt:null,head:{sha:row.headRefOid}},
    files:files.nodes.map((file)=>({filename:file?.path,status:String(file?.changeType??'').toLowerCase()})),
    linkedIssues:linked.nodes.map((item)=>({number:item?.number,state:String(item?.state??'').toLowerCase(),body:item?.body,createdAt:item?.createdAt})),
  }
}

export function completeReviewerOperationRouteSnapshot(data,readRestFiles){
  let snapshot=projectReviewerOperationRouteSnapshot(data)
  // GraphQL has no prior filename. A rename needs the complete REST inventory
  // before either side of its path can be classified under the reviewer mutex.
  // The REST read is gated on GraphQL reporting a rename. A file GraphQL reports
  // as ADDED/MODIFIED is routed exactly as it was before rename support existed,
  // so this gate adds no new trust: it only lets a GraphQL-reported rename use
  // the maintenance route once REST proves both of its paths are non-migration.
  if(snapshot.files.some((file)=>file.status==='renamed'))snapshot=reconcileReviewerOperationRouteFiles(snapshot,readRestFiles())
  return snapshot
}

export function reconcileReviewerOperationRouteFiles(snapshot,restFiles){
  if(!Array.isArray(snapshot?.files)||!Array.isArray(restFiles)||snapshot.files.length!==restFiles.length)throw new LaneError('reviewer rename routing GraphQL and REST file inventories disagree')
  const key=(file)=>{
    if(typeof file?.filename!=='string'||!file.filename.trim()||typeof file?.status!=='string'||!file.status.trim())throw new LaneError('reviewer rename routing file inventory is unreadable')
    const status=file.status.toLowerCase()==='deleted'?'removed':file.status.toLowerCase()
    return `${file.filename}\0${status}`
  }
  const graph=snapshot.files.map(key).sort(),rest=restFiles.map(key).sort()
  if(new Set(graph).size!==graph.length||new Set(rest).size!==rest.length||graph.some((value,index)=>value!==rest[index]))throw new LaneError('reviewer rename routing GraphQL and REST file inventories disagree')
  for(const file of restFiles)if(file.status.toLowerCase()==='renamed'&&(typeof file.previous_filename!=='string'||!file.previous_filename.trim()))throw new LaneError('reviewer rename routing prior filename is unreadable')
  return {...snapshot,files:restFiles.map(({filename,status,previous_filename})=>previous_filename===undefined?{filename,status}:{filename,status,previous_filename})}
}

// GitHub does not include repository association unless it is requested. The
// verdict predicate refuses association-less prose, so omitting this field here
// makes a genuine OWNER verdict invisible to normal reviewer-lease cleanup.
export function reviewStateGraphqlFields(lease,index){
  return `p${index}:pullRequest(number:${lease.pr}){state merged mergeCommit{oid} headRefOid comments(first:100){pageInfo{hasNextPage} nodes{body authorAssociation}} reviews(first:100){pageInfo{hasNextPage} nodes{body state authorAssociation commit{oid}}}} i${index}:issue(number:${lease.issue}){state comments(first:100){pageInfo{hasNextPage} nodes{body authorAssociation}}}`
}

export const MERGE_ANCESTRY_MEMO=new WeakMap()

// #2311. These refusals used to name three possible causes at once and leave the
// caller to guess which one fired; a closed work issue with an open PR read as a
// head change that had not happened. Report only what the already-fetched issue,
// PR and requested head prove. Never issue a fresh wire read from an error path:
// the request budget is fixed and a failing call would replace the real cause.
export function reviewEligibilityCause(request,issue,pr){
  const parts=[]
  const issueState=String(issue?.state??'unreadable'),prState=String(pr?.state??'unreadable')
  if(issueState!=='open'&&prState==='open')parts.push(`work issue #${request.issue} is ${issueState} while PR #${request.pr} is still open -- a reviewer needs an open work issue, or a pull request already merged into main. Reopen issue #${request.issue}, or merge the pull request first. If #${request.issue} is an orchestrator marker rather than the work issue, re-run with the work issue number`)
  else if(issueState!=='open')parts.push(`work issue #${request.issue} is ${issueState} and PR #${request.pr} (${prState}) is not proven merged into main`)
  const head=String(pr?.head?.sha??'')
  if(!head)parts.push(`PR #${request.pr} head could not be read`)
  else if(request.headSha&&head!==request.headSha)parts.push(`PR #${request.pr} head is now ${head}, not the requested ${request.headSha}`)
  if(!parts.length)parts.push(`the work issue is open and the head matches, so PR #${request.pr} (${prState}) failed the merge-eligibility check itself`)
  return ` -- ${parts.join('; ')}`
}

// #2311. A verdict refused because the reviewer's active lease points elsewhere
// used to name neither the lease it found nor the fix. Say what the lease holds.
export function reviewActiveLeaseCause(reviewer,activeSha,expected,io,activeRef=null){
  if(!activeSha)return ` -- reviewer ${reviewer} holds no active lease at all, so this verdict has nothing to record against; draw or replace the reviewer before recording a verdict`
  let held=`a different assignment (${activeSha})`
  try{
    const cursor=parseReviewCursor(io.getCommit(activeSha))
    held=`the assignment for issue #${cursor.issue}, PR #${cursor.pr}, head ${cursor.headSha}`
  }catch{/* an unreadable lease commit still names the SHA above */}
  return ` -- reviewer ${reviewer}'s active lease${activeRef?` (${activeRef})`:''} holds ${held}, but this verdict is for issue #${expected.issue}, PR #${expected.pr}, head ${expected.headSha}. Where the issue numbers differ you passed the wrong one: an orchestrator marker is not the work issue. Re-run against the issue the reviewer was actually assigned`
}

export function reviewerQueueRef(request){return `${REVIEW_QUEUE_REF_PREFIX}/${request.issue}-${request.pr}-${request.slot}`}
export function parseReviewerQueueTicket(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination reviewer-queue-ticket issue=(\d+) pr=(\d+) slot=(\d+) head=([0-9a-f]{7,40}) requested-at=([^ ]+)$/i.exec(message)
  if(!match)throw new LaneError('reviewer queue ticket is unreadable')
  return {issue:Number(match[1]),pr:Number(match[2]),slot:Number(match[3]),headSha:match[4],requestedAt:match[5]}
}

export function reviewerQueueTicketExpired(ticket,now){const age=reviewLeaseAgeHours(ticket?.requestedAt,now);return age!==null&&age>=REVIEW_QUEUE_TTL_HOURS}
export function liveReviewerQueue(io,now=new Date(),mutexOwnerSha=null){
  const reader=typeof io.listReviewRefsPaged==='function'?io.listReviewRefsPaged.bind(io):io.listRefs?.bind(io)
  const rows=typeof io.readReviewerQueue==='function'?io.readReviewerQueue():reader?.(REVIEW_QUEUE_REF_PREFIX)
  if(!rows)throw new LaneError('reviewer queue refs are unreadable')
  const live=[],expired=[]
  for(const row of rows){
    const ticket=row.ticket??parseReviewerQueueTicket(row.commit??io.getCommit(row.sha)),pr=row.pr??io.getPr(ticket.pr)
    if(reviewerQueueTicketExpired(ticket,now))expired.push({ref:row.ref,sha:row.sha})
    else if(pr?.state==='open'&&pr?.head?.sha===ticket.headSha)live.push({...ticket,ref:row.ref,sha:row.sha})
  }
  if(expired.length&&mutexOwnerSha&&typeof io.atomicReviewRefs==='function'&&typeof io.readReviewRefs==='function'){
    requireOwnedRef(MUTEX_REF,mutexOwnerSha,io)
    io.atomicReviewRefs([{ref:MUTEX_REF,expected:mutexOwnerSha,sha:mutexOwnerSha},...expired.map((row)=>({ref:row.ref,expected:row.sha,sha:null}))])
    const after=io.readReviewRefs([MUTEX_REF,...expired.map((row)=>row.ref)])
    if(after.get(MUTEX_REF)!==mutexOwnerSha||expired.some((row)=>after.get(row.ref)!==null))throw new LaneError('expired reviewer queue ticket evacuation readback mismatch')
  }else if(expired.length&&mutexOwnerSha){for(const row of expired)if(io.readRef(row.ref)===row.sha)releaseOwnedRef(row.ref,row.sha,io)}
  return live.sort((a,b)=>Date.parse(a.requestedAt)-Date.parse(b.requestedAt)||a.issue-b.issue||a.pr-b.pr||a.slot-b.slot)
}

export function finishReviewerQueueTurn(ticket,io){
  if(!ticket)return
  if(io.readRef(ticket.ref)===ticket.sha)releaseOwnedRef(ticket.ref,ticket.sha,io)
  if(io.readRef(ticket.ref)!==null)throw new LaneError('reviewer assignment succeeded but its queue ticket could not be cleared')
}

// The review mutex is shared with author acquisition and is held only for seconds.
// "is occupied" is thrown by createRef before any write, so the whole draw is safe
// to repeat; everything else propagates unchanged. Owner rate-limit rule
// (2026-09-11, marker #2758): lock-contention retries wait at least five minutes,
// so the default is one retry after five minutes plus jitter.
export const MUTEX_RETRY_WAIT_MS = 300000
export function assignWithMutexRetry(request,io=githubIo,{attempts=2,wait=(ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}){
  for(let attempt=1;;attempt++){
    try{return assignNextReviewer(request,io)}
    catch(error){
      if(attempt>=attempts||error?.message!==`${MUTEX_REF} is occupied`)throw error
      wait(MUTEX_RETRY_WAIT_MS+Math.floor(Math.random()*30000))
    }
  }
}
