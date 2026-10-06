// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { LaneError } from './claims.mjs'
import { parseRecordedReviewerAllowlist, reviewersForOrchestrator } from './reviewer-roster.mjs'
import { REVIEW_ASSIGNMENT_REF_PREFIX, REVIEW_FAILURE_REF_PREFIX, REVIEW_REPLACEMENT_REF_PREFIX } from './constants.mjs'
import { SLOT_INDEPENDENCE_CONFLICT, TERMINAL_FAILURE_CODES } from './queue-routing.mjs'
import { inReviewReplacementNamespace, reviewSlotSuffix, silenceReleaseRef } from './review-leases.mjs'
import { parseReviewCursor } from './review-records.mjs'
import { githubIo } from '../../manage-migration-author-lanes.mjs'

export function parseReviewReplacement(commit) {
  const message=commit?.message ?? commit?.commit?.message ?? ''
  const match=/^db-coordination reviewer-replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})(?: slot=\d+)?(?: allowlist=([a-z0-9.,-]+))? failed-sequence=(\d+) prior-sequence=(\d+) failure-ref=([0-9a-f]{7,40})$/i.exec(message)??/^db-coordination reviewer-failure-replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})(?: slot=\d+)?(?: allowlist=([a-z0-9.,-]+))? failed-sequence=(\d+) prior-sequence=(\d+) failure-ref=(self) /i.exec(message)
  if(!match)throw new LaneError('reviewer replacement ref does not point to a recognized replacement')
  return {sequence:Number(match[1]),reviewer:match[2],issue:Number(match[3]),pr:Number(match[4]),headSha:match[5],...(match[6]?{reviewerAllowlist:parseRecordedReviewerAllowlist(match[6])}:{}),failedSequence:Number(match[7]),priorSequence:Number(match[8]),failureSha:match[9]}
}

export function requireReplacementEvidence(replacement,io,records=null){
  const ref=`${REVIEW_FAILURE_REF_PREFIX}/${replacement.issue}-${replacement.pr}-${replacement.headSha}-${replacement.failedSequence}`
  const expected=replacement.failureSha==='self'?replacement.recordSha:replacement.failureSha
  const recorded=records?.has(ref)?records.get(ref)?.sha??null:io.readRef(ref)
  if(!expected||recorded!==expected)throw new LaneError('immutable reviewer failure evidence is missing or changed')
}

// THE PREFLIGHT MUST PROVE THE PROVIDER ANSWERS, NOT JUST THAT A FILE EXISTS.
//
// It used to check `commandAvailable(wrapper)` and nothing more -- the wrapper
// binary is on PATH, so the preflight passed. Every review then died at
// execution with a generic `provider_unavailable`: a message about the MODEL
// that was actually about a stopped local service on this machine.
//
// That misdiagnosis benched glm-5.3 for two days (2026-08-18 to 2026-08-20) on
// three `provider_unavailable` failures at sequences 161, 164 and 167. The
// provider was fine the whole time; its local OpenCode server was not running,
// and `ai-glm doctor` said so in one line. During that window the rotation was
// effectively one reviewer, and a rotation of one is not a rotation.
//
// So the probe runs the wrapper's own `doctor` and QUOTES the failing check.
// Never soften this into a warning and never drop the check name: a pause that
// cannot say what failed is a guess, and the last guess cost two days.
export function reviewerExecutionPreflight({reviewer,wrapper,worktree,headSha,skipDoctor},io=githubIo){
  const approved=reviewersForOrchestrator(io.resolveOrchestratorEngine?.()).find((row)=>row.name===reviewer)
  if(!approved||approved.wrapper!==wrapper)throw new LaneError('reviewer preflight requires an approved reviewer and its exact wrapper')
  if(!/^[0-9a-f]{40}$/i.test(String(headSha??''))||!worktree)throw new LaneError('reviewer preflight requires an exact 40-character head SHA and worktree')
  if(!io.commandAvailable?.(wrapper))throw new LaneError(`reviewer preflight cannot execute ${wrapper}`)
  if(io.localHead(worktree)!==headSha)throw new LaneError('reviewer preflight worktree is not at the exact assigned head')
  if(!io.localClean(worktree))throw new LaneError('reviewer preflight worktree is dirty')
  let doctor=null
  if(!skipDoctor){
    // No doctor probe available is NOT a pass. Say so rather than reporting
    // ready:true on evidence that was never collected.
    if(typeof io.reviewerDoctor!=='function')throw new LaneError(`reviewer preflight cannot probe ${wrapper}: this io has no reviewerDoctor. Nothing was proved about the provider; do not record a failure against the reviewer.`)
    doctor=io.reviewerDoctor(wrapper)
    if(!doctor?.ok){
      const checks=(doctor?.failingChecks??[]).map((c)=>`"${c}"`).join(', ')||'an unnamed check'
      throw new LaneError(`reviewer preflight: ${wrapper} doctor reports ${checks} -- this is a LOCAL dependency fault on this machine, not a ${reviewer} provider fault. Fix the local service and retry the same reviewer. Do NOT pause ${reviewer} and do NOT record provider_unavailable against it.`)
    }
  }
  return {reviewer,wrapper,worktree,headSha,ready:true,doctorChecked:!skipDoctor,failingChecks:doctor?.failingChecks??[]}
}

export function validateTerminalReviewerFailure(options,label='reviewer failure'){
  const request={issue:Number(options.issue),pr:Number(options.pr),headSha:String(options.headSha??''),failedSequence:Number(options.failedSequence),slot:Number(options.slot??1)}
  if(!Number.isInteger(request.issue)||!Number.isInteger(request.pr)||!/^[0-9a-f]{40}$/i.test(request.headSha)||!Number.isInteger(request.failedSequence))throw new LaneError(`${label} requires exact issue, PR, 40-character head SHA, and failed sequence`)
  if(!Number.isInteger(request.slot)||request.slot<1)throw new LaneError(`${label} slot must be a positive integer (1 = first reviewer, 2 = second independent reviewer)`)
  if(!TERMINAL_FAILURE_CODES.includes(String(options.failureCode??''))&&!(label==='reviewer replacement'&&String(options.failureCode)===SLOT_INDEPENDENCE_CONFLICT))throw new LaneError(`${label} requires a recognized terminal provider/tool failure code (${TERMINAL_FAILURE_CODES.join(', ')})${label==='reviewer replacement'?` or the guarded ${SLOT_INDEPENDENCE_CONFLICT} recovery`:''}`)
  if(String(options.failureCode)==='local_dependency_unavailable'){
    if(!String(options.failingCheck??'').trim())throw new LaneError('local_dependency_unavailable requires --failing-check naming the exact doctor check that failed. A failure record that cannot name the failing check is a guess.')
    if(!options.confirmLocalDependencyUnfixable)throw new LaneError(`this is a LOCAL dependency fault ("${String(options.failingCheck).trim()}"), not a provider fault. Fix it on this machine and retry the SAME reviewer. If it genuinely cannot be fixed here, re-run with --confirm-local-dependency-unfixable.`)
  }else if(String(options.failingCheck??'').trim())throw new LaneError('--failing-check applies only to local_dependency_unavailable')
  if(!options.confirmNoVerdict||!options.confirmNoArtifact)throw new LaneError(`${label} requires explicit confirmation that the failed session produced no verdict and no artifact`)
  return request
}

export function failedReviewerReleaseCommand(request,{failureCode,failingCheck}={}){
  const local=String(failureCode)==='local_dependency_unavailable'
    ?` --failing-check ${JSON.stringify(String(failingCheck))} --confirm-local-dependency-unfixable`
    :''
  return `--release-failed-reviewer --issue ${request.issue} --pr ${request.pr} --head-sha ${request.headSha} --failed-sequence ${request.failedSequence} --review-slot ${request.slot} --failure-code ${String(failureCode)}${local} --confirm-no-verdict --confirm-no-artifact`
}

export function reviewerFailureRef(request){return `${REVIEW_FAILURE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}-${request.failedSequence}`}

export function parseReviewRelease(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination reviewer-failure-release reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{40}) failed-sequence=(\d+) code=([a-z_]+)(?: failing-check=([^ ]+))? verdict=none artifact=none replacement=none$/i.exec(message)
  if(!match)throw new LaneError('reviewer release evidence is unreadable')
  return {reviewer:match[1],issue:Number(match[2]),pr:Number(match[3]),headSha:match[4],failedSequence:Number(match[5]),failureCode:match[6],failingCheck:match[7]??null}
}

// #3730: a failure ref may hold a `failure-ref=self` replacement record rather
// than a `--release-failed-reviewer` record -- the replacement IS the immutable
// failure evidence for its failed sequence. When that replacement is later
// returned (e.g. by --exclude-reviewer), the failure ref still names it, and a
// strict release parser left the slot permanently undrawable ("reviewer release
// evidence is unreadable"). Read either shape, bound to the same exact identity.
export function parseTerminalFailureEvidence(commit){
  const message=commit?.message??commit?.commit?.message??''
  const self=/^db-coordination reviewer-failure-replacement sequence=\d+ reviewer=[a-z0-9.-]+ issue=(\d+) pr=(\d+) head=([0-9a-f]{40})(?: slot=\d+)?(?: allowlist=[a-z0-9.,-]+)? failed-sequence=(\d+) prior-sequence=\d+ failure-ref=self failed-reviewer=([a-z0-9.-]+) code=([a-z_]+)(?: failing-check=([^ ]+))? verdict=none artifact=none$/i.exec(message)
  if(!self)return parseReviewRelease(commit)
  return {reviewer:self[5],issue:Number(self[1]),pr:Number(self[2]),headSha:self[3],failedSequence:Number(self[4]),failureCode:self[6],failingCheck:self[7]??null,selfReplacement:true}
}

export function assertAssignmentWasNotTerminallyReleased(request,assignment,io){
  if(io.enableReviewerSilence){const silenceRef=silenceReleaseRef({...request,sequence:assignment.sequence}),silenceSha=io.readRef(silenceRef)
    if(silenceSha)throw new LaneError(`reviewer ${assignment.reviewer} silent lease was reclaimed with immutable evidence; assignment retry will not recreate its lease. Draw a new reviewer for this exact head and slot.`)}
  const ref=reviewerFailureRef({...request,failedSequence:assignment.sequence}),sha=io.readRef(ref)
  if(!sha)return
  const released=parseTerminalFailureEvidence(io.getCommit(sha))
  if(released.issue===request.issue&&released.pr===request.pr&&released.headSha===request.headSha&&released.failedSequence===assignment.sequence&&released.reviewer===assignment.reviewer)throw new LaneError(`reviewer ${assignment.reviewer} terminal failure was released with immutable evidence; assignment retry will not recreate its lease. Use --replace-failed-reviewer for this sequence after capacity is available.`)
  throw new LaneError('reviewer failure evidence exists but does not match the durable assignment; assignment retry refused')
}

export function resolveFailedReviewRecord(request,io){
  const slotSuffix=reviewSlotSuffix(request.slot),assignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}${slotSuffix}`,assignmentSha=io.readRef(assignmentRef)
  if(!assignmentSha)throw new LaneError(`no durable reviewer assignment exists for issue #${request.issue} PR #${request.pr} at the exact head`)
  const initial=parseReviewCursor(io.getCommit(assignmentSha)),replacementBase=`${REVIEW_REPLACEMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}${slotSuffix}`
  const replacementRows=io.listRefs?.(replacementBase)??[]
  const replacements=replacementRows.filter((row)=>inReviewReplacementNamespace(row.ref,replacementBase)||(request.slot===1&&row.ref===replacementBase)).map((row)=>{const parsed=parseReviewReplacement(row.commit??io.getCommit(row.sha));return {...parsed,failureSha:parsed.failureSha==='self'?row.sha:parsed.failureSha}})
  for(const replacement of replacements)requireReplacementEvidence(replacement,io)
  const predecessors=replacements.filter((row)=>row.sequence===request.failedSequence)
  const original=request.failedSequence===initial.sequence?initial:predecessors.length===1?predecessors[0]:null
  if(!original||original.issue!==request.issue||original.pr!==request.pr||original.headSha!==request.headSha)throw new LaneError('durable reviewer assignment or replacement does not match the failure request')
  return original
}

// REVIEWER-INDEX CUTOVER ACTIVATION (issue #1777 handover). `findBusyReviewers`
// REFUSES outright when `REVIEW_ACTIVE_CUTOVER_REF` is absent (see its
// FAIL-CLOSED comment above), so that ref must never be created bare. Any
// review already live on an open PR's CURRENT head, assigned before this
// activation ran, needs its `REVIEW_ACTIVE_REF_PREFIX` lease backfilled FIRST
// -- otherwise the busy probe would silently lose visibility into it the
// instant cutover flips on, and a second reviewer could be handed a provider
// that is already working.
//
// BOUNDED. The live audit walks every currently OPEN pull request exactly
// once (`io.openPulls()`), which is bounded by this repository's open-PR
// count -- never all history and never every closed assignment ref ever
// written.
//
// FAIL-CLOSED ON AN UNPROVEN AUDIT. Any PR whose number or exact head SHA
// cannot be read, any matching assignment ref that cannot be parsed, any
// reviewer name the audit does not recognize, or any lease creation that
// cannot be proved by readback refuses the ENTIRE activation with no cutover
// ref written. A partially-audited cutover is worse than none: it would look
// active while actually blind to some in-flight review.
//
// IDEMPOTENT ON RETRY. If the cutover ref already exists this returns its
// recorded SHA immediately and performs no writes and no audit, so retrying
// after a network flake or an interrupted run never re-runs the audit and
// never risks a duplicate-ref race. The same race is handled mid-flight too:
// if another activation wins the create between this run's audit and its own
// `createRef`, the loser reads back the winner's SHA instead of erroring.
// A slot-2 assignment ref carries a `-slot{N}` suffix after the
// issue-pr-head tuple (see assignNextReviewerOperation's `slotSuffix`). The
// audit must recognize both shapes, or a live slot-2 review is invisible to
// it and its durable lease is never backfilled (issue #1798, medium finding).
export function matchesAssignmentTuple(ref, number, headSha) {
  return new RegExp(`-${number}-${headSha}(?:-slot\\d+)?$`).test(ref)
}

// Replacement refs for the same tuple are written as
// `<issue>-<pr>-<head>[-slotN]` (the original single unsuffixed link) and
// `<issue>-<pr>-<head>[-slotN]-<failedSequence>` for every link after it, so
// both shapes have to match here (see replaceFailedReviewerOperation).

// SLOT-SCOPED, not merely tuple-scoped (issue #1798 round 6, grok-4.6 blocking
// finding). Matching the tuple alone pools slot 1's and slot 2's replacements
// into ONE list, and the highest sequence in that pool then overwrites BOTH
// assignments. A slot-1 replacement would win the slot-2 assignment, leaving the
// live slot-2 reviewer with no lease and invisible to the busy probe -- the
// double-assignment hazard this activation exists to prevent. PR #1838 made the
// replacement WRITER slot-aware; this is the reader, and legacy unsuffixed
// slot-1 refs are still honoured, so the bad state was reachable on today's refs.
// A replacement belongs to an assignment only when the text after the tuple is
// that assignment's own slot suffix, optionally followed by the
// `-<failedSequence>` link number and nothing else.
export function matchesReplacementForSlot(ref, number, headSha, slotSuffix) {
  return new RegExp(`-${number}-${headSha}${slotSuffix}(?:-\\d+)?$`).test(ref)
}

// The suffix an assignment ref carries after its tuple: '' for slot 1, `-slotN`
// above it. Read back off the ref itself, so the reader cannot disagree with
// what the writer produced.
export function assignmentSlotSuffix(ref, number, headSha) {
  return new RegExp(`-${number}-${headSha}(-slot\\d+)?$`).exec(ref)?.[1] ?? ''
}

export function matchesReplacementTuple(ref, number, headSha) {
  return new RegExp(`-${number}-${headSha}(?:-slot\\d+)?(?:-\\d+)?$`).test(ref)
}
