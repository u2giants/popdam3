// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { REVIEW_VERDICTS, verdictRef, parseVerdictCommit, validateVerdictArtifact, assertFindingsRefForPr, findingsDigest, formatVerdictMessage, REVIEW_VERDICT_REF_PREFIX, REVIEW_VERDICT_REPLACEMENT_REF_PREFIX, parseVerdictRef } from '../../lib/review-verdict-artifact.mjs'
import { createHash } from 'node:crypto'
import { LaneError } from './claims.mjs'
import { REVIEWERS, parseRecordedReviewerAllowlist, reviewerEmitsGovernedVerdict, reviewerReadsRepository } from './reviewer-roster.mjs'
import { MUTEX_REF, REINSTATABLE_EXCLUSION_REASONS, RETIRED_EXCLUSION_REASONS, REVIEW_ACTIVE_PARALLEL_REF_PREFIX, REVIEW_ACTIVE_REF_PREFIX, REVIEW_ASSIGNMENT_REF_PREFIX, REVIEW_EXCLUSION_REASONS, REVIEW_EXCLUSION_REF_PREFIX, REVIEW_REINSTATEMENT_REF_PREFIX, REVIEW_REPLACEMENT_REF_PREFIX, REVIEW_RETIRED_VERDICT_REF_PREFIX, REVIEW_RETURN_REF_PREFIX } from './constants.mjs'
import { reviewSlotSuffix } from './review-leases.mjs'
import { reviewTargetIsRecordable } from './admission.mjs'
import { reviewActiveLeaseCause } from './review-assignment.mjs'
import { readRefAfterWrite } from './holds-and-refs.mjs'
import { githubIo } from '../../manage-migration-author-lanes.mjs'

export function parseReviewCursor(commit) {
  if (!commit) return null
  const message=commit.message ?? commit.commit?.message ?? ''
  const match=/^db-coordination reviewer-cursor sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})(?: slot=(\d+))?(?: allowlist=([a-z0-9.,-]+))?$/i.exec(message)??/^db-coordination reviewer-(?:failure-)?replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})(?: slot=(\d+))?(?: allowlist=([a-z0-9.,-]+))? /i.exec(message)
  if (!match) throw new LaneError('reviewer cursor does not point to a recognized assignment')
  // `slot` is NULL when the message does not state one, never a guessed 1.
  // Replacement messages written before PR #2077 carry no `slot=` token at all,
  // and reading their silence as "slot 1" is exactly how a slot-2 replacement
  // was returned as slot 1 (grok-4.6 REVISE, high finding 1). The REF NAME is
  // the authority on which slot a record belongs to -- see parseAssignmentRef --
  // and this parser now says "not stated" so a caller cannot mistake a default
  // for evidence.
  return {sequence:Number(match[1]),reviewer:match[2],issue:Number(match[3]),pr:Number(match[4]),headSha:match[5],slot:match[6]?Number(match[6]):null,...(match[7]?{reviewerAllowlist:parseRecordedReviewerAllowlist(match[7])}:{})}
}

// #2430. KEY ORDER IS NOT IDENTITY. Two verdict payloads carrying the same fields
// with the same values are the same record whichever order JSON.stringify emitted
// them in, so records are compared over sorted key/value pairs, never over the
// message text.
export function sameVerdictRecord(left,right){
  if(!left||!right)return false
  const keys=[...new Set([...Object.keys(left),...Object.keys(right)])].sort()
  return keys.every((key)=>JSON.stringify(left[key])===JSON.stringify(right[key]))
}
// THE LEASE A RECORDED VERDICT MUST HAND BACK (#2694 review, slot 2, critical
// finding 2).
//
// Before the assignment-keyed cutover the lease ref was named for the PROVIDER
// alone, so nothing had to release it: the reviewer's NEXT draw computed the
// same ref, found it stale (PR head moved, or a verdict recorded), and cleared
// it as `selectedStale`. A v2 ref is named for the TUPLE, and that tuple is
// never drawn again -- so no later draw ever computes that name, nothing
// reclaims it, and `refs/db-review-active-v2/*` grows by one ref per completed
// review forever until `listReviewRefsPaged` refuses the whole namespace and
// every draw, release, replacement, exclusion and capacity report in the
// repository stops.
//
// So the verdict releases its OWN lease, which is the only moment at which the
// work that lease protects is provably finished.
//
// IT NEVER THROWS. `recordReviewVerdict` does not hold the review mutex and the
// artifact is already durable by the time this runs; turning a failed cleanup
// into a thrown error would send the runner down its void path and destroy the
// findings comment a valid verdict's digest is computed over. A lease that
// could not be released is reported on the return value instead, and the next
// identical re-run releases it (the standing-artifact path calls this too).
export function releaseRecordedVerdictLease(ref,expectedSha,io){
  try{
    if(typeof io?.deleteRef!=='function')return false
    if(io.readRef(ref)!==expectedSha)return false
    if(typeof io.atomicReviewRefs==='function'&&typeof io.readReviewRefs==='function'){
      io.atomicReviewRefs([{ref,expected:expectedSha,sha:null}])
      return io.readReviewRefs([ref]).get(ref)===null
    }
    io.deleteRef(ref)
    return io.readRef(ref)===null
  }catch{return false}
}
export function recordReviewVerdict(options,io=githubIo){
  const issue=Number(options.issue),pr=Number(options.pr),slot=Number(options.slot??1),headSha=String(options.headSha??'').toLowerCase()
  const verdict=String(options.verdict??'').toUpperCase(),findingsRef=String(options.findingsRef??'')
  const replacementSequence=options.replacementSequence==null?null:Number(options.replacementSequence)
  if(!Number.isInteger(issue)||issue<1||!Number.isInteger(pr)||pr<1||!Number.isInteger(slot)||slot<1||!/^[0-9a-f]{40}$/.test(headSha)||!REVIEW_VERDICTS.has(verdict))throw new LaneError('review verdict requires exact issue, PR, slot, 40-character head SHA, and APPROVE, REVISE, or REJECT')
  if(replacementSequence!==null&&(!Number.isInteger(replacementSequence)||replacementSequence<1))throw new LaneError('replacement verdict requires a positive replacement sequence')
  const assignmentRef=replacementSequence===null
    ?`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}${reviewSlotSuffix(slot)}`
    :`${REVIEW_REPLACEMENT_REF_PREFIX}/${issue}-${pr}-${headSha}${reviewSlotSuffix(slot)}-${replacementSequence}`
  const assignmentSha=io.readRef(assignmentRef)
  if(!assignmentSha)throw new LaneError('the exact durable reviewer assignment does not exist')
  const assignment=parseReviewCursor(io.getCommit(assignmentSha))
  if(assignment.issue!==issue||assignment.pr!==pr||assignment.headSha.toLowerCase()!==headSha||(assignment.slot!==null&&assignment.slot!==slot))throw new LaneError('the assignment record disagrees with the requested verdict tuple')
  // #2078. Refuse BEFORE any commit or ref is created, and before the lease and
  // PR reads, so a reviewer that cannot open the code leaves no artifact at all.
  // This is a property of the wrapper, so no retry, no re-run and no better
  // formatted output can satisfy it.
  if(!reviewerReadsRepository(assignment.reviewer))throw new LaneError(`reviewer ${assignment.reviewer} runs through a wrapper that has no access to the repository under review -- it never reads the diff, only the text of the brief, so its verdict describes the change as DESCRIBED rather than as WRITTEN. Refusing to record a code-review verdict from it. This is a property of the wrapper: no retry and no re-run can satisfy it. Draw a reviewer that reads the code with the exact command: ${nonReadingReviewerReplacementCommand({issue,pr,headSha,slot},assignment.sequence)}`)
  // #2831: the sibling gate. A reviewer whose wrapper cannot end with the governed
  // verdict line can never be recorded; name the replacement route instead.
  if(!reviewerEmitsGovernedVerdict(assignment.reviewer))throw new LaneError(`reviewer ${assignment.reviewer} runs through a wrapper that cannot emit the governed VERDICT line, so no verdict from it can be recorded. This is a property of the wrapper. Draw another reviewer with the exact command: ${nonVerdictReviewerReplacementCommand({issue,pr,headSha,slot},assignment.sequence)}`)
  // Prefer the assignment-keyed lease introduced by #2694.  The legacy
  // one-provider ref remains valid only for reviews created before this
  // cutover, so an in-flight old review can still finish without being moved.
  const parallelActiveRef=reviewLeaseRefForAssignment({...assignment,slot},Boolean(io.requiresExactReviewHeadSha))
  const parallelLeaseSha=io.readRef(parallelActiveRef)
  const legacyActiveRef=reviewActiveRef(assignment.reviewer)
  const holdsParallel=parallelLeaseSha===assignmentSha
  const legacyLeaseSha=holdsParallel?null:io.readRef(legacyActiveRef)
  const holdsLegacy=!holdsParallel&&legacyLeaseSha===assignmentSha
  const activeLeaseSha=holdsParallel?parallelLeaseSha:legacyLeaseSha
  // The ref this verdict hands its lease back through. When NEITHER name holds
  // the lease any more -- the idempotent re-run below, whose first run already
  // released it -- the v2 name is the one this assignment's lease occupies, so
  // that is what is reported and what the (no-op) release is attempted against.
  // Falling back to the LEGACY provider-keyed name here would aim a release at a
  // ref a live SIBLING job for the same provider may be holding.
  const activeRef=holdsParallel||!holdsLegacy?parallelActiveRef:legacyActiveRef
  // Every successful exit goes through here, so a recorded verdict ALWAYS hands
  // its lease back -- including the idempotent re-run over a standing artifact,
  // which is what repairs a release that failed on an earlier attempt.
  // `releaseRecordedVerdictLease` is compare-and-delete: a ref that does not
  // hold THIS assignment SHA is left exactly as it is.
  const finish=(validated)=>({...validated,lease_ref:activeRef,lease_released:releaseRecordedVerdictLease(activeRef,assignmentSha,io)})
  const live=io.getPr(pr)
  if(!reviewTargetIsRecordable(live,{pr,issue,headSha},io))throw new LaneError('review target is no longer the exact open PR head')
  const ref=verdictRef({issue,pr,headSha,slot,replacementSequence})
  const existing=io.readRef(ref)
  // #2710. IDEMPOTENCY OUTLIVES THE LEASE, SO THE STANDING ARTIFACT IS READ
  // FIRST. A verdict releases its own lease on the way out (see
  // `releaseRecordedVerdictLease`), and `run-governed-review.mjs` re-runs the
  // whole recording with no existing-verdict pre-check. With the lease gate
  // ahead of this read, the SECOND identical run of a review that had already
  // succeeded was refused as a "late or conflicting verdict" for a verdict whose
  // durable artifact was sitting right there -- the release made the operation
  // non-idempotent. The artifact is the durable record; the lease is only the
  // concurrency token that produced it, so an existing artifact answers first.
  //
  // This does NOT weaken the late-or-conflicting refusal. The artifact carries
  // its own `assignment_sha`, and `validateVerdictArtifact` below refuses it
  // unless that SHA is exactly the assignment this request resolved (and the
  // reviewer, ref tuple, parentage and findings digest all agree). A verdict
  // from a different or superseded assignment is still refused here, and a
  // request with NO standing artifact still falls through to the lease gate.
  if(existing){
    // #2464. An artifact that ALREADY EXISTS is validated against ITS OWN
    // findings comment, never against the comment this round just posted. The
    // artifact is immutable and records the `findings_ref` it was bound to; a
    // re-run posts a NEW comment, so digesting this round's body against a
    // previous round's artifact reported "findings digest does not match the
    // durable findings" for a perfectly valid artifact and burned the tuple.
    // The create-race path below already read the winner's own findings; this
    // path now does the same.
    const existingCommit=io.getCommit(existing)
    const existingRecord=parseVerdictCommit(existingCommit)
    const existingBody=io.readFindings(existingRecord.findings_ref)
    const validated=validateVerdictArtifact({ref,sha:existing,commit:existingCommit,findingsBody:existingBody,activeLeaseSha:assignmentSha,assignment:{sha:assignmentSha,reviewer:assignment.reviewer}})
    if(validated.verdict!==verdict)throw new LaneError('a different create-only verdict already exists')
    return finish(validated)
  }
  if(activeLeaseSha!==assignmentSha){
    // #2694 review (slot 2, medium finding 8). The cause used to be built from
    // the LEGACY ref's contents unconditionally. Post-cutover the lease that
    // actually stands for this reviewer lives under the v2 name, so when the v2
    // ref held a different assignment and no legacy ref existed at all, the
    // refusal said "holds no active lease at all" -- the exact wrong-cause
    // report issue #2311 was opened to end. Report whichever ref actually holds
    // something, and name that ref.
    const causeRef=parallelLeaseSha?parallelActiveRef:legacyActiveRef
    const causeSha=parallelLeaseSha??legacyLeaseSha
    throw new LaneError(`reviewer does not hold the exact active lease; late or conflicting verdict refused${reviewActiveLeaseCause(assignment.reviewer,causeSha,{issue,pr,headSha},io,causeRef)}`)
  }
  try{assertFindingsRefForPr(findingsRef,pr)}catch(error){throw new LaneError(error.message)}
  const findingsBody=io.readFindings(findingsRef)
  if(!String(findingsBody??'').trim())throw new LaneError('durable reviewer findings are unreadable or empty')
  const record={verdict,head_sha:headSha,issue,pr,slot,reviewer:assignment.reviewer,assignment_sha:assignmentSha,findings_digest:findingsDigest(findingsBody),findings_ref:findingsRef}
  const sha=io.makeReviewVerdictCommit(formatVerdictMessage(record),assignmentSha)
  try{if(!io.createRef(ref,sha))throw new Error('create returned false')}catch(error){
    // #2464 (muse-spark, PR #2468). A FAILED create does not mean nothing was
    // created. The create can land and still report an error -- a dropped
    // response, a proxy timeout -- in which case the winner of this "race" is
    // THIS round's own commit, bound to THIS round's findings comment. Every
    // read below (getCommit, readFindings, validation) can then fail
    // transiently, and an unmarked throw sends the runner down its void path,
    // editing the very comment the artifact's findings_digest was computed
    // over. So the winner is read with the same absence-retry as the success
    // path, and once the winner is known to be our own SHA, EVERY error out of
    // this branch carries the marker.
    // The winner READ can itself throw -- readRef returns null only on a
    // confirmed 404 and rethrows every other transport error (muse-spark,
    // PR #2468, round 2). A thrown read leaves us unable to prove the ref is
    // absent, and the create may well have landed, so the failure is marked
    // UNCONFIRMED rather than left bare: refusing to void is safe when we do not
    // know, while voiding is irreversible. Round 4 extended the same reasoning
    // to a repeated null: see the block below -- after a FAILED create, no exit
    // in this branch is treated as proof of absence.
    let winner=null
    try{winner=readRefAfterWrite(ref,sha,io)}
    catch(readError){readError.verdictArtifactCreated={ref,sha,confirmed:false};throw readError}
    // A repeated null after an ERRORED create is not proof of absence either
    // (muse-spark, PR #2468 round 3). The create reported a failure, so landing
    // is unknown, and the same eventual consistency that hides a fresh ref for
    // one read can hide it for all twelve. This exit is therefore marked
    // unconfirmed as well: after a failed create, NOTHING in this branch is
    // proven absent, and the only unmarked outcome left is a winner that is
    // demonstrably another round's object, which is not ours to protect.
    if(!winner){const absent=new LaneError('create-only verdict ref failed and no winner could be read; the ref may still hold the commit this round created, so nothing may be voided and this must not be retried blindly');absent.verdictArtifactCreated={ref,sha,confirmed:false};throw absent}
    const markIfOurs=(failure)=>{if(winner===sha)failure.verdictArtifactCreated={ref,sha,confirmed:true};return failure}
    try{
      const winnerRecord=parseVerdictCommit(io.getCommit(winner))
      const winnerBody=io.readFindings(winnerRecord.findings_ref)
      const validated=validateVerdictArtifact({ref,sha:winner,commit:io.getCommit(winner),findingsBody:winnerBody,activeLeaseSha:assignmentSha,assignment:{sha:assignmentSha,reviewer:assignment.reviewer}})
      if(validated.verdict!==verdict)throw new LaneError('a contradictory create-only verdict won the race; this tuple is permanently refused')
      return finish(validated)
    }catch(failure){throw markIfOurs(failure)}
  }
  // #2464. THE CREATE SUCCEEDED. Everything from here on is confirmation of an
  // object that already exists durably, so two rules apply.
  //
  // FIRST, the readback is retried. GitHub's create-ref response can arrive
  // before the new custom ref is visible to a following GET -- the eventual
  // consistency `readRefAfterWrite` was written for. Asked exactly once, a
  // successful create followed by a transient 404 was indistinguishable from a
  // create that never landed, and it refused a real APPROVE four rounds running
  // on PR #2409 while `refs/db-review-verdicts/2334-2409-2835169...-slot2` sat
  // there holding the APPROVE payload. A DIFFERENT sha still fails closed on the
  // first read, exactly as before: this is not a weaker check, it is the same
  // check asked until the API can answer it.
  //
  // SECOND, any failure past this point is marked `verdictArtifactCreated`. The
  // runner's failure path voids the findings comment, which permanently breaks
  // the `findings_digest` recorded INSIDE the artifact that was just written --
  // destroying the evidence for a verdict that exists and is valid. A caller
  // that sees this marker must report loudly and STOP, touching nothing.
  try{
    const seen=readRefAfterWrite(ref,sha,io)
    // #2430. A DIFFERENT SHA IS NOT AUTOMATICALLY CORRUPTION. The create is
    // confirmed, so something written by THIS call stands at the ref -- and a
    // retried create can produce a second commit object with a different SHA
    // and an identical payload (the commit carries a timestamp; the record does
    // not). Refusing on the SHA alone threw away a completed, paid-for review on
    // PR #2415 at head 0fab4ace. So the CONTENT standing at the ref is compared
    // against the record this call intended to write: an equivalent record that
    // still validates as a full artifact is this verdict, and is a success.
    // Anything else -- an unreadable commit, a genuinely different record, an
    // absent ref after a confirmed create -- is still a permanent refusal, and
    // still marked created so the runner never voids the findings comment.
    if(seen!==sha){
      if(!seen)throw new LaneError(`create-only verdict readback could not confirm the created object at ${ref} (read absent, expected ${sha}); the artifact WAS created and must not be voided`)
      let standing=null
      try{standing=parseVerdictCommit(io.getCommit(seen))}catch{standing=null}
      if(!sameVerdictRecord(standing,record))throw new LaneError(`create-only verdict readback could not confirm the created object at ${ref} (read ${seen}, expected ${sha}); the artifact WAS created and must not be voided`)
      return finish(validateVerdictArtifact({ref,sha:seen,commit:io.getCommit(seen),findingsBody,activeLeaseSha:assignmentSha,assignment:{sha:assignmentSha,reviewer:assignment.reviewer}}))
    }
    return finish(validateVerdictArtifact({ref,sha,commit:io.getCommit(sha),findingsBody,activeLeaseSha:assignmentSha,assignment:{sha:assignmentSha,reviewer:assignment.reviewer}}))
  }catch(error){
    error.verdictArtifactCreated={ref,sha,confirmed:true}
    throw error
  }
}

// THE EXACT RECOVERY ROUTE FOR A NON-READING REVIEWER (#2079).
// The refusal above used to end with a bare "use --replace-failed-reviewer",
// which an operator could follow straight into a second refusal: replacement
// requires a recognized terminal failure code and both no-verdict confirmations,
// and (before this change) any durable verdict at the head blocked it outright.
// This builds the command that actually runs, so the message names a route
// rather than a direction.
export function nonVerdictReviewerReplacementCommand({issue,pr,headSha,slot=1},failedSequence){
  return `node scripts/manage-migration-author-lanes.mjs --replace-failed-reviewer --issue ${issue} --pr ${pr} --head-sha ${headSha} --review-slot ${slot} --failed-sequence ${failedSequence} --failure-code reviewer_cannot_emit_governed_verdict --confirm-no-verdict --confirm-no-artifact`
}
export function nonReadingReviewerReplacementCommand({issue,pr,headSha,slot=1},failedSequence){
  return `node scripts/manage-migration-author-lanes.mjs --replace-failed-reviewer --issue ${issue} --pr ${pr} --head-sha ${headSha} --review-slot ${slot} --failed-sequence ${failedSequence} --failure-code reviewer_cannot_read_repository --confirm-no-verdict --confirm-no-artifact`
}

// THE READ SIDE OF THE SAME FACT (#2079).
// The write-side guard in recordReviewVerdict only binds FUTURE verdicts. It
// cannot retract `refs/db-review-verdicts/1987-1989-fe810d47...`, the artifact
// deepseek-chat already produced for a migration it could not open, and that
// artifact was still merge-gate-valid.
//
// A verdict from a reviewer that cannot read the repository is treated as
// ABSENT, not as a refusal. That choice is deliberate. A refusal would be
// permanent -- the artifact is immutable and create-only, so the slot could
// never be satisfied and the pull request would be stuck forever, trading one
// deadlock for another. Treated as absent, the slot simply has no verdict: the
// gate refuses for the ordinary "no durable APPROVE" reason, and
// --replace-failed-reviewer can draw a reviewer that reads the code and finish
// the review. Absence is recoverable; a permanent refusal is not.
//
// THAT IS ONLY TRUE BECAUSE THE MERGE GATE APPLIES THE SAME RULE. This function
// is read by the PREVIEW gate, which under merge-first runs AFTER the merge. An
// earlier version of this comment claimed the merge gate refuses for the ordinary
// "no durable APPROVE" reason; it did not, because it applied no such filter at
// all -- a disregarded APPROVE still authorized there, and a disregarded REVISE
// still blocked the head permanently, which is exactly the deadlock this
// treat-as-absent choice exists to avoid. `evaluateExactHeadApproval` in
// `check-exact-head-approval.mjs` now disregards both directions the same way,
// so the two gates agree. Do not remove it there on the assumption that this
// function covers it.
//
// It is not silently dropped: `includeDisregarded` returns the rows with
// `disregarded:true` so callers can SAY that an artifact exists and why it does
// not count.
export function readReviewVerdicts(issue,pr,headSha,io=githubIo,{includeDisregarded=false}={}){
  const prefixes=[REVIEW_VERDICT_REF_PREFIX,REVIEW_VERDICT_REPLACEMENT_REF_PREFIX]
  const rows=prefixes.flatMap((prefix)=>io.listRefs(`${prefix}/${Number(issue)}-${Number(pr)}-${String(headSha).toLowerCase()}`))
  return rows.map(({ref,sha})=>{
    const named=parseVerdictRef(ref)
    if(!named||named.issue!==Number(issue)||named.pr!==Number(pr)||named.headSha!==String(headSha).toLowerCase())throw new LaneError(`verdict ref ${ref} escaped its exact tuple prefix`)
    const commit=io.getCommit(sha),record=parseVerdictCommit(commit)
    const assignmentRef=named.replacementSequence===null
      ?`${REVIEW_ASSIGNMENT_REF_PREFIX}/${named.issue}-${named.pr}-${named.headSha}${reviewSlotSuffix(named.slot)}`
      :`${REVIEW_REPLACEMENT_REF_PREFIX}/${named.issue}-${named.pr}-${named.headSha}${reviewSlotSuffix(named.slot)}-${named.replacementSequence}`
    const assignmentSha=io.readRef(assignmentRef)
    // A RETURNED ASSIGNMENT STILL ANSWERS FOR ITS VERDICT.
    //
    // `recordReviewVerdict` does not hold the review mutex, so a verdict can
    // land in the narrow window between the exclusion's fresh verdict scan and
    // its atomic push. The assignment ref is then gone and this read is null.
    // Throwing there would make the audit chain the return exists to protect
    // break the pull request permanently: the exclusion is already recorded, so
    // re-running it is idempotent and restores nothing. The return record is the
    // durable proof of that assignment -- it names the same SHA and reviewer,
    // and its commit is parented on the assignment commit, so the object is
    // still reachable. Resolve through it. This does NOT let the verdict
    // authorize anything: `assertDurableReviewApproval` treats the returned slot
    // as unapproved regardless of what this verdict says.
    let assignmentIdentity=assignmentSha?{sha:assignmentSha,reviewer:parseReviewCursor(io.getCommit(assignmentSha)).reviewer}:null
    if(!assignmentIdentity){
      const retired=readReviewReturns(named.issue,named.pr,named.headSha,io).find((row)=>row.slot===named.slot&&row.replacementSequence===named.replacementSequence&&row.assignmentSha===String(record.assignment_sha??'').toLowerCase())
      if(!retired)throw new LaneError(`verdict ${ref} has no live assignment record`)
      assignmentIdentity={sha:retired.assignmentSha,reviewer:retired.reviewer}
    }
    const assignment={reviewer:assignmentIdentity.reviewer}
    const findingsBody=io.readFindings(record.findings_ref)
    let validated
    try{validated=validateVerdictArtifact({ref,sha,commit,findingsBody,assignment:{sha:assignmentIdentity.sha,reviewer:assignment.reviewer}})}
    catch(error){throw new LaneError(`verdict ${ref} is invalid: ${error.message}`)}
    return {...validated,ref,reviewer:assignment.reviewer,disregarded:!reviewerReadsRepository(assignment.reviewer)}
  }).filter((row)=>includeDisregarded||!row.disregarded)
}

export function reviewActiveRef(reviewer,assignment=null){
  if(!REVIEWERS.some((row)=>row.name===reviewer))throw new LaneError(`unknown reviewer ${reviewer}`)
  if(assignment!==null){
    const issue=Number(assignment.issue),pr=Number(assignment.pr),headSha=String(assignment.headSha??'').toLowerCase(),slot=Number(assignment.slot??1)
    if(!Number.isInteger(issue)||issue<1||!Number.isInteger(pr)||pr<1||!/^[0-9a-f]{40}$/.test(headSha)||!Number.isInteger(slot)||slot<1)throw new LaneError('parallel reviewer lease requires exact issue, PR, head, and slot identity')
    return `${REVIEW_ACTIVE_PARALLEL_REF_PREFIX}/${reviewer}/${issue}-${pr}-${headSha}${reviewSlotSuffix(slot)}`
  }
  return `${REVIEW_ACTIVE_REF_PREFIX}/${reviewer}`
}

export function reviewLeaseRefForAssignment(assignment,parallel=false){return parallel&&/^[0-9a-f]{40}$/i.test(String(assignment?.headSha??''))?reviewActiveRef(assignment.reviewer,assignment):reviewActiveRef(assignment.reviewer)}
export function reviewLeaseIdentity(assignment){return `${assignment.reviewer}:${assignment.issue}:${assignment.pr}:${String(assignment.headSha).toLowerCase()}:${assignment.slot??1}:${assignment.sequence}`}
export function activeLeaseRecordForAssignment(busy,assignment){return busy?.byAssignment?.get(reviewLeaseIdentity(assignment))??null}
// Every live lease that matches one assignment TUPLE, read out of the
// assignment-keyed index rather than the reviewer-keyed `leases` compatibility
// view. `leases` is Map(reviewer -> LAST record), so the moment one provider may
// hold two independent jobs it can hide the very job a repair path is fixing
// (#2694 review, high finding 4). Repair paths ask by tuple, never by identity.
export function activeLeaseRecordsForJob(busy,{issue,pr,headSha,sequence}){
  const head=String(headSha??'').toLowerCase()
  return [...(busy?.byAssignment?.values()??[])].filter((row)=>row.lease.issue===issue&&row.lease.pr===pr&&String(row.lease.headSha).toLowerCase()===head&&row.lease.sequence===sequence)
}
export function activeLeaseRecordForJob(busy,job){return activeLeaseRecordsForJob(busy,job)[0]??null}
// The names a lease for this assignment can legitimately live under: the new
// per-assignment v2 ref, and the pre-cutover one-provider ref an in-flight
// review is still holding. The caller picks whichever one actually HOLDS it.
export function reviewLeaseRefCandidates(assignment,parallel){
  const refs=[reviewLeaseRefForAssignment(assignment,parallel)]
  const legacy=reviewActiveRef(assignment.reviewer)
  if(!refs.includes(legacy))refs.push(legacy)
  return refs
}
// Does `ref` hold the lease for exactly THIS assignment? Returns its SHA, or
// null. Fail-closed: an unreadable commit, an unparseable lease, or a lease that
// names any other tuple answers null rather than "close enough".
export function leaseMatchesAssignment(lease,assignment){
  if(!lease)return false
  if(lease.reviewer!==assignment.reviewer||lease.issue!==Number(assignment.issue)||lease.pr!==Number(assignment.pr)||String(lease.headSha).toLowerCase()!==String(assignment.headSha??'').toLowerCase())return false
  if(assignment.sequence!==undefined&&assignment.sequence!==null&&lease.sequence!==Number(assignment.sequence))return false
  if(lease.slot!==null&&assignment.slot!==undefined&&assignment.slot!==null&&lease.slot!==Number(assignment.slot))return false
  return true
}
export function leaseRefHoldsAssignment(ref,assignment,io){
  let sha
  try{sha=io.readRef(ref)}catch{return null}
  if(!sha)return null
  let lease
  try{lease=parseReviewLease(io.getCommit(sha))}catch{return null}
  return leaseMatchesAssignment(lease,assignment)?sha:null
}
// The ref that ACTUALLY holds this assignment's lease. `reviewLeaseRefForAssignment`
// alone always computes the v2 name on production, so every mutation path that
// used it aimed its compare-and-swap at a ref a legacy in-flight lease does not
// live in (#2694 review, high finding 2). The looked-up snapshot record's own
// `.ref` wins; otherwise each candidate is PROVED to hold this exact assignment
// before it is chosen. When nothing holds it the canonical v2 name is returned,
// so the caller's existing "lease does not match" refusal still fires.
export function resolveAssignmentLeaseRef(assignment,parallel,io,busy=null){
  const cached=busy?activeLeaseRecordForAssignment(busy,assignment):null
  if(cached?.ref)return cached.ref
  const candidates=reviewLeaseRefCandidates(assignment,parallel)
  // `leaseSnapshot` is the complete-or-refused listing findBusyReviewers already
  // paid for. When it is present it ANSWERS this question with no extra wire
  // read: a candidate it does not carry does not exist.
  const snapshot=busy?.leaseSnapshot
  if(snapshot instanceof Map){
    for(const ref of candidates){
      const row=snapshot.get(ref)
      if(!row?.sha)continue
      let lease=null
      try{lease=parseReviewLease(row.commit??io.getCommit(row.sha))}catch{lease=null}
      if(leaseMatchesAssignment(lease,assignment))return ref
    }
    return reviewLeaseRefForAssignment(assignment,parallel)
  }
  for(const ref of candidates)if(leaseRefHoldsAssignment(ref,assignment,io))return ref
  return reviewLeaseRefForAssignment(assignment,parallel)
}

export function parseReviewLease(commit){
  if(!commit)return null
  const message=commit.message??commit.commit?.message??''
  // #2208 FOLLOW-UP (codex-gpt-5.6-sol REJECT, high finding). The lease's SLOT is
  // now carried out of the message, because `findBusyReviewers` has to ask
  // "does MY slot have a verdict", not "has some sibling slot finished". It is
  // read per message FORM, never guessed:
  //   * cursor form  -- current `--assign-reviewer` writes ` slot=N` for every
  //     slot but 1, and omits it for slot 1. Absent therefore MEANS slot 1 here.
  //   * replacement form -- replacement messages written before PR #2077 carry
  //     no `slot=` token at all, so absent is genuinely UNKNOWN, not slot 1.
  //     Same reasoning as parseReviewCursor: reading that silence as slot 1 is
  //     how a slot-2 replacement was once returned as slot 1.
  //   * legacy `generation=` leases are SLOT 1 (round 3). Nothing writes that
  //     form any anymore -- it is read-only history from before review slots
  //     existed at all, so slot 1 is the only slot such a lease could ever have
  //     belonged to. Saying so keeps those leases freed by their own verdict, as
  //     they always have been; leaving them UNKNOWN under the round-3 fail-closed
  //     liveness sentinel would have pinned them busy forever.
  // `slot === null` means "not stated". Liveness callers map that ambiguity to
  // the slot-0 sentinel so no sibling verdict can reclaim the lease; the lease
  // remains busy until its slot identity is repaired or otherwise resolved.
  const leaseMatch=/^db-coordination reviewer-lease generation=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40}) sequence=(\d+)$/i.exec(message)
  const cursorMatch=leaseMatch?null:/^db-coordination reviewer-cursor sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})(?: slot=(\d+))?(?: allowlist=[a-z0-9.,-]+)?$/i.exec(message)
  const replacementMatch=(leaseMatch||cursorMatch)?null:/^db-coordination reviewer-(?:failure-)?replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})(?: slot=(\d+))?(?: allowlist=[a-z0-9.,-]+)? /i.exec(message)
  const match=leaseMatch??cursorMatch??replacementMatch
  if(!match)throw new LaneError('active reviewer lease is malformed')
  const cursorForm=!leaseMatch
  const slot=leaseMatch?1:(match[6]?Number(match[6]):(cursorMatch?1:null))
  const lease={generation:Number(match[1]),reviewer:match[2],issue:Number(match[3]),pr:Number(match[4]),headSha:match[5],sequence:Number(cursorForm?match[1]:match[6]),slot}
  if(!Number.isSafeInteger(lease.generation)||lease.generation<1||!Number.isSafeInteger(lease.sequence)||lease.sequence<1||!REVIEWERS.some((row)=>row.name===lease.reviewer))throw new LaneError('active reviewer lease is malformed')
  if(lease.slot!==null&&(!Number.isSafeInteger(lease.slot)||lease.slot<1))throw new LaneError('active reviewer lease is malformed')
  return lease
}

export function parseReviewExclusion(commit){
  if(!commit)return null
  const message=commit.message??commit.commit?.message??''
  const match=/^db-coordination reviewer-exclusion reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) reason=([a-z-]+) evidence=([0-9a-f]{7,40})$/i.exec(message)
  if(!match||!REVIEWERS.some((row)=>row.name===match[1])||!REVIEW_EXCLUSION_REASONS.has(match[4]))throw new LaneError('reviewer exclusion is malformed')
  return {reviewer:match[1],issue:Number(match[2]),pr:Number(match[3]),reason:match[4],evidenceSha:match[5]}
}

// EXCLUSION GENERATIONS -- WHY A LIFTED EXCLUSION MUST NOT KEEP THE SLOT.
//
// The exclusion ref is create-only, so before generations a reinstatement
// permanently spent the ONLY exclusion slot for that reviewer+PR: a later
// `already-reviewed` or `independence-conflict` exclusion hit the lifted
// record and was refused, and draw-time selection reads only the live
// exclusion set. The independence rule "a provider that already judged these
// bytes is never re-drawn" therefore could not be enforced for any reinstated
// reviewer on that pull request (#2224 review 2, High).
//
// The repair keeps EVERY record append-only. Nothing is ever deleted or
// rewritten: a later exclusion is written to the NEXT generation ref, and a
// generation only stops barring the reviewer when its OWN reinstatement ref
// lifts it. So gen1 lifted + gen2 `already-reviewed` bars the reviewer again,
// and the whole history -- exclusion, lift, re-exclusion -- stays readable.
export const REVIEW_EXCLUSION_GENERATION_LIMIT = 4
export function reviewGenerationSuffix(generation){
  const value=Number(generation)
  if(!Number.isInteger(value)||value<1||value>REVIEW_EXCLUSION_GENERATION_LIMIT)throw new LaneError(`reviewer exclusion generation must be an integer 1..${REVIEW_EXCLUSION_GENERATION_LIMIT}`)
  return value===1?'':`-gen${value}`
}
// Generation 1 keeps the historical ref name EXACTLY, so every exclusion and
// reinstatement recorded before this change reads unchanged.
export function reviewExclusionRef({issue,pr,reviewer,generation=1}){
  return `${REVIEW_EXCLUSION_REF_PREFIX}/${Number(issue)}-${Number(pr)}-${requireGenerationSafeReviewer(reviewer)}${reviewGenerationSuffix(generation)}`
}
export function reviewReinstatementRef({issue,pr,reviewer,generation=1}){
  return `${REVIEW_REINSTATEMENT_REF_PREFIX}/${Number(issue)}-${Number(pr)}-${requireGenerationSafeReviewer(reviewer)}${reviewGenerationSuffix(generation)}`
}
// A reviewer literally named `x-gen2` would make gen1 of `x-gen2` and gen2 of
// `x` the SAME ref, which would silently merge two providers' records. No such
// name is in the registry and this refuses one ever being added quietly.
export function requireGenerationSafeReviewer(reviewer){
  const name=String(reviewer??'')
  if(/-gen\d+$/i.test(name))throw new LaneError(`reviewer name ${name} collides with the exclusion generation ref suffix`)
  return name
}
export const REVIEW_EXCLUSION_GENERATIONS = Object.freeze(Array.from({length:REVIEW_EXCLUSION_GENERATION_LIMIT},(_,index)=>index+1))

export function reviewerExclusions(issue,pr,io,{fresh=false}={}){
  const prefix=`${REVIEW_EXCLUSION_REF_PREFIX}/${Number(issue)}-${Number(pr)}-`
  const result=new Map()
  // Read the complete, finite reviewer registry in one GraphQL request.  A
  // prefix listing returns only ref/SHA pairs and therefore costs one extra
  // getCommit request per exclusion while the global reviewer mutex is held.
  // That variable cost defeated the mutex-section request reserve (#1833).
  // Exact reads also make absence explicit and cannot be truncated.
  const refs=REVIEWERS.flatMap(({name})=>REVIEW_EXCLUSION_GENERATIONS.map((generation)=>reviewExclusionRef({issue,pr,reviewer:name,generation})))
  // The reinstatement refs ride in the SAME batched record read as the
  // exclusions, so lifting a reinstated exclusion costs ZERO extra requests on
  // the production io and the mutex-section reserve is unchanged (#1833). Only
  // test doubles without `readReviewRecords` pay a second prefix listing.
  const reinstatePrefix=`${REVIEW_REINSTATEMENT_REF_PREFIX}/${Number(issue)}-${Number(pr)}-`
  const reinstateRefs=REVIEWERS.flatMap(({name})=>REVIEW_EXCLUSION_GENERATIONS.map((generation)=>reviewReinstatementRef({issue,pr,reviewer:name,generation})))
  const exact=io.readReviewRecords?.([...refs,...reinstateRefs],null)
  const rows=exact
    ? refs.map((ref)=>{const row=exact.get(ref);return row?{ref,...row}:null}).filter(Boolean)
    : (fresh?io.__freshListRefs(prefix):io.listRefs(prefix))??[]
  // Returns are written only by exclusion. Keep historical presence even after
  // reinstatement so a redraw cannot forget its policy; ordinary draws pay no
  // extra return-history lookup. The exclusion records themselves are immutable.
  Object.defineProperty(result,'hasRecordedExclusions',{value:rows.length>0})
  // On the fallback path the second listing is only paid when there is an
  // exclusion that could be lifted. No exclusions, no reinstatement read, and
  // the measured request budget of the ordinary assignment path is unchanged
  // (scripts/manage-migration-author-lanes.test.mjs pins it at 23).
  const reinstateRows=exact
    ? reinstateRefs.map((ref)=>{const row=exact.get(ref);return row?{ref,...row}:null}).filter(Boolean)
    : rows.length?((fresh?io.__freshListRefs(reinstatePrefix):io.listRefs(reinstatePrefix))??[]):[]
  const reinstated=new Map()
  for(const row of reinstateRows){
    const record=parseReviewReinstatement(row.commit??io.getCommit(row.sha))
    const generation=REVIEW_EXCLUSION_GENERATIONS.find((each)=>row.ref===reviewReinstatementRef({issue,pr,reviewer:record.reviewer,generation:each}))
    if(record.issue!==Number(issue)||record.pr!==Number(pr)||!generation)throw new LaneError('durable reviewer reinstatement does not match its ref identity')
    reinstated.set(`${record.reviewer}#${generation}`,record)
  }
  for(const row of rows){
    const exclusion=parseReviewExclusion(row.commit??io.getCommit(row.sha))
    const generation=REVIEW_EXCLUSION_GENERATIONS.find((each)=>row.ref===reviewExclusionRef({issue,pr,reviewer:exclusion.reviewer,generation:each}))
    if(exclusion.issue!==Number(issue)||exclusion.pr!==Number(pr)||!generation)throw new LaneError('durable reviewer exclusion does not match its ref identity')
    // A lift only ever answers for its OWN generation. A later generation's
    // exclusion is untouched by an earlier generation's reinstatement, which is
    // what lets an independence exclusion be recorded after a lift.
    const lift=reinstated.get(`${exclusion.reviewer}#${generation}`)
    if(lift){
      // An exclusion ref is create-only and its commit never moves, so a
      // reinstatement naming a DIFFERENT exclusion SHA cannot be produced by any
      // correct path. That is corruption, not a stale record, and it is refused
      // rather than resolved in either direction.
      if(lift.exclusionSha!==String(row.sha).toLowerCase())throw new LaneError(`reviewer reinstatement for ${exclusion.reviewer} names exclusion ${lift.exclusionSha} but the durable exclusion is ${row.sha}; reviewer exclusion read stopped for audit`)
      // Belt and braces: the reason is proved from the EXCLUSION itself, not
      // from the reinstatement's copy of it. An independence guarantee can never
      // be lifted even if some record claims it was.
      if(!REINSTATABLE_EXCLUSION_REASONS.has(exclusion.reason))throw new LaneError(`reviewer reinstatement exists for a ${exclusion.reason} exclusion of ${exclusion.reviewer}; that reason is an independence guarantee and is never lifted`)
      continue
    }
    // Retired reuse cap (#2893): a legacy `already-reviewed` record never bars a draw.
    if(RETIRED_EXCLUSION_REASONS.has(exclusion.reason))continue
    result.set(exclusion.reviewer,exclusion)
  }
  return result
}

// THE RECORD THAT UNDOES A FALSE "TERMINAL" CALL -- WITHOUT ERASING IT.
//
// Append-only by construction: the original exclusion ref is never deleted,
// rewritten or moved, so the audit trail of the failure that was reported
// survives whatever happens next. The reinstatement is a SECOND, create-only
// ref whose commit is parented on the exclusion commit, and it carries the
// wrapper's own `doctor` output verbatim in its commit body. The header line
// carries a digest of that body, so a record whose evidence was edited or
// truncated stops matching its own header.
// The SAME count the writer records and the reader re-derives. A header may
// not claim more passing checks than the stored body actually contains
// (#2224 review 2, Low): `checks=` is re-counted from the proof, not trusted.
export function countDoctorPassLines(proof){
  return String(proof??'').split(/\r?\n/).filter((line)=>/^\s*PASS\s+\S/.test(line)||/^\s*\S(?:.*\S)?\s+:\s*(?:PASS|OK)\b/.test(line)).length
}
export function parseReviewReinstatement(commit){
  if(!commit)return null
  const message=String(commit.message??commit.commit?.message??'')
  const newline=message.indexOf('\n')
  const header=newline===-1?message:message.slice(0,newline)
  const proof=newline===-1?'':message.slice(newline).replace(/^\n\n?/,'')
  const match=/^db-coordination reviewer-reinstatement reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) exclusion=([0-9a-f]{7,40}) reason=([a-z-]+) wrapper=(\S+) proof=sha256:([0-9a-f]{64}) checks=(\d+)$/i.exec(header)
  if(!match||!REVIEWERS.some((row)=>row.name===match[1])||!REINSTATABLE_EXCLUSION_REASONS.has(match[5])||Number(match[8])<1)throw new LaneError('reviewer reinstatement is malformed')
  if(createHash('sha256').update(proof,'utf8').digest('hex')!==match[7].toLowerCase())throw new LaneError('reviewer reinstatement proof does not match its recorded digest')
  // Digest self-consistency is not proof CONTENT. A record whose header claims
  // passing checks its own body does not contain is refused outright.
  if(countDoctorPassLines(proof)!==Number(match[8]))throw new LaneError(`reviewer reinstatement claims ${Number(match[8])} passing checks but its recorded proof contains ${countDoctorPassLines(proof)}`)
  return {reviewer:match[1],issue:Number(match[2]),pr:Number(match[3]),exclusionSha:match[4].toLowerCase(),reason:match[5],wrapper:match[6],proofDigest:match[7].toLowerCase(),passedChecks:Number(match[8]),proof}
}

// A RETURN IS THE AUDIT TRAIL FOR AN ASSIGNMENT THAT WAS NEVER REVIEWED.
//
// Excluding a reviewer that already held this head's assignment used to strand
// the pull request permanently. The exclusion released the provider's lease but
// left the per-head assignment ref naming the now-excluded reviewer, so every
// later --assign-reviewer refused with "it was not returned or re-leased" while
// assertDurableReviewApproval kept demanding an APPROVE for a slot no eligible
// reviewer could ever be drawn into. --replace-failed-reviewer is not the way
// out: it requires a TERMINAL_FAILURE_CODES value, and a reviewer excluded for
// independence did not fail. Nothing else could return the slot.
//
// The return record is the missing half of the exclusion, not a relaxation of
// it. The excluded reviewer stays excluded forever; only the SLOT comes back.
// The record is create-only, named for the exact assignment it retires, and its
// commit is parented on that assignment commit so the retired assignment object
// stays reachable after its ref is compare-and-cleared. The assignment is never
// silently dropped: the record keeps who was assigned, to which head and slot,
// which assignment SHA it retires, and why it came back.
export function parseReviewReturn(commit){
  if(!commit)return null
  const message=commit.message??commit.commit?.message??''
  // `replacement=` is OPTIONAL and carries the replacement sequence of the
  // assignment being retired, or is absent for an original (sequence-less)
  // assignment. It is recorded because a slot's history is ORDERED: without it,
  // `assertDurableReviewApproval` cannot tell "the returned record is older than
  // the live one" from "the live record is the stale original the returned
  // replacement had already superseded", and the second case must fail closed.
  // `sequence=` is the retired assignment's GLOBALLY MONOTONE cursor sequence,
  // and it is what makes a returned slot answerable again. The replacement
  // sequence alone could not: an original assignment has none, so a re-drawn
  // original always compared as 0 and a slot whose replacement had been returned
  // stayed red forever, even after a fresh reviewer approved the new assignment
  // (grok-4.6 REVISE, high finding 2). It is optional only so that a record
  // written before this change still parses; such a record is ordered by reading
  // the retired assignment commit instead.
  const match=/^db-coordination reviewer-return reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{40}) slot=(\d+) assignment=([0-9a-f]{40})(?: sequence=(\d+))?(?: replacement=(\d+))? reason=([a-z-]+)$/i.exec(message)
  if(!match||!REVIEWERS.some((row)=>row.name===match[1])||!REVIEW_EXCLUSION_REASONS.has(match[9])||Number(match[5])<1||(match[7]!==undefined&&Number(match[7])<1)||(match[8]!==undefined&&Number(match[8])<1))throw new LaneError('reviewer return is malformed')
  return {reviewer:match[1],issue:Number(match[2]),pr:Number(match[3]),headSha:match[4].toLowerCase(),slot:Number(match[5]),assignmentSha:match[6].toLowerCase(),sequence:match[7]===undefined?null:Number(match[7]),replacementSequence:match[8]===undefined?null:Number(match[8]),reason:match[9]}
}

// THE REF NAME IS THE AUTHORITY ON SLOT AND SEQUENCE.
//
// A commit message is written by whichever command created it, and the
// replacement writer did not state a slot at all before PR #2077. The REF, by
// contrast, is constructed from the request in every writer and is what the
// merge gate, the verdict namespace, and the return namespace are all keyed on.
// So slot, head and replacement sequence are read from the ref here, once, and
// every caller shares this one parser rather than repeating the pattern.
export function parseAssignmentRef(ref){
  const match=/^refs\/db-review-(assignments|replacements)\/(\d+)-(\d+)-([0-9a-f]{40})(?:-slot(\d+))?(?:-(\d+))?$/.exec(String(ref??''))
  if(!match||(match[1]==='replacements')!==Boolean(match[6]))return null
  const slot=Number(match[5]??1)
  if(!Number.isInteger(slot)||slot<1)return null
  return {replacement:match[1]==='replacements',issue:Number(match[2]),pr:Number(match[3]),headSha:match[4],slot,replacementSequence:match[6]?Number(match[6]):null}
}

export function reviewReturnRef({issue,pr,headSha,slot,assignmentSha}){
  return `${REVIEW_RETURN_REF_PREFIX}/${Number(issue)}-${Number(pr)}-${String(headSha).toLowerCase()}${reviewSlotSuffix(slot)}-${String(assignmentSha).toLowerCase()}`
}

// Every assignment SHA durably returned for this exact head. The ref name
// carries the retired assignment SHA, but the COMMIT is what is trusted here: a
// ref name is only a label, and this answer decides whether a review slot is
// live work or superseded history. Absence of the namespace is absence of any
// return -- this reader never invents one.
export function readReviewReturns(issue,pr,headSha,io=githubIo){
  const head=String(headSha).toLowerCase()
  const rows=io.listRefs?.(`${REVIEW_RETURN_REF_PREFIX}/${Number(issue)}-${Number(pr)}-${head}`)??[]
  return rows.map((row)=>{
    const parsed=parseReviewReturn(row.commit??io.getCommit(row.sha))
    if(parsed.issue!==Number(issue)||parsed.pr!==Number(pr)||parsed.headSha!==head||row.ref!==reviewReturnRef(parsed))throw new LaneError('durable reviewer return does not match its ref identity')
    return {...parsed,ref:row.ref,sha:row.sha}
  })
}

// THE VERDICT RACE LEAVES A PIN, AND THE PIN IS CLEARED HERE.
//
// `recordReviewVerdict` does not take the review mutex. The return's verdict
// scan is re-read inside the mutex at the last possible moment, so a verdict
// that lands after THAT read still slips through. It authorizes nothing -- its
// `assignment_sha` names the retired object, and the merge gate treats the
// returned slot as unapproved regardless. But the create-only verdict ref is
// keyed per {issue, pr, head, slot, replacement sequence}, not per assignment
// SHA, so the raced verdict OCCUPIES the tuple. The re-drawn reviewer then
// cannot record any verdict for this head, and the only escape was a new push
// (grok-4.6 REVISE, medium finding).
//
// So the orphan is retired, not deleted and not ignored: the verdict object is
// moved under its own durable namespace, named for the tuple AND the verdict
// SHA, in one atomic push that compare-and-clears the tuple ref. The audit
// survives -- the object stays reachable under a ref that says exactly which
// retired assignment it answered -- and the head stays reviewable. Anything
// that is not plainly this orphan (a verdict naming some other assignment)
// stops the command for audit rather than being moved.
export function retiredVerdictRef({issue,pr,headSha,slot,replacementSequence,verdictSha}){
  return `${REVIEW_RETIRED_VERDICT_REF_PREFIX}/${Number(issue)}-${Number(pr)}-${String(headSha).toLowerCase()}${reviewSlotSuffix(slot)}${replacementSequence==null?'':`-${Number(replacementSequence)}`}-${String(verdictSha).toLowerCase()}`
}

export function retireVerdictsOrphanedByReturn({issue,pr,returns,ownerSha},io){
  if(!returns.length||typeof io.readReviewRefs!=='function')return []
  const refs=returns.map((row)=>verdictRef({issue,pr,headSha:row.headSha,slot:row.slot,replacementSequence:row.replacementSequence}))
  const raced=io.readReviewRefs(refs)
  const orphans=refs.map((ref,index)=>({ref,sha:raced.get(ref)??null,row:returns[index]})).filter((row)=>row.sha)
  if(!orphans.length)return []
  const changes=[{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha}]
  for(const orphan of orphans){
    const record=parseVerdictCommit(io.getCommit(orphan.sha))
    if(String(record.assignment_sha??'').toLowerCase()!==String(orphan.row.sha).toLowerCase())throw new LaneError(`verdict ${orphan.ref} does not answer the assignment this exclusion returned; reviewer exclusion stopped for audit`)
    orphan.retiredRef=retiredVerdictRef({issue,pr,headSha:orphan.row.headSha,slot:orphan.row.slot,replacementSequence:orphan.row.replacementSequence,verdictSha:orphan.sha})
    changes.push({ref:orphan.retiredRef,expected:null,sha:orphan.sha},{ref:orphan.ref,expected:orphan.sha,sha:null})
  }
  io.atomicReviewRefs(changes)
  const after=io.readReviewRefs([MUTEX_REF,...orphans.flatMap((orphan)=>[orphan.retiredRef,orphan.ref])])
  if(after.get(MUTEX_REF)!==ownerSha)throw new LaneError('atomic retired-verdict readback mismatch')
  for(const orphan of orphans)if(after.get(orphan.retiredRef)!==orphan.sha||after.get(orphan.ref)!==null)throw new LaneError('atomic retired-verdict readback mismatch')
  return orphans.map((orphan)=>({ref:orphan.ref,retiredRef:orphan.retiredRef,sha:orphan.sha}))
}

// The rows a reviewer's own durable return records say were handed back, shaped
// exactly like the live rows `excludeReviewerForPr` builds from assignment refs,
// so the retirement below cannot tell -- and does not need to tell -- a first run
// from a repair run. Identity is proved from the commit and then checked against
// the ref name, the same way `readReviewReturns` does it; a ref name is a label,
// never the authority on what was returned.
export function reviewReturnsHeldBy({issue,pr,reviewer,rows},io){
  return (rows??io.listRefs(`${REVIEW_RETURN_REF_PREFIX}/${Number(issue)}-${Number(pr)}-`)??[]).flatMap((row)=>{
    const record=parseReviewReturn(row.commit??io.getCommit(row.sha))
    if(record.issue!==Number(issue)||record.pr!==Number(pr)||row.ref!==reviewReturnRef(record))throw new LaneError('durable reviewer return does not match its ref identity')
    if(record.reviewer!==reviewer)return []
    return [{ref:row.ref,sha:record.assignmentSha,headSha:record.headSha,slot:record.slot,replacementSequence:record.replacementSequence}]
  })
}

// Which of those returned rows still has a verdict sitting on its per-tuple ref.
// This is a READ, taken before the mutex, so a repair run that has nothing to
// retire costs one batched request and never takes the global lock.
export function outstandingRetirements(rows,{issue,pr},io){
  if(!rows.length||typeof io.readReviewRefs!=='function')return []
  const refs=rows.map((row)=>verdictRef({issue,pr,headSha:row.headSha,slot:row.slot,replacementSequence:row.replacementSequence}))
  const raced=io.readReviewRefs(refs)
  return rows.filter((row,index)=>Boolean(raced.get(refs[index])))
}

// Which generation does a NEW exclusion belong in, and which one does a
// reinstatement answer? Both questions are read from the durable records only.
// A generation whose own reinstatement ref exists has been lifted, so it no
// longer bars anyone and no longer holds the slot: the walk moves on to the
// next generation. The first generation that is NOT lifted is the live one --
// absent (create it), identical (idempotent no-op), or different (the existing
// refusal). Nothing here deletes or rewrites a record.
export function reviewExclusionGenerationRows({issue,pr,reviewer},io,{fresh=false}={}){
  const exclusionRefs=REVIEW_EXCLUSION_GENERATIONS.map((generation)=>reviewExclusionRef({issue,pr,reviewer,generation}))
  const reinstateRefs=REVIEW_EXCLUSION_GENERATIONS.map((generation)=>reviewReinstatementRef({issue,pr,reviewer,generation}))
  // One batched GraphQL read on the production io. Test doubles without it pay
  // two prefix listings, which reviewOperationIo caches, rather than one read
  // per generation.
  const exact=io.readReviewRecords?.([...exclusionRefs,...reinstateRefs],null)
  const listed=exact?null:new Map([...((fresh?io.__freshListRefs(`${REVIEW_EXCLUSION_REF_PREFIX}/${issue}-${pr}-`):io.listRefs(`${REVIEW_EXCLUSION_REF_PREFIX}/${issue}-${pr}-`))??[]),
    ...((fresh?io.__freshListRefs(`${REVIEW_REINSTATEMENT_REF_PREFIX}/${issue}-${pr}-`):io.listRefs(`${REVIEW_REINSTATEMENT_REF_PREFIX}/${issue}-${pr}-`))??[])].map((row)=>[row.ref,row]))
  const shaOf=(ref)=>(exact?exact.get(ref)?.sha:listed.get(ref)?.sha)??null
  const commitOf=(ref,sha)=>(exact?exact.get(ref)?.commit:listed.get(ref)?.commit)??io.getCommit(sha)
  return REVIEW_EXCLUSION_GENERATIONS.map((generation)=>{
    const ref=exclusionRefs[generation-1],sha=shaOf(ref)
    return {generation,ref,sha,commit:sha?commitOf(ref,sha):null,reinstatementRef:reinstateRefs[generation-1],reinstatementSha:shaOf(reinstateRefs[generation-1])}
  })
}

export function liveExclusionGeneration({issue,pr,reviewer,reason,evidenceSha},io){
  for(const row of reviewExclusionGenerationRows({issue,pr,reviewer},io)){
    if(!row.sha)return row
    // Lifted: it bars nobody, so it does not hold the slot either.
    if(row.reinstatementSha)continue
    const parsed=parseReviewExclusion(row.commit)
    if(parsed.issue!==issue||parsed.pr!==pr||parsed.reviewer!==reviewer)throw new LaneError('durable reviewer exclusion does not match its ref identity')
    return row
  }
  // Reaching here means every generation exists AND every one was lifted: a live
  // generation returns above, so the loop can only run out on lifted rows. The
  // reviewer is therefore NOT currently excluded -- there is simply no generation
  // left to record a new exclusion in. Saying "every one is live" here would send
  // the caller to fix an exclusion that is not barring anything.
  throw new LaneError(`reviewer ${reviewer} has used all ${REVIEW_EXCLUSION_GENERATION_LIMIT} durable exclusion generations for issue #${issue} PR #${pr} and every one of them has been lifted, so the reviewer is NOT currently excluded and no generation remains in which to record a new exclusion`)
}
