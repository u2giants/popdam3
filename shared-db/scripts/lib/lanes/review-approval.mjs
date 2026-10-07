// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { verdictOpensLine as sharedVerdictOpensLine, evidenceTiedToHead as sharedEvidenceTiedToHead, isApprovalFor as sharedIsApprovalFor, isVerdictFor as sharedIsVerdictFor, anyVerdictFor as sharedAnyVerdictFor } from '../../lib/review-verdict.mjs'
import { parseVerdictRef, REVIEW_VERDICT_REF_PREFIX, REVIEW_VERDICT_REPLACEMENT_REF_PREFIX } from '../../lib/review-verdict-artifact.mjs'
import { execFileSync } from 'node:child_process'
import { REVIEW_ASSIGNMENT_REF_PREFIX, REVIEW_REPLACEMENT_REF_PREFIX, REVIEW_RETURN_REF_PREFIX } from './constants.mjs'
import { parseAssignmentRef, parseReviewCursor, readReviewReturns, readReviewVerdicts } from './review-records.mjs'
import { LaneError } from './claims.mjs'
import { reviewTargetIsRecordable } from './admission.mjs'
import { reviewSlotSuffix } from './review-leases.mjs'
import { reviewerKnownNonReading } from './reviewer-roster.mjs'
import { githubIo, listDurableVerdictRefs, main } from '../../manage-migration-author-lanes.mjs'

// Bounded readback ladder for the atomic mutex release (issues #2457, #2844): same
// shape as releaseOwnedRef's, ~10.5s instead of the former ~3s.
export const MUTEX_RELEASE_READBACK_DELAYS_MS=[0,500,1000,2000,3000,4000]

// A reviewer assignment is filed under issue + PR + THE EXACT HEAD IT REVIEWS.
// That head is not decoration: a verdict is only ever valid for the commit the
// reviewer actually read, so collapsing the key to issue + PR would let one
// reviewer's verdict silently cover code they never saw. The key stays.
//
// What was broken is FINDABILITY. Nothing indexed the assignments of a pull
// request, so once a push moved the head, a perfectly good record became
// invisible and the tool reported it "missing" -- sending people to hunt a
// data-loss bug that did not exist (issue #1351, sequence 243 on PR #1347).
// This lookup makes every assignment for a PR findable under any head, so the
// tool can say what IS recorded instead of claiming nothing is.
export function findPrReviewAssignments(issue,pr,io){
  if(typeof io.listRefs!=='function')return null
  const prefix=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${Number(issue)}-${Number(pr)}-`
  return (io.listRefs(prefix)??[])
    .map((row)=>({...parseReviewCursor(io.getCommit(row.sha)),ref:row.ref,assignmentSha:row.sha}))
    .filter((row)=>row.issue===Number(issue)&&row.pr===Number(pr))
    .sort((a,b)=>b.sequence-a.sequence)
}

// WHAT COUNTS AS A RECORDED VERDICT (issue #1822).
//
// This predicate was never a function. "Tied to the head AND contains a verdict
// word anywhere in the body" was written out longhand at EIGHT separate sites in
// this file, so there was no single place where it could be wrong and no single
// place where it could be fixed.
//
// A NINTH site, `previewGateProof`, is a VARIANT of the same defect rather than
// a ninth copy: it tests `\bAPPROVE\b` only, and adds a bundle/assignment
// clause. It is called out explicitly because a mechanical find-and-replace
// across "nine identical sites" would silently mangle it -- and it is the one
// that fails open.
//
// The old reading matched a verdict word ANYWHERE in the body. Ordinary prose
// that discusses reviewing, in a comment that also quotes the head, therefore
// read as a recorded verdict. That is not hypothetical: PR #1818 -- the change
// that enforces exact-head approval at the merge gate -- locked itself out of
// its own governed reviewer assignment with two of its own progress notes, one
// containing "approve something else entirely" and one containing "ride along
// with any REVISE findings". Its own patch for this behaviour lived in a file
// the assignment gate does not read. Those two bodies are in the test suite
// verbatim, because a test on a synthetic string would be a test of a different
// program.
//
// THE RULE: a verdict word must OPEN its line, after leading markdown emphasis
// and blockquote markers are stripped, optionally behind the `VERDICT:` label
// the reviewer wrappers actually emit. That is how a wrapper states a verdict
// and is not how anyone writes a status update.
//
// IT IS SYMMETRIC, AND THE SYMMETRY IS THE POINT. Eight of the nine sites fail
// CLOSED -- a phantom verdict blocks an assignment, which is safe and merely
// baffling. The ninth, `previewGateProof`, fails OPEN: it treats a matching body
// as an independent APPROVE and lets a migration through. Under the old reading
// a comment that quoted the head and merely mentioned approval satisfied it --
// including a sentence stating that an approval was ABSENT. Fixing only the
// refusal direction would leave the repository strict about blocking and loose
// about authorizing, which is the worst available asymmetry and would look like
// an improvement.
// The label strip removes ONLY the `VERDICT:` label itself. It must never be
// widened to skip arbitrary leading words: a strip that swallowed them would
// read `VERDICT: DO NOT APPROVE` as an approval, turning the plainest possible
// refusal into the strongest possible authorization. Pinned by test.
// REJECT is a real verdict word in this repository's reviewer wrappers alongside
// REVISE, and REQUEST_CHANGES is GitHub's own.
//
// `APPROVE WITH CONDITIONS` is a REFUSAL WITH A REMEDY, not an approval. Accepting
// it would merge before the conditions are met AND leave a durable record saying
// the reviewer approved -- the damage and the evidence of no damage in one act.
//
// The lookahead sits on the APPROVAL pattern ONLY, deliberately. Adding it to the
// refusal pattern too would make the conditional verdict count as a recorded
// refusal, which LOCKS the head: the reviewer could then never clear their own
// conditions, because a later unconditional APPROVE at that same head would be
// refused as "a verdict already exists". So it must be neither an approval nor a
// refusal -- it withholds the decision rather than recording one. Both halves are
// asserted in the same test, because "does not approve" and "does not lock" are
// two separate claims and only the first is obvious.
export function verdictOpensLine(body,pattern){
  return sharedVerdictOpensLine(body,pattern)
}
// Structured GitHub review states are data, not prose, so they are trusted as
// they always were -- the opening-line rule governs free text only.
export const reviewState=(row)=>String(row?.state??'').toUpperCase()
export function evidenceTiedToHead(row,headSha){
  return sharedEvidenceTiedToHead(row,headSha)
}
// An APPROVE for this head. Used by the fail-OPEN preview gate.
export function isApprovalFor(row,headSha){
  return sharedIsApprovalFor(row,headSha)
}
// Any decision for this head -- approval or refusal. Used by the fail-CLOSED
// assignment, replacement and lease guards.
export function isVerdictFor(row,headSha){
  return sharedIsVerdictFor(row,headSha)
}
export const anyVerdictFor=sharedAnyVerdictFor
// The executable predicate lives in lib/review-verdict.mjs and is shared with
// the exact-head merge gate. These compatibility exports keep existing callers
// stable while preventing another local regex implementation from drifting.
// Free-text evidence is unauthorized by default; only repository-authorized
// GitHub associations retain the reviewer-verdict capability.

// The fail-OPEN preview gate's authorization decision, extracted so it can be
// executed by a test. `previewGateProof` itself shells out to `gh` on its first
// two lines, so every test in this repo replaces the whole method with a stub
// that returns success -- which left the one decision here that can AUTHORIZE A
// MIGRATION completely uncovered.
//
// `readAssignments` is a THUNK on purpose. At the call site it performs network
// reads, and it sits inside the `some()` short-circuit so it only runs for
// evidence that already carries an approval and lacks the bundle id. Hoisting it
// to a plain argument would call it on every gate evaluation and raise the wire
// budget this repo treats as significant.
export function gateAuthorizes(evidence,headSha,bundleId,readAssignments){
  return (evidence??[]).some((row)=>isApprovalFor(row,headSha)&&(
    String(row?.body??'').includes(bundleId)||
    (readAssignments?.()??[]).some((assignment)=>assignment?.headSha===headSha)))
}

// A VERDICT IS AN ARTIFACT, NEVER A SENTENCE (issue #2075).
//
// This predicate used to be "an issue comment, a PR comment, or a PR review tied
// to this head contains a decision word". That made every lane decision -- lease
// liveness, the busy probe, the capacity report, assignment, replacement and
// release -- answerable by PROSE, and in particular by the governed-review
// runner's own findings comment in the window before its create-only artifact
// was recorded. Issue #2075 is exactly that: a findings comment whose verdict
// line was posted, whose artifact was never written, and whose pull request then
// deadlocked in BOTH directions -- the lease looked finished, so replacement and
// release were refused, while no artifact existed to authorize anything.
//
// The only thing that records a verdict is `recordReviewVerdict`, and the only
// thing it produces is a create-only ref under refs/db-review-verdicts/ or
// refs/db-review-verdict-replacements/. So that is what is read here. Comment
// text remains evidence for a human; it is no longer an input to any decision.
//
// ONE REQUEST, NOT ONE PER LEASE. `git/matching-refs` is a plain string-prefix
// match (measured 2026-08-30, see check-exact-head-approval.mjs), and both
// namespaces share the prefix `refs/db-review-verdict`, so a single listing
// answers for every (issue, pr, head) tuple an operation asks about and
// `reviewOperationIo` caches it for the rest of that operation.
export const DURABLE_VERDICT_REF_NAMESPACE = 'refs/db-review-verdict'
export function readDurableVerdictRefs(io){
  // `listReviewRefsPaged` reads the whole namespace in one request and REFUSES
  // past REVIEW_REF_ROW_LIMIT rather than returning a partial list; plain `listRefs`
  // refuses at 100 rows inside a wire budget. Either refusal is loud, and loud is
  // the only safe failure here: a silently short list reads as "no verdict",
  // which is the fail-OPEN direction for release and replacement.
  const reader=typeof io?.listReviewRefsPaged==='function'?io.listReviewRefsPaged.bind(io):(typeof io?.listRefs==='function'?io.listRefs.bind(io):null)
  if(!reader)throw new LaneError('durable reviewer verdict refs are unreadable; a verdict can only be proved by its create-only artifact, never by comment text')
  const rows=reader(DURABLE_VERDICT_REF_NAMESPACE)
  if(!Array.isArray(rows))throw new LaneError('durable reviewer verdict refs are unreadable; a verdict can only be proved by its create-only artifact, never by comment text')
  return rows
}
export function hasVerdictForHead(issue,pr,headSha,io,options={}){
  const head=String(headSha??'').toLowerCase()
  // #2208. `options.slot` is OPTIONAL and narrows the match to one slot's own
  // verdict ref. Omitted (every pre-#2208 caller), this answers "does ANY slot
  // have a durable verdict for this head" -- unchanged from before #2208, and
  // still what a caller that only knows the head (not a specific slot) needs.
  // A caller that IS asking on behalf of one specific slot -- "did MY slot's
  // verdict change", not "did some sibling slot finish" -- must pass its own
  // slot so a sibling slot's unrelated, already-existing verdict cannot be
  // mistaken for this slot's own state changing.
  //
  // #3947. `options.replacementSequence` further narrows the match to ONE
  // assignment's own verdict ref. Omitted, the coarse head/slot answer is
  // unchanged. `null` matches only an original assignment's verdict; a number
  // matches only that replacement's. A verdict on a superseded predecessor must
  // never be read as "this assignment already judged" -- that is what marked a
  // freshly drawn replacement's lease stale and blocked the governed review the
  // merge gate demands.
  const slot=options.slot==null?null:Number(options.slot)
  const rsFilter=options.replacementSequence===undefined?undefined:options.replacementSequence===null?null:Number(options.replacementSequence)
  return listDurableVerdictRefs(io,options).some((row)=>{
    const named=parseVerdictRef(row.ref)
    if(!named||named.issue!==Number(issue)||named.pr!==Number(pr)||named.headSha!==head)return false
    if(slot!==null&&named.slot!==slot)return false
    if(rsFilter===undefined)return true
    if(rsFilter===null)return named.replacementSequence===null
    return named.replacementSequence===rsFilter
  })
}

// #2079 READ SIDE, REPLACEMENT PATH. `hasVerdictForHead` answers from durable ref
// NAMES only -- deliberately, because that is one listing and no attribution. But
// the replacement path needs attribution: a verdict artifact left by a reviewer
// that cannot open the repository must NOT forbid the replacement that exists to
// re-review that exact slot. So resolve each durable verdict ref at this head back
// to the assignment (or replacement) ref it names, read that record's reviewer,
// and ask `reviewerReadsRepository`.
//
// FAIL CLOSED. Anything unresolvable -- a malformed verdict ref, a missing or
// unreadable assignment record, a name outside the roster -- blocks. Replacement
// is the "un-review this head" direction, so ambiguity must never open it. Comment
// text is not consulted anywhere in here.
//
// #3947. A VERDICT ON AN ASSIGNMENT A LATER RETURN HAS SUPERSEDED IS HISTORY,
// NOT THE AUTHORIZATION OF RECORD. The merge gate already refuses to let such a
// verdict satisfy the slot ("nor by a record the returned one had already
// superseded") and demands a strictly newer live assignment. Replacement is the
// only command that can draw that assignment, so a verdict left on the
// superseded predecessor must not forbid the very redraw the gate demands --
// otherwise no supported command can ever unstick the slot. The same ordering
// rule the gate uses is applied here: the owning assignment is superseded when a
// return for the same slot carries a cursor sequence at least as large as its
// own. Anything unreadable still fails closed and blocks.
function owningAssignmentSupersededByReturn({issue,pr,headSha,slot,sequence},io){
  let returns
  try{returns=readReviewReturns(issue,pr,headSha,io)}catch{return true}
  const sameSlot=returns.filter((row)=>row.slot===Number(slot))
  if(!sameSlot.length)return false
  if(!Number.isInteger(Number(sequence)))return true
  return sameSlot.some((row)=>{
    let seq=row.sequence
    if(seq==null){try{seq=Number(parseReviewCursor(io.getCommit(row.assignmentSha))?.sequence)}catch{return true}}
    return Number.isInteger(Number(seq))&&Number(seq)>=Number(sequence)
  })
}
export function durableVerdictBlocksReplacement(ref,io){
  const named=parseVerdictRef(ref)
  if(!named)return true
  const owningRef=named.replacementSequence===null
    ?`${REVIEW_ASSIGNMENT_REF_PREFIX}/${named.issue}-${named.pr}-${named.headSha}${reviewSlotSuffix(named.slot)}`
    :`${REVIEW_REPLACEMENT_REF_PREFIX}/${named.issue}-${named.pr}-${named.headSha}${reviewSlotSuffix(named.slot)}-${named.replacementSequence}`
  let reviewer=null,sequence=null
  try{
    const sha=io.readRef(owningRef)
    if(sha){const cursor=parseReviewCursor(io.getCommit(sha));reviewer=cursor?.reviewer??null;sequence=cursor?.sequence??null}
  }catch{return true}
  if(!reviewer)return true
  // NOT `reviewerReadsRepository(reviewer)`: that returns false for an unknown
  // name, which would PERMIT replacement on an artifact nobody can attribute.
  // Only a roster row explicitly marked non-reading may be discarded.
  if(reviewerKnownNonReading(reviewer))return false
  return !owningAssignmentSupersededByReturn({issue:named.issue,pr:named.pr,headSha:named.headSha,slot:named.slot,sequence},io)
}
export function headVerdictBlocksReplacement(issue,pr,headSha,io,options={}){
  const head=String(headSha??'').toLowerCase()
  return listDurableVerdictRefs(io,options).some((row)=>{
    const named=parseVerdictRef(row.ref)
    if(!named||named.issue!==Number(issue)||named.pr!==Number(pr)||named.headSha!==head)return false
    if(options.slot!=null&&named.slot!==Number(options.slot))return false
    return durableVerdictBlocksReplacement(row.ref,io)
  })
}

// A MERGE FROM MAIN DOES NOT VOID AN APPROVAL (orchestrator marker #2758). The
// same rule `evaluateApprovalWithRefresh` applies at the merge gate: an APPROVE
// that fully satisfies an earlier head A stands for head B when A is an ancestor
// of B and the pull request's own diff is identical at both (`.agent/` aside).
// A refusal at B, or at any content-identical earlier head, still blocks. With no
// `io.contentPreservingRefresh` nothing is carried.
// #3411: which main a prior-head APPROVE is compared against. An open pull
// request: the current main tip. A merged one: the first parent of its merge
// commit, and only when that merge commit is in main history and the pull
// request's recorded head is the head being judged. Anything unreadable refuses.
export function mergedReviewComparisonBase({mergeCommitSha,head,main,gitRunner=(args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']})}){
  const merge=String(mergeCommitSha??'').toLowerCase(),reviewed=String(head??'').toLowerCase(),tip=String(main??'').toLowerCase()
  if(![merge,reviewed,tip].every((sha)=>/^[0-9a-f]{40}$/.test(sha)))throw new LaneError('merged review comparison requires exact merge, head and main SHAs')
  const parents=String(gitRunner(['rev-list','--parents','-n','1',merge])).trim().toLowerCase().split(/\s+/)
  if(parents.length!==3||parents[0]!==merge||parents[2]!==reviewed)throw new LaneError(`merge commit ${merge} does not have reviewed head ${reviewed} as its second parent`)
  try{gitRunner(['merge-base','--is-ancestor',merge,tip])}catch{throw new LaneError(`merge commit ${merge} is not proven in current main ${tip}`)}
  return parents[1]
}

export function resolveLaneApprovalBase(pr,head,io){
  const tip=()=>{const main=io.mainSha();return /^[0-9a-f]{40}$/.test(String(main))?{ok:true,fetch:main}:{ok:false,reason:'main tip unreadable'}}
  if(pr==null)return tip()
  const live=io.getPr(Number(pr))
  if(!live||typeof live!=='object')return{ok:false,reason:`pull request #${pr} is unreadable`}
  if(Number(live.number)!==Number(pr))return{ok:false,reason:`pull request #${pr} response does not identify that exact pull request`}
  if(live.merged!==true){
    if(live.merged_at)return{ok:false,reason:`pull request #${pr} has inconsistent merged state`}
    return tip()
  }
  const merge=String(live.merge_commit_sha??'').toLowerCase()
  if(!/^[0-9a-f]{40}$/.test(merge))return{ok:false,reason:`pull request #${pr} is merged but has no exact merge commit to judge its diff against`}
  if(String(live.head?.sha??'').toLowerCase()!==String(head).toLowerCase())return{ok:false,reason:`pull request #${pr} merged head ${live.head?.sha??'unknown'} is not the head being judged ${head}`}
  if(io.mergeCommitInMain?.(merge)!==true)return{ok:false,reason:`pull request #${pr} merge commit ${merge} is not proven in main history`}
  const currentMain=io.mainSha()
  if(!/^[0-9a-f]{40}$/.test(String(currentMain)))return{ok:false,reason:'main tip unreadable'}
  return{ok:true,fetch:merge,firstParentOf:merge,currentMain}
}

export function assertDurableReviewApproval(issue,pr,headSha,io=githubIo){
  const head=String(headSha).toLowerCase()
  try{return assertExactDurableReviewApproval(issue,pr,head,io)}catch(exactError){
    if(!(exactError instanceof LaneError)||typeof io.contentPreservingRefresh!=='function')throw exactError
    if(/durable reviewer refusal/.test(exactError.message))throw exactError
    // A head with reviewer records of its own (assignment, replacement, return or
    // verdict) is judged on those alone: carrying a prior head's sign-off past
    // them would bypass a slot returned or newly drawn here (muse review, #2780).
    const own=[REVIEW_ASSIGNMENT_REF_PREFIX,REVIEW_REPLACEMENT_REF_PREFIX,REVIEW_RETURN_REF_PREFIX,REVIEW_VERDICT_REF_PREFIX,REVIEW_VERDICT_REPLACEMENT_REF_PREFIX].flatMap((p)=>io.listRefs(`${p}/${Number(issue)}-${Number(pr)}-${head}`)??[])
    if(own.length)throw new LaneError(`${exactError.message}; an APPROVE cannot be carried forward because this head has reviewer records of its own (assignment, return or verdict), so it is judged on those alone`)
    const prefix=(p)=>`${p}/${Number(issue)}-${Number(pr)}-`
    // Prior heads come from verdicts and returns too, not only live assignments:
    // an exclusion clears a refused head's assignment and leaves its verdict,
    // and that refusal must still block (grok review of PR #2780).
    const priors=[...new Set([REVIEW_ASSIGNMENT_REF_PREFIX,REVIEW_REPLACEMENT_REF_PREFIX,REVIEW_RETURN_REF_PREFIX,REVIEW_VERDICT_REF_PREFIX,REVIEW_VERDICT_REPLACEMENT_REF_PREFIX].flatMap((p)=>(io.listRefs(prefix(p))??[]).map(({ref})=>new RegExp(`^${Number(issue)}-${Number(pr)}-([0-9a-f]{40})`).exec(String(ref).slice(p.length+1))?.[1])).filter(Boolean))].filter((sha)=>sha!==head)
    // #2728: a carry records the approved implementation digest; a proof without one carries nothing.
    const comparisonContext={}
    const equivalent=priors.filter((sha)=>{const proof=io.contentPreservingRefresh(sha,head,Number(pr),comparisonContext);return proof?.ok===true&&/^[0-9a-f]{64}$/.test(String(proof.implementation_digest??''))})
    for(const sha of equivalent){
      let rows
      try{rows=readReviewVerdicts(issue,pr,sha,io)}catch(error){throw new LaneError(`${exactError.message}; an APPROVE cannot be carried forward because the reviewer records at head ${sha}, whose pull request diff is identical to this head, could not be read: ${error?.message??error}`)}
      if(rows.some((row)=>row.verdict!=='APPROVE'))throw new LaneError(`${exactError.message}; an APPROVE cannot be carried forward because head ${sha}, whose pull request diff is identical to this head, carries a durable reviewer refusal`)
    }
    for(const sha of equivalent){try{return assertExactDurableReviewApproval(issue,pr,sha,io)}catch(error){if(!(error instanceof LaneError))throw error}}
    throw exactError
  }
}

// OWNER RULING, Albert Hazan in his chat 2026-10-02 (verbatim): "there are more
// than 2 reviewers working on this machine. find another one. and if you can't
// then you'll have to be ok with using one reviewer twice." Recorded in
// docs/owner-rulings.md. Reuse is allowed ONLY for review slot >= 2 on a pull
// request that is already MERGED at this exact head (the post-merge
// production-risk-assessment slot), proved through the verified merged-PR issue
// binding. Open pull requests keep strict slot independence.
export function mergedPrReviewerReuseAllowed(request,io){
  if(!(Number(request?.slot)>=2)||typeof io?.mergedPrReviewTarget!=='function')return false
  let live
  try{live=io.getPr(Number(request.pr))}catch{return false}
  if(!mergedPrLive(live,request.headSha))return false
  return io.mergedPrReviewTarget(Number(request.pr),Number(request.issue))===true
}
export function mergedPrLive(live,headSha){return Boolean(live?.merged_at)&&String(live?.state??'').toLowerCase()!=='open'&&/^[0-9a-f]{40}$/i.test(String(headSha??''))&&String(live?.head?.sha??'').toLowerCase()===String(headSha).toLowerCase()}
export function mergedPrAtHead(pr,headSha,io){try{return mergedPrLive(io.getPr?.(Number(pr)),headSha)}catch{return false}}

export function assertExactDurableReviewApproval(issue,pr,headSha,io){
  const head=String(headSha).toLowerCase(),allVerdicts=readReviewVerdicts(issue,pr,head,io,{includeDisregarded:true})
  const disregarded=allVerdicts.filter((row)=>row.disregarded),verdicts=allVerdicts.filter((row)=>!row.disregarded)
  // #2079. A verdict recorded before the write-side guard existed, by a reviewer
  // that cannot open the code, is not evidence in either direction: it neither
  // approves nor refuses this head. It is reported, then ignored.
  const disregardedNote=disregarded.length?` (${disregarded.length} durable verdict artifact(s) at this head are DISREGARDED because their reviewer cannot read the repository: ${disregarded.map((row)=>`${row.ref} by ${row.reviewer}`).join(', ')}. Re-review the slot with --replace-failed-reviewer --failure-code reviewer_cannot_read_repository)`:''
  if(verdicts.some((row)=>row.verdict!=='APPROVE'))throw new LaneError('the exact head carries a durable reviewer refusal')
  const assignments=[REVIEW_ASSIGNMENT_REF_PREFIX,REVIEW_REPLACEMENT_REF_PREFIX].flatMap((prefix)=>io.listRefs(`${prefix}/${Number(issue)}-${Number(pr)}-${head}`)).map(({ref,sha})=>{
    const named=parseAssignmentRef(ref)
    if(!named)throw new LaneError(`assignment ref ${ref} is malformed`)
    return{ref,sha,slot:named.slot,replacementSequence:named.replacementSequence}
  })
  // A durably RETURNED assignment is superseded history, not a live slot. The
  // exclusion that returned it also compare-and-cleared its ref, so this filter
  // normally has nothing to do; it is here so a return that raced a re-created
  // ref still cannot resurrect a slot no reviewer holds. It never lets a slot
  // pass without an APPROVE -- it removes the retired assignment entirely, and
  // if every assignment for this head was returned the refusal below fires.
  const returnRecords=readReviewReturns(issue,pr,head,io)
  const returned=new Set(returnRecords.map((row)=>row.assignmentSha))
  const latest=new Map()
  for(const assignment of assignments){if(returned.has(assignment.sha))continue;const prior=latest.get(assignment.slot);if(!prior||Number(assignment.replacementSequence??0)>Number(prior.replacementSequence??0))latest.set(assignment.slot,assignment)}
  if(!latest.size)throw new LaneError('the exact head has no durable reviewer assignment')
  // A RETURNED SLOT IS AN UNAPPROVED SLOT, NEVER A DISAPPEARED ONE.
  //
  // Dropping the retired assignment above is only half the answer. Removing it
  // also removes the SLOT from `latest` whenever nothing has refilled it, and
  // the loop below only demands an APPROVE for slots that are still in the map.
  // With one slot that fails closed at the emptiness refusal above; with two, a
  // returned slot 1 beside an already-approved slot 2 left the gate green while
  // NOBODY had approved slot 1's assignment of this head -- a merge authorized
  // over an unreviewed slot, which is exactly the failure the return was written
  // to prevent. So every slot that was ever returned for this head must still be
  // answered for: it needs a live assignment at least as new as the newest thing
  // returned for it, and that assignment needs its own APPROVE below. A slot
  // whose returned record was a replacement is not satisfied by falling back to
  // the older original the replacement had already superseded.
  //
  // "NEWER" IS THE GLOBAL CURSOR SEQUENCE, NOT THE REPLACEMENT NAMESPACE.
  //
  // The first version of this rule compared `replacementSequence`, treating an
  // original assignment as 0. That closed the hole and opened a worse one: after
  // any replacement for a slot was returned, `--assign-reviewer` recreates the
  // ORIGINAL ref, whose namespace sequence is 0, so `0 < returnedSequence`
  // stayed true forever and the slot could never be answered -- not even by a
  // freshly drawn reviewer who had recorded their own APPROVE (grok-4.6 REVISE,
  // high finding 2). A namespace tail is not a clock. The reviewer cursor IS:
  // every assignment and every replacement spends one strictly increasing
  // sequence from the same durable counter, across both namespaces. So a slot
  // that was returned is answerable by exactly one thing -- a live assignment
  // for the same slot drawn AFTER the returned record was drawn -- which still
  // excludes another slot's APPROVE and still excludes the superseded original
  // the returned replacement had already replaced.
  const cursorSequence=(sha)=>{const parsed=parseReviewCursor(io.getCommit(sha));const value=Number(parsed?.sequence);if(!Number.isInteger(value)||value<1)throw new LaneError(`assignment ${sha} has no readable reviewer sequence`);return value}
  const newestReturned=new Map()
  for(const row of returnRecords){const sequence=row.sequence==null?cursorSequence(row.assignmentSha):Number(row.sequence);if(!(newestReturned.get(row.slot)>=sequence))newestReturned.set(row.slot,sequence)}
  for(const [slot,sequence] of newestReturned){
    const live=latest.get(slot)
    if(!live||cursorSequence(live.sha)<=sequence)throw new LaneError(`review slot ${slot} was durably returned and has no live exact-head assignment newer than the returned one to approve; it cannot be satisfied by another slot, nor by a record the returned one had already superseded. Draw a new reviewer for this exact head and slot (--assign-reviewer when the returned record was the original assignment, --replace-failed-reviewer with the same --failed-sequence when it was a replacement), and that new assignment must record its own APPROVE.`)
  }
  const reviewers=new Set()
  for(const assignment of latest.values()){
    const record=parseReviewCursor(io.getCommit(assignment.sha))
    if(!record?.reviewer)throw new LaneError(`review slot ${assignment.slot} has no readable reviewer identity`)
    // Slot 1 is unique, so any shared pair involves a slot >= 2; on a merged head
    // that is the 2026-10-02 reuse ruling, and the check is order-independent.
    // Merged-at-head is enough here because every verdict this loop counts was
    // recorded through the binding: recordReviewVerdict refuses any verdict on a merged PR unless
    // reviewTargetIsRecordable passes (scripts/manage-migration-author-lanes.mjs, the
    // `if(!reviewTargetIsRecordable(live,{pr,issue,headSha},io))throw` line), which for a
    // merged PR requires io.mergedPrReviewTarget(pr,issue) === true -- the verified
    // merged-PR issue binding. Pinned by scripts/merged-pr-issue-binding.test.mjs.
    // The allocator draws a shared reviewer only through that same binding.
    if(reviewers.has(record.reviewer)&&!mergedPrAtHead(pr,head,io))throw new LaneError(`review slots at exact head ${head} share reviewer ${record.reviewer}; independent approval refused`)
    reviewers.add(record.reviewer)
  }
  for(const assignment of latest.values())if(!verdicts.some((row)=>row.verdict==='APPROVE'&&row.assignment_sha===assignment.sha))throw new LaneError(`review slot ${assignment.slot} has no durable APPROVE for its latest exact-head assignment${disregardedNote}`)
  return verdicts
}

// #2208 FOLLOW-UP. A lease belongs to ONE review slot. Ask the verdict question
// on behalf of that slot when the lease states which one it is. An old record
// that genuinely does not state a slot stays BUSY: a sibling verdict must never
// reclaim an ambiguous live lease. Slot 0 cannot be written and matches no
// verdict, so it is the fail-closed liveness sentinel.
//
// #3947. A lease belongs to ONE assignment's verdict ref, too. An original
// assignment owns the untailed verdict ref; a replacement owns the ref tailed
// with the failed-sequence it replaces (`replacementSequence`, which
// `parseReviewLease` reads out of the message's `failed-sequence=` token).
// Passing that identity through is what stops a verdict left on a superseded
// predecessor from being read as "this assignment already judged" -- the reading
// that marked a freshly drawn replacement's lease stale and refused the governed
// review the merge gate demands.
export function leaseVerdictOptions(record,extra={}){
  const slot=record?.slot
  const replacementSequence=record?.replacementSequence??record?.failedSequence
  return {...extra,slot:slot==null?0:Number(slot),replacementSequence:replacementSequence==null?null:Number(replacementSequence)}
}

export function assertReviewLeaseStillStale(row,states,io){
  if(!row)return
  const state=states?.get(`${row.assignment.issue}:${row.assignment.pr}`)
  const verdict=hasVerdictForHead(row.assignment.issue,row.assignment.pr,row.assignment.headSha,io,leaseVerdictOptions(row.assignment,{fresh:true}))
  if(reviewTargetIsRecordable(state?.pr,{pr:row.assignment.pr,issue:row.assignment.issue,headSha:row.assignment.headSha},io)&&!verdict)throw new LaneError(`reviewer ${row.assignment.reviewer} lease became live after mutex acquisition`)
}

export function isReviewAssignmentLive(assignment,states,io){
  const state=states?.get(`${assignment.issue}:${assignment.pr}`),pr=state?.pr??io.getPr(assignment.pr)
  const verdict=hasVerdictForHead(assignment.issue,assignment.pr,assignment.headSha,io,leaseVerdictOptions(assignment))
  return reviewTargetIsRecordable(pr,{pr:assignment.pr,issue:assignment.issue,headSha:assignment.headSha},io)&&!verdict
}
