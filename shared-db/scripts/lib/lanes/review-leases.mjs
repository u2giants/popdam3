// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { REVIEW_VERDICT_REF_PREFIX, REVIEW_VERDICT_REPLACEMENT_REF_PREFIX, parseVerdictRef } from '../../lib/review-verdict-artifact.mjs'
import { REVIEW_ACTIVE_CUTOVER_REF, REVIEW_ACTIVE_PARALLEL_REF_PREFIX, REVIEW_LEASE_SUSPECT_HOURS, REVIEW_SILENCE_PROBE_REF_PREFIX, REVIEW_SILENCE_RELEASE_REF_PREFIX, SILENCE_CONFIRM_HOURS, SILENCE_MIN_AGE_HOURS, isLeaseReadFailure, isReviewRefListingRefusal, leaseReadFailureError, reviewStartMarkerPresent } from './constants.mjs'
import { LaneError } from './claims.mjs'
import { reviewTargetIsRecordable } from './admission.mjs'
import { ACTIVE_REVIEWERS, OVERFLOW_REVIEWERS, REVIEWERS, allocatableReviewers } from './reviewer-roster.mjs'
import { parseReviewLease, resolveAssignmentLeaseRef, reviewActiveRef, reviewLeaseIdentity, reviewLeaseRefForAssignment } from './review-records.mjs'
import { hasVerdictForHead, leaseVerdictOptions } from './review-approval.mjs'
import { resolveFailedReviewRecord } from './review-replacement.mjs'
import { liveReviewerQueue } from './review-assignment.mjs'
import { activityFingerprintForLease } from '../../manage-migration-author-lanes.mjs'
import { orderedReviewers } from './reviewer-roster.mjs'

// WHICH REVIEWERS HOLD LIVE REVIEW LEASES IN THIS REPOSITORY RIGHT NOW.
//
// This is a REPORT, not a capacity gate. Owner ruling 2026-09-16: one reviewer
// may run any number of reviews at once, so the production draw
// (`requiresExactReviewHeadSha`, one lease ref per exact review) never skips a
// provider because it appears here. The set feeds stale-lease release, silence
// and start watches, and the capacity report. Only the legacy short-head fixture
// protocol, which stores one lease ref per reviewer and so physically cannot
// hold two, still treats a listed name as taken.
//
// A reviewer is busy when it holds a durable assignment whose work is still
// live: the PR is open or is merged with a verified issue binding, its head is
// still the head that reviewer was given, and no verdict has landed for its slot.
// An unbound closed PR, a moved head, or its own verdict frees the provider.
//
// NULL MEANS UNREADABLE, AND EVERY CALLER FAILS CLOSED ON IT. If the refs cannot
// be listed this returns null; the draw, release, replacement, reap, capacity
// report and start watch all refuse rather than proceed. No caller may treat null
// as "nobody is busy" -- a probe that cannot read GitHub must never invent
// availability. (Before issue #3130 the test-only rotation helper kept rotating on
// null; it no longer reads this at all.)
export function findBusyReviewers(io,requested=[],{keepUnreadableLeases=false}={}){
  if(typeof io.readRef!=='function')throw leaseReadFailureError({read:'readRef capability check',kind:'determinate',cause:'io.readRef is not a function'})
  let cutover
  try{cutover=io.readRef(REVIEW_ACTIVE_CUTOVER_REF)}catch(error){throw leaseReadFailureError({read:'cutover read',ref:REVIEW_ACTIVE_CUTOVER_REF,kind:'transient',cause:error?.message??String(error)})}
  if(!cutover)throw new LaneError('active reviewer lease cutover is incomplete; assignment refused')
  const busy=new Set()
  const stale=[]
  let snapshot=null
  // #2694 review (slot 2, high finding 5). A DETERMINATE listing refusal --
  // the reviewer-lease namespace at or past its row ceiling, or newly
  // paginated -- is NOT the transient unreadability this fail-open exists for.
  // Swallowed, it surfaced everywhere as "active reviewer leases are
  // unreadable", which names neither the namespace, the row count, nor the
  // retirement that fixes it, and it stopped every draw, release, replacement,
  // exclusion and capacity report in the repository with no stated cause.
  try{snapshot=typeof io.readActiveReviewLeases==='function'?io.readActiveReviewLeases():null}
  catch(error){
    if(isReviewRefListingRefusal(error))throw new LaneError(`active reviewer lease namespace cannot be listed: ${error.message}`)
    if(isLeaseReadFailure(error)){const d=error.leaseReadFailure;throw leaseReadFailureError({read:d.read??'lease snapshot read',ref:d.ref,kind:d.kind,cause:d.cause??error.message})}
    throw leaseReadFailureError({read:'lease snapshot read',kind:'transient',cause:error?.message??String(error)})
  }
  const records=[]
  const refs=snapshot?[...snapshot.keys()]:[...ACTIVE_REVIEWERS,...OVERFLOW_REVIEWERS].map((reviewer)=>reviewActiveRef(reviewer.name))
  for(const ref of refs){
    let sha
    try{sha=snapshot?snapshot.get(ref)?.sha??null:io.readRef(ref)}catch(error){throw leaseReadFailureError({read:'lease ref read',ref,kind:'transient',cause:error?.message??String(error)})}
    if(!sha)continue
    let assignment,commit
    try{commit=snapshot?.get(ref)?.commit??io.getCommit(sha);assignment=parseReviewLease(commit)}
    catch(error){
      // A malformed lease is determinate: no retry parses it. A transport error
      // (getCommit) is transient. Issue #3349. The production snapshot readers
      // mark their parse failures via markLeaseReadFailure; the fallback reader
      // path catches parseReviewLease directly.
      if(isLeaseReadFailure(error)){const d=error.leaseReadFailure;throw leaseReadFailureError({read:d.read??'lease commit parse',ref:d.ref??ref,kind:d.kind,cause:d.cause??error.message})}
      const isParse=error instanceof LaneError&&/malformed/i.test(error.message)
      throw leaseReadFailureError({read:'lease commit parse',ref,kind:isParse?'determinate':'transient',cause:error?.message??String(error)})
    }
    const reviewer=REVIEWERS.find((row)=>row.name===assignment?.reviewer)
    const legacy=reviewer?reviewActiveRef(reviewer.name):null
    const parallel=reviewer&&/^[0-9a-f]{40}$/i.test(assignment.headSha)?reviewLeaseRefForAssignment(assignment,true):null
    if(!reviewer||ref!==legacy&&ref!==parallel||(io.requiresExactReviewHeadSha&&!/^[0-9a-f]{40}$/i.test(assignment.headSha)))throw leaseReadFailureError({read:'lease ref structure',ref,kind:'determinate',cause:`lease ref does not match a recognized reviewer assignment (reviewer=${assignment?.reviewer??'unknown'})`})
    const heldSince=commit?.committedDate??commit?.committer?.date??commit?.commit?.committer?.date??null
    records.push({reviewer,ref,sha,assignment,heldSince})
  }
  let states=null
    try{states=typeof io.readReviewStates==='function'?io.readReviewStates([...records.map((row)=>row.assignment),...requested]):null}catch(error){throw leaseReadFailureError({read:'review states read',kind:'transient',cause:error?.message??String(error)})}
  for(const {reviewer,ref,sha,assignment} of records){
    let prRow
    try{
      const state=states?.get(`${assignment.issue}:${assignment.pr}`)
      prRow=state?.pr??io.getPr(assignment.pr)
      if(!reviewTargetIsRecordable(prRow,{pr:assignment.pr,issue:assignment.issue,headSha:assignment.headSha},io)){stale.push({ref,sha,assignment});continue}
    }catch(error){throw leaseReadFailureError({read:'lease PR read',ref,kind:'transient',cause:error?.message??String(error)})}
    let verdict
    try{verdict=hasVerdictForHead(assignment.issue,assignment.pr,assignment.headSha,io,leaseVerdictOptions(assignment))}catch(error){
      // #2987. The verdict namespace at its row ceiling is determinate: no retry
      // clears it. Swallowed, it read as "active reviewer leases are unreadable".
      if(isReviewRefListingRefusal(error))throw new LaneError(`durable reviewer verdict namespace cannot be listed: ${error.message}. Preview with --archive-old-review-verdicts, then archive with --archive-old-review-verdicts --apply-recovery (#2987)`)
      // Capacity reporting must retain the readable lease row so it can expose
      // the verdict read error on that row. Mutation callers keep the existing
      // fail-closed whole-probe behavior.
      if(!keepUnreadableLeases)throw leaseReadFailureError({read:'verdict read',ref,kind:'transient',cause:error?.message??String(error)})
      busy.add(assignment.reviewer)
      continue
    }
    if(verdict){stale.push({ref,sha,assignment});continue}
    busy.add(assignment.reviewer)
  }
  Object.defineProperty(busy,'stale',{value:stale,enumerable:false})
  Object.defineProperty(busy,'states',{value:states,enumerable:false})
  const leaseRecords=records.map((row)=>({...row,lease:row.assignment}))
  // `leases` keeps its historical reviewer-keyed compatibility view.  New
  // concurrent-aware paths use `byAssignment`; older release history can keep
  // resolving its legacy one-provider lease unchanged during the cutover.
  Object.defineProperty(busy,'leases',{value:new Map(leaseRecords.map((row)=>[row.lease.reviewer,{sha:row.sha,lease:row.lease,heldSince:row.heldSince,ref:row.ref}])),enumerable:false})
  Object.defineProperty(busy,'byAssignment',{value:new Map(leaseRecords.map((row)=>[reviewLeaseIdentity(row.lease),{sha:row.sha,lease:row.lease,heldSince:row.heldSince,ref:row.ref}])),enumerable:false})
  Object.defineProperty(busy,'byReviewer',{value:new Map([...new Set(leaseRecords.map((row)=>row.lease.reviewer))].map((name)=>[name,leaseRecords.filter((row)=>row.lease.reviewer===name).map((row)=>({sha:row.sha,lease:row.lease,heldSince:row.heldSince,ref:row.ref}))])),enumerable:false})
  Object.defineProperty(busy,'leaseSnapshot',{value:snapshot,enumerable:false})
  return busy
}

export function reviewLeaseAgeHours(heldSince,now=new Date()){
  const start=new Date(heldSince).getTime(),end=new Date(now).getTime()
  if(!heldSince||!Number.isFinite(start)||!Number.isFinite(end)||end<start)return null
  return (end-start)/3_600_000
}

export function newestActivityTimestamp(rows,fields){
  let newest=null
  for(const row of rows??[])for(const field of fields){
    const value=row?.[field],time=Date.parse(value??'')
    if(Number.isFinite(time)&&(newest===null||time>newest.time))newest={time,value:new Date(time).toISOString()}
  }
  return newest
}

// Issue #3027 Step 7: in unstarted mode a reviewer is judged ONLY by its own durable start
// marker. PR-wide activity (CI check runs, workflow runs, another slot's review or comments)
// is not that reviewer's start, so ownStartOnly neither reads nor fingerprints it. The PR state,
// head, draft flag and this slot's verdict stay in the fingerprint; unreadable facts still throw.
export const OWN_START_ONLY_ACTIVITY='not-counted-own-start-marker-only'

export function silenceProbeRef(request){return `${REVIEW_SILENCE_PROBE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}-${request.sequence}`}
export function silenceReleaseRef(request){return `${REVIEW_SILENCE_RELEASE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}-${request.sequence}`}
export function parseSilenceProbe(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination reviewer-silence-probe reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{40}) sequence=(\d+) slot=(\d+) observed-at=([^ ]+) lease-held-since=([^ ]+) last-activity=([^ ]+) fingerprint=([0-9a-f]{64})$/i.exec(message)
  if(!match)throw new LaneError('reviewer silence probe evidence is unreadable')
  return {reviewer:match[1],issue:Number(match[2]),pr:Number(match[3]),headSha:match[4],sequence:Number(match[5]),slot:Number(match[6]),observedAt:match[7],leaseHeldSince:match[8],lastActivityIso:match[9],fingerprint:match[10].toLowerCase()}
}

export function resolveSilentLease(options,io){
  const request={issue:Number(options.issue),pr:Number(options.pr),headSha:String(options.headSha??'').toLowerCase(),sequence:Number(options.failedSequence??options.sequence),slot:Number(options.slot??1)}
  if(!Number.isInteger(request.issue)||!Number.isInteger(request.pr)||!/^[0-9a-f]{40}$/.test(request.headSha)||!Number.isInteger(request.sequence)||!Number.isInteger(request.slot)||request.slot<1)throw new LaneError('silent reviewer operation requires exact issue, PR, 40-character head SHA, sequence, and review slot')
  // Keep the chosen ref and its SHA from the same resolution snapshot. A second
  // read paid twice and could change the chosen lease between identity and contents.
  // This cache is local to this call; the in-mutex call always proves it afresh.
  const refSnapshot=new Map(),resolutionIo={...io,readRef(ref){if(!refSnapshot.has(ref))refSnapshot.set(ref,io.readRef(ref));return refSnapshot.get(ref)}}
  const original=resolveFailedReviewRecord({...request,failedSequence:request.sequence},io),leaseRef=resolveAssignmentLeaseRef({...original,slot:request.slot},Boolean(io.requiresExactReviewHeadSha),resolutionIo),leaseSha=resolutionIo.readRef(leaseRef),leaseCommit=leaseSha?io.getCommit(leaseSha):null,lease=leaseCommit?parseReviewLease(leaseCommit):null
  if(!lease||lease.issue!==request.issue||lease.pr!==request.pr||lease.headSha!==request.headSha||lease.sequence!==request.sequence||lease.slot!==request.slot||lease.reviewer!==original.reviewer)throw new LaneError('silent reviewer active lease does not match the exact durable assignment')
  return {request,original,leaseRef,leaseSha,lease:{...lease,heldSince:leaseCommit?.committedDate??leaseCommit?.committer?.date??leaseCommit?.commit?.committer?.date??null}}
}

// ISSUE #2711 -- the governed reaper for abandoned assignment-keyed leases.
// A v2 lease names its (issue, PR, head, slot) tuple, so once that PR closes or
// its head moves no later draw ever computes the name again and nothing frees
// it. This command retires exactly the v2 leases `findBusyReviewers` already
// classifies as stale (PR not open, head moved, or verdict recorded), plus, since
// issue #3449, a legacy one-slot ref only in the stricter terminal state that
// `legacyLeaseTerminalReason` proves (PR merged with a durable verdict). It re-proves
// each one under the review mutex, and deletes them with a compare-and-swap on
// both the mutex and every lease SHA. It never draws a replacement and never
// posts a verdict; a legacy lease that is live or unreadable is kept or refused.
// Without --apply-recovery it is a read-only preview.
export const REVIEW_REAP_REQUEST_LIMIT = 64, REVIEW_REAP_BATCH = 40
export function abandonedLeaseReason(row,states){
  const pr=states?.get(`${row.assignment.issue}:${row.assignment.pr}`)?.pr
  if(pr&&pr.state!=='open')return 'pr-closed'
  if(pr&&pr.head?.sha!==row.assignment.headSha)return 'head-moved'
  return 'verdict-recorded'
}
// Issue #3449. A legacy one-slot ref (refs/db-review-active/<reviewer>) is never
// recomputed by a later draw under concurrent leases, so a finished one is never
// implicitly overwritten; the explicit release paths still accept it, but only
// when an operator names its exact assignment tuple. It is reaped only in a terminal state: pull request
// MERGED and a durable verdict recorded either for the exact leased head, or, when
// the lease head was superseded before merge, for the merged head itself.
// Anything else is kept; an unreadable PR or verdict listing is refused.
// The merged-head proof is by verdict ref NAME only and is not attributed to the
// lease holder, hence its distinct reason. A cursor-form lease with no slot
// token reads as slot 1 (parseReviewLease) and matches a slot-1 verdict ref; only
// a replacement-form lease with no slot matches none and is kept. A lease whose
// head is not 40-hex never reaches here: findBusyReviewers refuses the snapshot.
// Retiring the ref only removes the stale lease record; the verdict refs stay.
// Performs verdict reads and may throw; returns the retirement reason or null.
export function legacyLeaseTerminalReason(row,states,io){
  if(row.ref!==reviewActiveRef(row.assignment.reviewer))return null
  const key=`${row.assignment.issue}:${row.assignment.pr}`
  let pr=states?.get(key)?.pr
  const unreadable=()=>new LaneError(`legacy reviewer lease ${row.ref} pull request is unreadable; nothing was reaped`)
  if(!pr){try{pr=io.getPr(row.assignment.pr)}catch{throw unreadable()}
    if(!pr||Number(pr.number)!==Number(row.assignment.pr))throw unreadable()}
  if(pr.state==='open'||!(pr.merged===true||Boolean(pr.merged_at)))return null
  const hex40=/^[0-9a-f]{40}$/,leased=String(row.assignment.headSha??'').toLowerCase(),mergedHead=String(pr.head?.sha??'').toLowerCase()
  const heads=[]
  if(hex40.test(leased))heads.push([leased,'legacy-merged-verdict-recorded'])
  if(hex40.test(mergedHead)&&mergedHead!==leased)heads.push([mergedHead,'legacy-merged-superseded-head-verdict-recorded'])
  for(const [head,reason] of heads){
    let verdict
    try{verdict=hasVerdictForHead(row.assignment.issue,row.assignment.pr,head,io,leaseVerdictOptions(row.assignment,{fresh:true}))}catch(error){
      if(isReviewRefListingRefusal(error))throw new LaneError(`durable reviewer verdict namespace cannot be listed: ${error.message}. Preview with --archive-old-review-verdicts, then archive with --archive-old-review-verdicts --apply-recovery (#2987)`)
      throw new LaneError(`legacy reviewer lease ${row.ref} verdict is unreadable; nothing was reaped`)
    }
    if(verdict)return reason
  }
  return null
}
export function abandonedLeases(io){
  const busy=findBusyReviewers(io)
  if(!busy)throw new LaneError('active reviewer leases are unreadable; nothing was reaped')
  const rows=[]
  for(const row of busy.stale){
    const reason=row.ref.startsWith(`${REVIEW_ACTIVE_PARALLEL_REF_PREFIX}/`)?abandonedLeaseReason(row,busy.states):legacyLeaseTerminalReason(row,busy.states,io)
    if(reason)rows.push({ref:row.ref,sha:row.sha,reviewer:row.assignment.reviewer,issue:row.assignment.issue,pr:row.assignment.pr,headSha:row.assignment.headSha,reason})
  }
  return rows
}

// Issue #2987. Every durable verdict ever recorded stays under the shared
// `refs/db-review-verdict` prefix, and `readDurableVerdictRefs` REFUSES once that
// listing reaches REVIEW_REF_ROW_LIMIT. When it did, every draw, release and
// replacement stopped. The ceiling says "retire refs, do not raise the number";
// this is the governed retirement.
//
// ARCHIVED, NEVER DELETED. Each chosen verdict object is moved, in one atomic
// compare-and-swap push that also pins the review mutex, to
// refs/db-review-archived-verdicts/<original ref without refs/>. The commit stays
// reachable and its original name is recoverable from the archive name, so an
// archive can be reversed by the inverse transition.
//
// ONLY VERDICTS NOTHING CAN STILL ASK FOR. A verdict is archived only when its pull
// request is closed and either (a) was never merged, or (b) was merged by a commit
// that changed nothing under supabase/migrations/. Kept: every open pull request
// (the merge gate and #2758 carry-forward read prior-head verdicts), every pull
// request an active reviewer lease names, and every merged migration pull request
// because production promotion re-runs check-exact-head-approval against the merged
// source pull request. An unknown pull request or an unreadable merge commit is
// kept, never guessed. Without --apply-recovery this is a read-only preview.
// Artifact zip selection, shared by the proof readers (portable; no tar).
export function selectArtifactJson(entries,expectedFile){
  const names=[...entries.keys()]
  if(names.length!==1||names[0]!==expectedFile)throw new LaneError(`proof artifact must contain exactly ${expectedFile}`)
  return JSON.parse(entries.get(expectedFile).toString('utf8'))
}
export function selectArtifactFiles(entries,expectedFiles){
  const names=[...entries.keys()],result=new Map()
  for(const expected of expectedFiles){
    const entry=names.find((value)=>value===expected||value.endsWith(`/${expected}`))
    if(!entry)throw new LaneError(`production proof artifact is missing ${expected}`)
    result.set(expected,entries.get(entry).toString('utf8'))
  }
  return result
}

export const REVIEW_ARCHIVED_VERDICT_REF_PREFIX='refs/db-review-archived-verdicts'
export const REVIEW_VERDICT_ARCHIVE_BATCH=40
export const ARCHIVABLE_VERDICT_NAMESPACES=[`${REVIEW_VERDICT_REF_PREFIX}/`,`${REVIEW_VERDICT_REPLACEMENT_REF_PREFIX}/`]
export function archivedVerdictRef(ref){
  if(!ARCHIVABLE_VERDICT_NAMESPACES.some((prefix)=>String(ref).startsWith(prefix)))throw new LaneError(`${ref} is not a durable reviewer verdict ref`)
  return `${REVIEW_ARCHIVED_VERDICT_REF_PREFIX}/${String(ref).slice('refs/'.length)}`
}
export function classifyVerdictForArchive(ref,{pulls,leasedPrs,touchesMigrations}){
  const named=parseVerdictRef(ref)
  if(!named)return {archive:false,reason:'unparseable-ref'}
  if(leasedPrs.has(named.pr))return {archive:false,reason:'active-lease'}
  const pull=pulls.get(named.pr)
  if(!pull)return {archive:false,reason:'pr-unknown'}
  if(pull.state!=='closed')return {archive:false,reason:'pr-open'}
  if(!pull.merged)return {archive:true,reason:'pr-closed-unmerged'}
  const touches=pull.mergeCommitSha?touchesMigrations(pull.mergeCommitSha):null
  if(touches===false)return {archive:true,reason:'merged-no-migration'}
  if(touches===true)return {archive:false,reason:'merged-migration-kept-for-promotion'}
  return {archive:false,reason:'merge-commit-unreadable'}
}
export function readArchivableVerdictRows(io){
  // Each namespace is listed on its own, so each keeps the same loud ceiling
  // refusal while the combined prefix is over it.
  if(typeof io.listReviewRefsPaged!=='function')throw new LaneError('verdict archive requires the complete single-listing ref reader')
  return ARCHIVABLE_VERDICT_NAMESPACES.flatMap((prefix)=>{
    const rows=io.listReviewRefsPaged(prefix)
    if(!Array.isArray(rows))throw new LaneError(`${prefix} listing is unreadable; verdict archive refused`)
    return rows
  })
}
export function activeLeasePulls(io){
  if(typeof io.readActiveReviewLeases!=='function')throw new LaneError('verdict archive requires the active reviewer lease snapshot')
  const snapshot=io.readActiveReviewLeases()
  if(!(snapshot instanceof Map))throw new LaneError('active reviewer lease snapshot is unreadable; verdict archive refused')
  const prs=new Set()
  for(const [ref,row] of snapshot){
    let lease
    try{lease=parseReviewLease(row?.commit)}catch{throw new LaneError(`active reviewer lease ${ref} is unreadable; verdict archive refused`)}
    prs.add(Number(lease.pr))
  }
  return prs
}
export function verdictArchiveScan(io,pulls){
  const leasedPrs=activeLeasePulls(io)
  const memo=new Map()
  const touchesMigrations=(sha)=>{
    if(!memo.has(sha)){let value=null;try{value=io.mergeTouchesMigrations(sha)}catch{value=null};memo.set(sha,value===true||value===false?value:null)}
    return memo.get(sha)
  }
  const rows=readArchivableVerdictRows(io),candidates=[],kept={}
  for(const row of rows){
    const verdict=classifyVerdictForArchive(row.ref,{pulls,leasedPrs,touchesMigrations})
    if(verdict.archive)candidates.push({ref:row.ref,sha:row.sha,archiveRef:archivedVerdictRef(row.ref),reason:verdict.reason})
    else kept[verdict.reason]=(kept[verdict.reason]??0)+1
  }
  return {total:rows.length,candidates,kept}
}
export function readPullStateMap(io){
  if(typeof io.readPullStates!=='function'||typeof io.mergeTouchesMigrations!=='function')throw new LaneError('verdict archive requires pull request states and merge-commit inspection')
  const pulls=io.readPullStates()
  if(!(pulls instanceof Map))throw new LaneError('pull request states are unreadable; verdict archive refused')
  return pulls
}
export function countReasons(rows){const out={};for(const row of rows)out[row.reason]=(out[row.reason]??0)+1;return out}

export function reviewerCapacityReportOperation(io,now){
  const busy=findBusyReviewers(io,[],{keepUnreadableLeases:true})
  if(!busy)throw new LaneError('active reviewer leases are unreadable; reviewer capacity is unknown')
  // #2694 review (slot 2, medium-high finding 6). `busy.leases` is
  // Map(reviewer -> LAST record), so two live jobs for one provider collapsed
  // to one row and the capacity report simply did not show the second. Under
  // assignment-keyed leases a provider legitimately holds several, so the rows
  // are built from the assignment-keyed index: one row per LEASE, and one
  // "free" row for a provider holding none. Stale is likewise keyed by REF, not
  // by provider name.
  const staleByRef=new Map(busy.stale.map((row)=>[row.ref,row]))
  const leasesByReviewer=new Map()
  for(const record of (busy.byAssignment?.values()??[]))leasesByReviewer.set(record.lease.reviewer,[...(leasesByReviewer.get(record.lease.reviewer)??[]),record])
  const rows=ACTIVE_REVIEWERS.flatMap((reviewer)=>{
    const records=leasesByReviewer.get(reviewer.name)??[]
    if(!records.length)return [{reviewer:reviewer.name,held:false,issue:null,pr:null,headSha:null,sequence:null,heldSinceIso:null,ageHours:null,prState:null,headMatches:null,verdictPresent:false,verdictReadError:null,lastActivityIso:null,silenceProbe:null,classification:'free'}]
    return records.map((record)=>{
    const state=busy.states?.get(`${record.lease.issue}:${record.lease.pr}`),pr=state?.pr
    let verdictPresent=false,verdictReadError=null
    try{verdictPresent=hasVerdictForHead(record.lease.issue,record.lease.pr,record.lease.headSha,io,leaseVerdictOptions(record.lease))}catch(error){verdictPresent=null;verdictReadError=String(error?.message??error)}
    const ageHours=reviewLeaseAgeHours(record.heldSince,now)
    let lastActivityIso=null,silenceProbe=null,silenceState=null
    if(typeof io.readLeaseActivity==='function'&&!staleByRef.has(record.ref)){
      try{
        const observed=activityFingerprintForLease(record.lease,io);lastActivityIso=observed.lastActivityIso
        const ref=silenceProbeRef({...record.lease,sequence:record.lease.sequence}),sha=io.readRef(ref)
        if(sha){const probe=parseSilenceProbe(io.getCommit(sha));silenceProbe={observedAt:probe.observedAt,fingerprint:probe.fingerprint,sha};if(observed.fingerprint===probe.fingerprint)silenceState=reviewLeaseAgeHours(probe.observedAt,now)>=SILENCE_CONFIRM_HOURS?'silence-reclaimable':'silence-probed'}
      }catch{silenceState='unknown'}
    }
    let classification
    if(verdictReadError!==null||!state||!pr)classification='unknown'
    else if(staleByRef.has(record.ref))classification='stale-reclaimable'
    else if(silenceState)classification=silenceState
    else if(ageHours===null)classification='unknown'
    else if(ageHours>=REVIEW_LEASE_SUSPECT_HOURS)classification='suspect-aged'
    else classification='live'
    return {reviewer:reviewer.name,held:true,leaseRef:record.ref,issue:record.lease.issue,pr:record.lease.pr,headSha:record.lease.headSha,sequence:record.lease.sequence,heldSinceIso:record.heldSince??null,ageHours:ageHours===null?null:Number(ageHours.toFixed(2)),prState:pr?.state??null,headMatches:pr?pr.head?.sha===record.lease.headSha:null,verdictPresent,verdictReadError,lastActivityIso,silenceProbe,classification}
    })
  })
  let queue=[]
  if(io.enableReviewerQueue)try{queue=liveReviewerQueue(io)}catch{queue=null}
  return {generatedAt:new Date(now).toISOString(),advisorySuspectHours:REVIEW_LEASE_SUSPECT_HOURS,silenceMinAgeHours:SILENCE_MIN_AGE_HOURS,silenceConfirmHours:SILENCE_CONFIRM_HOURS,summary:{total:rows.length,free:rows.filter((row)=>row.classification==='free').length,live:rows.filter((row)=>['live','suspect-aged','silence-probed'].includes(row.classification)).length,reclaimable:rows.filter((row)=>['stale-reclaimable','silence-reclaimable'].includes(row.classification)).length,silenceProbed:rows.filter((row)=>row.classification==='silence-probed').length,silenceReclaimable:rows.filter((row)=>row.classification==='silence-reclaimable').length,unknown:rows.filter((row)=>row.classification==='unknown').length},queue,reviewers:rows}
}

// ISSUE #3027 STEP 7 -- read-only lease view for the reviewer start watcher
// (scripts/orchestrator-flow/reviewer-start-watch.mjs). Every lease reports its exact
// slot, draw time, whether a durable start marker exists after the draw, and the last
// PR activity. Anything unreadable is reported as `unknown`, which the watcher never
// reroutes. Leases younger than the start SLO are listed without further reads.
export function reviewerStartWatchLeasesOperation(io,now,minAgeHours){
  const busy=findBusyReviewers(io,[],{keepUnreadableLeases:true})
  if(!busy)throw new LaneError('active reviewer leases are unreadable; start watch refused')
  const staleRefs=new Set((busy.stale??[]).map((row)=>row.ref))
  return [...(busy.byAssignment?.values()??[])].map((record)=>{
    const lease=record.lease,row={leaseRef:record.ref,reviewer:lease.reviewer,issue:lease.issue,pr:lease.pr,headSha:lease.headSha,sequence:lease.sequence,slot:lease.slot??1,heldSinceIso:record.heldSince??null,stale:staleRefs.has(record.ref),started:null,lastActivityIso:null,verdictPresent:null,error:null}
    const age=reviewLeaseAgeHours(record.heldSince,now)
    if(row.stale||age===null||age<minAgeHours)return row
    try{
      row.verdictPresent=hasVerdictForHead(lease.issue,lease.pr,lease.headSha,io,leaseVerdictOptions(lease))
      row.started=reviewStartMarkerPresent({...lease,slot:row.slot},io)
      // Own start marker only (#3027 Step 7): PR-wide CI or another slot's activity is not this reviewer starting.
      row.lastActivityIso=OWN_START_ONLY_ACTIVITY
    }catch(error){row.error=String(error?.message??error)}
    return row
  })
}

export function describeMovedAssignmentHead(request,recorded){
  return `the durable reviewer assignment is NOT missing: sequence=${recorded.sequence} reviewer=${recorded.reviewer} for issue #${request.issue} PR #${request.pr} is recorded under head ${recorded.headSha}, and this request names head ${request.headSha}. The PR head moved after that reviewer was assigned, so the exact code that reviewer was given is no longer this PR's head. A replacement would bind a new reviewer -- and later a verdict -- to a commit the failed reviewer never saw, so it is refused. Assign a reviewer to the current code instead: --assign-reviewer --issue ${request.issue} --pr ${request.pr} --head-sha <the PR's current head>. Nothing was lost and nothing needs reconstructing.`
}

// ROTATION HELPER -- it has NO production caller in this tree (tests only). A live
// review never makes its provider busy (owner ruling 2026-09-16: no ceiling on
// concurrent reviews by one reviewer), so it returns the plain rotation slot. The
// live draw path adds failed-name, exclusion and excluded-provider filtering that
// this helper does not have, so it must NOT be reused for a draw.
export function pickReviewer(sequence,io){
  const {eligible}=allocatableReviewers(io)
  if(!eligible.length)throw new LaneError('no reviewer is independent from the live orchestrator engine')
  const eligibleNames=new Set(eligible.map((row)=>row.name))
  const ordered=orderedReviewers(sequence).filter((row)=>eligibleNames.has(row.name))
  return ordered[0]??OVERFLOW_REVIEWERS.find((row)=>eligibleNames.has(row.name))
}

// Slot 1 keeps the original, unsuffixed ref namespace so every already-recorded
// assignment and replacement stays exactly where it is. Slot 2+ gets a parallel
// namespace under the same tuple.
export function reviewSlotSuffix(slot){return Number(slot)===1?'':`-slot${Number(slot)}`}

// `listRefs` is a PREFIX scan, and slot 1's replacement base is a prefix of
// every higher slot's base (".../9-109-abc" also matches ".../9-109-abc-slot2-516").
// Every replacement listing must therefore be narrowed to the exact namespace it
// asked for, or slot 2's records leak into slot 1's answers -- silently, and with
// the highest sequence winning, which is exactly the cross-slot mutation the
// replacement matcher fails closed to prevent. Links are named `<base>-<failedSequence>`,
// so the remainder after the base is digits and nothing else.
export function inReviewReplacementNamespace(ref,base){
  const rest=String(ref).slice(base.length)
  return String(ref).startsWith(base)&&/^-\d+$/.test(rest)
}
