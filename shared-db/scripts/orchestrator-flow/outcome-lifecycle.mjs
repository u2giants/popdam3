import { createHash } from 'node:crypto'
import { coordinationEvent, formatEventComment, parseEventComment } from '../db-coordination-events.mjs'
import { COMPLETION_FENCE, findCompletionRecord, validateCompletionRecord } from '../lib/work-dependencies.mjs'

export class OutcomeError extends Error {}

export const OUTCOME_STATES = Object.freeze([
  'entered', 'classified', 'dispatched', 'implementation_complete', 'review_ready',
  'preview_verified', 'merged', 'production_authorized', 'production_applied',
  'live_verified', 'blocked', 'yielded',
])
export const OUTCOME_EVIDENCE_FENCE = 'db-outcome-evidence'

const SHA = /^[0-9a-f]{40}$/i
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const EVIDENCE_REF = /^(?:https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull|actions\/runs|commit)\/[A-Za-z0-9_.#?=&\/-]+|artifact:[A-Za-z0-9][A-Za-z0-9._:\/-]*)$/
const LINEAR = Object.freeze([
  'entered', 'classified', 'dispatched', 'implementation_complete', 'review_ready',
  'preview_verified', 'merged', 'production_authorized', 'production_applied', 'live_verified',
])

export function parseOutcomeEvidence(body = '') {
  const fences = [...String(body).matchAll(new RegExp('```' + OUTCOME_EVIDENCE_FENCE + '\\s*\\n([\\s\\S]*?)```', 'g'))]
  if (fences.length !== 1) throw new OutcomeError('evidence reference must resolve to exactly one db-outcome-evidence block')
  let record
  try { record = JSON.parse(fences[0][1]) } catch { throw new OutcomeError('db-outcome-evidence block is not valid JSON') }
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new OutcomeError('db-outcome-evidence must be a JSON object')
  const known = new Set([
    'schema_version', 'work_issue', 'merge_pr', 'merge_sha', 'application_repository',
    'production_evidence', 'production_commit_sha', 'production_artifact_id', 'production_artifact_digest',
    'application_commit_sha', 'generated_types_evidence', 'generated_types_artifact_id', 'generated_types_artifact_digest', 'generated_types_output_digest', 'live_assertion',
    'live_evidence', 'live_artifact_id', 'live_artifact_digest', 'environment', 'verified_at',
  ])
  for (const key of Object.keys(record)) if (!known.has(key)) throw new OutcomeError(`db-outcome-evidence has unknown field ${key}`)
  if (record.schema_version !== 1) throw new OutcomeError('db-outcome-evidence schema_version must be 1')
  if (!Number.isInteger(record.work_issue) || record.work_issue <= 0) throw new OutcomeError('db-outcome-evidence work_issue must be positive')
  if (!Number.isInteger(record.merge_pr) || record.merge_pr <= 0) throw new OutcomeError('db-outcome-evidence must name merge_pr')
  if (!SHA.test(record.merge_sha ?? '')) throw new OutcomeError('db-outcome-evidence must name the exact 40-character merge_sha')
  if (typeof record.production_evidence !== 'string' || !EVIDENCE_REF.test(record.production_evidence)) throw new OutcomeError('db-outcome-evidence must link durable production apply proof')
  if (!SHA.test(record.production_commit_sha ?? '')) throw new OutcomeError('db-outcome-evidence must name the exact production_commit_sha')
  if (!Number.isInteger(record.production_artifact_id) || record.production_artifact_id <= 0) throw new OutcomeError('db-outcome-evidence must name the production apply artifact id')
  if (typeof record.production_artifact_digest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(record.production_artifact_digest)) throw new OutcomeError('db-outcome-evidence must name the production apply artifact sha256 digest')
  if (!REPOSITORY.test(record.application_repository ?? '')) throw new OutcomeError('db-outcome-evidence must name application_repository as owner/repo')
  if (!SHA.test(record.application_commit_sha ?? '')) throw new OutcomeError('db-outcome-evidence must name the exact application_commit_sha')
  if (typeof record.live_assertion !== 'string' || !record.live_assertion.trim()) throw new OutcomeError('db-outcome-evidence must repeat the live assertion')
  if (typeof record.live_evidence !== 'string' || !EVIDENCE_REF.test(record.live_evidence)) throw new OutcomeError('db-outcome-evidence must link durable live application proof')
  if (!Number.isInteger(record.live_artifact_id) || record.live_artifact_id <= 0) throw new OutcomeError('db-outcome-evidence must name the live proof artifact id')
  if (typeof record.live_artifact_digest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(record.live_artifact_digest)) throw new OutcomeError('db-outcome-evidence must name the live proof artifact sha256 digest')
  if (typeof record.environment !== 'string' || !record.environment.trim()) throw new OutcomeError('db-outcome-evidence must name the environment verified')
  if (typeof record.verified_at !== 'string' || Number.isNaN(Date.parse(record.verified_at))) throw new OutcomeError('db-outcome-evidence verified_at must be an ISO instant')
  return record
}

export function trustedOutcomeComments(comments = []) {
  return comments.filter((comment) => {
    if(!Object.prototype.hasOwnProperty.call(comment??{},'author_association')&&!Object.prototype.hasOwnProperty.call(comment??{},'authorAssociation'))return false
    const association = String(comment?.author_association ?? comment?.authorAssociation ?? '').toUpperCase()
    return association === 'OWNER'
  })
}

// A repair is expressible ONLY as a later appended event that names exact earlier
// event_ids. `recovery_completed` is the only event type whose `supersedes` list
// is honored here, so a routine lifecycle comment — or any other
// OWNER-association comment — cannot suppress outcome history.
export const OUTCOME_REPAIR_EVENT_TYPE = 'recovery_completed'

// Problem classes. Exactly two of them are artefacts of the read-back race this
// module exists to fix, and they are the ONLY two a supersession repair may
// clear:
//
//   duplicate_event_id — the same event_id posted twice (a byte-identical re-post).
//   state_repost       — the state already reached, recorded again under a NEW
//                        event_id. This is the wedge issue #2847 actually
//                        describes: an operator retried a write that had already
//                        landed, and the retry carried a fresh timestamp.
//
// Retiring either leaves the ledger at exactly the state it was already in, so
// nothing is hidden. Everything else is `lifecycle_violation` — a skipped state,
// a move BACKWARD to an earlier state, a misused blocked/yielded pair. Those are
// gaps in the record, and superseding one would manufacture a valid-looking
// ledger that conceals it. Repair refuses on them.
export const OUTCOME_PROBLEM_DUPLICATE = 'duplicate_event_id'
export const OUTCOME_PROBLEM_REPOST = 'state_repost'
export const OUTCOME_PROBLEM_LIFECYCLE = 'lifecycle_violation'
const OUTCOME_RACE_PROBLEMS = Object.freeze([OUTCOME_PROBLEM_DUPLICATE, OUTCOME_PROBLEM_REPOST])

// Replay the ordered outcome events, ignoring every event a later appended
// supersession named. `offenders` records which exact event raised each problem
// and `classes` records what KIND of problem it was, so a governed repair can
// name the smallest set of events to supersede — and can refuse outright on a
// class it was never designed to clear — instead of guessing. It never has to
// edit or delete an audit comment to do it.
function replayOutcomeEvents(events, superseded = new Set()) {
  const problems = []
  const offenders = []
  const classes = []
  const totals = new Map()
  for (const event of events) totals.set(event.event_id, (totals.get(event.event_id) ?? 0) + 1)
  const occurrences = new Map()
  let highest = -1
  let blocked = false
  const flag = (event, message, problemClass) => { problems.push(message); offenders.push(event.event_id); classes.push(problemClass) }
  for (const event of events) {
    const occurrence = (occurrences.get(event.event_id) ?? 0) + 1
    occurrences.set(event.event_id, occurrence)
    // A supersession names an event_id, but a duplicate post shares its id with
    // the legitimate original. Retiring EVERY occurrence would erase the real
    // event alongside the copy and regress the very state the repair was run to
    // restore, so when an id was posted more than once only the repeated copies
    // are retired. An id that occurs exactly once is retired outright.
    if (superseded.has(event.event_id) && (occurrence > 1 || totals.get(event.event_id) === 1)) continue
    if (occurrence > 1) { flag(event, `duplicate outcome event ${event.event_id}`, OUTCOME_PROBLEM_DUPLICATE); continue }
    if (event.result === 'refused') continue
    if (event.event_type === 'blocked') {
      if(blocked)flag(event, 'blocked repeats before yielded', OUTCOME_PROBLEM_LIFECYCLE)
      blocked = true; continue
    }
    if (event.event_type === 'yielded') {
      if(!blocked)flag(event, 'yielded without an active blocked state', OUTCOME_PROBLEM_LIFECYCLE)
      blocked = false; continue
    }
    const index = LINEAR.indexOf(event.event_type)
    if (index < 0) continue
    if (index > highest + 1) flag(event, `${event.event_type} skips ${LINEAR[highest + 1]}`, OUTCOME_PROBLEM_LIFECYCLE)
    // Repeating the CURRENT state is the read-back-race re-post and is repairable.
    // Moving back to an EARLIER state is a real violation and is not.
    if (index === highest) flag(event, `${event.event_type} repeats ${LINEAR[highest]}`, OUTCOME_PROBLEM_REPOST)
    if (index < highest) flag(event, `${event.event_type} moves backward from ${LINEAR[highest]}`, OUTCOME_PROBLEM_LIFECYCLE)
    highest = Math.max(highest, index)
  }
  return { problems, offenders, classes, highest, blocked }
}

export function outcomeHistory(comments = [], issue) {
  const expectedIssue = issue === undefined ? null : Number(issue)
  const parsed = trustedOutcomeComments(comments).flatMap((comment) => parseEventComment(comment?.body ?? ''))
    .filter((event) => expectedIssue === null || Number(event.work_issue) === expectedIssue)
  const events = parsed
    .filter((event) => OUTCOME_STATES.includes(event.event_type))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
      || (LINEAR.indexOf(a.event_type)<0?LINEAR.length:LINEAR.indexOf(a.event_type))-(LINEAR.indexOf(b.event_type)<0?LINEAR.length:LINEAR.indexOf(b.event_type))
      || a.event_id.localeCompare(b.event_id))
  // ONLY a SUCCEEDED repair event may retire outcome history, and it may retire
  // ONLY an outcome-state event of this same issue. A named id that is not an
  // outcome event here is not honored, so neither a phantom id nor a cross-type
  // target can silently suppress anything.
  const outcomeIds = new Set(events.map((event) => event.event_id))
  const superseded = new Set(parsed
    .filter((event) => event.event_type === OUTCOME_REPAIR_EVENT_TYPE && event.result === 'succeeded')
    .flatMap((event) => Array.isArray(event.supersedes) ? event.supersedes : [])
    .filter((id) => outcomeIds.has(id)))
  const { problems, highest, blocked } = replayOutcomeEvents(events, superseded)
  return {
    valid: problems.length === 0,
    problems,
    state: highest >= 0 ? LINEAR[highest] : null,
    blocked,
    complete: highest === LINEAR.length - 1,
    events,
    superseded: [...superseded],
  }
}

export function assertOutcomeTransition(comments, next, issue) {
  if (!OUTCOME_STATES.includes(next)) throw new OutcomeError(`unknown outcome state ${next}`)
  const history = outcomeHistory(comments, issue)
  if (!history.valid) throw new OutcomeError(`outcome history is invalid: ${history.problems.join('; ')}`)
  if (next === 'blocked') {
    if(history.blocked)throw new OutcomeError('outcome is already blocked')
    return history
  }
  if (next === 'yielded') {
    if(!history.blocked)throw new OutcomeError('outcome can yield only from blocked')
    return history
  }
  if(history.blocked)throw new OutcomeError('outcome must record yielded before another lifecycle advance')
  const expected = LINEAR[(history.state ? LINEAR.indexOf(history.state) : -1) + 1]
  if (next !== expected) throw new OutcomeError(`cannot advance outcome from ${history.state ?? 'none'} to ${next}; next state is ${expected ?? 'none'}`)
  return history
}

// GitHub comment listing is eventually consistent, so a read-back issued
// immediately after a successful post can race its own write (issue #2847). A
// first miss therefore proves nothing. Re-read with bounded backoff — the same
// pattern the --claim dispatch path already uses — and refuse only once the
// event is genuinely absent after every attempt. Throwing on the first miss made
// operators retry a write that had already landed, appending a second event with
// a different event_id and wedging the ledger permanently.
export const OUTCOME_READBACK_DELAYS = Object.freeze([0, 250, 500, 1000, 1500, 2000])
const defaultWait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function confirmOutcomeReadBack(io, issue, predicate) {
  let history = null
  for (const delay of OUTCOME_READBACK_DELAYS) {
    if (delay) (io.wait ?? defaultWait)(delay)
    history = outcomeHistory(io.issueComments(Number(issue)), issue)
    if (predicate(history)) return { seen: true, history }
  }
  return { seen: false, history }
}

export function advanceOutcome({issue,state,actor,timestamp=new Date().toISOString(),evidenceUrls=[]},io){
  const comments=io.issueComments(Number(issue))
  assertOutcomeTransition(comments,state,issue)
  if(!['entered','classified'].includes(state)&&(!Array.isArray(evidenceUrls)||evidenceUrls.length<1||evidenceUrls.some((value)=>typeof value!=='string'||!EVIDENCE_REF.test(value))))throw new OutcomeError(`outcome ${state} requires at least one durable GitHub or artifact evidence reference`)
  const event=outcomeEvent({issue,state,actor,timestamp,evidenceUrls})
  io.commentIssue(Number(issue),formatEventComment(event))
  const {seen}=confirmOutcomeReadBack(io,issue,(history)=>history.valid&&history.events.some((row)=>row.event_id===event.event_id))
  if(!seen)throw new OutcomeError(`outcome ${state} event did not read back exactly`)
  return {issue:Number(issue),state,event_id:event.event_id}
}

// Curative counterpart to the fix above. Two work issues were already wedged by
// duplicate events before the backoff existed, and nothing could clear an invalid
// history: requireAdmission refuses on it before doing anything.
//
// This repairs ONLY by appending. It names the exact earlier event_ids that no
// longer count and records who ran it and why. No existing coordination comment
// is edited or deleted — that would be audit-history tampering.

export function repairOutcomeHistory({issue,actor,reason,timestamp=new Date().toISOString(),evidenceUrls=[]},io){
  if(typeof actor!=='string'||!actor.trim())throw new OutcomeError('outcome history repair must record the actor that ran it')
  if(typeof reason!=='string'||!reason.trim())throw new OutcomeError('outcome history repair must record why it was run')
  if(!Array.isArray(evidenceUrls)||evidenceUrls.some((value)=>typeof value!=='string'||!EVIDENCE_REF.test(value)))throw new OutcomeError('outcome history repair evidence must be durable GitHub or artifact references')
  const history=outcomeHistory(io.issueComments(Number(issue)),issue)
  if(history.valid)throw new OutcomeError(`outcome history for #${issue} is already valid; repair refuses to append to a healthy ledger`)
  const dropped=new Set(history.superseded)
  for(let attempt=0;attempt<=history.events.length;attempt+=1){
    const replay=replayOutcomeEvents(history.events,dropped)
    if(!replay.problems.length)break
    // REFUSE LOUDLY ON ANY PROBLEM CLASS THIS VERB WAS NOT DESIGNED FOR. A real
    // lifecycle violation — a skipped state, a backward move, a misused
    // blocked/yielded pair — is a GAP IN THE RECORD. Superseding the event that
    // exposed it would leave a valid-looking ledger that hides the gap, which is
    // worse than the wedge it replaced. Only the duplicate-event_id class, the
    // byte-identical re-post left by the read-back race, may be cleared here.
    const foreign=replay.classes.findIndex((problemClass)=>!OUTCOME_RACE_PROBLEMS.includes(problemClass))
    if(foreign>=0)throw new OutcomeError(`outcome history for #${issue} has a lifecycle violation that repair must not hide: ${replay.problems[foreign]}; --repair-outcome-history supersedes only the duplicate or re-posted events left by the read-back race, so record the missing or corrected lifecycle event instead`)
    const offender=replay.offenders[0]
    if(!offender||dropped.has(offender))throw new OutcomeError(`outcome history for #${issue} cannot be repaired by supersession: ${replay.problems.join('; ')}`)
    dropped.add(offender)
  }
  const supersedes=[...dropped].filter((id)=>!history.superseded.includes(id))
  if(!supersedes.length)throw new OutcomeError(`outcome history for #${issue} names no superseding event that would repair it`)
  const settled=replayOutcomeEvents(history.events,dropped)
  if(settled.problems.length)throw new OutcomeError(`outcome history for #${issue} cannot be repaired by supersession: ${settled.problems.join('; ')}`)
  const event=coordinationEvent({
    eventType:OUTCOME_REPAIR_EVENT_TYPE, workIssue:Number(issue), actor, timestamp,
    detail:`outcome history repair by ${actor}: ${reason.trim()}`,
    supersedes, evidence_urls:evidenceUrls,
  })
  io.commentIssue(Number(issue),formatEventComment(event))
  const {seen,history:readBack}=confirmOutcomeReadBack(io,issue,(current)=>supersedes.every((id)=>current.superseded.includes(id)))
  if(!seen)throw new OutcomeError('outcome history repair event did not read back exactly')
  if(!readBack.valid)throw new OutcomeError(`outcome history for #${issue} remains invalid after repair: ${readBack.problems.join('; ')}`)
  return {issue:Number(issue),event_id:event.event_id,supersedes,state:readBack.state,actor,reason:reason.trim()}
}

export function outcomeEvent({ issue, state, actor, timestamp, evidenceUrls = [], detail }) {
  return coordinationEvent({
    eventType: state, workIssue: Number(issue), actor, timestamp,
    evidence_urls: evidenceUrls, ...(detail ? { detail } : {}),
  })
}

function sameSha(expected, actual) { return String(expected).toLowerCase() === String(actual).toLowerCase() }

export function completeOutcome({ issue, evidenceRef, actor, timestamp = new Date().toISOString() }, io) {
  const work = io.getIssue(Number(issue))
  if (!work || !['open','closed'].includes(String(work.state).toLowerCase())) throw new OutcomeError(`outcome issue #${issue} is unreadable`)
  const scope = io.parseScope(work.body ?? '')
  if (!scope || scope.workType !== 'structural' || scope.route !== 'shared-db-orchestrator') throw new OutcomeError('only an admitted structural outcome can complete')
  if (!scope.applicationReturnTo || !scope.liveAssertion) throw new OutcomeError('outcome is missing its application return address or live assertion')
  const comments=trustedOutcomeComments(io.issueComments(Number(issue)))
  const history = outcomeHistory(comments,issue)
  if (!history.valid) throw new OutcomeError(`outcome history is invalid: ${history.problems.join('; ')}`)
  if (!['production_applied','live_verified'].includes(history.state)) throw new OutcomeError(`merge or preview is not completion; outcome is at ${history.state ?? 'none'}, not production_applied`)
  if(String(work.state).toLowerCase()==='closed'&&history.state!=='live_verified')throw new OutcomeError(`outcome issue #${issue} closed before live verification`)

  const evidenceBody = io.readOutcomeEvidence(evidenceRef)
  const evidence = parseOutcomeEvidence(evidenceBody)
  if (evidence.work_issue !== Number(issue)) throw new OutcomeError(`evidence belongs to issue #${evidence.work_issue}`)
  if (evidence.application_repository !== scope.applicationReturnTo) throw new OutcomeError('evidence application repository does not match application_return_to')
  if (evidence.live_assertion !== scope.liveAssertion) throw new OutcomeError('live evidence does not prove the intake live_assertion verbatim')
  if (scope.generatedTypes === 'required' && !(typeof evidence.generated_types_evidence === 'string' && EVIDENCE_REF.test(evidence.generated_types_evidence))) {
    throw new OutcomeError('generated types are required but no durable generated-types evidence was supplied')
  }
  if(scope.generatedTypes==='required'){
    if(!Number.isInteger(evidence.generated_types_artifact_id)||evidence.generated_types_artifact_id<=0||!/^sha256:[0-9a-f]{64}$/i.test(evidence.generated_types_artifact_digest??'')||!/^sha256:[0-9a-f]{64}$/i.test(evidence.generated_types_output_digest??''))throw new OutcomeError('generated types require exact artifact and output sha256 digests')
    if(!io.verifyGeneratedTypes(evidence))throw new OutcomeError('generated types artifact could not be re-derived')
  }
  const linked=io.closingIssuesForPr(evidence.merge_pr)
  if(!Array.isArray(linked)||linked.length!==1||Number(linked[0]?.number)!==Number(issue))throw new OutcomeError(`merge PR #${evidence.merge_pr} is not linked exclusively to outcome issue #${issue}`)
  const actualObjects=io.prStructuralObjects(evidence.merge_pr,evidence.merge_sha)
  const declared=[...scope.writes].sort()
  if(!Array.isArray(actualObjects)||actualObjects.length!==declared.length||actualObjects.some((value,index)=>value!==declared[index]))throw new OutcomeError('merge PR structural objects do not match the admitted issue writes')
  const pr = io.getPr(evidence.merge_pr)
  if (!pr?.merged_at || !sameSha(evidence.merge_sha, pr.merge_commit_sha ?? '')) throw new OutcomeError('merge evidence does not match GitHub')
  if (!io.mergeCommitInMain(evidence.merge_sha)) throw new OutcomeError('merge commit is not in current shared-db main history')
  if (!io.verifyProductionApply(evidence)) throw new OutcomeError('production application could not be re-derived from exact run and artifact evidence')
  if (!io.applicationCommitInDefaultBranch(evidence.application_repository, evidence.application_commit_sha)) {
    throw new OutcomeError('application commit is not in the application default branch history')
  }
  if (!io.verifyLiveAssertion(evidence)) throw new OutcomeError('live application assertion could not be re-derived from its durable evidence')

  const completion=validateCompletionRecord({
    schema_version:1, work_issue:Number(issue), outcome:'live_verified', pr:evidence.merge_pr,
    merge_sha:evidence.merge_sha, application_repository:evidence.application_repository,
    application_commit_sha:evidence.application_commit_sha, live_evidence:evidence.live_evidence,
  })
  const existingCompletion=findCompletionRecord(comments)
  if(existingCompletion){
    for(const [key,value] of Object.entries(completion))if(existingCompletion[key]!==value)throw new OutcomeError(`existing immutable completion record disagrees on ${key}`)
  }
  if(history.state==='production_applied'){
    assertOutcomeTransition(io.issueComments(Number(issue)), 'live_verified', issue)
    const event = outcomeEvent({ issue, state: 'live_verified', actor, timestamp, evidenceUrls: [evidenceRef, evidence.live_evidence] })
    io.commentIssue(Number(issue), formatEventComment(event))
  }
  let completionReadBack=existingCompletion
  if(completionReadBack){
    for(const [key,value] of Object.entries(completion))if(completionReadBack[key]!==value)throw new OutcomeError(`existing immutable completion record disagrees on ${key}`)
  }else{
    io.commentIssue(Number(issue),[
      'Authoritative outcome completion. Published only after live evidence was re-derived.', '',
      '```'+COMPLETION_FENCE, JSON.stringify(completion,null,2), '```',
    ].join('\n'))
  }
  // The SAME eventually-consistent listing race advanceOutcome now tolerates
  // (issue #2847). A single read issued straight after a landed write can miss it
  // and throw on a completion that actually succeeded, inviting exactly the retry
  // that wedges the ledger. Confirm the final transition with the same bounded
  // backoff so the fix is applied consistently across both write paths.
  const {seen}=confirmOutcomeReadBack(io,issue,(current)=>{
    if(!current.valid||!current.complete)return false
    completionReadBack=completionReadBack??findCompletionRecord(trustedOutcomeComments(io.issueComments(Number(issue))))
    return completionReadBack?.outcome==='live_verified'
  })
  if(!seen)throw new OutcomeError('live_verified event or completion record did not read back as the authoritative completion')
  if(String(io.getIssue(Number(issue))?.state??'').toLowerCase()==='open')io.updateIssue(Number(issue),{state:'closed'})
  if(String(io.getIssue(Number(issue))?.state??'').toLowerCase()!=='closed')throw new OutcomeError('authoritative outcome was verified but the issue did not close on exact readback')
  return { issue: Number(issue), state: 'live_verified', completed: true, evidence_digest: createHash('sha256').update(JSON.stringify(evidence)).digest('hex') }
}
