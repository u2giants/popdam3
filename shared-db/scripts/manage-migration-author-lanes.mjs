#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gatherOpenPrObjects, normalizeObject, parseClaimBlock } from './check-dispatch-collision.mjs'
import { classifyDependencies, findCompletionRecord, findDependencyCycles, validateCompletionRecord, validateDependencyDeclaration, COMPLETION_FENCE, DependencyError } from './lib/work-dependencies.mjs'
import { assertLease, evaluateRecovery, formatLeaseMessage, parseLeaseMessage, recoveredLeaseMetadata, LeaseError } from './lib/exclusive-lease.mjs'
import { coordinationEvent, formatEventComment, parseEventComment, auditTimeline, renderTimeline } from './db-coordination-events.mjs'
import { reconcileFlow, persistInitialReady, preparePreviewDispatch, repairPreviewReady } from './orchestrator-flow/reconcile.mjs'
import { buildEvidenceBundle, canonicalJson, sha256 } from './orchestrator-flow/evidence-bundle.mjs'
import { selectPreviewRoute } from './orchestrator-flow/select-preview-route.mjs'
import { PROJECT_REFS } from './orchestrator-flow/read-preview-ledger.mjs'; import { verdictOpensLine as sharedVerdictOpensLine, evidenceTiedToHead as sharedEvidenceTiedToHead, isApprovalFor as sharedIsApprovalFor, isVerdictFor as sharedIsVerdictFor, anyVerdictFor as sharedAnyVerdictFor } from './lib/review-verdict.mjs'

export const REPO = 'u2giants/shared-db'
// AUTHOR LANE CAP. Raised from three to five on 2026-08-25 (owner instruction).
//
// WHAT THE NUMBER DOES AND DOES NOT DO. It is a throughput dial, not a safety
// dial. Collision safety comes from four mechanisms that do not read this
// constant: exact per-object claims (`assertLaneAvailable`), the global
// acquisition mutex (`MUTEX_REF`), permanent per-version refs
// (`refs/db-claims/<version>`), and the exclusive single-holder stage refs in
// `EXCLUSIVE_REFS`. Preview, guarded merge and production stay strictly serial
// at eight lanes exactly as they were at three -- more authors never means more
// sessions touching a live database.
//
// WHAT THE RAISE ACTUALLY COSTS. Downstream capacity, not correctness. Eight
// authors finishing together queue in front of the single preview stage. The
// owner approved six active reviewers, including Codex GPT-5.6 Sol and DeepSeek,
// before this cap was activated. Ref writes are ~6/hour per lane, so eight lanes
// stay far inside GitHub's limits and the rate-limit caveat recorded in
// plan_multi_agent_database_coordination_hardening.md is satisfied at this cap.
export const MAX_AUTHOR_LANES = 8
export const AUTHOR_CAPACITY_STATES = Object.freeze(['active', 'relinquished', 'expired-unconfirmed'])
export const DEFAULT_LEASE_HOURS = 12
export const MUTEX_STALE_AFTER_MS = 2 * 60 * 1000
export const MUTEX_REF = 'refs/db-coordination/author-acquisition'
export const MUTEX_RECOVERY_ACTIVE_REF = 'refs/db-coordination/author-acquisition-recovery-active'
export const REVIEW_CURSOR_REF = 'refs/db-coordination/reviewer-round-robin'
export const REVIEW_FAILURE_REF_PREFIX = 'refs/db-review-failures'
export const REVIEW_REPLACEMENT_REF_PREFIX = 'refs/db-review-replacements'
export const REVIEW_ASSIGNMENT_REF_PREFIX = 'refs/db-review-assignments'
export const REVIEW_ACTIVE_REF_PREFIX = 'refs/db-review-active'
export const REVIEW_ACTIVE_CUTOVER_REF = 'refs/db-coordination/reviewer-index-cutover'
export const REVIEW_OPERATION_REQUEST_LIMIT = 22, REVIEW_MUTEX_SECTION_RESERVE = 13 // slot 2 = 9 pre-mutex + this reserve; slot 1 = 6 + reserve. An ENTRY gate, not a release guarantee: it refuses to ACQUIRE the mutex unless the whole mutex-held section (body 11 + merged-PR ancestry add-on 2) still fits. Release is guaranteed separately by cleanupReserve (set at the acquire site, enforced in consumeReviewWireRequest). Derivation and the replacement-ref caveat: docs/verification/reviewer-assignment-api-budget-2026-08-28.md (#1812)
export const REVIEW_QUOTA_RESERVE = 100
// Page ceiling for listReviewRefsPaged. It is a REFUSAL, not a truncation: past
// this the reviewer audit stops rather than reporting a partial view of the
// durable review history (issue #1798).
//
// DO NOT read 6 pages as 600 refs of headroom per namespace. The page limit is
// not the real ceiling -- the wire-request budget is, and the two namespaces
// SHARE it, one counted request per page each. Against today's budget the
// cutover has room for roughly 500 assignment refs and 200 replacement refs
// combined, not 600 apiece, and today's repository already holds 370 and 106.
// The headroom this constant appears to grant is illusory; the operation will
// hit the request budget first (issue #1798 round 3, glm-5.3 Medium).
export const REVIEW_REF_PAGE_LIMIT = 6
export const REVIEWERS = Object.freeze([
  { name:'grok-4.6', wrapper:'ai-grok-review' }, { name:'glm-5.3', wrapper:'ai-glm' },
  { name:'kimi-k3', wrapper:'ai-kimi' }, { name:'qwen-3.8-max', wrapper:'ai-qwen' },
  { name:'glm-5.2', wrapper:'ai-glm' },
  { name:'muse-spark-1.2-contributor', wrapper:'ai-muse' },
  { name:'codex-gpt-5.6-sol', wrapper:'ai-codex-review', orchestratorEngine:'codex' },
  { name:'deepseek-chat', wrapper:'ai-deepseek-agent' },
])
// Keep REVIEWERS as the historical evidence registry. Paused providers remain
// readable forever, but only ACTIVE_REVIEWERS can receive new work.
//
// WHY 'glm-5.2' IS STILL LISTED BUT NOT ACTIVE
// -------------------------------------------
// The `ai-glm` wrapper has pinned MODEL=glm-5.3 (ai-devops/bin/ai-glm), so every
// review routed through it was ALREADY running on 5.3 while this registry
// recorded it as 'glm-5.2'. The model was right; the label was wrong, and the
// label is what lands in durable review evidence. Corrected here at the source.
//
// 'glm-5.2' is deliberately NOT deleted. Reviewer names are read back out of
// permanent coordination refs (`parseReviewCursor` -> `REVIEWERS.find(...)`), so
// every historical GLM review recorded before this change still has to resolve to
// a wrapper. One of those lookups is not null-guarded, so a missing name is a
// crash, not a graceful miss. Retired names stay readable forever; only
// ACTIVE_REVIEWERS receives new work -- the same pattern used to pause Qwen.
//
// 'glm-5.3' occupies the SAME rotation slot 'glm-5.2' held, so no in-flight
// sequence is reassigned out of order. It no longer keeps ACTIVE_REVIEWERS at the
// same LENGTH -- issue #1290 changed the length from two to three. See the
// ROTATION SLOTS block below, which is the accurate statement.
//
// RESTORED 2026-08-20 (owner instruction, issue #1290): 'glm-5.3'.
// ITS PAUSE ON 2026-08-18 WAS A FALSE DIAGNOSIS, and the diagnosis is the lesson.
// The three `provider_unavailable` failures -- sequences 161, 164 and 167 -- were not
// the remote provider being down. `ai-glm doctor` showed every check passing EXCEPT
// `health endpoint answers`, because the LOCAL `opencode` server was not running.
// `opencode-glm-launch` fixed it in about thirty seconds, and glm-5.3 then produced a
// full 10 KB review with a coverage statement on the first attempt. One stopped local
// process cost a two-day reviewer outage.
//
// WHY THAT COULD HAPPEN, and what was done about it (#1287, CLOSED by the three
// changes below; ai-devops#45 fixed the wrapper half upstream):
//
//   1. `provider_unavailable` conflated "the remote provider is down" (wait) with
//      "a local dependency of the wrapper is not running" (thirty-second fix).
//      `local_dependency_unavailable` is now a separate terminal code -- see
//      TERMINAL_FAILURE_CODES -- and `replaceFailedReviewer` REFUSES to spend a
//      rotation slot on one until the operator states the local fault cannot be
//      fixed on this machine. A working provider no longer collects permanent
//      failure evidence because a background process stopped.
//   2. Recording a local fault now REQUIRES naming the failing check, and the name
//      is written into the immutable failure evidence. A failure record that
//      cannot say what broke is a guess, and the last guess cost two days.
//   3. `reviewerExecutionPreflight` runs the wrapper's own `doctor` and quotes the
//      failing check, so the operator is told "your local server is down, start
//      it" instead of a wrong verdict about a model. It refuses outright rather
//      than report ready on a probe it never ran.
//
// A pause entry below must still NAME the failing health check, or state explicitly
// that the health check passed and the failure was elsewhere. That rule is now
// enforced in code for the local-fault path, not left to the writer's memory.
//
// PAUSED 2026-08-20 (owner instruction, issue #1290): 'kimi-k3'. ELEVEN terminal
// failures against FIVE successes in a single session, in three distinct modes:
// findings discarded above the verdict heading (1), usage-limit exhaustion (1), and
// nine consecutive 6-second `exit 127` deaths. Health check: NOT the cause in the
// glm-5.3 sense -- the `exit 127` deaths are the wrapper's own launch failing, which
// is a local fault, but it is kimi's wrapper and it was not repairable in session.
// Reviewer issue `20260820T004602Z-edge-dev-kimi-k3-385556` carries the raw evidence.
// This is a PAUSE, not a retirement.
//
// ADDED 2026-08-20 (owner instruction, issue #1290): 'muse-spark-1.2-contributor'.
// A registry addition, not an un-pause -- it was never listed. On the head-to-head
// trial it produced a complete seven-point review ending in `VERDICT: APPROVE`.
// KNOWN DEFECT, and the caller must handle it: the wrapper's verdict DETECTION fails
// and writes "This is not a review result" over correct work. It SAVES the output, so
// every such result is fully recoverable -- READ THE SAVED ARTIFACT before recording
// any Muse failure, and never record a bare "incomplete" from this wrapper without
// having read the raw provider stream.
//
// NOT ADDED, deliberately: 'gemini-3.7-flash-high'. `ai-gemini doctor` passes, so the
// install is sound, but two attempts produced `no usable Gemini verdict` and then a
// bare `PASS` with an EMPTY report. Two attempts is thin evidence and an empty report
// is the worst possible failure mode for a review gate. Retry only after someone
// establishes why the report comes back empty. This supersedes the narrower #1203.
//
// ROTATION SLOTS. 'glm-5.3' still occupies the slot 'glm-5.2' held. Muse was
// APPENDED, so it took the slot kimi-k3's pause vacated rather than displacing
// anyone.
//
// KIMI-K3 UNPAUSED, 2026-08-25 (owner instruction, with the lane cap raise to
// five). It returns to its ORIGINAL position in REVIEWERS, so the rotation is
// ['grok-4.6','glm-5.3','kimi-k3','muse-spark-1.2-contributor'] -- FOUR names.
// Verified before unpausing, not assumed: `AI_KIMI_CALLER=claude ai-kimi doctor`
// on edge-dev reports kimi 0.36.1, model pin kimi-code/k3, read-only profile
// PASS and `auth : OK`. Its one FAIL, `preflight (execution-context-denied)`,
// is an execution-context rule -- credentialed Kimi jobs must run from the Full
// Access main task -- not a broken install.
//
// THAT FAIL WAS INVISIBLE UNTIL THIS CHANGE, and fixing it was part of the
// unpause. `ai-kimi` and `ai-grok-review` report `<name> : PASS|FAIL|OK`, not
// the `PASS  <check>` form ai-glm, ai-muse and ai-codex-review use, so
// summarizeDoctorOutput scored kimi's output as an unrecognized format and
// therefore healthy-by-exit-status. Un-retiring a wrapper whose FAIL lines
// nothing parses would have re-armed exactly the false local-fault diagnosis
// this machinery exists to end, so parseDoctorFailures now reads both forms.
// See the note above summarizeDoctorOutput for the doctor output all five
// wrappers actually produce.
//
// WHAT THREE NAMES DOES AND DOES NOT FIX. An earlier draft of this block claimed an
// odd-length rotation removes the `replaceFailedReviewer` same-provider trap. THAT
// CLAIM WAS FALSE and a review caught it (#1290 review, High). The old refuse --
// `next durable reviewer is the same failed provider` -- fired whenever there had
// been N-1 assignments since the failure, for ANY N, so three names only moved the
// collision from ONE intervening assignment to TWO. Do not re-add an odd-length
// safety claim here; roster length was never the fix.
//
// The actual fix landed in #1297: `replaceFailedReviewer` now SKIPS every provider
// that already failed on the exact head and advances the cursor past it, refusing
// only when no other active reviewer is left. Roster length therefore buys CAPACITY
// -- three reviews in flight, and for most of 2026-08-19 the rotation was
// effectively Grok alone because ai-grok-review holds a per-REPOSITORY in-flight
// lock -- and nothing else.
//
// Capacity is worth having on its own terms: twice on 2026-08-19 a second reviewer
// overturned the first's conclusion, once by refuting an author's design rationale
// using the author's own test fixture. A rotation of one is not a rotation.
// Qwen remains historical-only, and Gemini remains outside the registry, while
// ai-devops reviewer reliability is being repaired (owner instruction,
// 2026-08-28). Historical names are never deleted because durable refs use them.
export const RETIRED_REVIEWERS = Object.freeze(['qwen-3.8-max', 'glm-5.2'])

// ACTIVE ROTATION EXPANSION (owner approval, 2026-08-28). Codex GPT-5.6 Sol and
// DeepSeek are active rotation providers. No overflow provider remains; when all
// six execution keys are occupied, assignment fails closed and the Phase 2
// allocator records an ordered durable wait.
//
// It is listed in REVIEWERS like every other name, so a cursor commit naming it
// still resolves to a wrapper forever (`REVIEWERS.find(...)` at parse time is
// not null-guarded on every path -- see the retired-name note above).
//
// `ai-codex-review` pins `codex exec -m gpt-5.6-sol --sandbox read-only
// -c model_reasoning_effort=medium`. That satisfies the standing rule that
// GPT-5.6 runs at low or medium reasoning only, and the pin lives in the
// wrapper, so no caller here can raise it. `ai-codex-review doctor` was run on
// edge-dev before activation and returns
// `PASS provider=codex sandbox=read-only reasoning=explicit command=codex`.
export const OVERFLOW_REVIEWERS = Object.freeze([])
export const ACTIVE_REVIEWERS = Object.freeze(REVIEWERS.filter((row)=>!RETIRED_REVIEWERS.includes(row.name)))

export function reviewersForOrchestrator(engine, reviewers=ACTIVE_REVIEWERS){
  const normalized=String(engine??'').trim().toLowerCase()
  if(!normalized)throw new LaneError('live orchestrator engine is unreadable; reviewer assignment refused')
  return reviewers.filter((row)=>String(row.orchestratorEngine??'').toLowerCase()!==normalized)
}
export const EXCLUSIVE_REFS = Object.freeze({
  preview: 'refs/db-coordination/preview',
  'preview-recovery': 'refs/db-coordination/preview',
  // POST-MERGE REHEARSAL. Deliberately the SAME ref as the ordinary preview
  // lane, so a rehearsal and an ordinary preview run can never both hold
  // preview -- no new interaction and no new hatch. NOTE WHAT THIS REF DOES NOT
  // DO: it is not cross-checked against `merge` or `production` in either
  // direction (the only cross-checks are the two `EXCLUSIVE_REFS` reads below,
  // promotion-waits-for-merge and merge-waits-for-production). A rehearsal is
  // therefore NOT excluded from a guarded merge or a promotion. That is
  // pre-existing behaviour of the preview lane which this kind inherits
  // unchanged; an earlier comment here claimed the exclusion existed (#1213
  // round 7 audit).
  'preview-rehearsal': 'refs/db-coordination/preview',
  merge: 'refs/db-coordination/merge',
  production: 'refs/db-coordination/production',
})

// Terminal reviewer failure codes. `local_dependency_unavailable` is separate
// from `provider_unavailable` on purpose: the first is a fault on THIS machine
// and is usually a thirty-second fix, the second is the provider being down and
// means waiting. Collapsing them is what produced a two-day pause of a working
// reviewer (#1287). Keep them distinct.
export const TERMINAL_FAILURE_CODES = Object.freeze(['insufficient_quota','provider_unavailable','local_dependency_unavailable','wrapper_terminal_failure','turn_limit_cancelled'])

export const QUEUE_STATUSES = new Set(['ready','blocked','owner-decision'])
export const QUEUE_WORK_TYPES = new Set(['structural','curated-master-data','application-data','source-data','repo-maintenance','documentation','security-settings'])
export const QUEUE_ROUTES = new Set(['shared-db-orchestrator','curated-master-data-governance','application-session','source-data-session','owner-only','repo-maintenance'])
const ROUTES_BY_WORK_TYPE = Object.freeze({
  structural: new Set(['shared-db-orchestrator']),
  'curated-master-data': new Set(['curated-master-data-governance']),
  'application-data': new Set(['application-session']),
  'source-data': new Set(['source-data-session']),
  'repo-maintenance': new Set(['repo-maintenance','owner-only']),
  documentation: new Set(['repo-maintenance','owner-only']),
  'security-settings': new Set(['owner-only','repo-maintenance']),
})

// ORCHESTRATOR ADMISSION TEST (AGENTS.md 0.0-C). A parsed scope block that is
// not `structural` never exits by `accept`. Each non-structural work type names
// WHERE it goes instead, because the old single `fork` value did not say who
// picks the work up, and an ambiguous exit is what let repository-maintenance
// work be read as an orchestrator worklist.
//
// OWNER RULING 2026-08-21 (issue #1366). The shared-db orchestrator does
// database STRUCTURE and SCHEMA only. Repository maintenance, documentation and
// security-settings work is performed by a SEPARATELY STARTED session and is
// never an orchestrator assignment - not even to dispatch. The orchestrator's
// own context is reserved for triage, dispatch, review and merge of structural
// work, so it must never work one of these itself no matter how small it looks.
export const NON_STRUCTURAL_EXITS = Object.freeze({
  'application-data': 'reject',
  'source-data': 'reject',
  // FORK, not REJECT, and DELIBERATELY UNCHANGED by issue #1366. Curated Master
  // Data is governed INSIDE this repo by 6.4: it binds the AI session doing the
  // typing and never leaves for an application repo. It exits by fork because it
  // must not be worked in the orchestrator's own context - not because it belongs
  // to somebody else. A curated fork that ships supabase/migrations/* must still
  // claim a lane before authoring: version reservation and object collision locks
  // are safety controls. Curated work that ships no migration does not use a lane.
  //
  // The 2026-08-21 ruling was about repository-maintenance work. It did NOT
  // change how curated Master Data is routed. Do not move this to another exit
  // without a separate explicit owner ruling.
  'curated-master-data': 'fork',
  // REPO-SESSION, not FORK. These are owned by a separately started repository
  // session. The orchestrator records them so an audit can see them, and then
  // takes no action at all: it does not work them and it does not dispatch them.
  'repo-maintenance': 'repo-session',
  documentation: 'repo-session',
  // RETURN-TO-OWNER. A security-settings change needs authority the orchestrator
  // does not have, so it goes to Albert rather than to any session.
  'security-settings': 'return-to-owner',
})

// Exits that mean "this is not the orchestrator's work AND the orchestrator has
// nothing to do about it" - visible to an audit, never a worklist.
export const OUTSIDE_ORCHESTRATOR_EXITS = Object.freeze(['repo-session', 'return-to-owner'])

// A REJECT exit must MOVE the task, never merely decline it. `return_to` is the
// forwarding address: the repository whose session owns the work. Rejecting
// without one closes the issue into silence, because the session that filed it
// has usually already ended and nobody reads the notification.
export const RETURN_ADDRESS_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
export const RETURNED_MARKER = 'RETURNED TO'

export function requiresReturnAddress(workType) {
  return NON_STRUCTURAL_EXITS[workType] === 'reject'
}

export function queueExit(workType) {
  if (workType === 'structural') return 'accept'
  const exit = NON_STRUCTURAL_EXITS[workType]
  if (!exit) throw new LaneError(`no orchestrator exit is defined for work_type ${workType}`)
  return exit
}

export function parseQueueScope(body = '') {
  const fences=[...body.matchAll(/```db-work-scope\s*\n([\s\S]*?)```/g)]
  if (!fences.length) return null
  if (fences.length !== 1) throw new LaneError('exactly one db-work-scope block is required')
  const fence=fences[0]
  const lines = fence[1].split(/\r?\n/), fields = new Map()
  // THREE list keys, one parser. `objects:` is the legacy spelling and means
  // `writes:` - see LEGACY_OBJECTS_MEANS_WRITES below. seenListHeaders makes a
  // repeated list header an error rather than a silent append.
  const lists = { objects: [], writes: [], reads: [] }
  const seenListHeaders = new Set()
  let currentList = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const listHeader = /^(objects|writes|reads):$/.exec(line)
    if (listHeader) {
      if (seenListHeaders.has(listHeader[1])) throw new LaneError(`db-work-scope repeats the ${listHeader[1]}: list`)
      seenListHeaders.add(listHeader[1])
      currentList = listHeader[1]
      continue
    }
    if (currentList && line.startsWith('- ')) { lists[currentList].push(line.slice(2).trim()); continue }
    currentList = null
    const match = /^([a-z_]+):\s*(.*)$/.exec(line)
    if (!match || fields.has(match[1])) throw new LaneError('unreadable db-work-scope block')
    fields.set(match[1], match[2].trim())
  }
  if (fields.has('state')) throw new LaneError('db-work-scope state is retired; use separate status, work_type, and route fields')
  const status = fields.get('status')
  const workType = fields.get('work_type')
  const route = fields.get('route')
  if (!QUEUE_STATUSES.has(status)) throw new LaneError(`db-work-scope status must be one of ${[...QUEUE_STATUSES].join(', ')}`)
  if (!QUEUE_WORK_TYPES.has(workType)) throw new LaneError(`db-work-scope work_type must be one of ${[...QUEUE_WORK_TYPES].join(', ')}`)
  if (!QUEUE_ROUTES.has(route)) throw new LaneError(`db-work-scope route must be one of ${[...QUEUE_ROUTES].join(', ')}`)
  if (!ROUTES_BY_WORK_TYPE[workType].has(route)) throw new LaneError(`route ${route} is not valid for work_type ${workType}`)
  const priority = Number(fields.get('priority'))
  if (!Number.isInteger(priority) || priority < 0) throw new LaneError('db-work-scope priority must be a non-negative integer')
  const dependencies = (fields.get('depends_on') ?? '').split(',').map((v)=>v.trim()).filter(Boolean).map((v)=>Number(String(v).replace(/^#/,'')))
  if (dependencies.some((v)=>!Number.isInteger(v) || v <= 0)) throw new LaneError('db-work-scope depends_on must contain issue numbers')
  // LEGACY_OBJECTS_MEANS_WRITES. A flat `objects:` list never distinguished a
  // reader from a writer, so the only safe reading of an existing claim is the
  // conservative one: every declared object is a WRITE. Reading a legacy claim as
  // a read would let a new writer run against work already in flight.
  if (lists.objects.length && (lists.writes.length || lists.reads.length)) {
    throw new LaneError('db-work-scope must not mix the legacy objects: list with writes:/reads:; objects: means writes:')
  }
  const legacyObjects = lists.objects.length ? validateClaimObjects(lists.objects) : []
  // VISIBLE DEPRECATION. The alias stays until Step 8A's gate is met (zero open
  // legacy claims/issues, plus 14 days of examples using writes:). A silent alias
  // never gets migrated, because nothing ever reminds anyone it exists.
  if (legacyObjects.length && !process.env.SHARED_DB_SUPPRESS_LEGACY_OBJECTS_WARNING) {
    process.stderr.write('WARNING: db-work-scope uses the deprecated `objects:` list, which is read as `writes:`. Use `writes:` and `reads:` so readers of the same table can run in parallel. See the anti-collision rules in AGENTS.md for the conflict matrix.\n')
  }
  const writes = lists.objects.length ? legacyObjects : (lists.writes.length ? validateClaimObjects(lists.writes) : [])
  const reads = lists.reads.length ? validateClaimObjects(lists.reads) : []
  const declaredBothWays = writes.filter((object)=>reads.includes(object))
  if (declaredBothWays.length) throw new LaneError(`db-work-scope declares ${declaredBothWays.join(', ')} as both a read and a write; a write already implies exclusive access`)
  if (workType === 'structural' && !writes.length) throw new LaneError('structural db-work-scope must list at least one write (use writes:, or the legacy objects:)')
  if (workType !== 'structural' && (writes.length || reads.length)) throw new LaneError(`${workType} db-work-scope must not claim database objects`)
  if (route === 'owner-only' && status !== 'owner-decision') throw new LaneError('owner-only route requires status owner-decision')
  // Present-but-malformed is a hard error; absent is reported by the audit as a
  // missing return address rather than thrown, so one unaddressed issue cannot
  // make every other open issue unauditable.
  const returnTo = fields.get('return_to') ?? null
  if (returnTo !== null && !RETURN_ADDRESS_PATTERN.test(returnTo)) throw new LaneError('db-work-scope return_to must be an owner/repo slug')
  if (returnTo !== null && workType === 'structural') throw new LaneError('structural db-work-scope must not carry a return_to address')
  // `objects` stays as an alias for `writes` so every existing caller keeps working
  // during the compatibility window. Step 8A removes it once the queue audit finds
  // zero open legacy claims.
  return { status, workType, route, priority, dependencies, returnTo, writes, reads, legacyObjects, objects: writes }
}

export const COORDINATION_LABELS = new Set(['db-claim','orchestrator-marker'])
export const WORK_LABEL = 'db-work'

// THE CONFLICT MATRIX (Step 2, issue #1366).
//
//              B reads   B writes
//   A reads      no        YES
//   A writes     YES       YES
//
// Read/read running in parallel is the entire point: two sessions may inspect the
// same table at once. Anything involving a write serialises, in BOTH directions,
// because a writer changing an object underneath a reader is exactly the silent
// corruption these lanes exist to prevent.
export function conflicts(a, b) {
  const aWrites = new Set(a?.writes ?? []), bWrites = new Set(b?.writes ?? [])
  for (const object of aWrites) if (bWrites.has(object)) return true
  for (const object of (b?.reads ?? [])) if (aWrites.has(object)) return true
  for (const object of (a?.reads ?? [])) if (bWrites.has(object)) return true
  return false
}

// Two flat lists, compared as writes. Conservative on purpose: a caller that has
// lost the read/write distinction must not be handed a weaker answer.
function overlaps(a, b) { return conflicts({ writes: a, reads: [] }, { writes: b, reads: [] }) }

export function buildDynamicQueues(issues, claims, now = new Date(), allOpenIssueNumbers = issues.map((issue)=>issue.number), dependencyStates = null, claimPullStates = new Map(), authoredOnMain = new Set()) {
  const openNumbers = new Set(allOpenIssueNumbers.map(Number))
  const skipped = [], unclassified = [], malformed = [], unlabelled = [], candidates = [], notOrchestratorWork = []
  const dependencyEdges = {}
  const grandfatheredDependencies = []
  for (const issue of issues) {
    // githubIo always supplies a labels array, so real audits always run this
    // check; callers that pass no labels at all are asserting they carry no
    // label information rather than asserting the label is absent.
    if (Array.isArray(issue.labels) && !issue.labels.includes(WORK_LABEL)) unlabelled.push(issue.number)
    let scope
    try { scope = parseQueueScope(issue.body) } catch (error) { malformed.push({ issue:issue.number, reason:error.message }); continue }
    if (!scope) { unclassified.push(issue.number); continue }
    // Recorded before the status check so a non-structural issue parked at
    // `blocked` or `owner-decision` is still reported with its exit. Silently
    // parked items are how non-shape work accumulated in the queue until an
    // orchestrator eventually read one and did it in its own context.
    if (scope.workType !== 'structural') {
      notOrchestratorWork.push({
        issue: issue.number,
        title: issue.title,
        workType: scope.workType,
        route: scope.route,
        exit: queueExit(scope.workType),
        blockedOnOwner: scope.route === 'owner-only',
        returnTo: scope.returnTo,
        needsReturnAddress: requiresReturnAddress(scope.workType) && !scope.returnTo,
      })
    }
    if (scope.status !== 'ready') { skipped.push({ issue:issue.number, reason:`status:${scope.status}`, workType:scope.workType, route:scope.route }); continue }
    if (scope.workType !== 'structural' || scope.route !== 'shared-db-orchestrator') {
      skipped.push({ issue:issue.number, reason:'not-migration-author-work', workType:scope.workType, route:scope.route }); continue
    }
    // A closed author claim is the normal result of a merge. If its permanently
    // reserved version is on main, the issue may remain open for promotion, but
    // it must never be offered as fresh authoring again.
    if (authoredOnMain.has(issue.number)) {
      skipped.push({ issue:issue.number, reason:'authored-on-main', detail:'a closed claim has a merged migration version on current main' })
      continue
    }
    // DEPENDENCY PROOF (Step 3, issue #1366). `dependencyStates` is gathered by the
    // caller so this function stays pure and exhaustively testable. When it is
    // absent the old open-set test is used, which keeps every existing caller and
    // fixture working; the CLI always supplies it.
    dependencyEdges[issue.number] = scope.dependencies
    try {
      validateDependencyDeclaration(issue.number, scope.dependencies)
    } catch (error) {
      malformed.push({ issue: issue.number, reason: error.message })
      continue
    }
    if (dependencyStates) {
      const verdict = classifyDependencies(issue.number, scope.dependencies, dependencyStates)
      for (const row of verdict.results.filter((r)=>r.status === 'grandfathered')) {
        grandfatheredDependencies.push({ issue: issue.number, dependency: row.number, detail: row.reason })
      }
      if (!verdict.satisfied) {
        for (const blocked of verdict.blocked) {
          skipped.push({ issue: issue.number, reason: `${blocked.status}:${blocked.number}`, detail: blocked.reason })
        }
        continue
      }
    } else {
      const waiting = scope.dependencies.filter((number)=>openNumbers.has(number))
      if (waiting.length) { skipped.push({ issue:issue.number, reason:`depends-on-open:${waiting.join(',')}` }); continue }
    }
    candidates.push({ issue:issue.number, title:issue.title, ...scope })
  }
  const protectedClaims = claims.map((claim)=>{
    const lease = parseAuthorLease(claim.body,now)
    return { claim:claim.number, issue:null, priority:Number.MAX_SAFE_INTEGER, writes:lease.writes, reads:lease.reads ?? [], objects:lease.writes, capacityActive:lease.capacityActive, leaseState:lease.capacityState, expiresAt:lease.expiresAt?.toISOString?.() ?? null, prState:claimPullStates.get(claim.number) ?? 'unknown' }
  })
  const components = [...protectedClaims, ...candidates].map((item)=>[item])
  for (let i=0;i<components.length;i++) for (let j=i+1;j<components.length;) {
    if (components[i].some((a)=>components[j].some((b)=>conflicts(a,b)))) components[i].push(...components.splice(j,1)[0]); else j++
  }
  const queues = Array.from({length:MAX_AUTHOR_LANES},(_,index)=>({ lane:index+1, active:null, activeLeaseState:null, activeExpiresAt:null, activePrState:null, protected:[], queued:[], objects:[], reads:[] }))
  const ordered = components.sort((a,b)=>Number(Boolean(b.some(x=>x.claim)))-Number(Boolean(a.some(x=>x.claim))) || Math.max(...b.map(x=>x.priority))-Math.max(...a.map(x=>x.priority)))
  for (const component of ordered) {
    const protectedItems = component.filter((x)=>x.claim)
    const activeItem = protectedItems.find((x)=>x.capacityActive)
    const free=queues.filter((q)=>!q.active)
    // Protected claims may outnumber active capacity. They remain visible in a
    // collision component without indexing a non-existent author lane.
    let lane = activeItem ? free[0] : [...(free.length?free:queues)].sort((a,b)=>a.queued.length-b.queued.length)[0]
    if (!lane) lane = { lane:null, active:null, protected:[], queued:[], objects:[], reads:[] }, queues.push(lane)
    if (activeItem) {
      if (!free.length) throw new LaneError(`active author capacity exceeds ${MAX_AUTHOR_LANES}`)
      lane.active = activeItem.claim
      lane.activeLeaseState = activeItem.leaseState
      lane.activeExpiresAt = activeItem.expiresAt
      lane.activePrState = activeItem.prState
    }
    lane.protected.push(...protectedItems.map((item)=>item.claim))
    lane.queued.push(...component.filter((x)=>x.issue).sort((a,b)=>b.priority-a.priority || a.issue-b.issue).map((x)=>x.issue))
    lane.objects.push(...new Set(component.flatMap((x)=>x.writes ?? x.objects ?? [])))
    lane.reads.push(...new Set(component.flatMap((x)=>x.reads ?? [])))
  }
  const authorQueues = queues.filter((q)=>q.lane !== null)
  const emptyLanes = authorQueues.filter((q)=>!q.active).length
  const dispatchable = authorQueues.filter((q)=>!q.active && !q.protected.length && q.queued.length).map((q)=>q.queued[0])
  const expiredClaims = authorQueues.filter((q)=>q.active && q.activeLeaseState === 'expired-unconfirmed').map((q)=>({ claim:q.active, lane:q.lane, expires_at:q.activeExpiresAt, pr_state:q.activePrState, queued:[...q.queued] }))
  // A CYCLE IS NEVER STARTABLE and is invisible to an open/closed test, so it is
  // reported as its own finding rather than as N tasks that merely look blocked.
  const dependencyCycles = findDependencyCycles(dependencyEdges)
  return { queues, expiredClaims, skipped, unclassified, malformed, unlabelled, notOrchestratorWork, dependencyCycles, grandfatheredDependencies, dispatchable, emptyLanes, fullyAudited:!unclassified.length&&!malformed.length&&!unlabelled.length&&!dependencyCycles.length }
}

// RETURN PATH (AGENTS.md 0.0-C). A rejected task is forwarded to the repository
// that owns it and only then closed here, so the closing comment always carries
// a live link to where the work actually went. Order is the whole safety
// property: the mirror issue is created FIRST, and any failure leaves this issue
// open and untouched. Never reorder these three steps.
export function returnIssueToOwner(number, io, { alreadyReturned } = {}) {
  const issue = io.getIssue(number)
  if (!issue) throw new LaneError(`issue #${number} could not be read`)
  if (issue.state && String(issue.state).toLowerCase() === 'closed') throw new LaneError(`issue #${number} is already closed`)
  const scope = parseQueueScope(issue.body)
  if (!scope) throw new LaneError(`issue #${number} carries no db-work-scope block, so its owner is unknown`)
  if (queueExit(scope.workType) !== 'reject') throw new LaneError(`issue #${number} is ${scope.workType} work, whose exit is ${queueExit(scope.workType)}, not return`)
  if (!scope.returnTo) throw new LaneError(`issue #${number} has no return_to address; add one before returning it`)
  const priorComments = alreadyReturned ?? io.getIssueComments(number).map((comment)=>comment.body ?? '')
  const prior = priorComments.find((body)=>body.includes(RETURNED_MARKER))
  if (prior) throw new LaneError(`issue #${number} was already returned: ${prior.trim()}`)

  const body = [
    `Returned from ${REPO}#${number} by the shared-db orchestrator.`,
    '',
    `This is **${scope.workType}** work. Under the shared-db admission test (AGENTS.md 0.0-C) it changes the CONTENTS of the shared database, not its SHAPE, so the session working in this repository owns it outright — no shared-db issue, no dispatch, no migration.`,
    '',
    `Original issue: https://github.com/${REPO}/issues/${number}`,
    '',
    '---',
    '',
    issue.body ?? '',
  ].join('\n')
  const url = io.createIssueIn(scope.returnTo, issue.title, body)
  if (!url) throw new LaneError('the owning repository did not return an issue URL; nothing was closed here')

  io.commentIssue(number, `${RETURNED_MARKER} ${url}

This is ${scope.workType} work and belongs to ${scope.returnTo} (AGENTS.md 0.0-C). It has been filed there and is closed here. It is not abandoned — follow the link.`)
  io.closeIssue(number)
  return { issue: number, returnedTo: scope.returnTo, url, workType: scope.workType }
}

export class LaneError extends Error {}

const CLAIM_KINDS = new Set(['schema','table','column','view','materialized view','function','procedure','trigger','policy','type','domain','sequence','index','publication','storage bucket'])
export function validateClaimObjects(objects) {
  const normalized = objects.map(normalizeObject)
  if (new Set(normalized).size !== normalized.length) throw new LaneError('duplicate object claims are not allowed')
  for (const object of [...normalized]) {
    const ident = '(?:[a-z_][a-z0-9_$]*|"(?:[^"]|"")+")'
    const match = new RegExp(`^column (${ident}\\.${ident})\\.${ident}$`).exec(object)
    if (match && !normalized.includes(`table ${match[1]}`)) normalized.push(`table ${match[1]}`)
  }
  if (!normalized.length) throw new LaneError('at least one exact object is required')
  for (const object of normalized) {
    const kind = [...CLAIM_KINDS].sort((a,b)=>b.length-a.length).find((k)=>object.startsWith(`${k} `))
    if (!kind) throw new LaneError(`unknown object kind in claim: ${object}`)
    const target = object.slice(kind.length + 1)
    const ident = '(?:[a-z_][a-z0-9_$]*|"(?:[^"]|"")+")'
    const qualified = new RegExp(`^${ident}\\.${ident}$`)
    const namedOn = new RegExp(`^${ident} on ${ident}\\.${ident}$`)
    if (kind === 'schema' || kind === 'publication' || kind === 'storage bucket') {
      if (!new RegExp(`^${ident}$`).test(target)) throw new LaneError(`claim must name one exact ${kind}: ${object}`)
    } else if (kind === 'trigger' || kind === 'policy') {
      if (!namedOn.test(target)) throw new LaneError(`claim must use "${kind} name on schema.table": ${object}`)
    } else if (kind === 'column') {
      if (!new RegExp(`^${ident}\\.${ident}\\.${ident}$`).test(target)) throw new LaneError(`claim must use "column schema.table.column": ${object}`)
    } else if (!qualified.test(target)) throw new LaneError(`claim must use a schema-qualified exact name: ${object}`)
  }
  return normalized
}

export function parseAuthorLease(body, now = new Date()) {
  if (!/```db-claim\s*\n/.test(body)) throw new LaneError('missing fenced db-claim block')
  const claim = parseClaimBlock(body)
  if (!claim) throw new LaneError('unreadable fenced db-claim block')
  const fence = /```db-author-lease\s*\n([\s\S]*?)```/.exec(body)
  if (!fence) return { ...claim, legacy: true, active: true, capacityState:'active', capacityActive:true, blockedOn:null, owner: null, branch: null, worktree: null, expiresAt: null }
  if (!/^\d{14}$/.test(String(claim.version ?? ''))) throw new LaneError('db-claim version must be exactly 14 digits')
  if (!claim.writes.length) throw new LaneError('db-claim must list at least one exact object to write')
  const fields = new Map()
  for (const raw of fence[1].split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const match = /^([a-z_]+):\s*(.+)$/.exec(line)
    if (!match || fields.has(match[1])) throw new LaneError('unreadable db-author-lease block')
    fields.set(match[1], match[2].trim())
  }
  for (const required of ['owner', 'branch', 'worktree', 'expires_at']) {
    if (!fields.get(required)) throw new LaneError(`db-author-lease is missing ${required}`)
  }
  const expiresAt = new Date(fields.get('expires_at'))
  if (Number.isNaN(expiresAt.valueOf())) throw new LaneError('db-author-lease expires_at is not a valid ISO timestamp')
  const declaredCapacityState = fields.get('capacity_state') ?? 'active'
  if (!AUTHOR_CAPACITY_STATES.includes(declaredCapacityState)) throw new LaneError(`db-author-lease capacity_state must be one of ${AUTHOR_CAPACITY_STATES.join(', ')}`)
  const blockedOn = fields.get('blocked_on') ?? null
  if (declaredCapacityState === 'relinquished' && !blockedOn) throw new LaneError('relinquished author capacity must name blocked_on')
  if (declaredCapacityState !== 'relinquished' && blockedOn) throw new LaneError('blocked_on is allowed only for relinquished author capacity')
  const active = expiresAt > now
  const capacityState = !active && declaredCapacityState === 'active' ? 'expired-unconfirmed' : declaredCapacityState
  // Clock expiry never frees capacity. Only an explicit relinquished fence does.
  const capacityActive = declaredCapacityState !== 'relinquished'
  return { ...claim, legacy: false, owner: fields.get('owner'), branch: fields.get('branch'), worktree: fields.get('worktree'), expiresAt, active, capacityState, declaredCapacityState, capacityActive, blockedOn }
}

export function assertLaneAvailable(claims, proposedObjects, now = new Date(), { ignoreCapacity = false, prSources = [] } = {}) {
  const parsed = claims.map((claim) => {
    try { return { ...claim, lease: parseAuthorLease(claim.body, now) } }
    catch (error) { throw new LaneError(`claim #${claim.number} is unreadable: ${error.message}`) }
  })
  // Legacy claims consume capacity. An expiry never releases object protection;
  // cleanup must close the issue explicitly before another author can touch it.
  const occupied = parsed.filter((claim)=>claim.lease.capacityActive)
  if (!ignoreCapacity && occupied.length >= MAX_AUTHOR_LANES) throw new LaneError(`all ${MAX_AUTHOR_LANES} active-author leases are occupied`)
  const wanted = new Set(proposedObjects.map(normalizeObject))
  for (const holder of [...parsed.map((c) => ({ label: `claim #${c.number}`, objects: c.lease.objects })), ...prSources]) {
    const overlap = (holder.objects ?? []).map(normalizeObject).filter((object) => wanted.has(object))
    if (overlap.length) throw new LaneError(`object collision with ${holder.label}: ${[...new Set(overlap)].join(', ')}`)
  }
  return { active: occupied, protected:parsed, relinquished:parsed.filter((claim)=>!claim.lease.capacityActive), stale: parsed.filter((claim) => !claim.lease.legacy && !claim.lease.active) }
}

export function claimBody({ version, objects, writes, reads = [], owner, branch, worktree, expiresAt, capacityState = 'active', blockedOn = null }) {
  // `objects` is the deprecated parameter name for `writes`. Accepting both keeps
  // every existing caller working through the compatibility window; Step 8A drops
  // the alias once no open claim uses it.
  const written = (writes ?? objects ?? []).map((o) => normalizeObject(o))
  const read = (reads ?? []).map((o) => normalizeObject(o)).filter((o) => !written.includes(o))
  const lines = ['```db-claim', `version: ${version}`, 'writes:', ...written.map((o) => `  - ${o}`)]
  // Emit `reads:` only when there is one. An always-present empty header would
  // make every legacy claim look edited in a diff.
  if (read.length) lines.push('reads:', ...read.map((o) => `  - ${o}`))
  if (!AUTHOR_CAPACITY_STATES.includes(capacityState)) throw new LaneError(`capacityState must be one of ${AUTHOR_CAPACITY_STATES.join(', ')}`)
  if (capacityState === 'relinquished' && !blockedOn) throw new LaneError('relinquished capacity requires blockedOn')
  if (capacityState !== 'relinquished' && blockedOn) throw new LaneError('blockedOn is allowed only for relinquished capacity')
  lines.push('```', '', '```db-author-lease', `owner: ${owner}`, `branch: ${branch}`, `worktree: ${worktree}`, `expires_at: ${expiresAt.toISOString()}`, `capacity_state: ${capacityState}`)
  if (blockedOn) lines.push(`blocked_on: ${blockedOn}`)
  lines.push('```', '',
    'This claim remains authoritative until explicitly released. Only an active author-capacity lease occupies an author slot.',
    'Expiry is an audit warning, not an automatic release. The migration version is permanent and is never reused.',
    'WRITES are exclusive. READS may run in parallel with other reads, and block only against a writer.')
  return lines.join('\n')
}

export function isTransientGitHubTransport(error) {
  return /HTTP 5\d\d|connection (?:reset|timed out)|TLS handshake timeout|No server is currently available/i.test(String(error?.stderr ?? error?.message ?? error ?? ''))
}
// An EXPECTED failure is one this code asks a question with: "does this ref
// exist yet?" answers with HTTP 404, and "create this ref" answers with
// "reference already exists". Both are answers, not faults, but the GitHub CLI
// prints them to the terminal anyway, so a completely healthy run looked
// alarming and trained everyone to ignore 404s -- which is exactly how a REAL
// error on issue #1351 was read as more of the same noise.
//
// The cure must not be "swallow stderr". stderr is CAPTURED here (never
// inherited), attached to the thrown error so the message keeps every detail,
// and re-printed to this process's stderr for every failure that is NOT the
// expected answer. Quieter for the answers, LOUDER for the faults: an
// unexpected gh failure now prints gh's own stderr even when a caller catches
// the exception.
// Exactly the message that PROVES absence (see isConfirmedRefAbsence). A bare
// "not found" without a 404 is ambiguous, stays a hard failure, and must stay
// noisy.
export const EXPECTED_REF_ABSENCE=/HTTP 404/i
export const EXPECTED_REF_PRESENCE=/reference already exists/i
let reviewWireBudget=null,reviewCommitBase=null
function consumeReviewWireRequest(){
  if(!reviewWireBudget)return
  const usable=reviewWireBudget.locked&&!reviewWireBudget.cleanup?REVIEW_OPERATION_REQUEST_LIMIT-(reviewWireBudget.cleanupReserve??0):REVIEW_OPERATION_REQUEST_LIMIT
  if(reviewWireBudget.count>=usable)throw new LaneError(`reviewer operation request budget exhausted before request ${reviewWireBudget.count+1}`)
  reviewWireBudget.count+=1
}
export function withReviewRequestBudget(fn){
  if(reviewWireBudget)return fn(reviewWireBudget)
  reviewWireBudget={count:0}
  try{return fn(reviewWireBudget)}finally{reviewWireBudget=null;reviewCommitBase=null}
}
export function runGitHubCommand(args,{executor=execFileSync,wait=(ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms),attempts=4,expectedFailure=null,reportStderr=(text)=>process.stderr.write(text)}={}) {
  let last
  const allowedAttempts=reviewWireBudget?.locked?1:attempts
  for(let attempt=0;attempt<allowedAttempts;attempt++){
    consumeReviewWireRequest()
    try{return executor('gh',args,{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']})}
    catch(error){
      last=error
      if(!isTransientGitHubTransport(error)||attempt===allowedAttempts-1){
        const captured=String(error.stderr??'').trim()
        const detail=captured||String(error.message??'').trim()
        const wrapped=new LaneError(`GitHub command failed: ${detail}`)
        wrapped.transientTransport=isTransientGitHubTransport(error)
        wrapped.stderr=captured
        if(captured&&!(expectedFailure&&expectedFailure.test(detail)))reportStderr(`gh ${args.join(' ')}\n${captured}\n`)
        throw wrapped
      }
      wait(2**attempt*1000)
    }
  }
  throw last
}
function gh(args,options) { return runGitHubCommand(args,options) }

export function createRefWithReadback(ref,sha,{run=gh,readRef}={}) {
  try{run(['api','-X','POST',`repos/${REPO}/git/refs`,'-f',`ref=${ref}`,'-f',`sha=${sha}`],{expectedFailure:EXPECTED_REF_PRESENCE});return true}
  catch(error){
    if(/reference already exists/i.test(error.message)){
      if(!readRef)return false
      return readRef(ref)===sha
    }
    if(!error.transientTransport||!readRef)throw error
    const actual=readRef(ref)
    if(actual===sha)return true
    if(actual!==null)return false
    throw error
  }
}
export function deleteRefWithReadback(ref,{run=gh,readRef}={}) {
  try{run(['api','-X','DELETE',`repos/${REPO}/git/refs/${ref.replace(/^refs\//,'')}`],{expectedFailure:EXPECTED_REF_ABSENCE});return}
  catch(error){
    if(isConfirmedRefAbsence(error))return
    if(/reference does not exist/i.test(error.message)&&readRef&&readRef(ref)===null)return
    if(!error.transientTransport||!readRef)throw error
    if(readRef(ref)===null)return
    throw error
  }
}
function ghJson(args,options) {
  const raw = gh(args,options)
  try { return JSON.parse(raw) } catch { throw new LaneError(`GitHub returned unreadable JSON for gh ${args.join(' ')}`) }
}
function ghPaginated(endpoint) {
  if(reviewWireBudget){
    const page=ghJson(['api',endpoint])
    if(!Array.isArray(page))throw new LaneError(`GitHub page for ${endpoint} was incomplete or malformed`)
    if(page.length>=100)throw new LaneError(`GitHub page for ${endpoint} reached 100 rows; reviewer operation refuses possible pagination`)
    return page
  }
  const pages = ghJson(['api', '--paginate', '--slurp', endpoint])
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new LaneError(`GitHub pagination for ${endpoint} was incomplete or malformed`)
  return pages.flat()
}
export function isConfirmedRefAbsence(error) { return /HTTP 404/i.test(String(error?.message??'')) }

export const githubIo = {
  requiresExactReviewHeadSha: true,
  countLogicalReviewRequests:true,
  getRateLimit(){
    const rest=ghJson(['api','rate_limit'])?.resources?.core
    const graphRaw=gh(['api','-i','graphql','-f','query=query{rateLimit{limit remaining resetAt}}'])
    const graphText=/\{[\s\S]*$/.exec(graphRaw)?.[0]
    let graph
    try{graph=JSON.parse(graphText)?.data?.rateLimit}catch{return null}
    return rest&&graph?{remaining:Number(rest.remaining),limit:Number(rest.limit),reset:Number(rest.reset),graphRemaining:Number(graph.remaining),graphLimit:Number(graph.limit),graphReset:Math.floor(new Date(graph.resetAt).getTime()/1000)}:null
  },previewApplyRun(runId){return{run:ghJson(['api',`repos/${REPO}/actions/runs/${runId}`]),artifacts:ghJson(['api',`repos/${REPO}/actions/runs/${runId}/artifacts`]),logs:execFileSync('gh',['run','view',String(runId),'--repo',REPO,'--log'],{encoding:'utf8'})}},
  readActiveReviewLeases(){
    const names=[...ACTIVE_REVIEWERS,...OVERFLOW_REVIEWERS].map((row)=>row.name)
    const allowed=new Set(names)
    const fields=names.map((name,index)=>`r${index}:object(expression:${JSON.stringify(`${REVIEW_ACTIVE_REF_PREFIX}/${name}`)}){oid ... on Commit{message}}`).join(' ')
    const query=`query($owner:String!,$name:String!){repository(owner:$owner,name:$name){defaultBranchRef{target{oid ... on Commit{tree{oid}}}} ${fields}}}`
    const data=ghJson(['api','graphql','-f',`query=${query}`,'-F','owner=u2giants','-F','name=shared-db'])
    if(data?.errors?.length)throw new LaneError('active reviewer lease snapshot returned GraphQL errors')
    const repo=data?.data?.repository
    if(!repo)throw new LaneError('active reviewer lease snapshot is unreadable')
    const base=repo?.defaultBranchRef?.target
    if(!base?.oid||!base?.tree?.oid)throw new LaneError('review commit base is unreadable')
    reviewCommitBase={head:base.oid,tree:base.tree.oid}
    const entries=[]
    names.forEach((name,index)=>{
      const target=repo[`r${index}`]
      if(target===undefined)throw new LaneError('active reviewer lease snapshot is unreadable')
      if(target===null)return
      if(!allowed.has(name)||!target?.oid||!target?.message)throw new LaneError('active reviewer lease snapshot is unreadable')
      entries.push([`${REVIEW_ACTIVE_REF_PREFIX}/${name}`,{sha:target.oid,commit:{message:target.message}}])
    })
    return new Map(entries)
  },
  readReviewStates(leases){
    const unique=[...new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,lease])).values()]
    if(!unique.length)return new Map()
    const fields=unique.map((lease,index)=>`p${index}:pullRequest(number:${lease.pr}){state merged mergeCommit{oid} headRefOid comments(first:100){pageInfo{hasNextPage} nodes{body}} reviews(first:100){pageInfo{hasNextPage} nodes{body state commit{oid}}}} i${index}:issue(number:${lease.issue}){state comments(first:100){pageInfo{hasNextPage} nodes{body}}}`).join(' ')
    const data=ghJson(['api','graphql','-f',`query=query{repository(owner:"u2giants",name:"shared-db"){${fields}}}`])
    if(data?.errors?.length||!data?.data?.repository)throw new LaneError('batched reviewer PR/verdict evidence returned GraphQL errors')
    const result=new Map()
    unique.forEach((lease,index)=>{
      const pr=data.data.repository[`p${index}`],issue=data.data.repository[`i${index}`]
      if(!pr||!issue||!Array.isArray(pr.comments?.nodes)||!Array.isArray(pr.reviews?.nodes)||!Array.isArray(issue.comments?.nodes)||pr.comments?.pageInfo?.hasNextPage!==false||pr.reviews?.pageInfo?.hasNextPage!==false||issue.comments?.pageInfo?.hasNextPage!==false)throw new LaneError('batched reviewer PR/verdict evidence is incomplete or paginated')
      result.set(`${lease.issue}:${lease.pr}`,{issue:{state:String(issue.state).toLowerCase()},pr:projectReviewPr(pr),evidence:[...issue.comments.nodes,...pr.comments.nodes,...pr.reviews.nodes.map((row)=>({...row,commit_id:row.commit?.oid}))]})
    })
    return result
  },
  // GraphQL `ref(qualifiedName:...)` silently resolves to null for refs
  // outside refs/heads/ and refs/tags/, even when the ref genuinely exists
  // (confirmed empirically 2026-08-28 against a live refs/db-review-active/*
  // ref while investigating issue #1810 -- REST proved the ref present while
  // this query answered null). `object(expression:...)` is the form that
  // actually resolves an arbitrary ref path, same as #1808 already found for
  // readActiveReviewLeases.
  readReviewRefs(refs){
    const fields=refs.map((ref,index)=>`r${index}:object(expression:${JSON.stringify(ref)}){oid}`).join(' ')
    const data=ghJson(['api','graphql','-f',`query=query{repository(owner:"u2giants",name:"shared-db"){${fields}}}`])
    if(data?.errors?.length||!data?.data?.repository)throw new LaneError('review ref readback returned GraphQL errors')
    return new Map(refs.map((ref,index)=>[ref,data.data.repository[`r${index}`]?.oid??null]))
  },
  // GitHub's GraphQL `refs(refPrefix:...)` connection only supports the
  // refs/heads/ and refs/tags/ namespaces, and (confirmed 2026-08-28, issue
  // #1810) rejects any prefix without a trailing slash outright with
  // "refPrefix must end with a /". This ref family lives under the custom
  // `refs/db-review-replacements/<issue>-<pr>-<headSha>` namespace and shares
  // a dash-joined prefix across an open-ended number of failure-sequence
  // suffixes, not a directory -- so refPrefix can never list it, whether by
  // silently returning nothing (#1803) or by erroring outright (#1810).
  // `listRefs` already lists this same family correctly via the REST
  // `git/matching-refs` endpoint (plain string-prefix match, no trailing-slash
  // requirement), and is already used elsewhere in this file as a fallback
  // for exactly this ref family -- so it is used here instead of GraphQL's
  // prefix listing. Commit messages for matched refs are intentionally
  // omitted from this call: every caller already falls back to
  // `io.getCommit(row.sha)` when `row.commit` is absent.
  readReviewRecords(refs,prefix){
    // Same `object(expression:...)` fix as readReviewRefs above, applied here
    // too: `ref(qualifiedName:...)` silently answered null for every one of
    // these custom-namespace refs (replacementRef, assignmentRef,
    // REVIEW_CURSOR_REF), which would have made every caller of this method
    // treat a real record as absent.
    const fields=refs.map((ref,index)=>`r${index}:object(expression:${JSON.stringify(ref)}){oid ... on Commit{message}}`).join(' ')
    const data=ghJson(['api','graphql','-f',`query=query{repository(owner:"u2giants",name:"shared-db"){base:defaultBranchRef{target{... on Commit{oid tree{oid}}}} ${fields}}}`])
    if(data?.errors?.length||!data?.data?.repository)throw new LaneError('review record preflight returned GraphQL errors')
    const base=data.data.repository.base?.target
    if(reviewWireBudget&&base?.oid&&base?.tree?.oid)reviewCommitBase={head:base.oid,tree:base.tree.oid}
    const result=new Map(refs.map((ref,index)=>{const target=data.data.repository[`r${index}`];return [ref,target?.oid?{sha:target.oid,commit:{message:target.message}}:null]}))
    const matches=prefix?this.listRefs(prefix):[]
    Object.defineProperty(result,'matching',{value:matches.map((row)=>({ref:row.ref,sha:row.sha})),enumerable:false})
    return result
  },
  atomicReviewRefs(changes){
    for(const sha of [...new Set(changes.map((change)=>change.sha).filter(Boolean))]){
      try{execFileSync('git',['cat-file','-e',`${sha}^{commit}`],{stdio:'ignore'})}
      catch{try{execFileSync('git',['fetch','--no-tags','origin',sha],{encoding:'utf8',stdio:['ignore','pipe','pipe']})}catch(error){throw new LaneError(`atomic reviewer ref transition could not hydrate commit ${sha}: ${String(error.stderr??error.message??error).trim()}`)}}
    }
    const args=['push','--atomic','origin']
    for(const change of changes)args.push(`--force-with-lease=${change.ref}:${change.expected??''}`)
    for(const change of changes)args.push(change.sha?`${change.sha}:${change.ref}`:`:${change.ref}`)
    try{execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']})}catch(error){throw new LaneError(`atomic reviewer ref transition failed: ${String(error.stderr??error.message??error).trim()}`)}
  },
  atomicReviewMutexRelease(ownerSha){
    return this.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  },
  openClaims() {
    const rows = ghPaginated(`repos/${REPO}/issues?state=open&labels=db-claim&per_page=100`)
    return rows.filter((x) => !x.pull_request).map((x) => ({ number: x.number, title: x.title, body: x.body, url: x.html_url }))
  },closedClaimsForWork(issue,pager=ghPaginated){return pager(`repos/${REPO}/issues?state=closed&labels=db-claim&per_page=100`).filter((x)=>!x.pull_request&&[...String(x.title??'').matchAll(/#(\d+)\b/g)].map((match)=>Number(match[1])).filter((number)=>number===Number(issue)).length===1&&[...String(x.title??'').matchAll(/#(\d+)\b/g)].length===1).map((x)=>({number:x.number,title:x.title,body:x.body,url:x.html_url,state:x.state}))},
  // EVERY open issue is audited, not just the ones somebody remembered to
  // label. Filtering on `labels=db-work` here is what let issues #1188, #1238,
  // #1242, #1266 and #1268 sit unlabelled and therefore invisible to the queue
  // audit while carrying a valid db-work-scope block. Coordination issues
  // (db-claim, orchestrator-marker) are the only exclusions; a missing db-work
  // label on anything else is now a reported defect, never a silent skip.
  openWorkIssues(pager = ghPaginated) {
    const rows = pager(`repos/${REPO}/issues?state=open&per_page=100`)
    return rows.filter((x)=>!x.pull_request)
      .map((x)=>({ number:x.number, title:x.title, body:x.body, labels:(x.labels??[]).map((l)=>l.name) }))
      .filter((x)=>!x.labels.some((name)=>COORDINATION_LABELS.has(name)))
  },
  openIssueNumbers() { return ghPaginated(`repos/${REPO}/issues?state=open&per_page=100`).filter((x)=>!x.pull_request).map((x)=>x.number) },
  // DEPENDENCY STATE (Step 3, issue #1366). Fetch every REFERENCED dependency, not
  // just the ones that happen to be open, because a nonexistent number and an
  // unreadable issue must both BLOCK rather than release. Any failure is recorded
  // as `unreadable` and never collapsed into "fine".
  dependencyStates(numbers) {
    const states = {}
    for (const number of [...new Set((numbers ?? []).map(Number))]) {
      let issue
      try {
        issue = ghJson(['api', `repos/${REPO}/issues/${number}`])
      } catch (error) {
        const detail = String(error?.stderr ?? error?.message ?? error)
        // A 404 is an ANSWER: the issue does not exist. Anything else is "I could
        // not find out", which is a different and equally blocking condition.
        states[number] = /HTTP 404|Not Found/i.test(detail) ? { exists: false } : { exists: true, unreadable: detail }
        continue
      }
      if (issue.pull_request) { states[number] = { exists: true, unreadable: `#${number} is a pull request, not a work issue` }; continue }
      const state = { exists: true, open: issue.state === 'open', closedAt: issue.closed_at ?? null, comments: [] }
      if (!state.open) {
        try {
          state.comments = ghPaginated(`repos/${REPO}/issues/${number}/comments?per_page=100`).map((c)=>({ body: c.body }))
        } catch (error) {
          states[number] = { exists: true, unreadable: `comments unreadable: ${String(error?.message ?? error)}` }
          continue
        }
      }
      states[number] = state
    }
    return states
  },
  mergeCommitInMain(sha) {
    try { assertMergeCommitInMainHistory(sha, this.readRef('refs/heads/main'), this); return true }
    catch { return false }
  },
  prSources() { return gatherOpenPrObjects(REPO) },
  openPulls() { return ghPaginated(`repos/${REPO}/pulls?state=open&per_page=100`) },
  // AGENTS.md section 4 rule 2 is merge-first: the rehearsal happens AFTER the PR
  // merges, so the lane must still be able to find that PR once it is closed.
  // `openPulls()` cannot see it; this looks the branch up across every state.
  branchPulls(branch) { return ghPaginated(`repos/${REPO}/pulls?state=all&head=${REPO.split('/')[0]}:${encodeURIComponent(branch)}&per_page=100`) },
  getPr(number) { return ghJson(['api', `repos/${REPO}/pulls/${number}`]) },
  getPrFiles(number) { return ghPaginated(`repos/${REPO}/pulls/${number}/files?per_page=100`) },
  getFileAt(file,ref){const value=ghJson(['api',`repos/${REPO}/contents/${file}?ref=${ref}`]);if(value?.encoding!=='base64'||!value.content)throw new LaneError(`could not read ${file} at ${ref}`);return Buffer.from(value.content.replace(/\s/g,''),'base64').toString('utf8')},
  treeFiles(ref){const value=ghJson(['api',`repos/${REPO}/git/trees/${ref}?recursive=1`]);if(value?.truncated||!Array.isArray(value?.tree))throw new LaneError(`repository tree at ${ref} is unreadable or truncated`);return value.tree.filter((row)=>row.type==='blob').map((row)=>row.path)},
  previewGateProof(issue,pr,head,bundleId,dependencies=[]){
    const protectedContexts=ghJson(['api',`repos/${REPO}/branches/main/protection/required_status_checks`])?.contexts??[]
    const checks=JSON.parse(gh(['pr','checks',String(pr),'--repo',REPO,'--json','name,state']))
    const byName=new Map(checks.map((row)=>[row.name,String(row.state).toUpperCase()]))
    const failed=protectedContexts.filter((name)=>byName.get(name)!=='SUCCESS')
    if(failed.length)throw new LaneError(`required full CI is not successful on the current head: ${failed.join(', ')}`)
    const evidence=[...(this.getIssueComments(issue)??[]),...(this.getIssueComments(pr)??[]),...(this.getPrReviews(pr)??[])]
    // FAILS OPEN -- see the verdict-predicate block near `hasVerdictForHead`.
    // `isApprovalFor` requires the APPROVE to OPEN its line, so prose that
    // merely discusses approval (including prose stating approval is absent)
    // can no longer authorize a migration (issue #1822).
    // The decision itself lives in `gateAuthorizes` so it is REACHABLE BY TESTS.
    // The two lines above shell out through module-scope `ghJson`/`gh`, so this
    // whole method is unreachable without a network, and every existing test
    // replaces it with a stub that returns success. That meant the one site in
    // this file that can AUTHORIZE A MIGRATION had no coverage at all: deleting
    // its approval check entirely left the suite green.
    const approved=gateAuthorizes(evidence,head,bundleId,()=>findPrReviewAssignments(issue,pr,this))
    if(!approved)throw new LaneError('an independent APPROVE tied to the exact head and bundle-compatible assignment is required')
    const states=dependencies.length?this.dependencyStates(dependencies):{},closure=classifyDependencies(issue,dependencies,states)
    if(!closure.satisfied)throw new LaneError(`migration dependency closure is incomplete: ${closure.blocked.map((row)=>`#${row.number}`).join(', ')}`)
    return {full_ci_success:true,review_approved:true,dependency_closure_complete:true}
  },
  getIssue(number) { return ghJson(['api', `repos/${REPO}/issues/${number}`]) },
  getIssueComments(number) { return ghPaginated(`repos/${REPO}/issues/${number}/comments?per_page=100`) },
  getPrReviews(number) { return ghPaginated(`repos/${REPO}/pulls/${number}/reviews?per_page=100`) },
  updateIssue(number, fields) {
    const args=['api','-X','PATCH',`repos/${REPO}/issues/${number}`]
    for(const [key,value] of Object.entries(fields))args.push('-f',`${key}=${value}`)
    return ghJson(args)
  },
  mainSha() { return ghJson(['api', `repos/${REPO}/git/ref/heads/main`])?.object?.sha ?? null },
  getCommit(sha) { return ghJson(['api', `repos/${REPO}/git/commits/${sha}`]) },
  // ARGUMENT ORDER IS THE WHOLE CHECK. GitHub's compare endpoint is
  // `compare/{base}...{head}` and reports how HEAD relates to BASE. Passing the
  // merge commit as BASE and the main tip as HEAD is what makes `ahead` mean
  // "main contains the merge commit". Inverted, `ahead` would mean the exact
  // opposite and would accept unmerged code. See compareCommits tests.
  compareCommits(baseSha, headSha) { return ghJson(['api', `repos/${REPO}/compare/${baseSha}...${headSha}`]) },
  makeOwnerCommit(message) {
    let {head,tree}=reviewWireBudget&&reviewCommitBase?reviewCommitBase:{}
    if(!head)head=ghJson(['api', `repos/${REPO}/git/ref/heads/main`])?.object?.sha
    if (!head) throw new LaneError('GitHub main ref has no commit SHA')
    if(!tree)tree=ghJson(['api', `repos/${REPO}/git/commits/${head}`])?.tree?.sha
    if (!tree) throw new LaneError('GitHub main commit has no tree SHA')
    if(reviewWireBudget)reviewCommitBase={head,tree}
    const commit = ghJson(['api', '-X', 'POST', `repos/${REPO}/git/commits`, '-f', `message=${message}`, '-f', `tree=${tree}`, '-f', `parents[]=${head}`])
    if (!commit?.sha) throw new LaneError('GitHub did not create an ownership commit')
    return commit.sha
  },
  createRef(ref, sha) {
    return createRefWithReadback(ref,sha,{readRef:(target)=>this.readRef(target)})
  },
  readRef(ref) {
    const short = ref.replace(/^refs\//, '')
    // Absence is an expected answer here, so gh's 404 line is not printed --
    // see runGitHubCommand. Any OTHER failure still prints and still throws.
    try { return ghJson(['api', `repos/${REPO}/git/ref/${short}`],{expectedFailure:EXPECTED_REF_ABSENCE})?.object?.sha ?? null }
    // Only GitHub CLI's explicit HTTP 404 proves that this exact ref is absent.
    // A transport message that merely says "not found" is ambiguous and must
    // remain a hard failure rather than being mistaken for successful cleanup.
    catch (error) { if (isConfirmedRefAbsence(error)) return null; throw error }
  },
  listRefs(prefix) {
    const short=prefix.replace(/^refs\//,'')
    return ghPaginated(`repos/${REPO}/git/matching-refs/${short}?per_page=100`).map((row)=>({ref:row.ref,sha:row.object?.sha})).filter((row)=>row.sha)
  },
  // Paginated sibling of listRefs for the DURABLE review ref namespaces
  // (issue #1798). `listRefs` routes through ghPaginated, which -- inside a
  // reviewer wire budget -- refuses outright at 100 rows rather than risk a
  // silently truncated page. That is the right default for a namespace that
  // is supposed to be small, but the assignment and replacement namespaces
  // are append-only across the repository's whole review history (370
  // assignment refs as of 2026-08-29), so the cutover audit could never list
  // them at all: it died on the 100-row refusal before reading anything.
  //
  // This walks explicit pages instead, so every page is a counted request the
  // wire budget can see, and stops at REVIEW_REF_PAGE_LIMIT with a LOUD
  // refusal rather than returning a partial list. A truncated audit is the
  // one outcome that must never happen quietly here: it would look like
  // "no live review to protect" and flip the cutover on blind.
  listReviewRefsPaged(prefix) {
    const short=prefix.replace(/^refs\//,'')
    const rows=[]
    for(let page=1;page<=REVIEW_REF_PAGE_LIMIT;page++){
      const chunk=ghJson(['api',`repos/${REPO}/git/matching-refs/${short}?per_page=100&page=${page}`])
      if(!Array.isArray(chunk))throw new LaneError(`GitHub page ${page} for ${prefix} was incomplete or malformed`)
      rows.push(...chunk.map((row)=>({ref:row.ref,sha:row.object?.sha})).filter((row)=>row.sha))
      if(chunk.length<100)return rows
    }
    throw new LaneError(`${prefix} exceeded ${REVIEW_REF_PAGE_LIMIT} pages of 100 refs; refusing a possibly truncated reviewer audit`)
  },
  // A DELETE is never replayed after a transport failure. The first request may
  // have succeeded and a new owner may acquire the fixed coordination ref
  // during backoff; replaying the DELETE could then remove that new owner.
  deleteRef(ref) {
    deleteRefWithReadback(ref,{
      run:(args,options)=>runGitHubCommand(args,{...options,attempts:1}),
      readRef:(target)=>this.readRef(target),
    })
  },
  updateRef(ref, sha) { gh(['api','-X','PATCH',`repos/${REPO}/git/refs/${ref.replace(/^refs\//,'')}`,'-f',`sha=${sha}`,'-F','force=true']) },
  readCommitMessage(sha) { try { return ghJson(['api',`repos/${REPO}/git/commits/${sha}`]).message } catch { return null } },
  // LIVE run state for lease recovery. `latestAttemptActive` re-reads the CURRENT
  // attempt rather than trusting the one recorded in the lease: a re-run reuses
  // GITHUB_RUN_ID, so a stored attempt can make a live run look finished.
  runState(runId) {
    try {
      const run = ghJson(['api',`repos/${REPO}/actions/runs/${runId}`])
      let latestAttemptActive = false
      try {
        const attempts = ghPaginated(`repos/${REPO}/actions/runs/${runId}/attempts?per_page=100`)
        latestAttemptActive = attempts.some?.((attempt)=>attempt.status && attempt.status !== 'completed') ?? false
      } catch { /* the attempts endpoint is optional; the run's own status still governs */ }
      return { status: run.status, conclusion: run.conclusion, completedAt: run.updated_at, latestAttemptActive }
    } catch (error) {
      return { unreadable: String(error?.message ?? error) }
    }
  },
  reserveVersion() { return JSON.parse(execFileSync(process.execPath, ['scripts/check-dispatch-collision.mjs', '--reserve-version', '--json'], { encoding: 'utf8' })) },
  createClaim(title, body) { return gh(['issue', 'create', '--repo', REPO, '--label', 'db-claim', '--title', `CLAIM: ${title}`, '--body', body]).trim() },
  createIssueIn(repo, title, body) { return gh(['issue','create','--repo',repo,'--title',title,'--body',body]).trim() },
  commentIssue(number, body) { gh(['issue','comment',String(number),'--repo',REPO,'--body',body]) },
  issueComments(number) { return ghPaginated(`repos/${REPO}/issues/${number}/comments?per_page=100`).map((c)=>({ body: c.body })) },
  closeIssue(number) { gh(['issue','close',String(number),'--repo',REPO]) },
  closeClaim(number) { gh(['issue', 'close', String(number), '--repo', REPO, '--comment', 'Expired migration-author lease closed by guarded cleanup. Its migration version remains unavailable.']) },
  reversionFiles(worktree,oldVersion) {
    let referenced=[];const riskGatePath=['scripts','production_business_risk_gate.py'].join('/')
    try{referenced=execFileSync('git',['-C',worktree,'grep','-l',oldVersion,'--','supabase/migrations','supabase/tests',riskGatePath,'docs'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean)}
    catch(error){if(error.status!==1)throw error}
    const migrations=execFileSync('git',['-C',worktree,'ls-files','--cached','--others','--exclude-standard','--',`supabase/migrations/${oldVersion}_*.sql`],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean)
    const sidecar=`scripts/production-verification-sidecars/${oldVersion}.json`
    if(existsSync(path.resolve(worktree,sidecar)))referenced.push(sidecar)
    return [...new Set([...referenced,...migrations].map((file)=>path.normalize(file)))].map((file)=>path.resolve(worktree,file))
  },
  rewriteVersion(worktree,oldVersion,newVersion) {
    const files=this.reversionFiles(worktree,oldVersion),migration=files.filter((file)=>new RegExp(`^${oldVersion}_[^\\/]+\\.sql$`).test(path.basename(file)))
    if(migration.length!==1)throw new LaneError('local worktree must contain exactly one old-version migration file')
    const exactVersion=new RegExp(`(?<!\\d)${oldVersion}(?!\\d)`,'g')
    const renamed=path.join(path.dirname(migration[0]),path.basename(migration[0]).replace(new RegExp(`^${oldVersion}_`),`${newVersion}_`))
    const sidecar=files.find((file)=>path.basename(file)===`${oldVersion}.json`&&path.basename(path.dirname(file))==='production-verification-sidecars')
    const renamedSidecar=sidecar?path.join(path.dirname(sidecar),`${newVersion}.json`):null
    if(existsSync(renamed))throw new LaneError('refusing migration version rewrite because the target filename already exists')
    if(renamedSidecar&&existsSync(renamedSidecar))throw new LaneError('refusing sidecar version rewrite because the target filename already exists')
    const originals=new Map(files.map((file)=>[file,readFileSync(file,'utf8')]))
    let renamedApplied=false,sidecarRenamed=false
    try{
      for(const [file,contents] of originals)writeFileSync(file,contents.replace(exactVersion,newVersion))
      ;(this.renameVersionFile??renameSync)(migration[0],renamed);renamedApplied=true
      if(sidecar){const item=JSON.parse(readFileSync(sidecar,'utf8'));item.migration_version=newVersion;item.migration_sha256=createHash('sha256').update(readFileSync(renamed).toString().replace(/\r\n/g,'\n')).digest('hex');writeFileSync(sidecar,`${JSON.stringify(item,null,2)}\n`);(this.renameSidecarVersion??renameSync)(sidecar,renamedSidecar);sidecarRenamed=true}
      return {files,migration:migration[0],renamed,sidecar,renamedSidecar}
    }catch(error){
      const failures=[]
      if(sidecarRenamed||sidecar&&(!existsSync(sidecar)&&existsSync(renamedSidecar)))try{renameSync(renamedSidecar,sidecar)}catch(rollbackError){failures.push(rollbackError.message)}
      if(renamedApplied||(!existsSync(migration[0])&&existsSync(renamed)))try{renameSync(renamed,migration[0])}catch(rollbackError){failures.push(rollbackError.message)}
      for(const [file,contents] of originals)try{writeFileSync(file,contents)}catch(rollbackError){failures.push(rollbackError.message)}
      if(failures.length)throw new LaneError(`${error.message}; LOCAL ROLLBACK INCOMPLETE: ${failures.join('; ')}`)
      throw error
    }
  },
  commitAndPushReversion(worktree,oldVersion,newVersion) {
    const riskGatePath=['scripts','production_business_risk_gate.py'].join('/')
    execFileSync('git',['-C',worktree,'add','--all','--','supabase/migrations','supabase/tests','scripts/production-verification-sidecars',riskGatePath,'docs'])
    execFileSync('git',['-C',worktree,'commit','-m',`migration: re-reserve ${oldVersion} as ${newVersion}`],{stdio:'pipe'})
    execFileSync('git',['-C',worktree,'push','origin','HEAD'],{stdio:'pipe'})
    return execFileSync('git',['-C',worktree,'rev-parse','HEAD'],{encoding:'utf8'}).trim()
  },
  localHead(worktree){return execFileSync('git',['-C',worktree,'rev-parse','HEAD'],{encoding:'utf8'}).trim()},
  localClean(worktree){return execFileSync('git',['-C',worktree,'status','--porcelain'],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean).every((line)=>line.slice(3).replaceAll('\\','/').startsWith('.ai/')) },
  currentMaxVersion(worktree){return execFileSync('git',['-C',worktree,'ls-tree','-r','--name-only','origin/main'],{encoding:'utf8'}).split(/\r?\n/).map((f)=>/^supabase\/migrations\/(\d{14})_/.exec(f)?.[1]).filter(Boolean).sort().at(-1)},
  commandAvailable(command){return Boolean(resolveCommandPath(command))},
  // Ask the wrapper's own `doctor` whether it can actually work RIGHT NOW.
  // Every wrapper prints one `PASS <check>` / `FAIL <check>` line per check, so
  // the failing check can be quoted verbatim instead of guessed at. Exit status
  // alone is not enough: the operator needs to be told WHICH check failed.
  //
  // WINDOWS. Every reviewer wrapper on Albert's machines is a `.cmd` shim, and
  // `execFileSync` CANNOT spawn a `.cmd` directly -- it fails ENOENT even though
  // `where.exe` finds the file. Caught by an independent review before this
  // shipped: the probe would have failed on every review on Windows and reported
  // a LOCAL FAULT for a provider that was fine, which is the exact misdiagnosis
  // this whole change exists to end. Resolve the real path and route a batch
  // shim through `cmd.exe /c`. No shell string is built, so nothing here is
  // interpolated into a command line.
  reviewerDoctor(wrapper){
    const resolved=resolveCommandPath(wrapper)
    if(!resolved)return {ok:false,failingChecks:[`${wrapper} is not on PATH`]}
    const {file,args}=doctorSpawnPlan(resolved)
    let output=''
    try{output=execFileSync(file,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:REVIEWER_DOCTOR_TIMEOUT_MS})}
    catch(error){
      if(error?.code==='ETIMEDOUT')return {ok:false,failingChecks:[`doctor did not answer within ${REVIEWER_DOCTOR_TIMEOUT_MS/1000}s`]}
      output=`${error?.stdout??''}${error?.stderr??''}`
      const failed=parseDoctorFailures(output)
      if(failed.length)return {ok:false,failingChecks:failed}
      return {ok:false,failingChecks:[`doctor could not be run (${error?.code??`exit ${error?.status}`}) and named no check`]}
    }
    return summarizeDoctorOutput(output)
  },
  resolveOrchestratorEngine(){
    let resolved
    try{resolved=JSON.parse(execFileSync(process.execPath,['scripts/check-orchestrator-marker.mjs','--resolve','--json'],{encoding:'utf8'}))}
    catch(error){throw new LaneError(`live orchestrator engine could not be resolved (${error.message})`)}
    const engine=resolved?.state==='declared'?resolved.routing?.engine:null
    if(!engine)throw new LaneError('live orchestrator engine is unreadable; reviewer assignment refused')
    return String(engine).toLowerCase()
  },
  orchestratorFlowAdapter(claimNumber){ return githubFlowAdapter(this,claimNumber) },
  flowSnapshot(){
    return {issues:this.openClaims().map((claim)=>{const lease=parseAuthorLease(claim.body),issue=claimWorkIssue(claim),work=this.getIssue(issue),declared=/^blocked_on:\s*(issue:#\d+|artifact:[^\s]+)\s*$/m.exec(work?.body??'')?.[1]??null,reference=declared??lease.blockedOn,resolved=reference?.startsWith('issue:#')?this.getIssue(Number(reference.slice(7)))?.state==='closed':false;let preview_edge_satisfied=false,preview_error=null;try{deriveLivePreviewCandidate(issue,this);preview_edge_satisfied=true}catch(error){preview_error=error.message}return{issue,claim:claim.number,owner:lease.owner,capacity_state:lease.capacityState,blocker:reference?{durable:true,resolved,reference}:null,preview_edge_satisfied,preview_error}})}
  },
}

function githubFlowAdapter(io,claimNumber=null){
  const payload=(sha)=>{const message=io.getCommit(sha)?.message??'';const match=/^db-preview-(?:ready|outcome) ([\s\S]+)$/.exec(message);if(!match)throw new LaneError('preview coordination ref does not point to a recognized immutable payload');return JSON.parse(match[1])}
  return {
    resolveMarker(){
      let resolved;try{resolved=JSON.parse(execFileSync(process.execPath,['scripts/check-orchestrator-marker.mjs','--resolve','--json'],{encoding:'utf8'}))}catch(error){throw new LaneError(`live orchestrator marker could not be resolved (${error.message})`)}
      const calling=process.env.ORCHESTRATOR_ROUTE_ID??''
      return {live:resolved.state==='declared',task:resolved.routing?.routeId??null,calling_task:calling}
    },
    actor:()=>process.env.ORCHESTRATOR_ROUTE_ID??'unknown-orchestrator',now:()=>new Date().toISOString(),
    appendEvent(event){io.commentIssue(event.work_issue,formatEventComment(event))},
    createRef(ref,digest,record){const kind=ref.startsWith('refs/db-preview-ready-outcomes/')?'outcome':'ready',sha=io.makeOwnerCommit(`db-preview-${kind} ${JSON.stringify({digest,record})}`);return io.createRef(ref,sha)},
    readRef(ref){const sha=io.refreshRef?.(ref)??io.readRef(ref);return sha?payload(sha):null},
    listReady(issue){return io.listRefs('refs/db-preview-ready/').map((row)=>payload(row.sha)).filter((row)=>Number(row.record?.issue)===Number(issue))},
    selectCurrent(issue){return deriveLivePreviewCandidate(Number(issue),io,{claimNumber})},
    relinquishCapacity(row){return relinquishAuthorLease({claim:row.claim,owner:row.owner,blockedOn:row.blocker.reference},new Date(),io)},
    resumeCapacity(row){return resumeAuthorLease({claim:row.claim,owner:row.owner,leaseHours:DEFAULT_LEASE_HOURS},new Date(),io)},
    persistReady(row){return persistInitialReady(deriveLivePreviewCandidate(Number(row.issue),io),this)},
    withMutex(fn){const ownerSha=io.makeOwnerCommit(`db-coordination preview-ready-preparation issue=0`);acquireMutex(ownerSha,io);try{return fn()}finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}},
    events(issue){return (io.issueComments(issue)??[]).flatMap((comment)=>parseEventComment(comment.body??comment))},
  }
}

function livePreviewLedger(){
  const code=`import {readPreviewLedger} from './scripts/orchestrator-flow/read-preview-ledger.mjs';try{console.log(JSON.stringify(await readPreviewLedger()))}catch(e){console.error(e.message);process.exit(2)}`
  try{return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:process.env}))}catch(error){throw new LaneError(`fresh preview ledger is unavailable (${String(error.stderr??error.message).trim()})`)}
}
export function deriveLivePreviewCandidate(issue,io,{claimNumber=null}={}){
  const claims=io.openClaims().map((claim)=>({claim,lease:parseAuthorLease(claim.body)}));for(const row of claims){const titleIssues=claimTitleIssues(row.claim);if(titleIssues.includes(issue)&&titleIssues.length!==1)throw new LaneError(`open claim #${row.claim.number} ambiguously identifies work issue #${issue}`)}const owned=claims.filter((row)=>claimTitleWorkIssue(row.claim)===issue),allClosed=owned.length===0?(io.closedClaimsForWork?.(issue)??[]).map((claim)=>({claim,lease:parseAuthorLease(claim.body)})):[],closed=claimNumber===null?allClosed:allClosed.filter((row)=>Number(row.claim.number)===Number(claimNumber));if(owned.length>1)throw new LaneError(`work issue #${issue} must have exactly one live protected claim`);if(claimNumber!==null&&owned.length===0&&closed.length!==1)throw new LaneError(`closed claim #${claimNumber} is not a unique historical claim for work issue #${issue}`);for(const row of closed)if(claimWorkIssue(row.claim)!==issue)throw new LaneError(`closed claim #${row.claim.number} title does not identify work issue #${issue}`);for(const row of closed)if(io.openPulls().some((pr)=>pr.head?.ref===row.lease.branch))throw new LaneError(`closed claim #${row.claim.number} cannot recover while its pull request is still open`)
  const recoverable=closed.filter((row)=>{const merged=(io.branchPulls?.(row.lease.branch)??[]).filter((pr)=>pr.head?.ref===row.lease.branch&&pr.merged_at&&pr.merge_commit_sha);if(merged.length>1)throw new LaneError(`closed claim #${row.claim.number} has multiple merged pull requests`);if(merged.length===1&&!io.mergeCommitInMain(merged[0].merge_commit_sha))throw new LaneError(`merged claim #${row.claim.number} merge commit ${merged[0].merge_commit_sha} is not in main history`);return merged.length===1});if(owned.length===0&&recoverable.length!==1)throw new LaneError(`work issue #${issue} has ${recoverable.length} recoverable closed claims; historical recovery requires exactly one${recoverable.length>1?' or an explicit --claim-number <claim> selector':''}`);const recoveredClosed=owned.length===0,{claim,lease}=recoveredClosed?recoverable[0]:owned[0],pulls=io.openPulls().filter((pr)=>pr.head?.ref===lease.branch)
  // Merge-first (AGENTS.md section 4 rule 2): once the claim PR merges there is no open
  // pull request left, and the rehearsal still owes proof. Fall back to the merged pull
  // request on the same branch and drive the POST_MERGE_REHEARSAL route from it.
  let merged=false,mergeCommit=null,pr
  if(pulls.length===1){pr=pulls[0]}
  else if(pulls.length===0){
    const closed=(io.branchPulls?.(lease.branch)??[]).filter((row)=>row.head?.ref===lease.branch&&row.merged_at&&row.merge_commit_sha)
    if(closed.length!==1)throw new LaneError(`claim #${claim.number} must have exactly one live pull request`)
    pr=closed[0];merged=true;mergeCommit=pr.merge_commit_sha
    // The merge commit is NOT where the rehearsal is anchored -- commit_sha below is the
    // current main tip. It is checked here only as proof that this claim really merged
    // into main, which is what makes the post-merge route legitimate at all.
    if(!io.mergeCommitInMain(mergeCommit))throw new LaneError(`merged claim #${claim.number} merge commit ${mergeCommit} is not in main history`)
  }
  else throw new LaneError(`claim #${claim.number} must have exactly one live pull request`)
  const head=pr.head.sha,changed=io.getPrFiles(pr.number).filter((file)=>file.status!=='removed').map((file)=>file.filename)
  const migrations=changed.filter((file)=>/^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(file)),versions=migrations.map((file)=>path.basename(file).slice(0,14))
  if(!migrations.length)throw new LaneError('pull request has no added migration to prepare')
  for(const row of claims)if(claimTitleWorkIssue(row.claim)===null&&versions.includes(row.lease.version))throw new LaneError(`open claim #${row.claim.number} with an invalid title protects recovery version ${row.lease.version}`)
  const inventory=JSON.parse(io.getFileAt('config/orchestrator-global-invalidators-v1.json',head)),allFiles=new Set([...migrations,...changed.filter((file)=>/^(?:supabase\/tests\/|scripts\/production-verification-sidecars\/)/.test(file)),...inventory.files,'config/orchestrator-global-invalidators-v1.json'])
  const contents=new Map([...allFiles].map((file)=>[file,io.getFileAt(file,head)])),headTree=io.treeFiles(head),order=headTree.filter((file)=>/^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(file)).sort()
  const bundle=buildEvidenceBundle({migrations,focusedFiles:changed.filter((file)=>file.startsWith('supabase/tests/')),verificationFiles:changed.filter((file)=>file.startsWith('scripts/production-verification-sidecars/')),writes:lease.writes,reads:lease.reads,migrationOrderDigest:sha256(canonicalJson(order)),issue,pr:pr.number,claim:claim.number,baseMainSha:pr.base.sha,integrationSha:head},{isClean:()=>true,fileExists:(file)=>contents.has(file),readFile:(file)=>contents.get(file)})
  const work=io.getIssue(issue),scope=parseQueueScope(work?.body??''),gate=io.previewGateProof(issue,pr.number,head,bundle.bundle_id,scope.dependencies)
  const main=io.mainSha(),mainVersions=io.treeFiles(main).filter((file)=>/^supabase\/migrations\/\d{14}_/.test(file)).map((file)=>path.basename(file).slice(0,14)),preview=io.previewLedger?.()??livePreviewLedger(),originalApplyEvidence=versions.every((version)=>preview.versions.includes(version))?validateOriginalPreviewApplyEvidence({issue,pr:pr.number,versions,mergeCommitSha:merged?pr.merge_commit_sha:null},io):null
  const claimRows=claims.map((row)=>{const linked=io.openPulls().find((p)=>p.head?.ref===row.lease.branch);return{issue:claimTitleWorkIssue(row.claim),pr:linked?.number??0,versions:[row.lease.version],merged:false}}).filter((row)=>row.pr&&row.issue!==null)
  const route=selectPreviewRoute({issue,pr:pr.number,head_sha:head,bundle_id:bundle.bundle_id,versions,dependency_closure_complete:gate.dependency_closure_complete,claims:claimRows,main_versions:mainVersions,preview_versions:preview.versions,original_apply_evidence:originalApplyEvidence,merged})
  if(route.status!=='READY')throw new LaneError(`preview route is ${route.status}: ${route.reason}`)
  const routeName=route.route==='NORMAL_PREVIEW'?'ordinary_preview_apply':route.route==='POST_MERGE_REHEARSAL'?'merged_rehearsal':'historical_rebind'
  const routeContext=routeName==='ordinary_preview_apply'?'':main
  // commit_sha is the CURRENT MAIN TIP the rehearsal runs at -- shared-supabase-migrations
  // asserts `git rev-parse origin/main` equals it. That is a different thing from the
  // historical-recovery lane's producer-file pin at the authoring merge commit; conflating
  // the two emits a manifest the workflow refuses.
  //
  // A merged rehearsal must NOT name claim_pr: "merged_preview_source_pr replaces claim_pr.
  // A merged pull request has no live author claim; do not name both."
  const claimFields=routeName==='merged_rehearsal'?{}:{claim_pr:String(pr.number),claim_head_sha:head}
  const manifest={target:'preview',preview_allowlist:versions.join(','),...claimFields,...(routeName==='merged_rehearsal'?{commit_sha:main,merged_preview_source_pr:String(pr.number)}:{}),...(routeName==='historical_rebind'?{commit_sha:main,historical_preview_source_pr:String(pr.number),historical_preview_original_run_map:versions.map((version)=>`${version}:${originalApplyEvidence.run_id}`).join(',')}:{})}
  return {issue,pr:pr.number,head_sha:head,bundle_id:bundle.bundle_id,route:routeName,route_context:routeContext,manifest}
}

// A wrapper's doctor is a local probe; it must never hang a governed lane.
// An empty or unparseable override must NOT silently become 0 or NaN: Node treats
// both as "no timeout", so a hung doctor would hang the lane instead of being
// refused -- a silent failure produced by the very setting meant to prevent one.
export const REVIEWER_DOCTOR_TIMEOUT_MS = (()=>{
  const raw=process.env.REVIEWER_DOCTOR_TIMEOUT_MS
  if(raw===undefined||String(raw).trim()==='')return 60000
  const value=Number(raw)
  if(!Number.isFinite(value)||value<=0)throw new LaneError(`REVIEWER_DOCTOR_TIMEOUT_MS must be a positive number of milliseconds; got "${raw}". Left unchecked this disables the timeout and a hung doctor hangs a governed lane.`)
  return value
})()

// Reviewer wrappers report checks in ONE OF TWO shapes, both real and both in
// use on edge-dev today:
//
//   leading   `PASS  <check>` / `FAIL  <check>`      ai-glm, ai-muse, ai-codex-review
//   trailing  `<check> : PASS|FAIL|OK (<detail>)`    ai-grok-review, ai-kimi
//
// Only the leading form was read until 2026-08-25, which meant a trailing-form
// FAIL scored as an unrecognized format and therefore as healthy. Return the
// names of the failing checks, in order, from either shape.
export function parseDoctorFailures(output=''){
  return String(output).split(/\r?\n/).map((line)=>{
    const leading=/^\s*FAIL\s+(.*\S)\s*$/.exec(line)
    if(leading)return leading[1]
    const trailing=/^\s*(\S(?:.*\S)?)\s+:\s*FAIL\b\s*(.*\S)?\s*$/.exec(line)
    return trailing?(trailing[2]?`${trailing[1]} ${trailing[2]}`:trailing[1]):null
  }).filter(Boolean)
}

// SILENCE IS NOT A PASS -- but an unfamiliar format is not a failure either.
//
// This runs only on a ZERO exit; a non-zero exit is refused by the caller before
// it gets here. Three cases, measured against the real wrappers on edge-dev:
//
//   ai-glm / ai-muse   print `PASS  <check>` / `FAIL  <check>` lines. A FAIL wins
//                      over any number of PASSes.
//   ai-codex-review    prints exactly one `PASS provider=codex ...` line. Same
//                      leading form, one check.
//   ai-grok-review     prints key/value lines and an `auth : OK` footer.
//   ai-kimi            prints the same trailing form, including real FAILs such
//                      as `preflight : FAIL (execution-context-denied)`.
//
//                      UNTIL 2026-08-25 BOTH OF THOSE SCORED AS "unrecognized",
//                      i.e. healthy-by-exit-status. That was tolerable while the
//                      trailing form belonged only to a wrapper that never
//                      printed FAIL; un-retiring ai-kimi, which does, made it a
//                      hole. parseDoctorFailures now reads the trailing form, and
//                      `<check> : PASS|OK` counts as a recognized pass here.
//                      Grok is still healthy on exit status when it prints
//                      neither -- refusing that would have blocked a healthy Grok
//                      on every review, the false local-fault diagnosis this whole
//                      mechanism exists to end.
//   unfamiliar output  when a wrapper answers with output in a format we do not
//                      recognise AND exits 0, its own exit status is its verdict;
//                      `format` records that we could not read the detail.
//   nothing at all     proves nothing. A wrapper that quietly stops reporting must
//                      never be read as healthy forever. Refused.
//
// Do not "tidy" the third case into a pass, and do not tighten the second one
// without first running `doctor` on every ACTIVE_REVIEWERS wrapper and pasting the
// output into the change. Both halves were established that way.
export function summarizeDoctorOutput(output=''){
  const failed=parseDoctorFailures(output)
  if(failed.length)return {ok:false,failingChecks:failed,format:'checks'}
  const passed=String(output).split(/\r?\n/).filter((line)=>/^\s*PASS\s+\S/.test(line)||/^\s*\S(?:.*\S)?\s+:\s*(?:PASS|OK)\b/.test(line)).length
  if(passed)return {ok:true,failingChecks:[],format:'checks'}
  if(String(output).trim())return {ok:true,failingChecks:[],format:'unrecognized'}
  return {ok:false,failingChecks:['doctor reported nothing at all; nothing was proved'],format:'silent'}
}

// How a resolved wrapper path is actually spawned. A Windows `.cmd`/`.bat` shim
// must go through the command interpreter; everything else is executed directly.
// Kept separate from the spawn so the rule can be tested for both platforms on
// either platform.
export function doctorSpawnPlan(resolved,platform=process.platform){
  if(platform==='win32'&&/\.(cmd|bat)$/i.test(resolved))return {file:process.env.ComSpec||'cmd.exe',args:['/d','/s','/c',resolved,'doctor']}
  return {file:resolved,args:['doctor']}
}

// The single place a wrapper name becomes a real path.
//
// ON WINDOWS THE FIRST LINE IS OFTEN THE WRONG ONE. `where.exe ai-grok-review`
// prints BOTH `...\\ai-grok-review` (an extension-less bash script Windows cannot
// execute at all) and `...\\ai-grok-review.cmd` (the shim the shell actually runs,
// via PATHEXT). Taking the first line made the probe fail ENOENT for two of the
// three active reviewers and report them as local faults while they were healthy.
// Caught by spot-checking every wrapper after an independent review asked for it,
// having already been burned once by the same class of bug.
//
// So mirror what the shell does: prefer the first candidate whose extension is in
// PATHEXT, and fall back to the first line when none qualifies.
export function pickExecutableCandidate(candidates,platform=process.platform,pathext=process.env.PATHEXT){
  const list=candidates.filter(Boolean)
  if(platform!=='win32')return list[0]??null
  const exts=String(pathext||'.COM;.EXE;.BAT;.CMD').split(';').map((e)=>e.trim().toLowerCase()).filter(Boolean)
  const runnable=list.find((p)=>exts.some((e)=>p.toLowerCase().endsWith(e)))
  return runnable??list[0]??null
}

export function resolveCommandPath(command,platform=process.platform){
  try{
    const out=execFileSync(platform==='win32'?'where.exe':'which',[command],{encoding:'utf8',stdio:['ignore','pipe','ignore']})
    return pickExecutableCandidate(out.split(/\r?\n/).map((line)=>line.trim()),platform)
  }catch{return null}
}

export function acquireRef(ref, ownerSha, io = githubIo) {
  if (!io.createRef(ref, ownerSha)) throw new LaneError(`${ref} is occupied`)
  if (readRefAfterWrite(ref, ownerSha, io) !== ownerSha) throw new LaneError(`${ref} ownership could not be proved after acquisition`)
}

// GitHub's create-ref response can arrive before the new custom ref is visible
// to a following GET. Treat only a short sequence of 404/not-found reads as
// eventual consistency; a different owner is returned immediately and fails
// closed. This keeps the atomic create-if-absent lock while avoiding stranded
// mutexes caused by a successful create followed by a transient 404.
export function readRefAfterWrite(ref, expectedSha, io = githubIo, attempts = 12) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const actual = io.readRef(ref)
    if (actual !== null || attempt === attempts) return actual
    ;(io.wait ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)))(Math.min(50 * attempt, 500))
  }
  return null
}

// GitHub's pull-request head and file list are eventually consistent in the same
// way a custom ref is: a push that HAS landed can still be read back as the
// pre-push state for several seconds. Asked once, that stale answer is
// indistinguishable from a push that never happened. On 2026-08-18 three
// consecutive version supersessions rolled themselves back for exactly that
// reason, and each rollback permanently burned a migration version reservation
// that can never be reused (issue #1165).
//
// Retry ONLY an exactly-stale answer: the head we pushed from, and/or the single
// migration version we renamed from. Every other answer — a third head somebody
// else pushed, zero migrations, two migrations, an unrelated version — is a real
// conflict and fails closed on the FIRST read with no retry at all. The last
// attempt still asserts exactly, so an API that never catches up refuses rather
// than proceeding on an unproven readback.
export function readPrAfterPush(pr, expected, io = githubIo, attempts = 12) {
  const {head, version, branch, staleHead, staleVersion} = expected
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const live = io.getPr(pr), versions = migrationVersions(io.getPrFiles(pr))
    const headSha = live?.head?.sha
    if (live?.state === 'open' && headSha === head && live?.head?.ref === branch && versions.length === 1 && versions[0] === version) return live
    const staleReadback = live?.state === 'open' && live?.head?.ref === branch && (headSha === staleHead || headSha === head) && versions.length === 1 && (versions[0] === staleVersion || versions[0] === version)
    if (!staleReadback || attempt === attempts) return null
    ;(io.wait ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)))(Math.min(250 * attempt, 2000))
  }
  return null
}

export function acquireMutex(ownerSha, io = githubIo, attempts = 100) {
  for (let attempt=1; attempt<=attempts; attempt++) {
    if(io.readRef(MUTEX_RECOVERY_ACTIVE_REF))throw new LaneError('author mutex recovery is active; retry after it finishes')
    try { acquireRef(MUTEX_REF,ownerSha,io);return }
    catch(error) {
      if(!/occupied/.test(error.message))throw error
      if(attempt===attempts){
        const held=io.readRef(MUTEX_REF)
        throw new LaneError(`${MUTEX_REF} remained occupied${held ? ` at ${held}` : ''}; inspect it and use --recover-author-mutex with that exact SHA only if it is stale`)
      }
      // A mutex is held only for GitHub reads plus one issue creation. Waiting
      // here lets simultaneous unrelated authors serialize acquisition and then
      // continue authoring concurrently.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50)
    }
  }
}

export function requireOwnedRef(ref, ownerSha, io = githubIo) {
  if (io.readRef(ref) !== ownerSha) throw new LaneError(`lost ownership of ${ref}; refusing the next GitHub mutation`)
}

export function recoverStaleAuthorMutex({ expectedSha, confirmStale, serializedRecovery, now = new Date(), minAgeMs = MUTEX_STALE_AFTER_MS, quietMs = 6000 }, io = githubIo) {
  if (!confirmStale || !serializedRecovery || !/^[0-9a-f]{7,40}$/i.test(String(expectedSha ?? ''))) throw new LaneError('recovery requires the serialized recovery workflow, --expected-sha, and --confirm-stale')
    if(!io.createRef(MUTEX_RECOVERY_ACTIVE_REF,expectedSha) && readRefAfterWrite(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io)!==expectedSha)throw new LaneError('another author mutex recovery target is active')
    if(readRefAfterWrite(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io)!==expectedSha)throw new LaneError('recovery marker ownership could not be proved after acquisition')
    requireOwnedRef(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io)
    try {
    // An acquisition that read the marker just before it was created can wait
    // at most five seconds. Let it finish before inspecting/deleting the ref.
    if (quietMs > 0) (io.wait ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)))(quietMs)
    requireOwnedRef(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io)
    const actual=io.readRef(MUTEX_REF)
    if(actual===null)return {released:null,ageSeconds:null}
    if(actual!==expectedSha)throw new LaneError(`refusing recovery: mutex is ${actual}, not expected ${expectedSha}`)
    const commit=io.getCommit?.(actual)
    const message=commit?.message ?? commit?.commit?.message ?? ''
    const dateText=commit?.committer?.date ?? commit?.commit?.committer?.date
    const acquiredAt=new Date(dateText)
    if(!/^db-coordination (?:author-acquisition|author-capacity-relinquish|author-capacity-resume|preview|merge|production|claim-release|claim-split-recovery|claim-object-expansion|claim-reversion|claim-version-supersession|claim-lease-renewal|reviewer-assignment-lock|reviewer-replacement-lock|reviewer-failure(?:-replacement)?|reviewer-index-cutover-activation-audit)\b/.test(message))throw new LaneError('refusing recovery: mutex owner commit is not a recognized coordination lock')
    if(Number.isNaN(acquiredAt.valueOf()))throw new LaneError('refusing recovery: mutex owner time is unreadable')
    const age=now-acquiredAt
    if(age<minAgeMs)throw new LaneError(`refusing recovery: mutex is only ${Math.max(0,Math.floor(age/1000))} seconds old`)
    releaseOwnedRef(MUTEX_REF,expectedSha,io)
    return { released:expectedSha, ageSeconds:Math.floor(age/1000) }
    } finally { if(io.readRef(MUTEX_RECOVERY_ACTIVE_REF)===expectedSha)releaseOwnedRef(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io) }
}

export function releaseOwnedRef(ref, ownerSha, io = githubIo) {
  const actual = io.readRef(ref)
  if (actual === null) return false
  if (actual !== ownerSha) throw new LaneError(`refusing to release ${ref}: it belongs to another owner`)
  io.deleteRef(ref)
  const delays=[0,250,500,1000,1500,2000]
  for(const delay of delays){
    if(delay)(io.wait ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)))(delay)
    const after=io.readRef(ref)
    if(after===null)return true
    // A different SHA means another contender acquired the static ref after
    // our successful owner-verified delete. Never delete the successor.
    if(after!==ownerSha)return true
  }
  throw new LaneError(`release of ${ref} could not be proved after bounded readback; do not retry blindly`)
}

export function parseReviewCursor(commit) {
  if (!commit) return null
  const message=commit.message ?? commit.commit?.message ?? ''
  const match=/^db-coordination reviewer-cursor sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})(?: slot=(\d+))?$/i.exec(message)??/^db-coordination reviewer-(?:failure-)?replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40}) /i.exec(message)
  if (!match) throw new LaneError('reviewer cursor does not point to a recognized assignment')
  return {sequence:Number(match[1]),reviewer:match[2],issue:Number(match[3]),pr:Number(match[4]),headSha:match[5],slot:match[6]?Number(match[6]):1}
}

export function reviewActiveRef(reviewer){
  if(!REVIEWERS.some((row)=>row.name===reviewer))throw new LaneError(`unknown reviewer ${reviewer}`)
  return `${REVIEW_ACTIVE_REF_PREFIX}/${reviewer}`
}

export function parseReviewLease(commit){
  if(!commit)return null
  const message=commit.message??commit.commit?.message??''
  const match=/^db-coordination reviewer-lease generation=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40}) sequence=(\d+)$/i.exec(message)??/^db-coordination reviewer-cursor sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})(?: slot=\d+)?$/i.exec(message)??/^db-coordination reviewer-(?:failure-)?replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40}) /i.exec(message)
  if(!match)throw new LaneError('active reviewer lease is malformed')
  const cursorForm=!match[6]
  const lease={generation:Number(match[1]),reviewer:match[2],issue:Number(match[3]),pr:Number(match[4]),headSha:match[5],sequence:Number(cursorForm?match[1]:match[6])}
  if(!Number.isSafeInteger(lease.generation)||lease.generation<1||!Number.isSafeInteger(lease.sequence)||lease.sequence<1||!REVIEWERS.some((row)=>row.name===lease.reviewer))throw new LaneError('active reviewer lease is malformed')
  return lease
}

function reviewOperationIo(io){
  if(io?.__reviewOperation)return io
  const quota=typeof io.getRateLimit==='function'?io.getRateLimit():{remaining:5000,graphRemaining:5000,reset:0,graphReset:0}
  if(!quota||!Number.isFinite(Number(quota.remaining)))throw new LaneError('GitHub quota is unreadable; reviewer assignment refused before mutex acquisition')
  if(!Number.isFinite(Number(quota.graphRemaining)))throw new LaneError('GitHub GraphQL quota is unreadable; reviewer assignment refused before mutex acquisition')
  if(Number(quota.remaining)<REVIEW_QUOTA_RESERVE+REVIEW_OPERATION_REQUEST_LIMIT){
    const reset=new Date(Number(quota.reset)*1000).toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'})
    throw new LaneError(`GitHub quota is too low (${quota.remaining} remaining); reviewer assignment refused before mutex acquisition. Reset: ${reset}`)
  }
  if(Number(quota.graphRemaining)<REVIEW_QUOTA_RESERVE+REVIEW_OPERATION_REQUEST_LIMIT){
    const reset=new Date(Number(quota.graphReset)*1000).toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'})
    throw new LaneError(`GitHub GraphQL quota is too low (${quota.graphRemaining} remaining); reviewer assignment refused before mutex acquisition. Reset: ${reset}`)
  }
  const cache=new Map()
  const proxy=new Proxy(io,{get(target,key){
    if(key==='__reviewOperation')return true
    if(key==='__cacheRef')return (ref,sha)=>cache.set(`readRef:${JSON.stringify([ref])}`,sha)
    const value=target[key]
    if(typeof value!=='function')return value
    return (...args)=>{
      const cacheable=['listRefs','getCommit','getPr','getIssue','getIssueComments','getPrReviews'].includes(key)
      const cacheKey=cacheable?`${String(key)}:${JSON.stringify(args)}`:null
      if(cacheable&&cache.has(cacheKey))return cache.get(cacheKey)
      const result=value.apply(target,args)
      if(cacheable)cache.set(cacheKey,result)
      if(['createRef','updateRef','deleteRef'].includes(key))cache.delete(`readRef:${JSON.stringify([args[0]])}`)
      return result
    }
  }})
  return proxy
}

function finalizeReviewMutex(ownerSha,io){
  const previous=reviewWireBudget?.cleanup
  if(reviewWireBudget)reviewWireBudget.cleanup=true
  try{
    if(io.atomicReviewMutexRelease){
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      io.atomicReviewMutexRelease(ownerSha)
      if(io.readReviewRefs([MUTEX_REF]).get(MUTEX_REF)!==null)throw new LaneError(`release of ${MUTEX_REF} could not be proved after atomic deletion`)
      return true
    }
    return releaseOwnedRef(MUTEX_REF,ownerSha,io)
  }catch(error){throw new LaneError(`${error.message}; RECOVERY REQUIRED: ${MUTEX_REF} expected SHA ${ownerSha}. Use the guarded recover-author-mutex.yml procedure and do not retry blindly`)}
  finally{if(reviewWireBudget)reviewWireBudget.cleanup=previous}
}
function requireReviewWireCapacity(required,when='refused before mutex acquisition'){if(reviewWireBudget&&reviewWireBudget.count+required>REVIEW_OPERATION_REQUEST_LIMIT)throw new LaneError(`reviewer operation cannot fit ${required} remaining requests inside the ${REVIEW_OPERATION_REQUEST_LIMIT}-request budget; ${when}`)}
function acquireReviewMutex(ownerSha,io){
  if(reviewWireBudget){reviewWireBudget.cleanupReserve=io.atomicReviewMutexRelease?2:8;reviewWireBudget.locked=true}
  let acquired
  try{acquired=io.createRef(MUTEX_REF,ownerSha)}
  catch(error){
    const previous=reviewWireBudget?.cleanup
    if(reviewWireBudget)reviewWireBudget.cleanup=true
    try{
      const actual=io.readRef(MUTEX_REF)
      if(actual===ownerSha)finalizeReviewMutex(ownerSha,io)
    }catch(cleanup){throw new LaneError(`${error.message}; ${cleanup.message}; RECOVERY REQUIRED: ${MUTEX_REF} expected SHA ${ownerSha}. Use the guarded recover-author-mutex.yml procedure`)}
    finally{if(reviewWireBudget)reviewWireBudget.cleanup=previous}
    throw error
  }
  if(!acquired)throw new LaneError(`${MUTEX_REF} is occupied`)
  try{
    const proof=io.readReviewRefs?.([MUTEX_RECOVERY_ACTIVE_REF,MUTEX_REF])
    const recovery=proof?proof.get(MUTEX_RECOVERY_ACTIVE_REF):io.readRef(MUTEX_RECOVERY_ACTIVE_REF)
    let owner=proof?proof.get(MUTEX_REF):null
    if(owner===null)owner=readRefAfterWrite(MUTEX_REF,ownerSha,io)
    if(recovery||owner!==ownerSha)throw new LaneError(recovery?'author mutex recovery is active; retry after it finishes':'author mutex ownership could not be proved after acquisition')
  }catch(error){
    const previous=reviewWireBudget?.cleanup
    if(reviewWireBudget)reviewWireBudget.cleanup=true
    try{finalizeReviewMutex(ownerSha,io)}
    catch(cleanup){throw new LaneError(`${error.message}; ${cleanup.message}; RECOVERY REQUIRED: ${MUTEX_REF} expected SHA ${ownerSha}. Use the guarded recover-author-mutex.yml procedure`)}
    finally{if(reviewWireBudget)reviewWireBudget.cleanup=previous}
    throw error
  }
}

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
const reviewState=(row)=>String(row?.state??'').toUpperCase()
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

// A verdict exists for an exact head when an issue comment, a PR comment, or a
// PR review is tied to that head AND carries a decision. Extracted so the
// replacement guard and the busy-reviewer probe cannot drift apart: "this review
// is finished" has to mean the same thing in both places.
export function hasVerdictForHead(issue,pr,headSha,io){
  const evidence=[...(io.getIssueComments?.(Number(issue))??[]),...(io.getIssueComments?.(Number(pr))??[]),...(io.getPrReviews?.(Number(pr))??[])]
  return anyVerdictFor(evidence,headSha)
}

function assertReviewLeaseStillStale(row,states){
  if(!row)return
  const state=states?.get(`${row.assignment.issue}:${row.assignment.pr}`),evidence=state?.evidence??[]
  const verdict=anyVerdictFor(evidence,row.assignment.headSha)
  if(state?.pr?.state==='open'&&state?.pr?.head?.sha===row.assignment.headSha&&!verdict)throw new LaneError(`reviewer ${row.assignment.reviewer} lease became live after mutex acquisition`)
}

function isReviewAssignmentLive(assignment,states,io){
  const state=states?.get(`${assignment.issue}:${assignment.pr}`),pr=state?.pr??io.getPr(assignment.pr),evidence=state?.evidence
  const verdict=evidence?anyVerdictFor(evidence,assignment.headSha):hasVerdictForHead(assignment.issue,assignment.pr,assignment.headSha,io)
  return pr?.state==='open'&&pr?.head?.sha===assignment.headSha&&!verdict
}

// WHICH REVIEWERS ARE BUSY IN THIS REPOSITORY RIGHT NOW.
//
// The constraint being modelled is real and provider-side: `ai-grok-review`
// holds an in-flight lock PER REPOSITORY, so shared-db can have one live Grok
// review at a time. That is not a global limit -- five repositories with work
// can run five Grok reviews at once, and nothing here tries to coordinate across
// repositories. This function answers only the local question.
//
// A reviewer is busy when it holds a durable assignment whose work is still
// live: the PR is open, its head is still the head that reviewer was given, and
// no verdict has landed for that head. Anything else -- a merged or closed PR, a
// head that moved on, a recorded verdict -- frees the provider.
//
// FAIL OPEN, DELIBERATELY. If the refs cannot be listed, this returns null and
// the caller keeps the ordinary rotation. A busy probe that cannot read GitHub
// must never invent availability.
export function findBusyReviewers(io,requested=[]){
  if(typeof io.readRef!=='function')return null
  let cutover
  try{cutover=io.readRef(REVIEW_ACTIVE_CUTOVER_REF)}catch{return null}
  if(!cutover)throw new LaneError('active reviewer lease cutover is incomplete; assignment refused')
  const busy=new Set()
  const stale=[]
  let snapshot=null
  try{snapshot=typeof io.readActiveReviewLeases==='function'?io.readActiveReviewLeases():null}catch{return null}
  const records=[]
  for(const reviewer of [...ACTIVE_REVIEWERS,...OVERFLOW_REVIEWERS]){
    const ref=reviewActiveRef(reviewer.name)
    let sha
    try{sha=snapshot?snapshot.get(ref)?.sha??null:io.readRef(ref)}catch{return null}
    if(!sha)continue
    let assignment
    try{assignment=parseReviewLease(snapshot?.get(ref)?.commit??io.getCommit(sha))}catch{return null}
    if(!assignment||assignment.reviewer!==reviewer.name||(io.requiresExactReviewHeadSha&&!/^[0-9a-f]{40}$/i.test(assignment.headSha)))return null
    records.push({reviewer,ref,sha,assignment})
  }
  let states=null
    try{states=typeof io.readReviewStates==='function'?io.readReviewStates([...records.map((row)=>row.assignment),...requested]):null}catch{return null}
  for(const {reviewer,ref,sha,assignment} of records){
    let prRow,evidence
    try{
      const state=states?.get(`${assignment.issue}:${assignment.pr}`)
      prRow=state?.pr??io.getPr(assignment.pr);evidence=state?.evidence
    }catch{return null}
    if(prRow?.state!=='open'||prRow?.head?.sha!==assignment.headSha){stale.push({ref,sha,assignment});continue}
    let verdict
    try{verdict=evidence?anyVerdictFor(evidence,assignment.headSha):hasVerdictForHead(assignment.issue,assignment.pr,assignment.headSha,io)}catch{return null}
    if(verdict){stale.push({ref,sha,assignment});continue}
    busy.add(assignment.reviewer)
  }
  Object.defineProperty(busy,'stale',{value:stale,enumerable:false})
  Object.defineProperty(busy,'states',{value:states,enumerable:false})
  Object.defineProperty(busy,'leases',{value:new Map(records.map((row)=>[row.assignment.reviewer,{sha:row.sha,lease:row.assignment}])),enumerable:false})
  return busy
}

export function describeMovedAssignmentHead(request,recorded){
  return `the durable reviewer assignment is NOT missing: sequence=${recorded.sequence} reviewer=${recorded.reviewer} for issue #${request.issue} PR #${request.pr} is recorded under head ${recorded.headSha}, and this request names head ${request.headSha}. The PR head moved after that reviewer was assigned, so the exact code that reviewer was given is no longer this PR's head. A replacement would bind a new reviewer -- and later a verdict -- to a commit the failed reviewer never saw, so it is refused. Assign a reviewer to the current code instead: --assign-reviewer --issue ${request.issue} --pr ${request.pr} --head-sha <the PR's current head>. Nothing was lost and nothing needs reconstructing.`
}

export function pickReviewer(sequence,io){
  const busy=findBusyReviewers(io)
  const eligible=reviewersForOrchestrator(io.resolveOrchestratorEngine?.())
  if(!eligible.length)throw new LaneError('no reviewer is independent from the live orchestrator engine')
  const eligibleNames=new Set(eligible.map((row)=>row.name)),start=(sequence-1)%ACTIVE_REVIEWERS.length
  const ordered=Array.from({length:ACTIVE_REVIEWERS.length},(_,offset)=>ACTIVE_REVIEWERS[(start+offset)%ACTIVE_REVIEWERS.length]).filter((row)=>eligibleNames.has(row.name))
  if(!busy)return ordered[0]
  return ordered.find((row)=>!busy.has(row.name))??OVERFLOW_REVIEWERS.find((row)=>!busy.has(row.name))??ordered[0]
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

// Resolve the CURRENT reviewer bound to slot 1 for this exact (issue, pr,
// headSha), read-only. Slot 1 may have been replaced after a genuine failure
// (--replace-failed-reviewer --review-slot 1, which touches only slot 1's own
// ref namespace), so a live replacement takes priority over the original
// assignment record -- same precedence assignNextReviewerOperation itself gives
// replacements over a plain assignment. Throws if slot 1 was never assigned:
// slot 2 must never silently invent a first reviewer.
function resolveSlotOneReviewer(issue,pr,headSha,io){
  const slotOneBase=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`
  const slotOneReplacementBase=`${REVIEW_REPLACEMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`
  const missing=()=>new LaneError(`slot 2 requires slot 1 to already be assigned for issue #${issue} PR #${pr} head ${headSha}. Run --assign-reviewer --issue ${issue} --pr ${pr} --head-sha ${headSha} (default --review-slot 1) first, then request --review-slot 2.`)
  // BATCHED (issue #1798 fix). This used to be up to three separate wire
  // requests (listRefs, readRef, getCommit) run BEFORE the mutex is even
  // acquired, on every slot-2 assignment -- which is exactly the preflight
  // cost that pushed slot-2 over its own 19-request budget on real GitHub
  // every time. `readReviewRecords` reads the explicit slot-1 assignment ref
  // AND every slot-1 replacement ref, commit messages included, in one
  // GraphQL round trip. Only test doubles without readReviewRecords fall
  // back to the old three-call path.
  //
  // The `.matching` rows carry NO commit message in production -- that read is
  // a separate REST listing and its own comment says every caller falls back to
  // `io.getCommit(row.sha)`. Omitting that fallback made a real slot-2 request
  // after `--replace-failed-reviewer` throw outright (issue #1798 round 2).
  if(typeof io.readReviewRecords==='function'){
    const records=io.readReviewRecords([slotOneBase],slotOneReplacementBase)
    // `.matching` is a PREFIX listing, and slot 1's replacement base is a prefix
    // of every higher slot's base, so slot 2's records would otherwise leak into
    // slot 1's answer with the highest sequence winning (#1838). Narrow it to the
    // exact namespace, the same way the listRefs fallback below does.
    const replacementRows=(records.matching??[]).filter((row)=>inReviewReplacementNamespace(row.ref,slotOneReplacementBase))
    if(replacementRows.length){
      const replacements=replacementRows.map((row)=>parseReviewReplacement(row.commit??io.getCommit(row.sha)))
      return replacements.sort((a,b)=>b.sequence-a.sequence)[0].reviewer
    }
    const record=records.get(slotOneBase)
    if(!record)throw missing()
    return parseReviewCursor(record.commit??io.getCommit(record.sha)).reviewer
  }
  const replacementRows=(io.listRefs?.(slotOneReplacementBase)??[]).filter((row)=>inReviewReplacementNamespace(row.ref,slotOneReplacementBase))
  if(replacementRows.length){
    const replacements=replacementRows.map((row)=>parseReviewReplacement(row.commit??io.getCommit(row.sha)))
    return replacements.sort((a,b)=>b.sequence-a.sequence)[0].reviewer
  }
  const sha=io.readRef(slotOneBase)
  if(!sha)throw missing()
  return parseReviewCursor(io.getCommit(sha)).reviewer
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

const MERGE_ANCESTRY_MEMO=new WeakMap()

function reviewTargetEligible(pr,io){
  if(!pr)return false
  if(pr.state==='open')return true
  const merged=pr.merged===true||Boolean(pr.merged_at),mergeSha=pr.merge_commit_sha??pr.mergeCommit?.oid??''
  if(!merged||!/^[0-9a-f]{40}$/i.test(String(mergeSha)))return false
  // Ancestry, not the merged flag alone: a merge commit absent from main means the
  // bytes under review are not what main actually carries.
  //
  // WIRE BUDGET: `mergeCommitInMain` costs two requests (readRef + compareCommits),
  // and this predicate is reached from several alternative return paths in one
  // operation. Memoised per (io, sha) so a merged target costs those two requests
  // ONCE, never once per call site. The open-PR path short-circuits above and is
  // unchanged at zero added requests -- see REVIEW_OPERATION_REQUEST_LIMIT.
  let cache=MERGE_ANCESTRY_MEMO.get(io)
  if(!cache){cache=new Map();MERGE_ANCESTRY_MEMO.set(io,cache)}
  const key=String(mergeSha).toLowerCase()
  // The 2 requests are checked HERE rather than folded into the operations' pre-mutex
  // reservations, because raising those by 2 unconditionally would shrink the ordinary
  // open-PR path -- which spends nothing extra -- and can push a legitimate assignment
  // over the limit. Charging the merged path for its own cost keeps the open path at
  // exactly its previous headroom, and turns an opaque mid-flight exhaustion into a
  // refusal that names the reason.
  if(!cache.has(key)){
    requireReviewWireCapacity(2,'the merged-pull-request ancestry check needs two more requests than remain')
    cache.set(key,io.mergeCommitInMain?.(mergeSha)===true)
  }
  return cache.get(key)
}

function reviewIssueEligible(issue,pr,io){
  return issue?.state==='open'||(issue?.state==='closed'&&pr?.state!=='open'&&reviewTargetEligible(pr,io))
}

function assertReviewRequestEligible(request,states,io){
  if(!states)return null
  const state=states?.get(`${request.issue}:${request.pr}`),issue=state?.issue??io.getIssue(request.issue),pr=state?.pr??io.getPr(request.pr)
  if(!reviewIssueEligible(issue,pr,io)||!reviewTargetEligible(pr,io)||pr?.head?.sha!==request.headSha)throw new LaneError('review assignment issue, PR head, or merge eligibility changed after mutex acquisition')
  return state
}

function assignNextReviewerOperation({issue,pr,headSha,slot=1},io){
  const headPattern=io?.requiresExactReviewHeadSha?/^[0-9a-f]{40}$/i:/^[0-9a-f]{7,40}$/i
  if(!Number.isInteger(Number(issue))||!Number.isInteger(Number(pr))||!headPattern.test(String(headSha??'')))throw new LaneError('review assignment requires issue, PR, and exact 40-character head SHA')
  if(!Number.isInteger(Number(slot))||Number(slot)<1)throw new LaneError('review assignment slot must be a positive integer (1 = first reviewer, 2 = second independent reviewer)')
  io=reviewOperationIo(io)
  const request={issue:Number(issue),pr:Number(pr),headSha:String(headSha),slot:Number(slot)}
  const eligible=reviewersForOrchestrator(io.resolveOrchestratorEngine?.())
  if(!eligible.length)throw new LaneError('no reviewer is independent from the live orchestrator engine')
  const eligibleNames=new Set(eligible.map((row)=>row.name))
  // Slot >=2 needs a name to exclude BEFORE the mutex is taken: cheap, and it
  // lets an ungoverned "assign slot 2 with no slot 1" request fail fast.
  //
  // This branch reached the same slot-2 defect from the other side and moved
  // this resolve INSIDE the lock. #1813 fixed it by raising the ceiling instead,
  // and its REVIEW_MUTEX_SECTION_RESERVE is derived assuming the resolve is paid
  // here, pre-mutex. Two fixes for one defect is worse than either, so this
  // branch defers to the merged one: the resolve stays here, and the reserve is
  // #1813's (issue #1798 round 3 / issue #1812).
  const excludedProvider=request.slot===1?null:resolveSlotOneReviewer(request.issue,request.pr,request.headSha,io)
  const preflightBusy=findBusyReviewers(io)
  if(!preflightBusy)throw new LaneError('active reviewer leases are unreadable; reviewer assignment refused before mutex acquisition')
  const ownerSha=io.makeOwnerCommit(`db-coordination reviewer-assignment-lock issue=${request.issue} pr=${request.pr} head=${request.headSha}${request.slot!==1?` slot=${request.slot}`:''}`)
  requireReviewWireCapacity(REVIEW_MUTEX_SECTION_RESERVE)
  acquireReviewMutex(ownerSha,io)
  try{
    // Slot 1 keeps the original, unsuffixed ref namespace so every existing
    // caller and every already-recorded assignment/replacement is untouched.
    // Slot 2+ gets its own parallel namespace under the same tuple so it can
    // never collide with, or be confused for, slot 1's records.
    const slotSuffix=reviewSlotSuffix(request.slot)
    const assignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}${slotSuffix}`
    const replacementBase=`${REVIEW_REPLACEMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}${slotSuffix}`
    const replacementRows=(io.listRefs?.(replacementBase)??[]).filter((row)=>inReviewReplacementNamespace(row.ref,replacementBase))
    if(replacementRows.length){
      const replacements=replacementRows.map((row)=>{const parsed=parseReviewReplacement(row.commit??io.getCommit(row.sha));return {...parsed,failureSha:parsed.failureSha==='self'?row.sha:parsed.failureSha,replacementSha:row.sha}})
      for(const replacement of replacements){
        if(replacement.issue!==request.issue||replacement.pr!==request.pr||replacement.headSha!==request.headSha||!REVIEWERS.some((r)=>r.name===replacement.reviewer))throw new LaneError('durable reviewer replacement does not match the assignment request')
        requireReplacementEvidence(replacement,io)
      }
      const replacement=replacements.sort((a,b)=>b.sequence-a.sequence)[0], reviewer=REVIEWERS.find((r)=>r.name===replacement.reviewer)
      if(!eligibleNames.has(replacement.reviewer))throw new LaneError(`durable replacement sequence ${replacement.sequence} belongs to a retired reviewer or orchestrator-conflicting reviewer ${replacement.reviewer}; its active lease was not recreated. Record a new governed replacement for this exact head`)
      const replacementLeaseRef=reviewActiveRef(reviewer.name),liveReplacement=preflightBusy.leases.get(reviewer.name),staleReplacement=preflightBusy.stale.find((row)=>row.ref===replacementLeaseRef)
      if(liveReplacement&&liveReplacement.sha!==replacement.replacementSha&&!staleReplacement)throw new LaneError(`reviewer ${reviewer.name} has an unrelated live lease; assignment retry repair refused`)
      const failed=[...preflightBusy.leases.values()].find((row)=>row.lease.issue===request.issue&&row.lease.pr===request.pr&&row.lease.headSha===request.headSha&&row.lease.sequence===replacement.failedSequence)
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      const freshStates=io.readReviewStates?.([replacement,...(staleReplacement?[staleReplacement.assignment]:[])])
      assertReviewRequestEligible(request,freshStates,io)
      const replacementLive=isReviewAssignmentLive(replacement,freshStates,io),replacementTarget=replacementLive?replacement.replacementSha:null
      if(io.atomicReviewRefs){
        if(staleReplacement)assertReviewLeaseStillStale(staleReplacement,freshStates)
        const changes=[{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha}]
        if(failed)changes.push({ref:reviewActiveRef(failed.lease.reviewer),expected:failed.sha,sha:null})
        changes.push({ref:replacementLeaseRef,expected:staleReplacement?.sha??(liveReplacement?.sha??null),sha:replacementTarget})
        io.atomicReviewRefs(changes)
        const after=io.readReviewRefs([MUTEX_REF,...(failed?[reviewActiveRef(failed.lease.reviewer)]:[]),replacementLeaseRef])
        if(after.get(MUTEX_REF)!==ownerSha||(failed&&after.get(reviewActiveRef(failed.lease.reviewer))!==null)||after.get(replacementLeaseRef)!==replacementTarget)throw new LaneError('assignment retry replacement lease readback mismatch')
      }else{
        if(failed&&io.readRef(reviewActiveRef(failed.lease.reviewer))===failed.sha)releaseOwnedRef(reviewActiveRef(failed.lease.reviewer),failed.sha,io)
        if(staleReplacement&&io.readRef(replacementLeaseRef)===staleReplacement.sha)releaseOwnedRef(replacementLeaseRef,staleReplacement.sha,io)
        if(replacementLive&&!io.createRef(replacementLeaseRef,replacement.replacementSha)&&readRefAfterWrite(replacementLeaseRef,replacement.replacementSha,io)!==replacement.replacementSha)throw new LaneError('assignment retry replacement lease could not be restored')
      }
      return {...replacement,slot:request.slot,wrapper:reviewer.wrapper}
    }
    const priorSha=io.readRef(assignmentRef)
    if(priorSha){
      const prior=parseReviewCursor(io.getCommit(priorSha)),leaseRef=reviewActiveRef(prior.reviewer),preflightLease=preflightBusy.leases.get(prior.reviewer),stalePrior=preflightBusy.stale.find((row)=>row.ref===leaseRef&&row.sha===priorSha)
      const retryStates=io.readReviewStates?.([prior,...(stalePrior?[stalePrior.assignment]:[])])
      assertReviewRequestEligible(request,retryStates,io)
      // Eligibility is re-checked on EVERY retry return below, not only the
      // first one reached: the orchestrator engine backing a retry can differ
      // from the one that made the original assignment (a concurrent
      // orchestrator, or the same one switching engines), so a provider that
      // was independent when assigned can become a same-provider conflict by
      // the time a retry lands here. Every return path below must fail the
      // same way a fresh assignment would, never hand back a stale answer.
      if(!eligibleNames.has(prior.reviewer))throw new LaneError(`durable assignment sequence ${prior.sequence} belongs to a retired reviewer or orchestrator-conflicting reviewer ${prior.reviewer}; its active lease was not recreated. Record a governed replacement for this exact head`)
      if(preflightLease?.sha===priorSha&&preflightLease.lease.issue===prior.issue&&preflightLease.lease.pr===prior.pr&&preflightLease.lease.headSha===prior.headSha&&preflightLease.lease.sequence===prior.sequence&&!stalePrior){
        return {...prior,slot:request.slot,wrapper:REVIEWERS.find((r)=>r.name===prior.reviewer)?.wrapper}
      }
      if(stalePrior){
        if(io.atomicReviewRefs){assertReviewLeaseStillStale(stalePrior,io.readReviewStates([stalePrior.assignment]));io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},{ref:leaseRef,expected:priorSha,sha:null}]);const after=io.readReviewRefs([MUTEX_REF,leaseRef]);if(after.get(MUTEX_REF)!==ownerSha||after.get(leaseRef)!==null)throw new LaneError('stale assignment lease release readback mismatch')}
        else if(io.readRef(leaseRef)===priorSha)releaseOwnedRef(leaseRef,priorSha,io)
      }
      const live=io.getPr(prior.pr)
      if(reviewTargetEligible(live,io)&&live?.head?.sha===prior.headSha&&!hasVerdictForHead(prior.issue,prior.pr,prior.headSha,io)){
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        if(!io.createRef(leaseRef,priorSha)&&readRefAfterWrite(leaseRef,priorSha,io)!==priorSha)throw new LaneError(`reviewer ${prior.reviewer} has a conflicting active lease`)
      }
      return {...prior,slot:request.slot,wrapper:REVIEWERS.find((r)=>r.name===prior.reviewer)?.wrapper}
    }
    const cursorSha=io.readRef(REVIEW_CURSOR_REF), current=parseReviewCursor(cursorSha?io.getCommit(cursorSha):null)
    if(current&&current.issue===request.issue&&current.pr===request.pr&&current.headSha===request.headSha&&(current.slot??1)===request.slot){
      assertReviewRequestEligible(request,io.readReviewStates?.([current]),io)
      if(ACTIVE_REVIEWERS.some((row)=>row.name===current.reviewer)&&!eligibleNames.has(current.reviewer))throw new LaneError(`current reviewer ${current.reviewer} conflicts with the live orchestrator engine; assign an independent reviewer`)
      if(!io.createRef(assignmentRef,cursorSha)&&readRefAfterWrite(assignmentRef,cursorSha,io)!==cursorSha)throw new LaneError('review assignment record could not be proved; retry the same assignment')
      const live=io.getPr(current.pr)
      if(reviewTargetEligible(live,io)&&live?.head?.sha===current.headSha&&!hasVerdictForHead(current.issue,current.pr,current.headSha,io)){
        if(eligibleNames.has(current.reviewer)){
          const leaseRef=reviewActiveRef(current.reviewer),existing=io.readRef(leaseRef)
          if(existing!==cursorSha&&(!io.createRef(leaseRef,cursorSha)||readRefAfterWrite(leaseRef,cursorSha,io)!==cursorSha))throw new LaneError(`reviewer ${current.reviewer} has a conflicting active lease`)
        }
      }
      return {...current,slot:request.slot,wrapper:REVIEWERS.find((r)=>r.name===current.reviewer)?.wrapper}
    }
    const sequence=(current?.sequence??0)+1
    // Ordinary path: round-robin over the active roster. The overflow provider
    // is reached only when EVERY active reviewer is already holding live review
    // work here and the overflow provider itself is free. The rotation position
    // is derived from `sequence`, not from who was last assigned, so spending a
    // sequence on the overflow provider does not move anyone's turn.
    // Slot >=2 additionally excludes whoever slot 1 already holds for this
    // exact head, so the second reviewer is never the same provider as the
    // first -- on top of, never instead of, the ordinary busy exclusion.
    const busy=preflightBusy
    const start=(sequence-1)%ACTIVE_REVIEWERS.length
    const notTaken=(row)=>eligibleNames.has(row.name)&&!busy.has(row.name)&&row.name!==excludedProvider
    const reviewer=Array.from({length:ACTIVE_REVIEWERS.length},(_,offset)=>ACTIVE_REVIEWERS[(start+offset)%ACTIVE_REVIEWERS.length]).find(notTaken)??OVERFLOW_REVIEWERS.find(notTaken)
    if(!reviewer)throw new LaneError(request.slot===1?'no reviewer is available':`no independent reviewer is available for slot ${request.slot}: every active provider is either busy or already assigned to an earlier slot for this exact head`)
    const assignmentSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=${sequence} reviewer=${reviewer.name} issue=${request.issue} pr=${request.pr} head=${request.headSha}${request.slot!==1?` slot=${request.slot}`:''}`)
    const leaseRef=reviewActiveRef(reviewer.name)
    const leaseSha=assignmentSha
    const selectedStale=busy.stale.find((row)=>row.ref===leaseRef)
    let staleReleased=false,leaseCreated=false,cursorChanged=false,assignmentCreated=false
    try{
      if(io.atomicReviewRefs){
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        const freshStates=io.readReviewStates([{issue:request.issue,pr:request.pr,headSha:request.headSha},...(selectedStale?[selectedStale.assignment]:[])])
        const fresh=freshStates?.get(`${request.issue}:${request.pr}`)
        const freshVerdict=anyVerdictFor(fresh?.evidence,request.headSha)
        if(!reviewIssueEligible(fresh?.issue,fresh?.pr,io)||!reviewTargetEligible(fresh?.pr,io)||fresh?.pr?.head?.sha!==request.headSha||freshVerdict)throw new LaneError('review assignment issue, PR head, or verdict changed after mutex acquisition')
        if(selectedStale){
          const revived=freshStates?.get(`${selectedStale.assignment.issue}:${selectedStale.assignment.pr}`), evidence=revived?.evidence??[]
          const verdict=anyVerdictFor(evidence,selectedStale.assignment.headSha)
          if(revived?.pr?.state==='open'&&revived?.pr?.head?.sha===selectedStale.assignment.headSha&&!verdict)throw new LaneError('selected reviewer lease became live after mutex acquisition')
        }
        io.atomicReviewRefs([
          {ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},
          {ref:leaseRef,expected:selectedStale?.sha??null,sha:leaseSha},
          {ref:REVIEW_CURSOR_REF,expected:cursorSha,sha:assignmentSha},
          {ref:assignmentRef,expected:null,sha:assignmentSha},
        ])
        const refs=io.readReviewRefs([MUTEX_REF,leaseRef,REVIEW_CURSOR_REF,assignmentRef])
        if(refs.get(MUTEX_REF)!==ownerSha||refs.get(leaseRef)!==leaseSha||refs.get(REVIEW_CURSOR_REF)!==assignmentSha||refs.get(assignmentRef)!==assignmentSha)throw new LaneError('atomic review assignment readback mismatch')
        return {sequence,reviewer:reviewer.name,wrapper:reviewer.wrapper,...request}
      }
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      if(selectedStale){
        if(io.readReviewRefs){const current=io.readReviewRefs([MUTEX_REF,leaseRef]);if(current.get(MUTEX_REF)!==ownerSha||current.get(leaseRef)!==selectedStale.sha)throw new LaneError('selected stale reviewer lease changed after preflight');io.deleteRef(leaseRef);staleReleased=true}
        else if(io.readRef(leaseRef)===selectedStale.sha){releaseOwnedRef(leaseRef,selectedStale.sha,io);staleReleased=true}
      }
      if(!io.createRef(leaseRef,leaseSha)&&readRefAfterWrite(leaseRef,leaseSha,io)!==leaseSha)throw new LaneError(`reviewer ${reviewer.name} acquired a conflicting live lease`)
      leaseCreated=true
      if(cursorSha)io.updateRef(REVIEW_CURSOR_REF,assignmentSha);else if(!io.createRef(REVIEW_CURSOR_REF,assignmentSha))throw new LaneError('reviewer cursor was created concurrently; retry the same assignment')
      cursorChanged=true
      if(!io.readReviewRefs&&readRefAfterWrite(REVIEW_CURSOR_REF,assignmentSha,io)!==assignmentSha)throw new LaneError('reviewer cursor advancement could not be proved; retry the same assignment')
      if(!io.createRef(assignmentRef,assignmentSha)&&(!io.readReviewRefs&&readRefAfterWrite(assignmentRef,assignmentSha,io)!==assignmentSha))throw new LaneError('review assignment record could not be proved; retry the same assignment')
      assignmentCreated=true
      if(io.readReviewRefs){const refs=io.readReviewRefs([MUTEX_REF,leaseRef,REVIEW_CURSOR_REF,assignmentRef]);if(refs.get(MUTEX_REF)!==ownerSha||refs.get(leaseRef)!==leaseSha||refs.get(REVIEW_CURSOR_REF)!==assignmentSha||refs.get(assignmentRef)!==assignmentSha)throw new LaneError('batched review assignment readback mismatch')}
      return {sequence,reviewer:reviewer.name,wrapper:reviewer.wrapper,...request}
    }catch(error){
      const rollback=[]
      try{if(assignmentCreated&&io.readRef(assignmentRef)===assignmentSha)releaseOwnedRef(assignmentRef,assignmentSha,io)}catch(e){rollback.push(e.message)}
      try{if(cursorChanged&&io.readRef(REVIEW_CURSOR_REF)===assignmentSha){if(cursorSha){io.updateRef(REVIEW_CURSOR_REF,cursorSha);if(readRefAfterWrite(REVIEW_CURSOR_REF,cursorSha,io)!==cursorSha)throw new LaneError('cursor rollback could not be proved')}else releaseOwnedRef(REVIEW_CURSOR_REF,assignmentSha,io)}}catch(e){rollback.push(e.message)}
      try{if(leaseCreated&&io.readRef(leaseRef)===leaseSha)releaseOwnedRef(leaseRef,leaseSha,io)}catch(e){rollback.push(e.message)}
      try{if(staleReleased&&!io.readRef(leaseRef)&&!io.createRef(leaseRef,selectedStale.sha))throw new LaneError('stale reviewer lease rollback could not be proved')}catch(e){rollback.push(e.message)}
      if(rollback.length)throw new LaneError(`review assignment failed (${error.message}) and rollback was incomplete: ${rollback.join('; ')}`)
      throw error
    }
  }finally{finalizeReviewMutex(ownerSha,io)}
}

export function assignNextReviewer(request,io=githubIo){return withReviewRequestBudget(()=>assignNextReviewerOperation(request,reviewOperationIo(io)))}

function replaceClaimVersion(body,oldVersion,newVersion){
  const fence=/```db-claim\s*\n([\s\S]*?)```/.exec(String(body??''))
  if(!fence||!new RegExp(`^version: ${oldVersion}$`,'m').test(fence[1])||(fence[1].match(/^version:/gm)??[]).length!==1)throw new LaneError('claim fenced version is missing or ambiguous')
  return body.slice(0,fence.index)+fence[0].replace(`version: ${oldVersion}`,`version: ${newVersion}`)+body.slice(fence.index+fence[0].length)
}

function parseVersionSupersession(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination claim-version-superseded issue=(\d+) claim=(\d+) pr=(\d+) old=(\d{14}) new=(\d{14}) old-ref=([0-9a-f]{7,40}) head=([0-9a-f]{40})$/i.exec(message)
  if(!match)throw new LaneError('version supersession ref is unreadable')
  return {issue:Number(match[1]),claim:Number(match[2]),pr:Number(match[3]),oldVersion:match[4],newVersion:match[5],oldReservation:match[6],newHead:match[7]}
}

export function supersedeActiveClaimVersion(options,now=new Date(),io=githubIo){
  const request={issue:Number(options.issue),claim:Number(options.claim),pr:Number(options.pr),owner:String(options.owner??''),branch:String(options.branch??''),worktree:String(options.worktree??''),headSha:String(options.headSha??''),oldVersion:String(options.oldVersion??'')}
  if(!Number.isInteger(request.issue)||!Number.isInteger(request.claim)||!Number.isInteger(request.pr)||!request.owner||!request.branch||!request.worktree||!/^[0-9a-f]{40}$/i.test(request.headSha)||!/^\d{14}$/.test(request.oldVersion))throw new LaneError('version supersession requires exact issue, claim, owner, branch, worktree, PR, head, and current version')
  const supersessionRef=`refs/db-claim-supersessions/${request.claim}-${request.oldVersion}`
  const priorSha=io.readRef(supersessionRef)
  if(priorSha){
    const prior=parseVersionSupersession(io.getCommit(priorSha)),claim=io.getIssue(request.claim),lease=parseAuthorLease(claim?.body??'',now),pr=io.getPr(request.pr)
    if(prior.issue!==request.issue||prior.claim!==request.claim||prior.pr!==request.pr||prior.oldVersion!==request.oldVersion||lease.version!==prior.newVersion||lease.owner!==request.owner||lease.branch!==request.branch||lease.worktree!==request.worktree||pr?.head?.sha!==prior.newHead||pr?.head?.ref!==request.branch||io.readRef(`refs/db-claims/${request.oldVersion}`)!==prior.oldReservation||!io.readRef(`refs/db-claims/${prior.newVersion}`))throw new LaneError('durable version supersession does not match current state')
    return {...prior,supersessionSha:priorSha,idempotent:true}
  }
  const ownerSha=io.makeOwnerCommit(`db-coordination claim-version-supersession issue=${request.issue} claim=${request.claim} pr=${request.pr} head=${request.headSha}`)
  acquireMutex(ownerSha,io)
  let before,rewritten=false,bodyChanged=false,newVersion,newHead,supersessionSha
  try{
    before=io.getIssue(request.claim);if(before?.state!=='open'||Number(before.number)!==request.claim)throw new LaneError(`claim #${request.claim} is not open`)
    const lease=parseAuthorLease(before.body,now)
    if(lease.owner!==request.owner||lease.version!==request.oldVersion||lease.branch!==request.branch||lease.worktree!==request.worktree||!new RegExp(`#${request.issue}(?:\\D|$)`).test(before.title??''))throw new LaneError('claim issue, owner, lease, version, branch, or worktree changed')
    const oldReservation=io.readRef(`refs/db-claims/${request.oldVersion}`);if(!oldReservation)throw new LaneError('old permanent reservation is missing')
    const pr=io.getPr(request.pr);if(pr?.state!=='open'||pr.head?.sha!==request.headSha||pr.head?.ref!==request.branch)throw new LaneError('open PR exact head or branch changed')
    const versions=migrationVersions(io.getPrFiles(request.pr));if(versions.length!==1||versions[0]!==request.oldVersion)throw new LaneError('PR must change exactly one migration at the current reserved version')
    if(!io.localClean(request.worktree)||io.localHead(request.worktree)!==request.headSha)throw new LaneError('target worktree is dirty or not at the exact PR head')
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const reservation=io.reserveVersion();newVersion=String(reservation.version)
    if(!/^\d{14}$/.test(newVersion)||newVersion<=String(io.currentMaxVersion(request.worktree)??'')||newVersion===request.oldVersion)throw new LaneError('manager reservation is not later than current main')
    if(!io.readRef(`refs/db-claims/${newVersion}`))throw new LaneError('new permanent reservation readback failed')
    io.rewriteVersion(request.worktree,request.oldVersion,newVersion);rewritten=true
    newHead=io.commitAndPushReversion(request.worktree,request.oldVersion,newVersion)
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const newBody=replaceClaimVersion(before.body,request.oldVersion,newVersion);bodyChanged=true;io.updateIssue(request.claim,{body:newBody})
    const after=io.getIssue(request.claim),afterLease=parseAuthorLease(after.body,now)
    if(after.body!==newBody||afterLease.version!==newVersion||afterLease.owner!==lease.owner||afterLease.branch!==lease.branch||afterLease.worktree!==lease.worktree||afterLease.objects.join('|')!==lease.objects.join('|'))throw new LaneError('claim readback changed fields outside its fenced version')
    const livePr=readPrAfterPush(request.pr,{head:newHead,version:newVersion,branch:request.branch,staleHead:request.headSha,staleVersion:request.oldVersion},io)
    if(!livePr)throw new LaneError('PR did not expose exactly the new reserved migration')
    if(io.readRef(`refs/db-claims/${request.oldVersion}`)!==oldReservation||!io.readRef(`refs/db-claims/${newVersion}`))throw new LaneError('permanent reservation readback changed')
    supersessionSha=io.makeOwnerCommit(`db-coordination claim-version-superseded issue=${request.issue} claim=${request.claim} pr=${request.pr} old=${request.oldVersion} new=${newVersion} old-ref=${oldReservation} head=${newHead}`)
    if(!io.createRef(supersessionRef,supersessionSha)||readRefAfterWrite(supersessionRef,supersessionSha,io)!==supersessionSha)throw new LaneError('durable version supersession evidence could not be created and read back')
    return {issue:request.issue,claim:request.claim,pr:request.pr,oldVersion:request.oldVersion,newVersion,oldReservation,newHead,supersessionSha,idempotent:false}
  }catch(error){
    if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
    const failures=[]
    if(supersessionSha)try{if(io.readRef(supersessionRef)===supersessionSha)releaseOwnedRef(supersessionRef,supersessionSha,io)}catch(e){failures.push(e.message)}
    if(bodyChanged)try{io.updateIssue(request.claim,{body:before.body})}catch(e){failures.push(e.message)}
    if(rewritten)try{io.rewriteVersion(request.worktree,newVersion,request.oldVersion);io.commitAndPushReversion(request.worktree,newVersion,request.oldVersion)}catch(e){failures.push(e.message)}
    if(failures.length)throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${failures.join('; ')}`)
    throw error
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

export const reversionActiveClaim=supersedeActiveClaimVersion

function parseMergedClaimReissue(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination merged-claim-reissued issue=(\d+) claim=(\d+) source-pr=(\d+) old=(\d{14}) new=(\d{14}) old-ref=([0-9a-f]{7,40}) new-ref=([0-9a-f]{7,40}) merge=([0-9a-f]{40})$/i.exec(message)
  if(!match)throw new LaneError('merged claim reissue ref is unreadable')
  return {issue:Number(match[1]),claim:Number(match[2]),sourcePr:Number(match[3]),oldVersion:match[4],newVersion:match[5],oldReservation:match[6],newReservation:match[7],mergeSha:match[8]}
}

export function reissueMergedStrandedClaim(options,now=new Date(),io=githubIo){
  const request={issue:Number(options.issue),claim:Number(options.claim),sourcePr:Number(options.sourcePr),owner:String(options.owner??''),targetBranch:String(options.targetBranch??''),targetWorktree:String(options.targetWorktree??''),oldVersion:String(options.oldVersion??''),leaseHours:Number(options.leaseHours)}
  if(!Number.isInteger(request.issue)||!Number.isInteger(request.claim)||!Number.isInteger(request.sourcePr)||!request.owner||!request.targetBranch||!request.targetWorktree||!/^[0-9]{14}$/.test(request.oldVersion)||!Number.isFinite(request.leaseHours)||request.leaseHours<=0||request.leaseHours>24)throw new LaneError('merged claim reissue requires exact issue, claim, source PR, owner, target branch, target worktree, old version, and a lease of no more than 24 hours')
  const evidenceRef=`refs/db-claim-retirements/${request.claim}-${request.oldVersion}`
  const priorSha=io.readRef(evidenceRef)
  let prior=null
  if(priorSha){
    prior=parseMergedClaimReissue(io.getCommit(priorSha));const claim=io.getIssue(request.claim),lease=parseAuthorLease(claim?.body??'',now)
    if(prior.issue!==request.issue||prior.claim!==request.claim||prior.sourcePr!==request.sourcePr||prior.oldVersion!==request.oldVersion||lease.owner!==request.owner||io.readRef(`refs/db-claims/${request.oldVersion}`)!==prior.oldReservation||io.readRef(`refs/db-claims/${prior.newVersion}`)!==prior.newReservation)throw new LaneError('durable merged claim reissue does not match current state')
    if(lease.version===prior.newVersion&&lease.branch===request.targetBranch&&lease.worktree===request.targetWorktree)return {...prior,retirementSha:priorSha,idempotent:true}
    if(lease.version!==request.oldVersion)throw new LaneError('durable merged claim reissue exists but the claim is neither original nor exactly reissued')
  }
  const ownerSha=io.makeOwnerCommit(`db-coordination merged-claim-reissue-lock issue=${request.issue} claim=${request.claim} source-pr=${request.sourcePr}`)
  acquireMutex(ownerSha,io)
  let before,newVersion,newReservation,retirementSha,bodyChanged=false,evidenceCreated=false
  try{
    before=io.getIssue(request.claim)
    if(before?.state!=='open'||Number(before.number)!==request.claim)throw new LaneError(`claim #${request.claim} is not open`)
    const lease=parseAuthorLease(before.body,now)
    if(lease.owner!==request.owner||lease.version!==request.oldVersion||!new RegExp(`#${request.issue}(?:\\D|$)`).test(before.title??''))throw new LaneError('claim issue, owner, or stranded version changed')
    if(lease.branch===request.targetBranch||lease.worktree===request.targetWorktree)throw new LaneError('merged claim reissue requires a fresh target branch and worktree')
    const oldReservation=io.readRef(`refs/db-claims/${request.oldVersion}`)
    if(!oldReservation)throw new LaneError('old permanent reservation is missing')
    const pr=io.getPr(request.sourcePr),mergeSha=String(pr?.merge_commit_sha??pr?.mergeCommit?.oid??'')
    if(!(pr?.merged===true||pr?.merged_at||String(pr?.state).toLowerCase()==='merged')||!/^[0-9a-f]{40}$/i.test(mergeSha))throw new LaneError('source pull request is not merged with an exact merge commit')
    const versions=migrationVersions(io.getPrFiles(request.sourcePr))
    if(versions.length!==1||versions[0]!==request.oldVersion)throw new LaneError('source pull request must contain exactly the stranded migration version')
    const mainSha=io.mainSha?.()??io.readRef('refs/heads/main')
    assertMergeCommitInMainHistory(mergeSha,mainSha,io)
    if(prior&&(prior.mergeSha!==mergeSha||prior.oldReservation!==oldReservation||prior.newVersion<=request.oldVersion))throw new LaneError('durable merged claim reissue does not match source merge or reservations')
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    if(prior){newVersion=prior.newVersion;newReservation=prior.newReservation;retirementSha=priorSha}
    else{
      const reservation=io.reserveVersion();newVersion=String(reservation.version);newReservation=io.readRef(`refs/db-claims/${newVersion}`)
      if(!/^[0-9]{14}$/.test(newVersion)||newVersion<=request.oldVersion||!newReservation)throw new LaneError('new permanent reservation is not later than the stranded version or failed readback')
    }
    const expiresAt=new Date(now.valueOf()+request.leaseHours*3600000)
    let newBody=replaceClaimVersion(before.body,request.oldVersion,newVersion)
    newBody=replaceLeaseLocation(newBody,request.targetBranch,request.targetWorktree)
    newBody=replaceLeaseExpiry(newBody,expiresAt)
    if(!prior){
      retirementSha=io.makeOwnerCommit(`db-coordination merged-claim-reissued issue=${request.issue} claim=${request.claim} source-pr=${request.sourcePr} old=${request.oldVersion} new=${newVersion} old-ref=${oldReservation} new-ref=${newReservation} merge=${mergeSha}`)
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      if(!io.createRef(evidenceRef,retirementSha)||readRefAfterWrite(evidenceRef,retirementSha,io)!==retirementSha)throw new LaneError('immutable retirement and supersession evidence could not be created and read back')
      evidenceCreated=true
    }
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    bodyChanged=true;io.updateIssue(request.claim,{body:newBody})
    const after=io.getIssue(request.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.state!=='open'||after.body!==newBody||afterLease.version!==newVersion||afterLease.owner!==lease.owner||afterLease.branch!==request.targetBranch||afterLease.worktree!==request.targetWorktree||afterLease.objects.join('|')!==lease.objects.join('|'))throw new LaneError('reissued claim readback changed its object lock or identity')
    if(io.readRef(`refs/db-claims/${request.oldVersion}`)!==oldReservation||io.readRef(`refs/db-claims/${newVersion}`)!==newReservation||io.readRef(evidenceRef)!==retirementSha)throw new LaneError('reissue reservations or retirement evidence changed during readback')
    return {issue:request.issue,claim:request.claim,sourcePr:request.sourcePr,oldVersion:request.oldVersion,newVersion,oldReservation,newReservation,mergeSha,retirementSha,expiresAt:expiresAt.toISOString(),idempotent:false}
  }catch(error){
    if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
    const failures=[]
    if(bodyChanged)try{io.updateIssue(request.claim,{body:before.body});if(io.getIssue(request.claim)?.body!==before.body)throw new LaneError('claim rollback readback mismatch')}catch(e){failures.push(e.message)}
    if(evidenceCreated)try{if(io.readRef(evidenceRef)===retirementSha)releaseOwnedRef(evidenceRef,retirementSha,io)}catch(e){failures.push(e.message)}
    if(failures.length)throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${failures.join('; ')}`)
    throw error
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

function parseReviewReplacement(commit) {
  const message=commit?.message ?? commit?.commit?.message ?? ''
  const match=/^db-coordination reviewer-replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40}) failed-sequence=(\d+) prior-sequence=(\d+) failure-ref=([0-9a-f]{7,40})$/i.exec(message)??/^db-coordination reviewer-failure-replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40}) failed-sequence=(\d+) prior-sequence=(\d+) failure-ref=(self) /i.exec(message)
  if(!match)throw new LaneError('reviewer replacement ref does not point to a recognized replacement')
  return {sequence:Number(match[1]),reviewer:match[2],issue:Number(match[3]),pr:Number(match[4]),headSha:match[5],failedSequence:Number(match[6]),priorSequence:Number(match[7]),failureSha:match[8]}
}

function requireReplacementEvidence(replacement,io){
  const ref=`${REVIEW_FAILURE_REF_PREFIX}/${replacement.issue}-${replacement.pr}-${replacement.headSha}-${replacement.failedSequence}`
  const expected=replacement.failureSha==='self'?replacement.recordSha:replacement.failureSha
  if(!expected||io.readRef(ref)!==expected)throw new LaneError('immutable reviewer failure evidence is missing or changed')
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

function replaceFailedReviewerOperation({issue,pr,headSha,failedSequence,failureCode,failingCheck,confirmLocalDependencyUnfixable,confirmNoVerdict,confirmNoArtifact,slot=1},io){
  io=reviewOperationIo(io)
  const request={issue:Number(issue),pr:Number(pr),headSha:String(headSha??''),failedSequence:Number(failedSequence),slot:Number(slot)}
  const eligible=reviewersForOrchestrator(io.resolveOrchestratorEngine?.())
  const eligibleNames=new Set(eligible.map((row)=>row.name))
  if(!Number.isInteger(request.issue)||!Number.isInteger(request.pr)||!/^[0-9a-f]{40}$/i.test(request.headSha)||!Number.isInteger(request.failedSequence))throw new LaneError('reviewer replacement requires exact issue, PR, 40-character head SHA, and failed sequence')
  if(!Number.isInteger(request.slot)||request.slot<1)throw new LaneError('reviewer replacement slot must be a positive integer (1 = first reviewer, 2 = second independent reviewer)')
  if(!TERMINAL_FAILURE_CODES.includes(String(failureCode??'')))throw new LaneError(`reviewer replacement requires a recognized terminal provider/tool failure code (${TERMINAL_FAILURE_CODES.join(', ')})`)
  // A LOCAL fault is not the reviewer's fault. Replacing on one spends a
  // rotation slot and records permanent evidence against a provider that was
  // working, which is exactly how glm-5.3 was benched for two days. The named
  // failing check is required so the evidence says what actually broke, and a
  // replacement is only issued once the operator states plainly that the local
  // fault cannot be fixed on this machine right now.
  if(String(failureCode)==='local_dependency_unavailable'){
    if(!String(failingCheck??'').trim())throw new LaneError('local_dependency_unavailable requires --failing-check naming the exact doctor check that failed. A failure record that cannot name the failing check is a guess.')
    if(!confirmLocalDependencyUnfixable)throw new LaneError(`this is a LOCAL dependency fault ("${String(failingCheck).trim()}"), not a provider fault. Fix it on this machine and retry the SAME reviewer -- a replacement spends a rotation slot and records permanent evidence against a provider that is working. If it genuinely cannot be fixed here, re-run with --confirm-local-dependency-unfixable.`)
  }else if(String(failingCheck??'').trim())throw new LaneError('--failing-check applies only to local_dependency_unavailable')
  if(!confirmNoVerdict||!confirmNoArtifact)throw new LaneError('reviewer replacement requires explicit confirmation that the failed session produced no verdict and no artifact')
  const preflightBusy=findBusyReviewers(io,[request])
  if(!preflightBusy)throw new LaneError('active reviewer leases are unreadable; reviewer replacement refused before mutex acquisition')
  // Slot-aware, in the SAME namespaces assignment writes: a replacement request
  // for slot N resolves the failed sequence against slot N's own records and
  // nothing else. Slot 1 is byte-for-byte its historical unsuffixed namespace.
  // This is the gap #1832 reported -- the matcher below is unchanged and still
  // fails closed; it simply now gets shown the right records.
  const slotSuffix=reviewSlotSuffix(request.slot)
  const assignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}${slotSuffix}`
  // Failure evidence stays keyed by the globally monotone sequence, which is
  // unique across slots, so it needs no suffix and older refs keep their names.
  const failureRef=`${REVIEW_FAILURE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}-${request.failedSequence}`
  const replacementBase=`${REVIEW_REPLACEMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}${slotSuffix}`
  const replacementRef=`${replacementBase}-${request.failedSequence}`
  // Slot >=2 must stay independent of slot 1 after a replacement, not only at
  // first assignment. Resolved read-only, pre-mutex, exactly as assignment does.
  const excludedProvider=request.slot===1?null:resolveSlotOneReviewer(request.issue,request.pr,request.headSha,io)
  const fixedRecords=io.readReviewRecords?.([replacementRef,assignmentRef,REVIEW_CURSOR_REF],replacementBase)??null
  let ownerSha=null,mutexAcquired=false
  try{
    let priorReplacement=fixedRecords?(fixedRecords.get(replacementRef)?.sha??null):io.readRef(replacementRef)
    // The first implementation used one unsuffixed immutable ref. Preserve it
    // as the first link while allowing later links to be appended safely.
    if(!priorReplacement){
      const legacyRow=request.slot===1?(fixedRecords?.matching??io.listRefs?.(replacementBase)??[]).find((row)=>row.ref===replacementBase):null
      if(legacyRow){const parsed=parseReviewReplacement(io.getCommit(legacyRow.sha));if(parsed.failedSequence===request.failedSequence)priorReplacement=legacyRow.sha}
    }
    if(priorReplacement){
      const rawParsed=parseReviewReplacement(fixedRecords?.get(replacementRef)?.sha===priorReplacement?fixedRecords.get(replacementRef).commit:io.getCommit(priorReplacement)),parsed={...rawParsed,failureSha:rawParsed.failureSha==='self'?priorReplacement:rawParsed.failureSha}, reviewer=REVIEWERS.find((r)=>r.name===parsed.reviewer)
      if(parsed.issue!==request.issue||parsed.pr!==request.pr||parsed.headSha!==request.headSha||parsed.failedSequence!==request.failedSequence||!reviewer)throw new LaneError('durable reviewer replacement does not match this retry')
      requireReplacementEvidence(parsed,io)
      if(!eligibleNames.has(parsed.reviewer))throw new LaneError(`durable replacement sequence ${parsed.sequence} belongs to a retired reviewer or orchestrator-conflicting reviewer ${parsed.reviewer}; its active lease was not recreated. Record a new governed replacement for this exact head`)
      const failed=[...preflightBusy.leases.values()].find((row)=>row.lease.issue===request.issue&&row.lease.pr===request.pr&&row.lease.headSha===request.headSha&&row.lease.sequence===request.failedSequence)
      const replacementLeaseRef=reviewActiveRef(parsed.reviewer)
      const staleReplacement=preflightBusy.stale.find((row)=>row.ref===replacementLeaseRef)
      const liveReplacement=preflightBusy.leases.get(parsed.reviewer)
      if(liveReplacement&&liveReplacement.sha!==priorReplacement&&!staleReplacement)throw new LaneError(`reviewer ${parsed.reviewer} has an unrelated live lease; idempotent replacement repair refused`)
      ownerSha=io.makeOwnerCommit(`db-coordination reviewer-replacement-lock issue=${request.issue} pr=${request.pr} head=${request.headSha}${request.slot!==1?` slot=${request.slot}`:''}`)
      requireReviewWireCapacity(10);acquireReviewMutex(ownerSha,io);mutexAcquired=true
      const freshStates=io.readReviewStates?.([parsed,...(staleReplacement?[staleReplacement.assignment]:[])])
      assertReviewRequestEligible(request,freshStates,io)
      const replacementLive=isReviewAssignmentLive(parsed,freshStates,io),replacementTarget=replacementLive?priorReplacement:null
      let failedDeleted=false,staleDeleted=false
      try{if(io.atomicReviewRefs){
          requireOwnedRef(MUTEX_REF,ownerSha,io)
          if(staleReplacement)assertReviewLeaseStillStale(staleReplacement,freshStates)
          const changes=[]
          changes.push({ref:MUTEX_REF,expected:ownerSha,sha:ownerSha})
          if(failed)changes.push({ref:reviewActiveRef(failed.lease.reviewer),expected:failed.sha,sha:null})
          changes.push({ref:replacementLeaseRef,expected:staleReplacement?.sha??(liveReplacement?.sha??null),sha:replacementTarget})
          io.atomicReviewRefs(changes)
          const after=io.readReviewRefs([MUTEX_REF,...(failed?[reviewActiveRef(failed.lease.reviewer)]:[]),replacementLeaseRef])
          if(after.get(MUTEX_REF)!==ownerSha||(failed&&after.get(reviewActiveRef(failed.lease.reviewer))!==null)||after.get(replacementLeaseRef)!==replacementTarget)throw new LaneError('atomic idempotent replacement readback mismatch')
        }else if(io.readReviewRefs){
          const failedRef=failed?reviewActiveRef(failed.lease.reviewer):null,refs=io.readReviewRefs([MUTEX_REF,...(failedRef?[failedRef]:[]),replacementLeaseRef])
          if(refs.get(MUTEX_REF)!==ownerSha||(failed&&refs.get(failedRef)!==failed.sha)||(staleReplacement&&refs.get(replacementLeaseRef)!==staleReplacement.sha))throw new LaneError('idempotent replacement lease state changed after preflight')
          if(failed){io.deleteRef(failedRef);failedDeleted=true}
          if(staleReplacement){io.deleteRef(replacementLeaseRef);staleDeleted=true}
          if(replacementLive&&refs.get(replacementLeaseRef)!==priorReplacement&&!io.createRef(replacementLeaseRef,priorReplacement))throw new LaneError('idempotent replacement lease could not be restored')
          const after=io.readReviewRefs([MUTEX_REF,...(failedRef?[failedRef]:[]),replacementLeaseRef])
          if(after.get(MUTEX_REF)!==ownerSha||(failed&&after.get(failedRef)!==null)||after.get(replacementLeaseRef)!==replacementTarget)throw new LaneError('idempotent replacement lease readback mismatch')
        }else{
          if(failed&&io.readRef(reviewActiveRef(failed.lease.reviewer))===failed.sha){releaseOwnedRef(reviewActiveRef(failed.lease.reviewer),failed.sha,io);failedDeleted=true}
          if(staleReplacement&&io.readRef(replacementLeaseRef)===staleReplacement.sha){releaseOwnedRef(replacementLeaseRef,staleReplacement.sha,io);staleDeleted=true}
          if(replacementLive&&!io.createRef(replacementLeaseRef,priorReplacement)&&readRefAfterWrite(replacementLeaseRef,priorReplacement,io)!==priorReplacement)throw new LaneError('idempotent replacement lease could not be restored')
        }
      }catch(error){
        const rollback=[]
        try{if(failedDeleted&&!io.readRef(reviewActiveRef(failed.lease.reviewer)))io.createRef(reviewActiveRef(failed.lease.reviewer),failed.sha)}catch(e){rollback.push(e.message)}
        try{if(staleDeleted&&!io.readRef(replacementLeaseRef))io.createRef(replacementLeaseRef,staleReplacement.sha)}catch(e){rollback.push(e.message)}
        if(rollback.length)throw new LaneError(`${error.message}; idempotent lease rollback incomplete: ${rollback.join('; ')}`)
        throw error
      }
      return {...parsed,slot:request.slot,wrapper:reviewer.wrapper,failureCode:String(failureCode),replacementSha:priorReplacement}
    }
    const assignmentSha=fixedRecords?.get(assignmentRef)?.sha??io.readRef(assignmentRef)
    if(!assignmentSha){
      const recordedElsewhere=findPrReviewAssignments(request.issue,request.pr,io)
      if(recordedElsewhere===null)throw new LaneError(`no durable reviewer assignment exists for issue #${request.issue} PR #${request.pr} at head ${request.headSha}`)
      const recorded=recordedElsewhere.find((row)=>row.sequence===request.failedSequence)??recordedElsewhere[0]
      if(recorded)throw new LaneError(describeMovedAssignmentHead(request,recorded))
      throw new LaneError(`no durable reviewer assignment exists for issue #${request.issue} PR #${request.pr} under ANY head; --assign-reviewer was never run for this pull request, so there is nothing to replace`)
    }
    const initial=parseReviewCursor(fixedRecords?.get(assignmentRef)?.sha===assignmentSha?fixedRecords.get(assignmentRef).commit:io.getCommit(assignmentSha))
    const replacementRows=(fixedRecords?.matching??io.listRefs?.(replacementBase)??[]).filter((row)=>inReviewReplacementNamespace(row.ref,replacementBase))
    const parsedReplacements=replacementRows.map((row)=>{const parsed=parseReviewReplacement(row.commit??io.getCommit(row.sha));return {...parsed,failureSha:parsed.failureSha==='self'?row.sha:parsed.failureSha}})
    for(const replacement of parsedReplacements)requireReplacementEvidence(replacement,io)
    const predecessors=parsedReplacements.filter((row)=>row.sequence===request.failedSequence)
    const original=request.failedSequence===initial.sequence?initial:predecessors.length===1?predecessors[0]:null
    if(!original||original.issue!==request.issue||original.pr!==request.pr||original.headSha!==request.headSha)throw new LaneError('durable reviewer assignment or replacement does not match the replacement request')
    const cursorSha=fixedRecords?.get(REVIEW_CURSOR_REF)?.sha??io.readRef(REVIEW_CURSOR_REF), cursor=parseReviewCursor(cursorSha?(fixedRecords?.get(REVIEW_CURSOR_REF)?.sha===cursorSha?fixedRecords.get(REVIEW_CURSOR_REF).commit:io.getCommit(cursorSha)):null)
    if(!cursor||cursor.sequence<request.failedSequence)throw new LaneError('reviewer cursor is behind the failed durable assignment')
    const preflightState=preflightBusy.states?.get(`${request.issue}:${request.pr}`)
    const issueRow=preflightState?.issue??io.getIssue(request.issue), prRow=preflightState?.pr??io.getPr(request.pr)
    if(!reviewIssueEligible(issueRow,prRow,io))throw new LaneError('review replacement requires an open issue or a merged pull request whose merge commit is in main')
    // Same eligibility rule as assignment, and it must be applied HERE, pre-mutex, not
    // only at the post-mutex recheck below: an open-only test at this point throws
    // before the merged-eligible gate is ever reached, which would leave replacement
    // impossible for a merged head even though assignment works.
    if(!reviewTargetEligible(prRow,io))throw new LaneError('review replacement requires the exact open PR head')
    // The mirror of the lookup above: here the assignment WAS found under the
    // head that was named, but the pull request has since moved past it. Same
    // truth, said plainly, instead of a technicality.
    if(prRow?.head?.sha!==request.headSha)throw new LaneError(`review replacement requires the exact open PR head: sequence=${initial.sequence} reviewer=${initial.reviewer} IS recorded for issue #${request.issue} PR #${request.pr} under head ${request.headSha}, but the pull request has since moved to head ${String(prRow?.head?.sha??'unknown')}. Nothing is missing. A push replaced the code under review, so a replacement reviewer would be bound to a commit the failed reviewer never saw. Assign a reviewer to the new code instead: --assign-reviewer --issue ${request.issue} --pr ${request.pr} --head-sha ${String(prRow?.head?.sha??'<current head>')}`)
    const hasVerdict=preflightState?.evidence?anyVerdictFor(preflightState.evidence,request.headSha):hasVerdictForHead(request.issue,request.pr,request.headSha,io)
    if(hasVerdict)throw new LaneError('an existing verdict for the exact head forbids reviewer replacement')
    const failedLeaseRef=reviewActiveRef(original.reviewer),cachedFailed=preflightBusy.leases?.get(original.reviewer),failedLeaseSha=cachedFailed?.sha??io.readRef(failedLeaseRef)
    const failedLease=failedLeaseSha?(cachedFailed?.sha===failedLeaseSha?cachedFailed.lease:parseReviewLease(io.getCommit(failedLeaseSha))):null
    if(failedLease&&(![failedLease.issue,failedLease.pr,failedLease.headSha,failedLease.sequence,failedLease.reviewer].every((value,index)=>value===[request.issue,request.pr,request.headSha,request.failedSequence,original.reviewer][index])))throw new LaneError('failed reviewer active lease does not match the permanent failure evidence')
    // The failing check rides along in the immutable evidence, so a later reader
    // can tell a real provider outage from a stopped local service without
    // re-deriving it from memory.
    const checkNote=String(failingCheck??'').trim()?` failing-check=${String(failingCheck).trim().replace(/\s+/g,'_')}`:''
    let failureSha
    // SKIP, DO NOT REFUSE (#1297). The rotation position is only a starting point.
    // Every provider that already failed on THIS exact head is excluded, and the
    // cursor is advanced past each excluded name so the durable sequence still
    // moves forward monotonically and stays consistent with the sequence this
    // replacement allocates. (Byte-identical retries come from the create-only
    // replacement ref read above, not from this advancement.)
    // Refuse only when no other active reviewer is left.
    const bySequence=new Map([[initial.sequence,initial.reviewer],...parsedReplacements.map((row)=>[row.sequence,row.reviewer])])
    const failedNames=new Set([original.reviewer])
    for(const row of parsedReplacements){const name=bySequence.get(row.failedSequence);if(name)failedNames.add(name)}
    let sequence=null, reviewer=null
    for(let offset=0;offset<ACTIVE_REVIEWERS.length;offset+=1){
      const candidateSequence=cursor.sequence+1+offset, candidate=ACTIVE_REVIEWERS[(candidateSequence-1)%ACTIVE_REVIEWERS.length]
      if(!eligibleNames.has(candidate.name)||failedNames.has(candidate.name)||preflightBusy.has(candidate.name)||candidate.name===excludedProvider)continue
      sequence=candidateSequence;reviewer=candidate;break
    }
    // Compatibility hook for historical configurations that had an overflow
    // provider. The approved 2026-08-28 roster has none.
    if(!reviewer){
      const overflow=OVERFLOW_REVIEWERS.find((row)=>eligibleNames.has(row.name)&&!failedNames.has(row.name)&&!preflightBusy.has(row.name)&&row.name!==excludedProvider)
      if(overflow){sequence=cursor.sequence+1+ACTIVE_REVIEWERS.length;reviewer=overflow}
    }
    if(!reviewer)throw new LaneError(request.slot===1?'no other reviewer is available; every active provider has already failed on this exact head':`no other independent reviewer is available for slot ${request.slot}: every active provider has already failed on this exact head, is busy, or is already holding an earlier slot for it`)
    const replacementSha=io.makeOwnerCommit(`db-coordination reviewer-failure-replacement sequence=${sequence} reviewer=${reviewer.name} issue=${request.issue} pr=${request.pr} head=${request.headSha} failed-sequence=${request.failedSequence} prior-sequence=${cursor.sequence} failure-ref=self failed-reviewer=${original.reviewer} code=${failureCode}${checkNote} verdict=none artifact=none`)
    failureSha=replacementSha;ownerSha=replacementSha
    const cursorReplacementSha=replacementSha
    const replacementLeaseRef=reviewActiveRef(reviewer.name)
    const replacementLeaseSha=cursorReplacementSha
    const replacementStale=preflightBusy.stale.find((row)=>row.ref===replacementLeaseRef)
    let failureCreated=false, cursorUpdated=false,failedLeaseReleased=false,replacementStaleReleased=false,replacementLeaseCreated=false
    requireReviewWireCapacity(11);acquireReviewMutex(ownerSha,io);mutexAcquired=true
    try{
      if(io.atomicReviewRefs){
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        const freshStates=io.readReviewStates([original,...(replacementStale?[replacementStale.assignment]:[])])
        const fresh=freshStates?.get(`${request.issue}:${request.pr}`)
        const freshVerdict=anyVerdictFor(fresh?.evidence,request.headSha)
        if(!reviewIssueEligible(fresh?.issue,fresh?.pr,io)||!reviewTargetEligible(fresh?.pr,io)||fresh?.pr?.head?.sha!==request.headSha||freshVerdict)throw new LaneError('review replacement issue, PR head, or verdict changed after mutex acquisition')
        assertReviewLeaseStillStale(replacementStale,freshStates)
        const changes=[
          {ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},
          {ref:failureRef,expected:null,sha:failureSha},
          {ref:REVIEW_CURSOR_REF,expected:cursorSha,sha:cursorReplacementSha},
          {ref:replacementRef,expected:null,sha:replacementSha},
          {ref:replacementLeaseRef,expected:replacementStale?.sha??null,sha:replacementLeaseSha},
        ]
        if(failedLeaseSha)changes.splice(changes.length-1,0,{ref:failedLeaseRef,expected:failedLeaseSha,sha:null})
        io.atomicReviewRefs(changes)
        const refs=io.readReviewRefs([MUTEX_REF,failureRef,REVIEW_CURSOR_REF,replacementRef,failedLeaseRef,replacementLeaseRef])
        if(refs.get(MUTEX_REF)!==ownerSha||refs.get(failureRef)!==failureSha||refs.get(REVIEW_CURSOR_REF)!==cursorReplacementSha||refs.get(replacementRef)!==replacementSha||refs.get(failedLeaseRef)!==null||refs.get(replacementLeaseRef)!==replacementLeaseSha)throw new LaneError('atomic review replacement readback mismatch')
        return {sequence,reviewer:reviewer.name,wrapper:reviewer.wrapper,...request,priorSequence:cursor.sequence,failureCode:String(failureCode),failureSha,replacementSha}
      }
      if(io.readReviewRefs){
        const locked=io.readReviewRefs([MUTEX_REF,REVIEW_CURSOR_REF,failedLeaseRef,...(replacementStale?[replacementLeaseRef]:[])])
        if(locked.get(MUTEX_REF)!==ownerSha||locked.get(REVIEW_CURSOR_REF)!==cursorSha||locked.get(failedLeaseRef)!==failedLeaseSha||(replacementStale&&locked.get(replacementLeaseRef)!==replacementStale.sha))throw new LaneError('review replacement state changed after preflight')
      }else {requireOwnedRef(MUTEX_REF,ownerSha,io);if(io.readRef(REVIEW_CURSOR_REF)!==cursorSha)throw new LaneError('reviewer cursor changed after preflight')}
      if(!io.createRef(failureRef,failureSha))throw new LaneError('review failure evidence already exists without a replacement; manual audit required')
      failureCreated=true
      if(!io.readReviewRefs&&readRefAfterWrite(failureRef,failureSha,io)!==failureSha)throw new LaneError('immutable review failure evidence could not be proved')
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      io.updateRef(REVIEW_CURSOR_REF,cursorReplacementSha);cursorUpdated=true
      if(!io.readReviewRefs&&readRefAfterWrite(REVIEW_CURSOR_REF,cursorReplacementSha,io)!==cursorReplacementSha)throw new LaneError('reviewer cursor replacement could not be proved')
      if(!io.createRef(replacementRef,replacementSha))throw new LaneError('review replacement record was created concurrently')
      if(!io.readReviewRefs&&readRefAfterWrite(replacementRef,replacementSha,io)!==replacementSha)throw new LaneError('review replacement record could not be proved')
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      if(failedLeaseSha){if(io.readReviewRefs){io.deleteRef(failedLeaseRef);failedLeaseReleased=true}else if(io.readRef(failedLeaseRef)===failedLeaseSha){releaseOwnedRef(failedLeaseRef,failedLeaseSha,io);failedLeaseReleased=true}}
      if(replacementStale){if(io.readReviewRefs){io.deleteRef(replacementLeaseRef);replacementStaleReleased=true}else if(io.readRef(replacementLeaseRef)===replacementStale.sha){releaseOwnedRef(replacementLeaseRef,replacementStale.sha,io);replacementStaleReleased=true}}
      if(!io.createRef(replacementLeaseRef,replacementLeaseSha)&&readRefAfterWrite(replacementLeaseRef,replacementLeaseSha,io)!==replacementLeaseSha)throw new LaneError(`replacement reviewer ${reviewer.name} has a conflicting active lease`)
      replacementLeaseCreated=true
      if(io.readReviewRefs){
        const refs=io.readReviewRefs([MUTEX_REF,failureRef,REVIEW_CURSOR_REF,replacementRef,failedLeaseRef,replacementLeaseRef])
        if(refs.get(MUTEX_REF)!==ownerSha||refs.get(failureRef)!==failureSha||refs.get(REVIEW_CURSOR_REF)!==cursorReplacementSha||refs.get(replacementRef)!==replacementSha||refs.get(failedLeaseRef)!==null||refs.get(replacementLeaseRef)!==replacementLeaseSha)throw new LaneError('batched review replacement readback mismatch')
      }
      return {sequence,reviewer:reviewer.name,wrapper:reviewer.wrapper,...request,priorSequence:cursor.sequence,failureCode:String(failureCode),failureSha,replacementSha}
    }catch(error){
      const rollback=[]
      try{if(replacementLeaseCreated&&io.readRef(replacementLeaseRef)===replacementLeaseSha)releaseOwnedRef(replacementLeaseRef,replacementLeaseSha,io)}catch(e){rollback.push(e.message)}
      try{if(replacementStaleReleased&&!io.readRef(replacementLeaseRef)&&!io.createRef(replacementLeaseRef,replacementStale.sha))throw new LaneError('replacement stale lease rollback could not be proved')}catch(e){rollback.push(e.message)}
      try{if(failedLeaseReleased&&!io.readRef(failedLeaseRef)&&!io.createRef(failedLeaseRef,failedLeaseSha))throw new LaneError('failed reviewer lease rollback could not be proved')}catch(e){rollback.push(e.message)}
      try{if(io.readRef(replacementRef)===replacementSha)releaseOwnedRef(replacementRef,replacementSha,io)}catch(e){rollback.push(e.message)}
      try{if(cursorUpdated&&io.readRef(REVIEW_CURSOR_REF)===cursorReplacementSha){io.updateRef(REVIEW_CURSOR_REF,cursorSha);if(readRefAfterWrite(REVIEW_CURSOR_REF,cursorSha,io)!==cursorSha)throw new LaneError('cursor rollback could not be proved')}}catch(e){rollback.push(e.message)}
      try{if(failureCreated&&io.readRef(failureRef)===failureSha)releaseOwnedRef(failureRef,failureSha,io)}catch(e){rollback.push(e.message)}
      if(rollback.length)throw new LaneError(`review replacement failed (${error.message}) and rollback was incomplete: ${rollback.join('; ')}`)
      throw error
    }
  }finally{if(mutexAcquired)finalizeReviewMutex(ownerSha,io)}
}

export function replaceFailedReviewer(request,io=githubIo){return withReviewRequestBudget(()=>replaceFailedReviewerOperation(request,reviewOperationIo(io)))}

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
function matchesAssignmentTuple(ref, number, headSha) {
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
function matchesReplacementForSlot(ref, number, headSha, slotSuffix) {
  return new RegExp(`-${number}-${headSha}${slotSuffix}(?:-\\d+)?$`).test(ref)
}

// The suffix an assignment ref carries after its tuple: '' for slot 1, `-slotN`
// above it. Read back off the ref itself, so the reader cannot disagree with
// what the writer produced.
function assignmentSlotSuffix(ref, number, headSha) {
  return new RegExp(`-${number}-${headSha}(-slot\\d+)?$`).exec(ref)?.[1] ?? ''
}

function matchesReplacementTuple(ref, number, headSha) {
  return new RegExp(`-${number}-${headSha}(?:-slot\\d+)?(?:-\\d+)?$`).test(ref)
}

function activateReviewCutoverOperation(io) {
  const already = io.readRef(REVIEW_ACTIVE_CUTOVER_REF)
  if (already) return { activated: false, alreadyActive: true, cutoverSha: already, backfilled: [] }
  if (typeof io.openPulls !== 'function' || typeof io.listRefs !== 'function') {
    throw new LaneError('review cutover activation requires openPulls and listRefs; refusing an unproven audit')
  }
  // ENTRY GATE, re-derived (issue #1798 round 6, grok-4.6). This used to reserve
  // a bare 15 -- the in-lock reserve from a slot-2 design that was DELETED when
  // this branch deferred to #1813. It survived the merge as a number attached to
  // nothing, and it sat here rather than at the mutex acquire, so it guaranteed
  // release of nothing. Measured on this head: 3 requests are already spent when
  // control reaches this line, 7 more are spent before the mutex (openPulls, 4
  // assignment ref pages, the active-lease read, the owner commit), and the
  // mutex-held section reserves 11 at its own acquire site below. 7 + 11 is what
  // an operation still has to be able to afford here, so 18 is what it asks for.
  requireReviewWireCapacity(18)
  const openPulls = io.openPulls()
  if (!Array.isArray(openPulls)) throw new LaneError('open PR audit did not return a readable list; cutover activation refused')
  // REF DISCOVERY (issue #1798, round 2). Two production I/O facts drive this
  // shape, both confirmed against githubIo rather than a test double:
  //
  //   1. `readReviewRecords(refs, prefix)` returns commit messages ONLY for the
  //      EXPLICIT `refs` it is given. Its `.matching` rows come from a separate
  //      REST listing and deliberately carry no commit message (see its own
  //      comment). Passing `[]` as `refs` also builds an EMPTY GraphQL
  //      selection set, which is a syntax error GitHub rejects outright. So the
  //      prefix listing cannot be the thing that supplies lease messages.
  //   2. `listRefs` refuses at 100 rows inside a wire budget, and these
  //      namespaces hold the repository's whole review history (370 assignment
  //      refs today), so it can never list them at all.
  //
  // Hence: page the listing explicitly (cheap {ref,sha} rows, counted), narrow
  // to the open-PR tuples LOCALLY for free, then spend ONE GraphQL call to read
  // messages for just that narrowed set. Cost stays flat in the number of live
  // reviews found. 19 is what this walk SPENDS on today's real page counts; the
  // budget is REVIEW_OPERATION_REQUEST_LIMIT, which is 22. Spend and ceiling are
  // different numbers and this comment used to conflate them (issue #1798 round 6).
  const pagedRefs = (prefix) => (typeof io.listReviewRefsPaged === 'function'
    ? io.listReviewRefsPaged(prefix)
    : (io.listRefs(prefix) ?? []))
  const assignmentRows = pagedRefs(REVIEW_ASSIGNMENT_REF_PREFIX)
  // Replacement refs matter for correctness, not just completeness:
  // `--replace-failed-reviewer` does NOT rewrite the assignment ref, so a
  // review that was replaced while live still names its FAILED reviewer there.
  // Backfilling that name would hand the cutover a lease for someone who is not
  // reviewing, and leave the reviewer who actually is invisible to the busy
  // probe -- the same blindness this activation exists to prevent.
  // Deferred: only paged when an open PR actually has a matching assignment,
  // which is the only case where a replacement could supersede its reviewer.
  // On a repository with no pre-cutover live review this listing is never made.
  let replacementRowsCache = null
  const replacementRefs = () => (replacementRowsCache ??= pagedRefs(REVIEW_REPLACEMENT_REF_PREFIX))
  const backfilled = []
  // One call, three jobs (issue #1798 round 2, to buy real headroom under the
  // budget rather than sitting exactly on it): it snapshots every existing
  // active lease, AND its GraphQL query carries defaultBranchRef, which warms
  // `reviewCommitBase` -- so the makeOwnerCommit below costs 1 request instead
  // of 3, and the existing-lease check below costs 0 instead of 1.
  const activeLeases = typeof io.readActiveReviewLeases === 'function' ? io.readActiveReviewLeases() : null
  const ownerSha = io.makeOwnerCommit('db-coordination reviewer-index-cutover-activation-audit')
  // RESERVE THE MUTEX-HELD SECTION, at the acquire site, the way the two sibling
  // acquire sites above do. The replacement ref listing runs INSIDE this lock, so
  // extra replacement pages and per-ref getCommit fallbacks are in-lock spend, and
  // hitting the hard budget wall mid-section is exactly what a reserve prevents.
  // Measured in-lock spend on the real 4+2 page path is 9; 11 leaves two above it,
  // because a reserve must be at least the spend and erring the other way is what
  // strands a held mutex.
  requireReviewWireCapacity(11)
  acquireReviewMutex(ownerSha, io)
  try {
    // Narrow to the open-PR tuples first -- pure local filtering, no requests.
    const narrowed = []
    for (const pr of openPulls) {
      const headSha = pr?.head?.sha
      const number = pr?.number
      if (!Number.isInteger(number) || !/^[0-9a-f]{40}$/i.test(String(headSha ?? ''))) {
        throw new LaneError(`open PR audit could not read an exact number and 40-character head SHA for ${JSON.stringify(pr?.number ?? pr)}; cutover activation refused`)
      }
      const assignments = assignmentRows.filter((row) => matchesAssignmentTuple(row.ref, number, headSha))
      narrowed.push({
        number,
        headSha,
        assignments,
        replacements: assignments.length ? replacementRefs().filter((row) => matchesReplacementTuple(row.ref, number, headSha)) : [],
      })
    }
    // ONE GraphQL call for every narrowed ref's commit message. Explicit refs
    // are the form readReviewRecords actually attaches messages to, and the
    // list is never empty here (the empty-selection-set query is invalid).
    const wantedRefs = [...new Set(narrowed.flatMap((row) => [...row.assignments, ...row.replacements].map((entry) => entry.ref)))]
    const messages = new Map()
    if (wantedRefs.length) {
      if (typeof io.readReviewRecords === 'function') {
        const records = io.readReviewRecords(wantedRefs, null)
        for (const ref of wantedRefs) {
          const record = records.get(ref)
          // `record.commit` is `{message: target.message}` and is TRUTHY even
          // when GraphQL returned no message at all (a non-Commit object, or an
          // empty message). Testing the record alone would let an empty message
          // through as if it had been read; the per-ref fallback below is what
          // must handle it, so the message itself is what is tested (issue
          // #1798 round 3, glm-5.3 High 1).
          if (record?.commit?.message) messages.set(ref, record.commit)
        }
      }
      // Any ref the batched read could not answer for is fetched individually
      // rather than skipped. A missing message must never look like "no live
      // review here" -- that is the fail-open this activation exists to avoid.
      for (const ref of wantedRefs) {
        if (messages.has(ref)) continue
        const row = narrowed.flatMap((entry) => [...entry.assignments, ...entry.replacements]).find((entry) => entry.ref === ref)
        const commit = io.getCommit(row.sha)
        if (!(commit?.message ?? commit?.commit?.message)) throw new LaneError(`review ref ${ref} has no readable commit message; cutover activation refused`)
        messages.set(ref, commit)
      }
    }
    const candidates = []
    for (const { number, headSha, assignments, replacements } of narrowed) {
      for (const row of assignments) {
        let lease
        try { lease = parseReviewCursor(messages.get(row.ref)) }
        catch (error) { throw new LaneError(`assignment ref ${row.ref} is unreadable: ${error.message}; cutover activation refused`) }
        if (!lease) throw new LaneError(`assignment ref ${row.ref} does not hold a readable reviewer cursor; cutover activation refused`)
        if (lease.pr !== number || lease.headSha !== headSha) throw new LaneError(`assignment ref ${row.ref} disagrees with its commit record (PR #${lease.pr}, head ${lease.headSha}); cutover activation refused`)
        // A replacement supersedes the assignment's reviewer for this exact
        // tuple, highest failure sequence winning -- the same precedence
        // resolveSlotOneReviewer and assignNextReviewerOperation already use.
        let reviewer = lease.reviewer
        let leaseSha = row.sha
        // REFUSE, never discard (issue #1798 round 3, glm-5.3 High 1). This half
        // of the loop used to catch a parse failure and drop the row, while the
        // assignment half three lines up refuses on exactly the same failure.
        // The two halves of a symmetric loop had diverged, and the consequence
        // was the original fail-open in a new place: a replacement record that
        // cannot be read makes the FAILED reviewer named on the assignment ref
        // look live, and leaves the reviewer who is actually reviewing invisible
        // to the busy probe -- the double-assignment hazard this whole
        // activation exists to prevent.
        const parsedReplacements = replacements
          .filter((entry) => matchesReplacementForSlot(entry.ref, number, headSha, assignmentSlotSuffix(row.ref, number, headSha)))
          .map((entry) => {
            let parsed
            try { parsed = parseReviewReplacement(messages.get(entry.ref)) }
            catch (error) { throw new LaneError(`replacement ref ${entry.ref} is unreadable: ${error.message}; cutover activation refused`) }
            if (!parsed) throw new LaneError(`replacement ref ${entry.ref} does not hold a readable replacement record; cutover activation refused`)
            return { parsed, sha: entry.sha }
          })
        for (const entry of parsedReplacements) {
          if (entry.parsed.pr !== number || entry.parsed.headSha !== headSha) throw new LaneError(`replacement ref for PR #${number} head ${headSha} disagrees with its commit record (PR #${entry.parsed.pr}, head ${entry.parsed.headSha}); cutover activation refused`)
        }
        if (parsedReplacements.length) {
          const winner = parsedReplacements.sort((a, b) => b.parsed.sequence - a.parsed.sequence)[0]
          reviewer = winner.parsed.reviewer
          leaseSha = winner.sha
        }
        if (!REVIEWERS.some((r) => r.name === reviewer)) throw new LaneError(`review ref ${row.ref} names an unrecognized reviewer ${reviewer}; cutover activation refused`)
        candidates.push({ row: { ref: row.ref, sha: leaseSha }, lease: { ...lease, reviewer }, number, headSha })
      }
    }
    // BATCHED VERDICT + EXISTING-LEASE CHECK (issue #1798 fix). The old code
    // spent one `getCommit`, three verdict-evidence REST/GraphQL calls, and
    // two ref reads PER MATCHING ASSIGNMENT -- so activation was
    // uncompletable within its own 19-request budget the moment there was an
    // actual live review to protect (the exact case this feature exists
    // for), even though it sailed through on the no-op cases the tests
    // exercised. `readReviewStates` and `readReviewRefs` each answer for
    // every candidate in ONE network call, so the audit's request count no
    // longer grows with the number of live reviews found.
    const states = candidates.length && typeof io.readReviewStates === 'function'
      ? io.readReviewStates(candidates.map((c) => c.lease))
      : null
    const leaseRefs = [...new Set(candidates.map((c) => reviewActiveRef(c.lease.reviewer)))]
    // Prefer the snapshot already taken above -- it covers every reviewer's
    // active-lease ref, so it answers this without another request.
    const existingLeases = activeLeases
      ? new Map(leaseRefs.map((ref) => [ref, activeLeases.get(ref)?.sha ?? null]))
      : (leaseRefs.length && typeof io.readReviewRefs === 'function' ? io.readReviewRefs(leaseRefs) : null)
    const toCreate = []
    for (const candidate of candidates) {
      const { row, lease, number, headSha } = candidate
      const state = states?.get(`${lease.issue}:${lease.pr}`)
      // Batched path uses the SAME shared predicate as every other consumer
      // (issue #1822, glm-5.3 seq 524 High). This used to carry its own
      // anywhere-in-body verdict test -- the exact defect #1822 exists to
      // delete -- on the path production actually takes, while
      // hasVerdictForHead below (the fallback) already used the shared rule.
      // A false verdict here `continue`s past lease creation, so the reviewer
      // that is genuinely reviewing never gets its protective lease, the busy
      // probe goes blind, and a second reviewer can be handed the same
      // provider: the double-assignment hazard this activation exists to
      // prevent, failing silently.
      const verdict = state
        ? anyVerdictFor(state.evidence, lease.headSha)
        : hasVerdictForHead(lease.issue, lease.pr, lease.headSha, io)
      if (verdict) continue
      const leaseRef = reviewActiveRef(lease.reviewer)
      const existingLease = existingLeases ? (existingLeases.get(leaseRef) ?? null) : io.readRef(leaseRef)
      if (existingLease === row.sha) continue
      if (existingLease) throw new LaneError(`reviewer ${lease.reviewer} already holds a different active lease; cutover activation refused pending manual audit`)
      toCreate.push({ reviewer: lease.reviewer, issue: lease.issue, pr: number, headSha, ref: leaseRef, sha: row.sha })
    }
    // No read-then-check of the mutex before the ATOMIC path: the push below
    // carries `--force-with-lease=MUTEX_REF:ownerSha`, which GitHub evaluates
    // server-side as part of the same transaction. That is strictly stronger
    // than a separate read (which is TOCTOU by construction) and one request
    // cheaper. The non-atomic fallback below still checks explicitly, because
    // its writes are not transactional.
    if (io.atomicReviewRefs && io.readReviewRefs) {
      const changes = [
        { ref: MUTEX_REF, expected: ownerSha, sha: ownerSha },
        ...toCreate.map((c) => ({ ref: c.ref, expected: null, sha: c.sha })),
        { ref: REVIEW_ACTIVE_CUTOVER_REF, expected: null, sha: ownerSha },
      ]
      try { io.atomicReviewRefs(changes) }
      catch (error) {
        // A raced activation is the ONE expected failure here: another
        // activation won the create between our audit and this push. Read
        // back its winning SHA instead of erroring, same as the
        // non-batched path below.
        const raced = io.readRef(REVIEW_ACTIVE_CUTOVER_REF)
        if (raced && raced !== ownerSha) return { activated: false, alreadyActive: true, cutoverSha: raced, backfilled: [] }
        throw error
      }
      const verify = io.readReviewRefs([MUTEX_REF, REVIEW_ACTIVE_CUTOVER_REF, ...toCreate.map((c) => c.ref)])
      if (verify.get(MUTEX_REF) !== ownerSha || verify.get(REVIEW_ACTIVE_CUTOVER_REF) !== ownerSha || toCreate.some((c) => verify.get(c.ref) !== c.sha)) {
        throw new LaneError('batched review cutover activation readback mismatch')
      }
      backfilled.push(...toCreate.map(({ sha, ...rest }) => rest))
      return { activated: true, alreadyActive: false, cutoverSha: ownerSha, backfilled }
    }
    for (const c of toCreate) {
      requireOwnedRef(MUTEX_REF, ownerSha, io)
      if (!io.createRef(c.ref, c.sha) && readRefAfterWrite(c.ref, c.sha, io) !== c.sha) {
        throw new LaneError(`could not create or prove the active lease for reviewer ${c.reviewer} on PR #${c.pr}; cutover activation refused`)
      }
      backfilled.push({ reviewer: c.reviewer, issue: c.issue, pr: c.pr, headSha: c.headSha, ref: c.ref })
    }
    requireOwnedRef(MUTEX_REF, ownerSha, io)
    if (!io.createRef(REVIEW_ACTIVE_CUTOVER_REF, ownerSha)) {
      const raced = readRefAfterWrite(REVIEW_ACTIVE_CUTOVER_REF, ownerSha, io)
      if (!raced) throw new LaneError('review cutover ref could not be created or proven after the audit; activation refused')
      return { activated: false, alreadyActive: true, cutoverSha: raced, backfilled }
    }
    if (readRefAfterWrite(REVIEW_ACTIVE_CUTOVER_REF, ownerSha, io) !== ownerSha) {
      throw new LaneError('review cutover ref creation could not be proved by readback; activation refused')
    }
    return { activated: true, alreadyActive: false, cutoverSha: ownerSha, backfilled }
  } finally { finalizeReviewMutex(ownerSha, io) }
}

export function activateReviewCutover(io=githubIo){return withReviewRequestBudget(()=>activateReviewCutoverOperation(reviewOperationIo(io)))}

export function acquireAuthorLane(options, now = new Date(), io = githubIo) {
  options = { ...options, objects: validateClaimObjects(options.objects) }
  const requestId = options.requestId ?? randomUUID()
  const ownerSha = io.makeOwnerCommit(`db-coordination author-acquisition ${requestId}`)
  acquireMutex(ownerSha, io, options.mutexAttempts ?? 100)
  try {
    const claims = io.openClaims()
    const prSources = io.prSources()
    assertLaneAvailable(claims, options.objects, now, { prSources })
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const reservation = io.reserveVersion()
    const expiresAt = new Date(now.valueOf() + options.leaseHours * 3600000)
    const body = claimBody({ ...options, version: reservation.version, expiresAt })
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const url = io.createClaim(options.task, body)
    try { requireOwnedRef(MUTEX_REF,ownerSha,io) }
    catch(error) {
      const number=/\/(\d+)\/?$/.exec(String(url))?.[1]
      if(!number)throw new LaneError(`lost mutex ownership after claim creation and could not identify the claim to close: ${error.message}`)
      io.closeClaim(number)
      throw error
    }
    return { version: reservation.version, claim: url, expiresAt: expiresAt.toISOString(), requestId }
  } finally {
    // If recovery already replaced us, never delete the successor's lock and
    // never mask the original lost-ownership refusal.
    if (io.readRef(MUTEX_REF) === ownerSha) releaseOwnedRef(MUTEX_REF, ownerSha, io)
  }
}

const SPLIT_REMAINDER = 'index plm.item_upper_trim_item_number_idx'
function workstreamKey(title) {
  const match = /^CLAIM:\s+(#[0-9]+(?:\/#?[0-9]+)*)\b/.exec(String(title ?? ''))
  if (!match) throw new LaneError('claim title does not identify one exact issue workstream')
  return match[1]
}
function migrationVersions(files) {
  const namedFiles=files.map((file)=>({file,name:file.filename ?? file.path ?? ''}))
  if(namedFiles.some(({file,name})=>file.status==='removed'&&name.startsWith('supabase/migrations/')))throw new LaneError('pull request removes a migration file; split recovery refuses it')
  return namedFiles.map(({name})=>/^supabase\/migrations\/(\d{14})_[^/]+\.sql$/.exec(name)?.[1]).filter(Boolean)
}
function replaceLeaseLocation(body, branch, worktree) {
  const fence=/```db-author-lease\s*\n([\s\S]*?)```/.exec(body)
  if(!fence)throw new LaneError('active claim has no manager-owned author lease block')
  let block=fence[1]
  if((block.match(/^branch:/gm)??[]).length!==1||(block.match(/^worktree:/gm)??[]).length!==1)throw new LaneError('active claim lease location is ambiguous')
  block=block.replace(/^branch:.*$/m,`branch: ${branch}`).replace(/^worktree:.*$/m,`worktree: ${worktree}`)
  return body.slice(0,fence.index)+fence[0].replace(fence[1],()=>block)+body.slice(fence.index+fence[0].length)
}
function replaceClaimObjects(body, version, objects) {
  const fences=[...body.matchAll(/```db-claim\s*\n[\s\S]*?```/g)]
  if(fences.length!==1)throw new LaneError('claim body must contain exactly one manager-owned db-claim block')
  const replacement=['```db-claim',`version: ${version}`,'objects:',...objects.map((object)=>`  - ${normalizeObject(object)}`),'```'].join('\n')
  return body.slice(0,fences[0].index)+replacement+body.slice(fences[0].index+fences[0][0].length)
}

function replaceLeaseExpiry(body, expiresAt) {
  const fences=[...body.matchAll(/```db-author-lease\s*\n([\s\S]*?)```/g)]
  if(fences.length!==1)throw new LaneError('claim body must contain exactly one manager-owned db-author-lease block')
  const block=fences[0][1], matches=block.match(/^expires_at:\s*.+$/gm)??[]
  if(matches.length!==1)throw new LaneError('claim lease expiry is ambiguous')
  const replacement=block.replace(/^expires_at:\s*.+$/m,`expires_at: ${expiresAt.toISOString()}`)
  return body.slice(0,fences[0].index)+fences[0][0].replace(block,()=>replacement)+body.slice(fences[0].index+fences[0][0].length)
}

function replaceCapacityState(body, capacityState, blockedOn = null) {
  if (!AUTHOR_CAPACITY_STATES.includes(capacityState)) throw new LaneError('invalid author capacity state')
  if (capacityState === 'relinquished' && !blockedOn) throw new LaneError('relinquished author capacity requires blocked_on')
  if (capacityState !== 'relinquished' && blockedOn) throw new LaneError('blocked_on is only valid for relinquished capacity')
  const fences=[...body.matchAll(/```db-author-lease\s*\n([\s\S]*?)```/g)]
  if(fences.length!==1)throw new LaneError('claim body must contain exactly one manager-owned db-author-lease block')
  let block=fences[0][1]
  const capacityMatches=block.match(/^capacity_state:\s*.+$/gm)??[]
  if(capacityMatches.length>1)throw new LaneError('claim capacity state is ambiguous')
  block=capacityMatches.length
    ? block.replace(/^capacity_state:\s*.+$/m,`capacity_state: ${capacityState}`)
    : `${block.replace(/\s*$/,'')}\ncapacity_state: ${capacityState}\n`
  const blockedMatches=block.match(/^blocked_on:\s*.+$/gm)??[]
  if(blockedMatches.length>1)throw new LaneError('claim blocked_on is ambiguous')
  if(blockedMatches.length) block=block.replace(/^blocked_on:\s*.+\r?\n?/m,'')
  if(blockedOn) block=`${block.replace(/\s*$/,'')}\nblocked_on: ${blockedOn}\n`
  return body.slice(0,fences[0].index)+fences[0][0].replace(fences[0][1],()=>block)+body.slice(fences[0].index+fences[0][0].length)
}

function claimTitleIssues(claim) {
  return [...String(claim.title??'').matchAll(/#(\d+)\b/g)].map((match)=>Number(match[1]))
}

function claimTitleWorkIssue(claim) {
  const matches=claimTitleIssues(claim)
  return matches.length===1?matches[0]:null
}

function claimWorkIssue(claim) {
  const issue=claimTitleWorkIssue(claim)
  if(issue===null)throw new LaneError('claim title must identify exactly one work issue for capacity transition events')
  return issue
}

function validateCapacityBlocker(blockedOn, io) {
  const issue=/^issue:#?(\d+)$/.exec(String(blockedOn??''))
  if(issue){
    const blocker=io.getIssue(Number(issue[1]))
    if(!blocker||blocker.state!=='open')throw new LaneError(`blocked_on issue #${issue[1]} is not durably open`)
    return `issue:#${issue[1]}`
  }
  const artifact=/^artifact:(https:\/\/\S+|[0-9a-f]{40,64})$/i.exec(String(blockedOn??''))
  if(!artifact)throw new LaneError('--blocked-on must be issue:#<number> or artifact:<immutable-url-or-hash>')
  return `artifact:${artifact[1]}`
}

function publishCapacityEvents({ workIssue, claim, eventTypes, actor, detail }, now, io) {
  if(!io.commentIssue)return
  for(const eventType of eventTypes){
    const event=coordinationEvent({eventType,workIssue,claimIssue:Number(claim),actor,timestamp:now.toISOString(),detail})
    io.commentIssue(workIssue,formatEventComment(event))
  }
}

export function relinquishAuthorLease(options, now = new Date(), io = githubIo) {
  for(const key of ['claim','owner','blockedOn'])if(!options[key])throw new LaneError(`author-capacity relinquishment requires ${key}`)
  const ownerSha=io.makeOwnerCommit(`db-coordination author-capacity-relinquish claim=${options.claim}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,changed=false
  try{
    const matches=io.openClaims().filter((claim)=>String(claim.number)===String(options.claim))
    if(matches.length!==1)throw new LaneError(`claim #${options.claim} must be uniquely open`)
    before=io.getIssue(options.claim)
    if(before?.state!=='open'||before.body!==matches[0].body)throw new LaneError('claim changed concurrently before capacity relinquishment')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy)throw new LaneError('legacy claim capacity cannot be relinquished')
    if(lease.owner!==options.owner)throw new LaneError('claim belongs to a different owner')
    const blocker=validateCapacityBlocker(options.blockedOn,io)
    if(lease.capacityState==='relinquished'){
      if(lease.blockedOn===blocker)return {claim:Number(options.claim),capacityState:'relinquished',blockedOn:blocker,idempotent:true}
      throw new LaneError('claim is already relinquished for a different blocker')
    }
    if(!io.localClean?.(lease.worktree))throw new LaneError('claim worktree is not clean')
    for(const [kind,ref] of Object.entries(EXCLUSIVE_REFS)){
      const held=io.readRef(ref)
      if(!held)continue
      const message=io.getCommitMessage?.(held)??''
      if(new RegExp(`(?:issue|claim)=${options.claim}(?:\\D|$)`).test(message))throw new LaneError(`claim still holds the ${kind} stage`)
    }
    const expected=replaceCapacityState(before.body,'relinquished',blocker)
    requireOwnedRef(MUTEX_REF,ownerSha,io);changed=true;io.updateIssue(options.claim,{body:expected})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.body!==expected||afterLease.capacityState!=='relinquished'||afterLease.blockedOn!==blocker)throw new LaneError('relinquished capacity readback failed')
    const workIssue=claimWorkIssue(before)
    publishCapacityEvents({workIssue,claim:options.claim,eventTypes:['author_capacity_relinquished','issue_blocked'],actor:options.owner,detail:blocker},now,io)
    return {claim:Number(options.claim),workIssue,capacityState:'relinquished',blockedOn:blocker,idempotent:false}
  }catch(error){
    if(changed&&io.readRef(MUTEX_REF)===ownerSha)try{io.updateIssue(options.claim,{body:before.body})}catch(rollback){throw new LaneError(`${error.message}; rollback failed: ${rollback.message}`)}
    throw error
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

export function resumeAuthorLease(options, now = new Date(), io = githubIo) {
  for(const key of ['claim','owner','leaseHours'])if(options[key]===undefined||options[key]===null||options[key]==='')throw new LaneError(`author-capacity resume requires ${key}`)
  if(!Number.isFinite(options.leaseHours)||options.leaseHours<=0||options.leaseHours>24)throw new LaneError('resume lease hours must be greater than 0 and no more than 24')
  const ownerSha=io.makeOwnerCommit(`db-coordination author-capacity-resume claim=${options.claim}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,changed=false
  try{
    const claims=io.openClaims(),matches=claims.filter((claim)=>String(claim.number)===String(options.claim))
    if(matches.length!==1)throw new LaneError(`claim #${options.claim} must be uniquely open`)
    before=io.getIssue(options.claim);if(before?.state!=='open'||before.body!==matches[0].body)throw new LaneError('claim changed concurrently before capacity resume')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy||lease.owner!==options.owner)throw new LaneError('claim lease is legacy or belongs to a different owner')
    if(lease.capacityState!=='relinquished')throw new LaneError('claim capacity is not relinquished')
    assertLaneAvailable(claims.filter((claim)=>String(claim.number)!==String(options.claim)),lease.objects,now,{prSources:io.prSources?.()??[]})
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    const expiresAt=new Date(now.valueOf()+options.leaseHours*3600000)
    const expected=replaceLeaseExpiry(replaceCapacityState(before.body,'active'),expiresAt)
    requireOwnedRef(MUTEX_REF,ownerSha,io);changed=true;io.updateIssue(options.claim,{body:expected})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.body!==expected||!afterLease.active||!afterLease.capacityActive||afterLease.capacityState!=='active')throw new LaneError('resumed capacity readback failed')
    const workIssue=claimWorkIssue(before)
    publishCapacityEvents({workIssue,claim:options.claim,eventTypes:['issue_unblocked','author_capacity_resumed'],actor:options.owner,detail:'guarded capacity resume'},now,io)
    return {claim:Number(options.claim),workIssue,capacityState:'active',expiresAt:afterLease.expiresAt.toISOString(),idempotent:false}
  }catch(error){
    if(changed&&io.readRef(MUTEX_REF)===ownerSha)try{io.updateIssue(options.claim,{body:before.body})}catch(rollback){throw new LaneError(`${error.message}; rollback failed: ${rollback.message}`)}
    throw error
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

function renewalIssueScope(issue, lease) {
  const scope=issue?.state==='open'?parseQueueScope(issue.body):null
  if(!scope||scope.status!=='ready'||scope.workType!=='structural'||scope.route!=='shared-db-orchestrator')throw new LaneError('renewal issue must be one open ready structural shared-db work item')
  const issueObjects=scope.objects.map(normalizeObject),claimObjects=lease.objects.map(normalizeObject)
  if(issueObjects.length!==claimObjects.length||issueObjects.some((object)=>!claimObjects.includes(object)))throw new LaneError('renewal issue objects do not exactly match the permanent claim objects')
  return claimObjects
}

export function renewExpiredClaim(options, now = new Date(), io = githubIo) {
  for(const key of ['claim','issue','owner','branch','worktree','pr','headSha','leaseHours'])if(options[key]===undefined||options[key]===null||options[key]==='')throw new LaneError(`claim renewal requires ${key}`)
  if(!Number.isFinite(options.leaseHours)||options.leaseHours<=0||options.leaseHours>24)throw new LaneError('renewal lease hours must be greater than 0 and no more than 24')
  const desiredExpiry=new Date(now.valueOf()+options.leaseHours*3600000)
  const requestId=options.requestId??randomUUID(),ownerSha=io.makeOwnerCommit(`db-coordination claim-lease-renewal ${requestId}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,possiblyChanged=false
  try {
    const claims=io.openClaims(),matches=claims.filter((claim)=>String(claim.number)===String(options.claim))
    if(matches.length!==1)throw new LaneError(`claim #${options.claim} must be uniquely open`)
    before=io.getIssue(options.claim)
    if(before?.state!=='open'||before.body!==matches[0].body)throw new LaneError('claim changed concurrently before renewal')
    const claimIssues=[...String(before.title??'').matchAll(/#(\d+)\b/g)].map((match)=>Number(match[1]))
    if(!claimIssues.includes(Number(options.issue)))throw new LaneError('renewal issue number is not identified by the claim title')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy)throw new LaneError('legacy claim leases cannot be renewed')
    if(lease.owner!==options.owner||lease.branch!==options.branch||lease.worktree!==options.worktree)throw new LaneError('claim owner, branch, or worktree mismatch')
    const expectedBody=replaceLeaseExpiry(before.body,desiredExpiry)
    if(lease.active){
      if(before.body===expectedBody)return {claim:Number(options.claim),version:lease.version,expiresAt:lease.expiresAt.toISOString(),idempotent:true}
      throw new LaneError('claim has an active lease; refusing unrelated renewal')
    }
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    const workIssue=io.getIssue(options.issue),claimObjects=renewalIssueScope(workIssue,lease)
    const pr=io.getPr(options.pr)
    if(pr?.state!=='open'||pr.head?.ref!==options.branch||pr.head?.sha!==options.headSha)throw new LaneError('open pull request branch or exact head mismatch')
    const fileVersions=migrationVersions(io.getPrFiles(options.pr))
    if(fileVersions.length!==1||fileVersions[0]!==lease.version)throw new LaneError('pull request migration version does not match the permanent claim version')
    const sources=io.prSources(), target=sources.filter((source)=>new RegExp(`^PR #${options.pr}(?:\\s|$)`).test(source.label))
    if(target.length!==1)throw new LaneError('pull request parser source is missing or ambiguous')
    if(target[0].versions?.length!==1||String(target[0].versions[0])!==lease.version)throw new LaneError('parsed pull request version does not match the permanent claim version')
    const claimed=new Set(claimObjects),parsed=(target[0].objects??[]).length?validateClaimObjects(target[0].objects):[]
    const uncovered=parsed.filter((object)=>!claimed.has(object))
    if(uncovered.length)throw new LaneError(`claim does not cover parsed pull request objects: ${uncovered.join(', ')}`)
    const others=claims.filter((claim)=>String(claim.number)!==String(options.claim)),otherPrs=sources.filter((source)=>source!==target[0])
    assertLaneAvailable(others,lease.objects,now,{ignoreCapacity:true,prSources:otherPrs})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const freshWorkIssue=io.getIssue(options.issue)
    if(freshWorkIssue?.state!==workIssue.state||freshWorkIssue?.body!==workIssue.body)throw new LaneError('renewal issue changed concurrently')
    renewalIssueScope(freshWorkIssue,lease)
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    possiblyChanged=true;io.updateIssue(options.claim,{body:expectedBody})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.state!=='open'||after.body!==expectedBody||afterLease.version!==lease.version||afterLease.owner!==lease.owner||afterLease.branch!==lease.branch||afterLease.worktree!==lease.worktree||JSON.stringify(afterLease.objects)!==JSON.stringify(lease.objects))throw new LaneError('renewed claim exact readback failed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent reservation disappeared during renewal')
    return {claim:Number(options.claim),version:lease.version,expiresAt:afterLease.expiresAt.toISOString(),idempotent:false}
  } catch(error) {
    if(possiblyChanged){
      if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
      try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.claim,{body:before.body});requireOwnedRef(MUTEX_REF,ownerSha,io);if(io.getIssue(options.claim)?.body!==before.body)throw new LaneError('rollback readback mismatch')}
      catch(rollbackError){throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${rollbackError.message}`)}
    }
    throw error
  } finally {if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

export function expandActiveClaimFromPr(options, now = new Date(), io = githubIo) {
  for(const key of ['issue','claim','pr','owner','headSha','branch','worktree'])if(!options[key])throw new LaneError(`claim expansion requires ${key}`)
  if(!/^\d+$/.test(String(options.issue))||!/^\d+$/.test(String(options.claim))||!/^\d+$/.test(String(options.pr))||!/^[0-9a-f]{7,40}$/i.test(String(options.headSha)))throw new LaneError('claim expansion requires numeric issue, claim, PR, and an exact head SHA')
  const requestId=options.requestId??randomUUID(),ownerSha=io.makeOwnerCommit(`db-coordination claim-object-expansion ${requestId}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,possiblyChanged=false
  try {
    before=io.getIssue(options.claim)
    if(before?.state!=='open')throw new LaneError('target claim is not open')
    if(workstreamKey(before.title)!==`#${Number(options.issue)}`)throw new LaneError('target claim does not belong to the exact issue')
    const workIssue=io.getIssue(options.issue),scope=parseQueueScope(workIssue?.body??'')
    if(workIssue?.state!=='open'||scope?.status!=='ready'||scope.workType!=='structural'||scope.route!=='shared-db-orchestrator')throw new LaneError('exact work issue is not open ready structural orchestrator work')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy||!lease.active)throw new LaneError('target claim lease is legacy or expired')
    if(lease.owner!==options.owner||lease.branch!==options.branch||lease.worktree!==options.worktree)throw new LaneError('target claim owner, branch, or worktree changed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    const pr=io.getPr(options.pr)
    if(pr?.state!=='open'||pr.head?.sha!==options.headSha||pr.head?.ref!==options.branch)throw new LaneError('open pull request head or branch changed')
    const fileVersions=migrationVersions(io.getPrFiles(options.pr))
    if(fileVersions.length!==1||fileVersions[0]!==lease.version)throw new LaneError('pull request files do not contain exactly the immutable migration version')
    const sources=io.prSources(),targetSources=sources.filter((source)=>new RegExp(`^PR #${options.pr}(?:\\s|$)`).test(source.label))
    if(targetSources.length!==1)throw new LaneError('pull request parser source is missing or ambiguous')
    const target=targetSources[0]
    if(target.versions?.length!==1||String(target.versions[0])!==lease.version)throw new LaneError('pull request migration version does not match the immutable claim version')
    const claimed=new Set(lease.objects.map(normalizeObject)),parsed=validateClaimObjects(target.objects??[])
    const uncovered=parsed.filter((object)=>!claimed.has(object))
    if(!uncovered.length)throw new LaneError('pull request has no uncovered objects to add')
    const claims=io.openClaims()
    if(claims.filter((claim)=>String(claim.number)===String(options.claim)).length!==1)throw new LaneError('active claim set is ambiguous')
    const others=claims.filter((claim)=>String(claim.number)!==String(options.claim)),otherPrs=sources.filter((source)=>source!==target)
    assertLaneAvailable(others,uncovered,now,{ignoreCapacity:true,prSources:otherPrs})
    const expanded=[...lease.objects.map(normalizeObject),...uncovered]
    const updatedBody=replaceClaimObjects(before.body,lease.version,expanded)
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    possiblyChanged=true;io.updateIssue(options.claim,{body:updatedBody})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.state!=='open'||after.body!==updatedBody||afterLease.owner!==lease.owner||afterLease.branch!==lease.branch||afterLease.worktree!==lease.worktree||afterLease.version!==lease.version||JSON.stringify([...afterLease.objects].sort())!==JSON.stringify([...expanded].sort()))throw new LaneError('expanded claim exact readback failed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent reservation disappeared during claim expansion')
    return {claim:Number(options.claim),version:lease.version,added:uncovered,objects:afterLease.objects}
  } catch(error) {
    if(possiblyChanged){
      if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
      try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.claim,{body:before.body});requireOwnedRef(MUTEX_REF,ownerSha,io);if(io.getIssue(options.claim)?.body!==before.body)throw new LaneError('rollback readback mismatch')}
      catch(rollbackError){throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${rollbackError.message}`)}
    }
    throw error
  } finally {if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

export function expandActiveClaimFromIssue(options,now=new Date(),io=githubIo){
  for(const key of ['issue','claim','owner','branch','worktree'])if(!options[key])throw new LaneError(`issue-scope claim expansion requires ${key}`)
  if(!/^\d+$/.test(String(options.issue))||!/^\d+$/.test(String(options.claim)))throw new LaneError('issue-scope claim expansion requires numeric issue and claim')
  const requestId=options.requestId??randomUUID(),ownerSha=io.makeOwnerCommit(`db-coordination claim-object-expansion ${requestId}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,possiblyChanged=false
  try{
    before=io.getIssue(options.claim)
    if(before?.state!=='open'||workstreamKey(before.title)!==`#${Number(options.issue)}`)throw new LaneError('target claim is not open or does not belong to the exact issue')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy||!lease.active)throw new LaneError('target claim lease is legacy or expired')
    if(lease.owner!==options.owner||lease.branch!==options.branch||lease.worktree!==options.worktree)throw new LaneError('target claim owner, branch, or worktree changed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    const workIssue=io.getIssue(options.issue),scope=parseQueueScope(workIssue?.body??'')
    if(workIssue?.state!=='open'||scope?.status!=='ready'||scope.workType!=='structural'||scope.route!=='shared-db-orchestrator')throw new LaneError('exact work issue is not open ready structural orchestrator work')
    const claimed=new Set(lease.objects.map(normalizeObject)),uncovered=scope.objects.filter((object)=>!claimed.has(object))
    if(!uncovered.length)throw new LaneError('exact work issue has no uncovered objects to add')
    const claims=io.openClaims()
    if(claims.filter((claim)=>String(claim.number)===String(options.claim)).length!==1)throw new LaneError('active claim set is ambiguous')
    const others=claims.filter((claim)=>String(claim.number)!==String(options.claim)),sources=io.prSources()
    assertLaneAvailable(others,uncovered,now,{ignoreCapacity:true,prSources:sources})
    const expanded=[...lease.objects.map(normalizeObject),...uncovered],updatedBody=replaceClaimObjects(before.body,lease.version,expanded)
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    possiblyChanged=true;io.updateIssue(options.claim,{body:updatedBody})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.state!=='open'||after.body!==updatedBody||afterLease.owner!==lease.owner||afterLease.branch!==lease.branch||afterLease.worktree!==lease.worktree||afterLease.version!==lease.version||JSON.stringify([...afterLease.objects].sort())!==JSON.stringify([...expanded].sort()))throw new LaneError('expanded claim exact readback failed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent reservation disappeared during claim expansion')
    return {claim:Number(options.claim),version:lease.version,added:uncovered,objects:afterLease.objects}
  }catch(error){
    if(possiblyChanged){
      if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
      try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.claim,{body:before.body});requireOwnedRef(MUTEX_REF,ownerSha,io);if(io.getIssue(options.claim)?.body!==before.body)throw new LaneError('rollback readback mismatch')}
      catch(rollbackError){throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${rollbackError.message}`)}
    }
    throw error
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

export function recoverSameOwnerSplit(options, now = new Date(), io = githubIo) {
  for(const key of ['releasedClaim','activeClaim','sourcePr','targetPr','targetBranch','targetWorktree'])if(!options[key])throw new LaneError(`split recovery requires ${key}`)
  const requestId=options.requestId??randomUUID(), ownerSha=io.makeOwnerCommit(`db-coordination claim-split-recovery ${requestId}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let releasedBefore,activeBefore,releasedChanged=false,activeChanged=false
  try {
    if(String(options.releasedClaim)!=='1058'||String(options.activeClaim)!=='1063'||String(options.sourcePr)!=='1060')throw new LaneError('split recovery is pinned to claims #1058/#1063 and source PR #1060')
    if(!/^\d+$/.test(String(options.targetPr)))throw new LaneError('target pull request must be numeric')
    if(String(options.sourcePr)===String(options.targetPr))throw new LaneError('source and target pull requests must differ')
    releasedBefore=io.getIssue(options.releasedClaim);activeBefore=io.getIssue(options.activeClaim)
    if(releasedBefore?.state!=='closed'||activeBefore?.state!=='open')throw new LaneError('split recovery requires one closed original claim and one open active claim')
    if(workstreamKey(releasedBefore.title)!=='#853/#868'||workstreamKey(activeBefore.title)!=='#853/#868')throw new LaneError('claims do not belong to the pinned #853/#868 workstream')
    const closeComments=io.getIssueComments(options.releasedClaim)
    if(closeComments.at(-1)?.body!=='Expired migration-author lease closed by guarded cleanup. Its migration version remains unavailable.')throw new LaneError('closed claim does not have the exact guarded-release reason')
    const released=parseAuthorLease(releasedBefore.body,now),active=parseAuthorLease(activeBefore.body,now)
    if(released.legacy||active.legacy||released.owner!==active.owner)throw new LaneError('claims do not have the same exact manager owner')
    if(!released.active||!active.active)throw new LaneError('split recovery requires both exact leases to remain unexpired')
    if(released.version===active.version)throw new LaneError('split claims must retain two different permanent versions')
    const original=new Set(released.objects.map(normalizeObject)),combined=new Set(active.objects.map(normalizeObject))
    if(original.size>=combined.size||[...original].some((object)=>!combined.has(object)))throw new LaneError('original claim objects are not an exact strict subset')
    const remainder=[...combined].filter((object)=>!original.has(object))
    if(remainder.length!==1||remainder[0]!==SPLIT_REMAINDER)throw new LaneError(`split remainder must be exactly ${SPLIT_REMAINDER}`)
    for(const lease of [released,active])if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError(`permanent reservation for ${lease.version} is unreadable`)
    const source=io.getPr(options.sourcePr),target=io.getPr(options.targetPr)
    if(source?.state!=='open'||source.head?.ref!==released.branch)throw new LaneError('source pull request does not match the original claim branch')
    if(target?.state!=='open'||target.head?.ref!==options.targetBranch)throw new LaneError('target pull request does not match the requested split branch')
    if(options.targetBranch===released.branch)throw new LaneError('split recovery requires two different pull-request branches')
    const sourceVersions=migrationVersions(io.getPrFiles(options.sourcePr)),targetVersions=migrationVersions(io.getPrFiles(options.targetPr))
    if(sourceVersions.length!==1||sourceVersions[0]!==released.version)throw new LaneError('source pull request must contain only the original migration version')
    if(targetVersions.length!==1||targetVersions[0]!==active.version)throw new LaneError('target pull request must contain only the remainder migration version')
    const thirdParty=io.openClaims().filter((claim)=>![String(options.activeClaim),String(options.releasedClaim)].includes(String(claim.number)))
    const incidentPr=new RegExp(`^PR #(?:${options.sourcePr}|${options.targetPr})(?:\\s|$)`)
    const thirdPartyPrs=io.prSources().filter((pr)=>!incidentPr.test(pr.label))
    const reservedVersions=new Set([released.version,active.version])
    const versionCollision=thirdPartyPrs.find((pr)=>(pr.versions??[]).some((version)=>reservedVersions.has(String(version))))
    if(versionCollision)throw new LaneError(`migration version collision with ${versionCollision.label}`)
    assertLaneAvailable(thirdParty,[...combined],now,{prSources:thirdPartyPrs})
    const activeThirdParty=thirdParty.filter((claim)=>parseAuthorLease(claim.body,now).capacityActive)
    if(activeThirdParty.length+2>MAX_AUTHOR_LANES)throw new LaneError('split recovery would exceed active-author capacity')
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const activeBody=replaceLeaseLocation(activeBefore.body,options.targetBranch,options.targetWorktree)
    activeChanged=true;io.updateIssue(options.activeClaim,{body:activeBody})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    releasedChanged=true;io.updateIssue(options.releasedClaim,{state:'open'})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const activeAfter=io.getIssue(options.activeClaim),releasedAfter=io.getIssue(options.releasedClaim)
    if(activeAfter?.body!==activeBody||activeAfter?.state!=='open'||releasedAfter?.body!==releasedBefore.body||releasedAfter?.state!=='open')throw new LaneError('split recovery readback did not match both exact claims')
    for(const lease of [released,active])if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent reservation disappeared during split recovery')
    return {restored:Number(options.releasedClaim),rebound:Number(options.activeClaim),owner:active.owner,versions:[released.version,active.version]}
  } catch(error) {
    const rollback=[]
    if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost; manual manager recovery required`)
    if(releasedChanged){try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.releasedClaim,{state:'closed'});rollback.push('released claim')}catch(e){rollback.push(`FAILED released claim: ${e.message}`)}}
    if(activeChanged){try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.activeClaim,{body:activeBefore.body});rollback.push('active claim')}catch(e){rollback.push(`FAILED active claim: ${e.message}`)}}
    if(rollback.some((x)=>x.startsWith('FAILED')))throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${rollback.join(', ')}`)
    throw error
  } finally { if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io) }
}

// Every migration version a pull request ADDED. `added` only, deliberately: a
// rehearsal is allowed to apply versions this PR authored, never one it merely
// touched, renamed or inherited from another claim.
export function addedMigrationVersions(files) {
  if (!Array.isArray(files)) throw new LaneError('pull request files are unreadable; a post-merge preview rehearsal never assumes them')
  return files
    .filter((file) => file?.status === 'added')
    .map((file) => /^supabase\/migrations\/(\d{14})_[^/]+\.sql$/.exec(file.filename ?? file.path ?? '')?.[1])
    .filter(Boolean)
}

// A post-merge rehearsal batch that AGENTS.md 6.5 requires to move as one event
// can span several authoring pull requests. This parses `version:pr,version:pr`
// -- the same shape `historical_preview_source_pr_map` already uses -- and is
// deliberately EXACT in both directions. A version with no entry would otherwise
// be applied having proved nothing about it, and an entry for a version outside
// the allowlist would drag an unrelated pull request into the evidence. Neither
// is silently tolerated; both name the offending version in the refusal.
export function parseVersionPrMap(raw, versions) {
  const entries = (typeof raw === 'string' ? raw : '').split(',').map((e) => e.trim()).filter(Boolean)
  if (!entries.length) throw new LaneError('post-merge preview rehearsal version-to-PR map is empty')
  const map = new Map()
  for (const entry of entries) {
    if (!/^\d{14}:\d+$/.test(entry)) throw new LaneError(`post-merge preview rehearsal version-to-PR map entries must be version:pull-request, not ${entry}`)
    const [version, pr] = entry.split(':')
    if (map.has(version)) throw new LaneError(`post-merge preview rehearsal version-to-PR map names ${version} more than once`)
    if (Number(pr) <= 0) throw new LaneError(`post-merge preview rehearsal version-to-PR map has a non-positive pull request for ${version}`)
    map.set(version, Number(pr))
  }
  const missing = versions.filter((v) => !map.has(v))
  if (missing.length) throw new LaneError(`post-merge preview rehearsal version-to-PR map does not name every allowlisted version: ${missing.join(', ')}`)
  const stray = [...map.keys()].filter((v) => !versions.includes(v))
  if (stray.length) throw new LaneError(`post-merge preview rehearsal version-to-PR map names version(s) that are not in the allowlist: ${stray.join(', ')}`)
  return map
}

// THE AUTHORISATION for a post-merge rehearsal, in place of a live branch claim.
// Stated as what it enforces rather than as a strength ranking: a branch claim
// proves someone intends to merge; this proves the work IS merged and IS carried
// by the main tip being rehearsed. It does not prove anything a branch claim
// proves about WHO is rehearsing -- the preview lock, not this function, is what
// keeps two rehearsals apart.
export function assertMergeCommitInMainHistory(mergeSha, mainSha, io = githubIo) {
  let comparison
  try {
    // base = the merge commit, head = the main tip. NEVER the other way round.
    comparison = io.compareCommits?.(mergeSha, mainSha)
  } catch (error) {
    throw new LaneError(`merge-commit ancestry is unreadable (${error.message}); a post-merge preview rehearsal never assumes it`)
  }
  if (!comparison || typeof comparison.status !== 'string' || !Number.isInteger(comparison.behind_by)) {
    throw new LaneError('merge-commit ancestry is unreadable; a post-merge preview rehearsal never assumes it')
  }
  // `identical` is the ordinary case: the merge just happened and its commit IS
  // the tip. `ahead` means later commits landed on top. `behind_by` must be zero
  // in both, which is what refuses a diverged or rewritten history.
  if (comparison.behind_by !== 0 || !['identical', 'ahead'].includes(comparison.status)) {
    throw new LaneError(`merge commit ${mergeSha} is not contained in the history of main tip ${mainSha} (compare status ${comparison.status}, behind_by ${comparison.behind_by})`)
  }
  return comparison
}

// COMPLETING WORK (Step 3, issue #1366). The ONLY way a db-work-completion record
// is published. There is deliberately no second publishing path: two commands that
// both post completion records is how a divergent history gets created.
//
// The record is re-derived, not trusted. A caller can write anything into the
// report file; this command proves the claims against GitHub before publishing,
// and reads the comment back before letting anyone close the issue.
export function completeWork({ issue, report }, io = githubIo) {
  const record = validateCompletionRecord(report)
  if (record.work_issue !== Number(issue)) {
    throw new DependencyError(`report is for issue #${record.work_issue} but --issue said #${issue}`)
  }

  const existing = findCompletionRecord(io.issueComments(issue))
  if (existing) {
    // IMMUTABLE. Never edit or replace; a second record would make the history
    // ambiguous exactly where it must not be.
    throw new DependencyError(`issue #${issue} already has a ${existing.outcome} completion record; completion is immutable`)
  }

  // RE-DERIVE THE EVIDENCE. A merged record claims a pull request and a merge
  // commit; both are checkable, so neither is taken on trust.
  if (record.outcome === 'merged') {
    const pr = io.getPr(record.pr)
    if (!pr?.merged_at) throw new DependencyError(`pull request #${record.pr} is not merged`)
    // GitHub's own merge_commit_sha, which is the squash commit when the repo
    // squashes. The source branch head is NOT what lands on main.
    const actual = pr.merge_commit_sha
    if (!actual || !actual.startsWith(record.merge_sha) && !record.merge_sha.startsWith(actual)) {
      throw new DependencyError(`report merge_sha ${record.merge_sha} does not match GitHub's merge_commit_sha ${actual ?? 'none'} for PR #${record.pr}`)
    }
    assertMergeCommitInMainHistory(actual, io.readRef('refs/heads/main'), io)
    const files = io.getPrFiles(record.pr) ?? []
    const actualVersions = [...new Set(files
      .map((file)=>/supabase\/migrations\/(\d{14})_/.exec(file.filename ?? ''))
      .filter(Boolean).map((match)=>match[1]))].sort()
    const declared = [...record.migration_versions].sort()
    if (actualVersions.join(',') !== declared.join(',')) {
      throw new DependencyError(`report migration_versions [${declared.join(', ')}] do not match the versions PR #${record.pr} actually added [${actualVersions.join(', ')}]`)
    }
  }

  const body = [
    'Completion record for this work. Published by `--complete-work`; immutable.',
    '',
    '```' + COMPLETION_FENCE,
    JSON.stringify(record, null, 2),
    '```',
    '',
    'A dependent task is released only by a `merged` or `owner-ruling-recorded` outcome.',
  ].join('\n')
  io.commentIssue(issue, body)

  // READ BACK. An unverified write is not evidence, and the caller is about to
  // close the issue on the strength of this.
  const readBack = findCompletionRecord(io.issueComments(issue))
  if (!readBack) throw new DependencyError(`completion comment was posted to #${issue} but could not be read back; do NOT close the issue`)
  if (readBack.outcome !== record.outcome) throw new DependencyError(`completion read back as ${readBack.outcome}, expected ${record.outcome}`)
  return readBack
}

// --- FENCED STAGE OPERATIONS (Step 6, issue #1366) -------------------------
//
// EVERY ONE OF THESE TAKES THE GLOBAL MUTEX FIRST. `updateRef` PATCHes with
// force=true and no expected-sha, so there is NO Git-level compare-and-swap here:
// the mutex is the only thing making read-then-write atomic. An unserialised
// release could delete a ref a recovery had already replaced.

/** Read the lease currently on a stage's ref, or null when the lane is free. */
export function readExclusiveLease(kind, io = githubIo) {
  const ref = EXCLUSIVE_REFS[kind]
  if (!ref) throw new LaneError(`unknown exclusive lane: ${kind}`)
  const sha = io.readRef(ref)
  if (!sha) return null
  const message = io.readCommitMessage?.(sha)
  if (!message) throw new LaneError(`the lease on ${ref} is unreadable; refusing to guess who holds it`)
  return { ...parseLeaseMessage(message), ref, sha }
}

/**
 * Fence a side effect. Run IMMEDIATELY before every preview, merge or production
 * write: a check performed at acquisition time proves nothing about the moment
 * the write happens.
 */
export function assertExclusive(kind, expected, io = githubIo) {
  const lease = readExclusiveLease(kind, io)
  assertLease(lease, expected)
  return lease
}

/**
 * Release by HOLDER and GENERATION, not by the sha captured at acquisition.
 *
 * The old contract compared the ref's current sha against the acquisition sha,
 * which every calling workflow stashed at lock time. That is exactly why a
 * heartbeat could not be added without stranding lanes, and it is also why a
 * recovered lane could be released by the holder it replaced. Identity is the
 * right key; the sha is an implementation detail that legitimately moves.
 */
export function releaseExclusive(kind, expected, io = githubIo) {
  const ref = EXCLUSIVE_REFS[kind]
  if (!ref) throw new LaneError(`unknown exclusive lane: ${kind}`)
  const ownerSha = io.makeOwnerCommit(`db-coordination ${kind} release-${randomUUID()}`)
  acquireMutex(ownerSha, io)
  try {
    const lease = readExclusiveLease(kind, io)
    if (!lease) return { kind, ref, released: false, reason: 'the lane was already free' }
    // A legacy lease has no identity to check, so it keeps the old sha contract
    // rather than being releasable by anyone who asks.
    if (lease.legacy) {
      if (!expected.ownerSha) throw new LaneError('this lane holds a pre-Step-6 lease; release it with its acquisition sha')
      requireOwnedRef(MUTEX_REF, ownerSha, io)
      releaseOwnedRef(ref, expected.ownerSha, io)
      return { kind, ref, released: true, legacy: true }
    }
    assertLease(lease, expected)
    requireOwnedRef(MUTEX_REF, ownerSha, io)
    releaseOwnedRef(ref, lease.sha, io)
    return { kind, ref, released: true, holderId: lease.holderId, generation: lease.generation }
  } finally { if (io.readRef(MUTEX_REF) === ownerSha) releaseOwnedRef(MUTEX_REF, ownerSha, io) }
}

/**
 * Take over a crashed job's lane.
 *
 * Refuses unless the recorded run is conclusively finished on a LIVE query, no
 * later attempt or run is active, the grace has elapsed, and the ref still holds
 * the exact lease that was evaluated. Dry run by default: a recovery that turns
 * out to be wrong is the one failure this whole step is trying to avoid.
 */
export function recoverExclusive(kind, { holderId, apply = false, now = new Date(), requestId } = {}, io = githubIo) {
  const ref = EXCLUSIVE_REFS[kind]
  if (!ref) throw new LaneError(`unknown exclusive lane: ${kind}`)
  if (!holderId) throw new LaneError('a recovery must name the holder taking over')

  const observed = readExclusiveLease(kind, io)
  const runState = observed?.githubRunId ? io.runState?.(observed.githubRunId) : null
  const verdict = evaluateRecovery(observed, runState, now)
  if (!verdict.recoverable) return { kind, ref, recovered: false, reason: verdict.reason }
  if (!apply) return { kind, ref, recovered: false, dryRun: true, wouldRecover: true, reason: verdict.reason }

  const ownerCommit = io.makeOwnerCommit(`db-coordination ${kind} recovery-${requestId ?? randomUUID()}`)
  acquireMutex(ownerCommit, io)
  try {
    // RE-READ UNDER THE MUTEX. Everything above was decided outside it, so the
    // lease could have been released or already recovered in between. Acting on
    // the stale observation is the split-ownership bug itself.
    const current = readExclusiveLease(kind, io)
    if (!current) return { kind, ref, recovered: false, reason: 'the lane was released while recovery was being evaluated; nothing to recover' }
    if (current.sha !== observed.sha || current.generation !== observed.generation) {
      return { kind, ref, recovered: false, reason: `the lease changed while recovery was being evaluated (generation ${observed.generation} -> ${current.generation}); refusing rather than racing` }
    }
    const next = recoveredLeaseMetadata(current, {
      holderId,
      githubRunId: process.env.GITHUB_RUN_ID ?? null,
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      acquiredAt: now.toISOString(),
      previousOwnerSha: current.sha,
      requestId: requestId ?? randomUUID(),
    })
    const replacement = io.makeOwnerCommit(formatLeaseMessage(kind, next))
    requireOwnedRef(MUTEX_REF, ownerCommit, io)
    io.updateRef(ref, replacement)
    const readBack = readExclusiveLease(kind, io)
    if (readBack?.sha !== replacement || readBack.generation !== next.generation) {
      throw new LaneError(`recovery of ${ref} did not read back; do NOT treat this lane as owned`)
    }
    return { kind, ref, recovered: true, holderId, generation: next.generation, previousOwnerSha: current.sha, reason: verdict.reason }
  } finally { if (io.readRef(MUTEX_REF) === ownerCommit) releaseOwnedRef(MUTEX_REF, ownerCommit, io) }
}

export function acquireExclusive(kind, metadata, io = githubIo) {
  const ref = EXCLUSIVE_REFS[kind]
  if (!ref) throw new LaneError(`unknown exclusive lane: ${kind}`)
  if (!metadata.owner || !metadata.headSha || (kind !== 'production' && !metadata.pr)) throw new LaneError('exclusive lane requires owner, exact head SHA, and a PR number except for production')
  const requestId = metadata.requestId ?? randomUUID()
  // STRUCTURED LEASE (Step 6, issue #1366). The first line keeps the exact shape
  // recoverStaleAuthorMutex recognises; the metadata follows. A format that broke
  // that recognition would make a crash DURING acquisition -- mutex held, exclusive
  // ref possibly created -- permanently unrecoverable.
  const holderId = metadata.holderId ?? metadata.owner
  const ownerSha = io.makeOwnerCommit(formatLeaseMessage(kind, {
    requestId,
    holderId,
    githubRunId: metadata.githubRunId ?? process.env.GITHUB_RUN_ID ?? null,
    githubRunAttempt: metadata.githubRunAttempt ?? process.env.GITHUB_RUN_ATTEMPT ?? null,
    owner: metadata.owner,
    pr: metadata.pr,
    headSha: metadata.headSha,
    migrationVersions: metadata.versions ?? metadata.migrationVersions ?? [],
    acquiredAt: (metadata.now ?? new Date()).toISOString(),
    generation: metadata.generation ?? 1,
  }))
  acquireMutex(ownerSha, io)
  try {
    if (kind === 'production') {
      if (metadata.headSha !== io.mainSha?.()) throw new LaneError('production lane requires the exact current main SHA')
      if (io.readRef(EXCLUSIVE_REFS.merge)) throw new LaneError('a guarded merge is active; production promotion must wait')
    } else if (kind === 'preview-rehearsal') {
      // POST-MERGE PREVIEW REHEARSAL -- the path that makes "merge first, then
      // rehearse on preview from merged main, then promote" executable. There is
      // no live author claim to point at: the guarded merge released the claim
      // and deleted the branch. Authorisation comes from merge-commit ancestry
      // of the current main tip instead. Every failure below is fail-closed and
      // names exactly what was missing.
      const mainSha = io.mainSha?.()
      if (!mainSha) throw new LaneError('post-merge preview rehearsal cannot read the current main tip; GitHub state is unreadable')
      if (metadata.headSha !== mainSha) throw new LaneError(`post-merge preview rehearsal requires the exact current main SHA (asked for ${metadata.headSha}, main is ${mainSha})`)
      // The version set is validated FIRST and identically for both forms: one
      // source PR, or a version-to-PR map for a batch AGENTS.md 6.5 requires to
      // move as a single bounded event. The map does not weaken anything -- the
      // very same four proofs (merged, real merge commit, that commit contained
      // in the main tip's history, and the version ADDED by that PR) simply run
      // per version instead of once per batch.
      const versions = (metadata.versions ?? []).map((v) => String(v).trim()).filter(Boolean)
      if (!versions.length) throw new LaneError('post-merge preview rehearsal requires the exact migration versions it will apply')
      if (versions.some((v) => !/^\d{14}$/.test(v))) throw new LaneError('post-merge preview rehearsal versions must each be an exact 14-digit migration version')
      // PRESENT-BUT-EMPTY IS A REFUSAL, not a silent fall-back to the single-PR
      // form. An operator who passed a map that evaluated to nothing must be
      // told, never quietly given a different lane than the one they asked for.
      const hasMap = metadata.versionPrMap !== undefined && metadata.versionPrMap !== null
      const readPr = (number) => {
        let pr
        try { pr = io.getPr?.(number) } catch (error) { throw new LaneError(`post-merge preview rehearsal cannot read pull request #${number} (${error.message})`) }
        if (!pr) throw new LaneError(`post-merge preview rehearsal cannot read pull request #${number}`)
        if (pr.merged !== true || !pr.merge_commit_sha) throw new LaneError(`post-merge preview rehearsal requires an already-merged source PR; #${number} is not merged`)
        assertMergeCommitInMainHistory(pr.merge_commit_sha, mainSha, io)
        return pr
      }
      const readAdded = (number) => {
        let files
        try { files = io.getPrFiles?.(number) } catch (error) { throw new LaneError(`post-merge preview rehearsal cannot read the files of pull request #${number} (${error.message})`) }
        return addedMigrationVersions(files)
      }
      if (hasMap) {
        const map = parseVersionPrMap(metadata.versionPrMap, versions)
        // The lane lock is claimed against ONE pull request number, so that
        // number must be a member of the batch it claims to lock. Otherwise the
        // lock would be filed under a pull request the evidence never mentions.
        if (![...map.values()].some((number) => String(number) === String(metadata.pr))) {
          throw new LaneError(`post-merge preview rehearsal lock PR #${metadata.pr} is not one of the pull requests in the version-to-PR map`)
        }
        const addedByPr = new Map()
        for (const [version, number] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          readPr(number)
          if (!addedByPr.has(number)) addedByPr.set(number, readAdded(number))
          if (!addedByPr.get(number).includes(version)) throw new LaneError(`post-merge preview rehearsal version ${version} was not added by pull request #${number}`)
        }
      } else {
        readPr(metadata.pr)
        const added = readAdded(metadata.pr)
        const missing = versions.filter((v) => !added.includes(v))
        if (missing.length) throw new LaneError(`post-merge preview rehearsal versions were not added by pull request #${metadata.pr}: ${missing.join(', ')}`)
      }
    } else if (kind === 'preview-recovery') {
      if (metadata.headSha !== io.mainSha?.()) throw new LaneError('historical preview recovery requires the exact current main SHA')
      const pr = io.getPr?.(metadata.pr)
      // #1211 and #1439 are the proven circular cases: their corrected migrations cannot be
      // previewed (and therefore cannot be merged) until the abandoned preview-only
      // ledger row from the SAME PR is removed. The recovery workflow independently
      // pins the exact issue, claim, versions, run, artifact, and live PR head.
      const pending1211 = Number(metadata.pr) === 1372 && pr?.state === 'open' && pr?.merged !== true && Boolean(pr?.head?.sha)
      const pending1439 = Number(metadata.pr) === 1495 && pr?.state === 'open' && pr?.merged !== true && Boolean(pr?.head?.sha)
      // #1658/PR #1660 is the same circular case: the abandoned preview-only row
      // 20260827134155 blocks EVERY preview apply in the repository, including the
      // replacement 20260827171526 that PR #1660 itself carries, so the PR cannot be
      // previewed and therefore cannot be merged until that row is removed.
      const pending1658 = Number(metadata.pr) === 1660 && pr?.state === 'open' && pr?.merged !== true && Boolean(pr?.head?.sha)
      if (!pending1211 && !pending1439 && !pending1658 && (pr?.merged !== true || !pr?.merge_commit_sha)) throw new LaneError('historical preview recovery requires an already-merged source PR or an exact allowlisted pending-replacement PR')
    } else {
      const pr = io.getPr?.(metadata.pr)
      if (!pr?.head?.sha || pr.head.sha !== metadata.headSha) throw new LaneError('exclusive lane head SHA does not match the live pull request')
      const claims = io.openClaims()
      const matching = claims.map((claim)=>({ ...claim, lease:parseAuthorLease(claim.body) })).filter((claim)=>!claim.lease.legacy && claim.lease.branch===pr.head.ref && claim.lease.active)
      if (matching.length !== 1) throw new LaneError('exclusive lane requires exactly one live author claim for the pull-request branch')
      if (kind === 'merge' && pr.base?.sha !== io.mainSha?.()) throw new LaneError('pull request is not based on the current main tip')
      if (kind === 'merge' && io.readRef(EXCLUSIVE_REFS.production)) throw new LaneError('production promotion is active; merges are frozen')
    }
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    acquireRef(ref, ownerSha, io)
    return { kind, ref, ownerSha, requestId, holderId, generation: metadata.generation ?? 1 }
  } finally { if (io.readRef(MUTEX_REF) === ownerSha) releaseOwnedRef(MUTEX_REF, ownerSha, io) }
}

function parseArgs(argv) {
  const out = { objects: [] }
  const next = (i) => { if (i + 1 >= argv.length) throw new LaneError(`${argv[i]} needs a value`); return argv[i + 1] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--claim') out.claim = true
    else if (a === '--audit') out.audit = true
    else if (a === '--queue-audit') out.queueAudit = true
    else if (a === '--complete-work') out.completeWork = true
    else if (a === '--assert-exclusive') out.assertExclusive = next(i++)
    else if (a === '--recover-exclusive') out.recoverExclusive = next(i++)
    else if (a === '--release-exclusive') out.releaseExclusive = next(i++)
    else if (a === '--holder-id') out.holderId = next(i++)
    else if (a === '--generation') out.generation = Number(next(i++))
    else if (a === '--apply-recovery') out.applyRecovery = true
    else if (a === '--report-file') out.reportFile = argv[++i]
    else if (a === '--return-issue') out.returnIssue = Number(argv[++i])
    else if (a === '--assign-reviewer') out.assignReviewer = true
    else if (a === '--activate-review-cutover') out.activateReviewCutover = true
    else if (a === '--replace-failed-reviewer') out.replaceFailedReviewer = true
    else if (a === '--reviewer-preflight') out.reviewerPreflight = true
    else if (a === '--cleanup-stale') out.cleanup = true
    else if (a === '--release-claim') out.releaseClaim = next(i), i++
    else if (a === '--confirm-finished') out.confirmFinished = true
    else if (a === '--recover-author-mutex') out.recoverMutex = true
    else if (a === '--recover-same-owner-split') out.recoverSplit = true
    else if (a === '--expand-active-claim-from-pr') out.expandClaim = true
    else if (a === '--expand-active-claim-from-issue') out.expandClaimFromIssue = true
    else if (a === '--renew-claim') out.renewClaim = true
    else if (a === '--relinquish-author-lease') out.relinquishAuthorLease = true
    else if (a === '--resume-author-lease') out.resumeAuthorLease = true
    else if (a === '--flow-audit') out.flowAudit = true
    else if (a === '--reconcile-flow') out.reconcileFlow = true
    else if (a === '--prepare-preview-dispatch') out.preparePreviewDispatch = Number(next(i++))
    else if (a === '--repair-preview-ready') out.repairPreviewReady = next(i++)
    else if (a === '--json') out.json = true
    else if (a === '--reissue-merged-stranded-claim') out.reissueMergedClaim = true
    else if (a === '--reversion-active-claim' || a === '--supersede-active-claim-version') out.reversionClaim = true
    else if (a === '--confirm-stale') out.confirmStale = true
    else if (/^--acquire-(preview|preview-recovery|preview-rehearsal|merge|production)$/.test(a)) out.acquireExclusive = a.slice(10)
    else if (/^--release-(preview|preview-recovery|preview-rehearsal|merge|production)$/.test(a)) out.releaseExclusive = a.slice(10)
    else if (['--task','--owner','--branch','--worktree','--issue','--pr','--head-sha','--owner-sha','--expected-sha','--released-claim','--active-claim','--source-pr','--target-pr','--target-branch','--target-worktree','--claim-number','--failed-sequence','--failure-code','--failing-check','--old-version','--reviewer','--wrapper','--version-pr-map','--blocked-on','--review-slot'].includes(a)) { out[a.slice(2).replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = next(i); i++ }
    else if(a==='--confirm-local-dependency-unfixable')out.confirmLocalDependencyUnfixable=true
    else if(a==='--skip-doctor')out.skipDoctor=true
    else if(a==='--confirm-no-verdict')out.confirmNoVerdict=true
    else if(a==='--confirm-no-artifact')out.confirmNoArtifact=true
    else if (a === '--versions') { out.versions = next(i).split(',').map((v)=>v.trim()).filter(Boolean); i++ }
    else if (a === '--objects') { out.objects.push(...next(i).split(',').map((v)=>v.trim()).filter(Boolean)); i++ }
    else if (a === '--lease-hours') { out.leaseHours = Number(next(i)); i++ }
    else throw new LaneError(`unknown argument: ${a}`)
  }
  return out
}

export function main(argv, now = new Date(), io = githubIo) {
  try {
    const o = parseArgs(argv)
    if(o.recoverMutex){console.log(JSON.stringify(recoverStaleAuthorMutex({expectedSha:o.expectedSha,confirmStale:o.confirmStale,serializedRecovery:process.env.GITHUB_ACTIONS==='true'&&process.env.AUTHOR_MUTEX_RECOVERY_SERIALIZED==='true',now},io),null,2));return 0}
    if(o.reconcileFlow){
      if(typeof io.orchestratorFlowAdapter!=='function')throw new LaneError('reconcile runtime adapter is unavailable')
      const result=reconcileFlow(io.flowSnapshot(),io.orchestratorFlowAdapter());console.log(JSON.stringify(result,null,2));return result.status==='UNVERIFIABLE'?2:0
    }
    if(o.preparePreviewDispatch){
      if(typeof io.orchestratorFlowAdapter!=='function')throw new LaneError('preview preparation runtime adapter is unavailable')
      console.log(JSON.stringify(preparePreviewDispatch(o.preparePreviewDispatch,io.orchestratorFlowAdapter(o.claimNumber)),null,2));return 0
    }
    if(o.repairPreviewReady){
      if(!o.issue)throw new LaneError('--repair-preview-ready requires --issue <n>')
      if(typeof io.orchestratorFlowAdapter!=='function')throw new LaneError('preview repair runtime adapter is unavailable')
      console.log(JSON.stringify(repairPreviewReady(o.repairPreviewReady,Number(o.issue),io.orchestratorFlowAdapter()),null,2));return 0
    }
    if(o.flowAudit){
      if(!o.issue)throw new LaneError('--flow-audit requires --issue <n>')
      const events=(io.getIssueComments(Number(o.issue))??[]).flatMap((comment)=>parseEventComment(comment.body??comment))
      const audit=auditTimeline(events)
      console.log(o.json?JSON.stringify(audit,null,2):renderTimeline(audit))
      return audit.valid?0:2
    }
    if(o.recoverSplit){console.log(JSON.stringify(recoverSameOwnerSplit(o,now,io),null,2));return 0}
    if(o.expandClaim){console.log(JSON.stringify(expandActiveClaimFromPr({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.expandClaimFromIssue){console.log(JSON.stringify(expandActiveClaimFromIssue({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.renewClaim){console.log(JSON.stringify(renewExpiredClaim({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.relinquishAuthorLease){console.log(JSON.stringify(relinquishAuthorLease({...o,claim:o.claimNumber??o.claim},now,io),null,2));return 0}
    if(o.resumeAuthorLease){console.log(JSON.stringify(resumeAuthorLease({...o,claim:o.claimNumber??o.claim},now,io),null,2));return 0}
    if(o.reissueMergedClaim){console.log(JSON.stringify(reissueMergedStrandedClaim({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.reversionClaim){console.log(JSON.stringify(reversionActiveClaim({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.replaceFailedReviewer){console.log(JSON.stringify(replaceFailedReviewer({...o,slot:o.reviewSlot!==undefined?Number(o.reviewSlot):1},io),null,2));return 0}
    if(o.reviewerPreflight){console.log(JSON.stringify(reviewerExecutionPreflight(o,io),null,2));return 0}
    if(o.assignReviewer){console.log(JSON.stringify(assignNextReviewer({issue:o.issue,pr:o.pr,headSha:o.headSha,slot:o.reviewSlot!==undefined?Number(o.reviewSlot):1},io),null,2));return 0}
    if(o.activateReviewCutover){console.log(JSON.stringify(activateReviewCutover(io),null,2));return 0}
    if (o.acquireExclusive) { console.log(JSON.stringify(acquireExclusive(o.acquireExclusive, { owner:o.owner, pr:o.pr, headSha:o.headSha, versions:o.versions, versionPrMap:o.versionPrMap }, io), null, 2)); return 0 }
    if (o.releaseExclusive) { if (!o.ownerSha) throw new LaneError('--owner-sha is required for safe release'); releaseOwnedRef(EXCLUSIVE_REFS[o.releaseExclusive], o.ownerSha, io); return 0 }
    const claims = io.openClaims()
    if (o.returnIssue) { console.log(JSON.stringify(returnIssueToOwner(o.returnIssue, io), null, 2)); return 0 }
    if (o.queueAudit) {
      const issues = io.openWorkIssues()
      // Gather dependency state before building the queue so the pure function
      // stays pure. Referenced numbers come from the scope blocks themselves.
      const referenced = new Set()
      for (const issue of issues) {
        let scope = null
        try { scope = parseQueueScope(issue.body) } catch { /* malformed scopes are reported by the audit itself */ }
        for (const number of scope?.dependencies ?? []) referenced.add(number)
      }
      const dependencyStates = referenced.size && io.dependencyStates ? io.dependencyStates([...referenced]) : null
      // Re-derive the merge evidence rather than trusting the record's own claim.
      if (dependencyStates && io.mergeCommitInMain) {
        for (const [number, state] of Object.entries(dependencyStates)) {
          if (state.open || state.unreadable || state.exists === false) continue
          let record = null
          try { record = findCompletionRecord(state.comments) } catch { continue }
          if (record?.outcome === 'merged') state.mergeInMain = io.mergeCommitInMain(record.merge_sha)
        }
      }
      const openPulls = io.openPulls?.() ?? []
      const claimPullStates = new Map()
      for (const claim of claims) {
        const lease = parseAuthorLease(claim.body, now)
        if (lease.legacy || lease.active || !lease.capacityActive) continue
        if (openPulls.some((pull)=>pull.head?.ref === lease.branch)) { claimPullStates.set(claim.number, 'open'); continue }
        const historical = io.branchPulls?.(lease.branch) ?? []
        claimPullStates.set(claim.number, historical.some((pull)=>pull.merged_at) ? 'merged' : historical.length ? 'closed-unmerged' : 'none')
      }
      // Resolve historical authoring only for the bounded set that would be
      // dispatched. This catches merged work without scanning all historical
      // claim refs or spending an unbounded GitHub API budget.
      let result = buildDynamicQueues(issues, claims, now, io.openIssueNumbers(), dependencyStates, claimPullStates)
      const authoredOnMain = new Set()
      if (result.dispatchable.length && io.closedClaimsForWork && io.branchPulls && io.treeFiles && io.mainSha && io.mergeCommitInMain) {
        const main = io.mainSha()
        const mainVersions = new Set(io.treeFiles(main).filter((file)=>/^supabase\/migrations\/\d{14}_/.test(file)).map((file)=>path.basename(file).slice(0,14)))
        const checked = new Set()
        // Removing one already-authored issue can expose the next item in its
        // collision queue. Iterate to a fixed point and inspect each issue at
        // most once so a deeper queue cannot hide another completed authoring.
        while (true) {
          const fresh = result.dispatchable.filter((issue)=>!checked.has(issue))
          if (!fresh.length) break
          for (const issue of fresh) {
            checked.add(issue)
            const completed = io.closedClaimsForWork(issue).some((claim)=>{
              let lease
              try { lease = parseAuthorLease(claim.body, now) } catch { return false }
              if (!mainVersions.has(lease.version)) return false
              return (io.branchPulls(lease.branch)??[]).some((pull)=>pull.merged_at&&pull.merge_commit_sha&&io.mergeCommitInMain(pull.merge_commit_sha))
            })
            if (completed) authoredOnMain.add(issue)
          }
          if (!fresh.some((issue)=>authoredOnMain.has(issue))) break
          result = buildDynamicQueues(issues, claims, now, io.openIssueNumbers(), dependencyStates, claimPullStates, authoredOnMain)
        }
      }
      console.log(JSON.stringify(result,null,2))
      // Printed BEFORE the refill early-return: a queue with any dispatchable
      // work would otherwise hide this list entirely, which is exactly how these
      // items accumulated unseen in the first place.
      if (result.notOrchestratorWork.length) {
        // Split the list by what the orchestrator must DO. The single old
        // heading told the reader to "reject or fork each one", which reads as a
        // worklist even for items the orchestrator has no business touching.
        const actionable = result.notOrchestratorWork.filter((item)=>!OUTSIDE_ORCHESTRATOR_EXITS.includes(item.exit))
        const outside = result.notOrchestratorWork.filter((item)=>OUTSIDE_ORCHESTRATOR_EXITS.includes(item.exit))
        const describe = (item) => {
          const owner = item.blockedOnOwner ? ' [blocked on owner decision]' : ''
          const address = item.exit === 'reject'
            ? (item.returnTo ? ` -> ${item.returnTo}` : ' -> NO RETURN ADDRESS: add `return_to: owner/repo` before returning it')
            : ''
          return `  #${item.issue} ${item.exit.toUpperCase()} — work_type ${item.workType}, route ${item.route}${owner}${address}`
        }
        if (actionable.length) {
          console.error('NOT ORCHESTRATOR WORK: these open issues fail the shape test (AGENTS.md 0.0-C). Reject or fork each one; never work it here.')
          for (const item of actionable) console.error(describe(item))
        }
        if (outside.length) {
          // OWNER RULING 2026-08-21 (issue #1366): the orchestrator handles
          // structure and schema only. These rows are listed so an audit can see
          // them and so nothing accumulates unseen - NOT so the orchestrator can
          // pick them up. There is no orchestrator action for any of them.
          console.error('OUTSIDE ORCHESTRATOR — OWNED BY REPO SESSION: listed for audit visibility only (owner ruling 2026-08-21, issue #1366). The orchestrator does structure/schema only. Do NOT work these and do NOT dispatch them; a separately started session owns them.')
          for (const item of outside) console.error(describe(item))
        }
        const unaddressed = result.notOrchestratorWork.filter((item)=>item.needsReturnAddress)
        if (unaddressed.length) console.error(`NO RETURN ADDRESS on ${unaddressed.map((item)=>`#${item.issue}`).join(', ')} — a reject with no forwarding address closes into silence. Return each with --return-issue <n> once addressed.`)
      }
      // A CYCLE CAN NEVER START. Reported separately from "blocked", because a
      // blocked task is waiting for something and a cycle is waiting for itself.
      if (result.dependencyCycles.length) {
        console.error('DEPENDENCY CYCLE: these issues can never start, because each waits on the next. Break the cycle by removing one depends_on edge.')
        for (const cycle of result.dependencyCycles) console.error(`  ${cycle.map((n)=>`#${n}`).join(' -> ')}`)
      }
      // Print WHY a dependency blocked. "depends-on-open:12" was the whole
      // diagnostic before; an invalid or unsuccessfully-completed dependency now
      // says so in words, because those are the cases that used to release work.
      if (result.grandfatheredDependencies?.length) {
        console.error('GRANDFATHERED DEPENDENCIES: closed before completion records were required, so accepted without proof. Countable on purpose; Step 8A retires the cutoff when this list is empty.')
        for (const row of result.grandfatheredDependencies) console.error(`  #${row.issue} — ${row.detail}`)
      }
      const dependencyBlocked = result.skipped.filter((row)=>row.detail)
      if (dependencyBlocked.length) {
        console.error('DEPENDENCIES NOT PROVEN: closure alone is not success (Step 3, issue #1366).')
        for (const row of dependencyBlocked) console.error(`  #${row.issue} — ${row.detail}`)
      }
      if (result.expiredClaims.length) {
        console.error('EXPIRED AUTHOR LEASES: occupancy is locked but no live author lease exists. Inspect and explicitly renew, resume, or close out each claim; expiry never releases object protection.')
        for (const row of result.expiredClaims) console.error(`  claim #${row.claim}, lane ${row.lane}, expired ${row.expires_at}, PR ${row.pr_state}, queued ${row.queued.length ? row.queued.map((number)=>`#${number}`).join(', ') : 'none'}`)
      }
      if (result.dispatchable.length) { console.error(`REFILL REQUIRED NOW: dispatch issue(s) ${result.dispatchable.map((n)=>`#${n}`).join(', ')}`); return 2 }
      if (result.unlabelled.length) console.error(`UNLABELLED ISSUES: add the \`${WORK_LABEL}\` label to ${result.unlabelled.map((n)=>`#${n}`).join(', ')} — an unlabelled issue is invisible to every label-filtered query`)
      if (result.emptyLanes && !result.fullyAudited) { console.error('EMPTY LANE NOT PROVEN: classify and label every open issue before claiming no eligible work exists'); return 2 }
      return result.malformed.length || result.unlabelled.length || result.dependencyCycles.length || result.expiredClaims.some((row)=>row.queued.length) || result.notOrchestratorWork.some((item)=>item.needsReturnAddress) ? 2 : 0
    }
    if (o.assertExclusive) {
      const lease = assertExclusive(o.assertExclusive, {
        holderId: o.holderId, generation: o.generation, kind: o.assertExclusive,
        headSha: o.headSha, pr: o.pr ? Number(o.pr) : undefined,
      }, io)
      console.log(JSON.stringify({ kind: o.assertExclusive, holderId: lease.holderId, generation: lease.generation, headSha: lease.headSha }, null, 2))
      return 0
    }
    if (o.releaseExclusive) {
      const result = releaseExclusive(o.releaseExclusive, { holderId: o.holderId, generation: o.generation, ownerSha: o.ownerSha }, io)
      console.log(JSON.stringify(result, null, 2))
      return 0
    }
    if (o.recoverExclusive) {
      // DRY RUN BY DEFAULT. A recovery that turns out to be wrong produces the
      // split ownership this whole step exists to prevent.
      const result = recoverExclusive(o.recoverExclusive, { holderId: o.holderId, apply: Boolean(o.applyRecovery) }, io)
      console.log(JSON.stringify(result, null, 2))
      if (!result.recovered && !result.dryRun) { console.error(`RECOVERY REFUSED: ${result.reason}`); return 1 }
      if (result.dryRun) console.error(`DRY RUN — would recover: ${result.reason}. Re-run with --apply-recovery to take the lane.`)
      return 0
    }
    if (o.completeWork) {
      if (!o.issue) throw new LaneError('--complete-work requires --issue <n>')
      if (!o.reportFile) throw new LaneError('--complete-work requires --report-file <path>')
      let report
      try { report = JSON.parse(readFileSync(o.reportFile, 'utf8')) }
      catch (error) { throw new LaneError(`--report-file is not readable JSON: ${error.message}`) }
      const published = completeWork({ issue: Number(o.issue), report }, io)
      console.log(JSON.stringify(published, null, 2))
      console.error(`Completion recorded on #${o.issue} as ${published.outcome}. You may now close the issue.`)
      return 0
    }
    if (o.releaseClaim) {
      if (!o.confirmFinished || !o.owner) throw new LaneError('--release-claim requires exact --owner and --confirm-finished')
      const requestId=randomUUID(), ownerSha=io.makeOwnerCommit(`db-coordination claim-release ${requestId}`)
      acquireMutex(ownerSha,io)
      try {
        const fresh=io.openClaims(), claim=fresh.find((x)=>String(x.number)===String(o.releaseClaim))
        if(!claim)throw new LaneError(`claim #${o.releaseClaim} is not open`)
        const lease=parseAuthorLease(claim.body,now)
        if(lease.owner!==o.owner)throw new LaneError(`claim #${o.releaseClaim} belongs to a different owner`)
        if((io.openPulls?.() ?? io.prSources()).some((pr)=>(pr.head?.ref ?? pr.branch)===lease.branch))throw new LaneError(`claim branch ${lease.branch} still has an open pull request`)
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        io.closeClaim(claim.number)
      } finally { if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io) }
      return 0
    }
    if (o.cleanup) {
      const { stale } = assertLaneAvailable(claims, [], now, { ignoreCapacity: true })
      console.log(`${stale.length} expired claim(s) remain locked. Release each explicitly with --release-claim, exact --owner, and --confirm-finished.`); return stale.length ? 2 : 0
    }
    if (o.audit) {
      const malformed=[];let protectedCount=0,occupied=0,relinquished=0,expired=0
      for(const claim of claims){try{const lease=parseAuthorLease(claim.body,now);protectedCount++;if(lease.capacityActive)occupied++;else relinquished++;if(!lease.legacy&&!lease.active)expired++}catch(e){malformed.push(`#${claim.number}: ${e.message}`)}}
      console.log(`${occupied}/${MAX_AUTHOR_LANES} active-author leases occupied; ${protectedCount} protected claim(s); ${relinquished} relinquished; ${expired} expired lease(s) remain locked.`)
      for(const problem of malformed)console.error(`MALFORMED ${problem}`)
      return malformed.length || occupied>MAX_AUTHOR_LANES ? 2 : 0
    }
    if (!o.claim) throw new LaneError('choose --claim, --audit, --queue-audit, --return-issue, --cleanup-stale, --activate-review-cutover, or an exclusive-lane command')
    for (const k of ['task','owner','branch','worktree']) if (!o[k]) throw new LaneError(`--${k} is required`)
    if (!o.objects.length) throw new LaneError('--objects must name every database object exactly')
    o.leaseHours ??= DEFAULT_LEASE_HOURS
    if (!Number.isFinite(o.leaseHours) || o.leaseHours <= 0 || o.leaseHours > 24) throw new LaneError('--lease-hours must be greater than 0 and no more than 24')
    console.log(JSON.stringify(acquireAuthorLane(o, now, io), null, 2)); return 0
  } catch (error) { console.error(`REFUSED: ${error.message}`); return 2 }
}

export function validateOriginalPreviewApplyEvidence({issue,pr,versions,mergeCommitSha=null},io){
  const runIds=[...new Set((io.issueComments(issue)??[]).flatMap((comment)=>[...String(comment.body??comment).matchAll(/actions\/runs\/(\d+)/g)].map((match)=>match[1])))]
  const expected=[...versions].map(String).sort(),matches=[]
  for(const runId of runIds){try{
    const {run,artifacts,logs}=io.previewApplyRun(runId)
    if(String(run?.id)!==String(runId)||run?.path!=='.github/workflows/shared-supabase-migrations.yml'||run?.event!=='workflow_dispatch'||run?.status!=='completed'||run?.conclusion!=='success'||run?.run_attempt!==1||!/^[0-9a-f]{40}$/i.test(String(run?.head_sha??'')))continue
    const bindings=String(logs).split(/\r?\n/).flatMap((line)=>{const start=line.indexOf('{"allowlist"'),end=line.lastIndexOf('}');if(start<0||end<start)return[];try{return[JSON.parse(line.slice(start,end+1))]}catch{return[]}}).filter((row)=>row.schema==='shared-db-preview-instance-binding/v1')
    if(bindings.length!==1)continue
    const binding=bindings[0],allowlist=Array.isArray(binding.allowlist)?binding.allowlist.map(String).sort():[]
    if(String(binding.runId)!==String(runId)||binding.previewProjectRef!==PROJECT_REFS.preview||binding.appliedCommit!==run.head_sha||JSON.stringify(allowlist)!==JSON.stringify(expected))continue
    if(mergeCommitSha&&(binding.rehearsalMode!=='merged-main-rehearsal'||Number(binding.sourcePr)!==Number(pr)||String(binding.mergeCommitSha).toLowerCase()!==String(mergeCommitSha).toLowerCase()))continue
    const rows=Array.isArray(artifacts?.artifacts)?artifacts.artifacts:[]
    if(Number(artifacts?.total_count)!==1||rows.length!==1||rows[0].expired!==false||rows[0].name!==`preview-migration-apply-${run.head_sha}`||String(rows[0].workflow_run?.id)!==String(runId)||rows[0].workflow_run?.head_sha!==run.head_sha)continue
    matches.push({type:'preview-apply',run_id:String(runId)})
  }catch{/* An unreadable candidate cannot become evidence. */}}
  for(const runId of runIds){try{
    const {run,artifacts,logs}=io.previewApplyRun(runId)
    if(expected.length!==1||String(run?.id)!==String(runId)||run?.path!=='.github/workflows/preview-ledger-orphan-reconciliation.yml'||run?.event!=='workflow_dispatch'||run?.status!=='completed'||run?.conclusion!=='success'||run?.run_attempt!==1||!/^[0-9a-f]{40}$/i.test(String(run?.head_sha??'')))continue
    const applied=/PREVIEW LEDGER RECONCILIATION APPLY OK: removed=(\d{14}) replacement=(\d{14})/.exec(String(logs))
    // Only a true rename preserves already-applied status. A same-version
    // rehearsal reset deletes the ledger row so the migration can run again;
    // it is therefore the opposite of immutable no-replay evidence.
    if(!applied||applied[1]===applied[2]||applied[2]!==expected[0])continue
    const exact=(name,value)=>new RegExp(`(?:^|\\s)${name}:\\s+${String(value)}(?:\\s|$)`,'m').test(String(logs))
    if(!exact('ISSUE',issue)||!exact('SOURCE_PR',pr)||!exact('ORPHAN',applied[1])||!exact('REPLACEMENT',applied[2]))continue
    if(mergeCommitSha){const relation=io.compareCommits?.(mergeCommitSha,run.head_sha);if(!relation||!['ahead','identical'].includes(relation.status))continue}
    const rows=Array.isArray(artifacts?.artifacts)?artifacts.artifacts:[]
    if(Number(artifacts?.total_count)!==1||rows.length!==1||rows[0].expired!==false||rows[0].name!==`preview-ledger-orphan-reconciliation-${applied[1]}`||String(rows[0].workflow_run?.id)!==String(runId)||rows[0].workflow_run?.head_sha!==run.head_sha)continue
    matches.push({type:'preview-ledger-reconciliation',run_id:String(runId),orphan_version:applied[1],replacement_version:applied[2]})
  }catch{/* An unreadable candidate cannot become evidence. */}}
  if(matches.length!==1)throw new LaneError(`already-applied versions require exactly one validated immutable preview apply or ledger-reconciliation run; found ${matches.length}`)
  return matches[0]
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main(process.argv.slice(2))
