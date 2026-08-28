#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gatherOpenPrObjects, normalizeObject, parseClaimBlock } from './check-dispatch-collision.mjs'
import { classifyDependencies, findCompletionRecord, findDependencyCycles, validateCompletionRecord, validateDependencyDeclaration, COMPLETION_FENCE, DependencyError } from './lib/work-dependencies.mjs'
import { assertLease, evaluateRecovery, formatLeaseMessage, parseLeaseMessage, recoveredLeaseMetadata, LeaseError } from './lib/exclusive-lease.mjs'

export const REPO = 'u2giants/shared-db'
// AUTHOR LANE CAP. Raised from three to five on 2026-08-25 (owner instruction).
//
// WHAT THE NUMBER DOES AND DOES NOT DO. It is a throughput dial, not a safety
// dial. Collision safety comes from four mechanisms that do not read this
// constant: exact per-object claims (`assertLaneAvailable`), the global
// acquisition mutex (`MUTEX_REF`), permanent per-version refs
// (`refs/db-claims/<version>`), and the exclusive single-holder stage refs in
// `EXCLUSIVE_REFS`. Preview, guarded merge and production stay strictly serial
// at five lanes exactly as they were at three -- more authors never means more
// sessions touching a live database.
//
// WHAT THE RAISE ACTUALLY COSTS. Downstream capacity, not correctness. Five
// authors finishing together queue in front of the single preview stage, and
// they need reviewers: the roster was grown to four active providers plus a
// codex overflow slot in the same change, because five lanes feeding three
// reviewers just moves the wait. Ref writes are ~6/hour per lane, so five lanes
// stay far inside GitHub's limits and the rate-limit caveat recorded in
// plan_multi_agent_database_coordination_hardening.md is satisfied at this cap.
export const MAX_AUTHOR_LANES = 5
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
export const REVIEW_OPERATION_REQUEST_LIMIT = 19
export const REVIEW_QUOTA_RESERVE = 100
export const REVIEWERS = Object.freeze([
  { name:'grok-4.6', wrapper:'ai-grok-review' }, { name:'glm-5.3', wrapper:'ai-glm' },
  { name:'kimi-k3', wrapper:'ai-kimi' }, { name:'qwen-3.8-max', wrapper:'ai-qwen' },
  { name:'glm-5.2', wrapper:'ai-glm' },
  { name:'muse-spark-1.2-contributor', wrapper:'ai-muse' },
  { name:'codex-gpt-5.6-sol', wrapper:'ai-codex-review' },
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
export const RETIRED_REVIEWERS = Object.freeze(['qwen-3.8-max', 'glm-5.2'])

// OVERFLOW, NOT ROTATION (owner instruction, 2026-08-25). Codex is a reviewer of
// last resort: it is assigned only when every name in ACTIVE_REVIEWERS is
// already holding live review work in this repository, or -- in a replacement --
// when every active provider has already failed on the exact head. It is
// deliberately NOT a fifth rotation slot, because a provider that reviews on
// every fourth PR is not a fallback, and the owner asked for a fallback.
//
// It is listed in REVIEWERS like every other name, so a cursor commit naming it
// still resolves to a wrapper forever (`REVIEWERS.find(...)` at parse time is
// not null-guarded on every path -- see the retired-name note above).
//
// `ai-codex-review` pins `codex exec -m gpt-5.6-sol --sandbox read-only
// -c model_reasoning_effort=medium`. That satisfies the standing rule that
// GPT-5.6 runs at low or medium reasoning only, and the pin lives in the
// wrapper, so no caller here can raise it. `ai-codex-review doctor` was run on
// edge-dev before this name was added and returns
// `PASS provider=codex sandbox=read-only reasoning=explicit command=codex`.
export const OVERFLOW_REVIEWERS = Object.freeze(REVIEWERS.filter((row)=>row.name==='codex-gpt-5.6-sol'))
export const ACTIVE_REVIEWERS = Object.freeze(REVIEWERS.filter((row)=>!RETIRED_REVIEWERS.includes(row.name)&&!OVERFLOW_REVIEWERS.some((o)=>o.name===row.name)))
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
  // must not occupy a migration-author lane and must not be worked in the
  // orchestrator's own context - not because it belongs to somebody else.
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

export function buildDynamicQueues(issues, claims, now = new Date(), allOpenIssueNumbers = issues.map((issue)=>issue.number), dependencyStates = null) {
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
  const active = claims.map((claim)=>{
    const lease = parseAuthorLease(claim.body,now)
    return { claim:claim.number, issue:null, priority:Number.MAX_SAFE_INTEGER, writes:lease.writes, reads:lease.reads ?? [], objects:lease.writes }
  })
  const components = [...active, ...candidates].map((item)=>[item])
  for (let i=0;i<components.length;i++) for (let j=i+1;j<components.length;) {
    if (components[i].some((a)=>components[j].some((b)=>conflicts(a,b)))) components[i].push(...components.splice(j,1)[0]); else j++
  }
  const queues = Array.from({length:MAX_AUTHOR_LANES},(_,index)=>({ lane:index+1, active:null, queued:[], objects:[], reads:[] }))
  const ordered = components.sort((a,b)=>Number(Boolean(b.some(x=>x.claim)))-Number(Boolean(a.some(x=>x.claim))) || Math.max(...b.map(x=>x.priority))-Math.max(...a.map(x=>x.priority)))
  for (const component of ordered) {
    const activeItem = component.find((x)=>x.claim)
    const free=queues.filter((q)=>!q.active)
    let lane = activeItem ? free[0] : [...(free.length?free:queues)].sort((a,b)=>a.queued.length-b.queued.length)[0]
    if (activeItem) lane.active = activeItem.claim
    lane.queued.push(...component.filter((x)=>x.issue).sort((a,b)=>b.priority-a.priority || a.issue-b.issue).map((x)=>x.issue))
    lane.objects.push(...new Set(component.flatMap((x)=>x.writes ?? x.objects ?? [])))
    lane.reads.push(...new Set(component.flatMap((x)=>x.reads ?? [])))
  }
  const emptyLanes = queues.filter((q)=>!q.active).length
  const dispatchable = queues.filter((q)=>!q.active && q.queued.length).map((q)=>q.queued[0])
  // A CYCLE IS NEVER STARTABLE and is invisible to an open/closed test, so it is
  // reported as its own finding rather than as N tasks that merely look blocked.
  const dependencyCycles = findDependencyCycles(dependencyEdges)
  return { queues, skipped, unclassified, malformed, unlabelled, notOrchestratorWork, dependencyCycles, grandfatheredDependencies, dispatchable, emptyLanes, fullyAudited:!unclassified.length&&!malformed.length&&!unlabelled.length&&!dependencyCycles.length }
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
  if (!fence) return { ...claim, legacy: true, active: true, owner: null, branch: null, worktree: null, expiresAt: null }
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
  return { ...claim, legacy: false, owner: fields.get('owner'), branch: fields.get('branch'), worktree: fields.get('worktree'), expiresAt, active: expiresAt > now }
}

export function assertLaneAvailable(claims, proposedObjects, now = new Date(), { ignoreCapacity = false, prSources = [] } = {}) {
  const parsed = claims.map((claim) => {
    try { return { ...claim, lease: parseAuthorLease(claim.body, now) } }
    catch (error) { throw new LaneError(`claim #${claim.number} is unreadable: ${error.message}`) }
  })
  // Legacy claims consume capacity. An expiry never releases object protection;
  // cleanup must close the issue explicitly before another author can touch it.
  const occupied = parsed
  if (!ignoreCapacity && occupied.length >= MAX_AUTHOR_LANES) throw new LaneError(`all ${MAX_AUTHOR_LANES} migration-author lanes are occupied`)
  const wanted = new Set(proposedObjects.map(normalizeObject))
  for (const holder of [...parsed.map((c) => ({ label: `claim #${c.number}`, objects: c.lease.objects })), ...prSources]) {
    const overlap = (holder.objects ?? []).map(normalizeObject).filter((object) => wanted.has(object))
    if (overlap.length) throw new LaneError(`object collision with ${holder.label}: ${[...new Set(overlap)].join(', ')}`)
  }
  return { active: occupied, stale: parsed.filter((claim) => !claim.lease.legacy && !claim.lease.active) }
}

export function claimBody({ version, objects, writes, reads = [], owner, branch, worktree, expiresAt }) {
  // `objects` is the deprecated parameter name for `writes`. Accepting both keeps
  // every existing caller working through the compatibility window; Step 8A drops
  // the alias once no open claim uses it.
  const written = (writes ?? objects ?? []).map((o) => normalizeObject(o))
  const read = (reads ?? []).map((o) => normalizeObject(o)).filter((o) => !written.includes(o))
  const lines = ['```db-claim', `version: ${version}`, 'writes:', ...written.map((o) => `  - ${o}`)]
  // Emit `reads:` only when there is one. An always-present empty header would
  // make every legacy claim look edited in a diff.
  if (read.length) lines.push('reads:', ...read.map((o) => `  - ${o}`))
  lines.push('```', '', '```db-author-lease', `owner: ${owner}`, `branch: ${branch}`, `worktree: ${worktree}`, `expires_at: ${expiresAt.toISOString()}`, '```', '',
    'This claim remains authoritative and occupies a lane until explicitly released.',
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
  },
  readActiveReviewLeases(){
    const query='query($owner:String!,$name:String!){repository(owner:$owner,name:$name){defaultBranchRef{target{oid ... on Commit{tree{oid}}}} refs(refPrefix:"refs/db-review-active/",first:10){nodes{name target{oid ... on Commit{message}}}}}}'
    const data=ghJson(['api','graphql','-f',`query=${query}`,'-F','owner=u2giants','-F','name=shared-db'])
    if(data?.errors?.length)throw new LaneError('active reviewer lease snapshot returned GraphQL errors')
    const nodes=data?.data?.repository?.refs?.nodes
    const allowed=new Set([...ACTIVE_REVIEWERS,...OVERFLOW_REVIEWERS].map((row)=>row.name))
    if(!Array.isArray(nodes)||nodes.length>allowed.size||nodes.some((node)=>!node?.name||!allowed.has(node.name)||!node?.target?.oid||!node?.target?.message))throw new LaneError('active reviewer lease snapshot is unreadable')
    const base=data?.data?.repository?.defaultBranchRef?.target
    if(!base?.oid||!base?.tree?.oid)throw new LaneError('review commit base is unreadable')
    reviewCommitBase={head:base.oid,tree:base.tree.oid}
    return new Map(nodes.map((node)=>[`${REVIEW_ACTIVE_REF_PREFIX}/${node.name}`,{sha:node.target?.oid,commit:{message:node.target?.message}}]))
  },
  readReviewStates(leases){
    const unique=[...new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,lease])).values()]
    if(!unique.length)return new Map()
    const fields=unique.map((lease,index)=>`p${index}:pullRequest(number:${lease.pr}){state merged headRefOid comments(first:100){pageInfo{hasNextPage} nodes{body}} reviews(first:100){pageInfo{hasNextPage} nodes{body state commit{oid}}}} i${index}:issue(number:${lease.issue}){state comments(first:100){pageInfo{hasNextPage} nodes{body}}}`).join(' ')
    const data=ghJson(['api','graphql','-f',`query=query{repository(owner:"u2giants",name:"shared-db"){${fields}}}`])
    if(data?.errors?.length||!data?.data?.repository)throw new LaneError('batched reviewer PR/verdict evidence returned GraphQL errors')
    const result=new Map()
    unique.forEach((lease,index)=>{
      const pr=data.data.repository[`p${index}`],issue=data.data.repository[`i${index}`]
      if(!pr||!issue||!Array.isArray(pr.comments?.nodes)||!Array.isArray(pr.reviews?.nodes)||!Array.isArray(issue.comments?.nodes)||pr.comments?.pageInfo?.hasNextPage!==false||pr.reviews?.pageInfo?.hasNextPage!==false||issue.comments?.pageInfo?.hasNextPage!==false)throw new LaneError('batched reviewer PR/verdict evidence is incomplete or paginated')
      result.set(`${lease.issue}:${lease.pr}`,{issue:{state:String(issue.state).toLowerCase()},pr:{state:String(pr.state).toLowerCase(),head:{sha:pr.headRefOid}},evidence:[...issue.comments.nodes,...pr.comments.nodes,...pr.reviews.nodes.map((row)=>({...row,commit_id:row.commit?.oid}))]})
    })
    return result
  },
  readReviewRefs(refs){
    const fields=refs.map((ref,index)=>`r${index}:ref(qualifiedName:${JSON.stringify(ref)}){target{oid}}`).join(' ')
    const data=ghJson(['api','graphql','-f',`query=query{repository(owner:"u2giants",name:"shared-db"){${fields}}}`])
    if(data?.errors?.length||!data?.data?.repository)throw new LaneError('review ref readback returned GraphQL errors')
    return new Map(refs.map((ref,index)=>[ref,data.data.repository[`r${index}`]?.target?.oid??null]))
  },
  readReviewRecords(refs,prefix){
    const fields=refs.map((ref,index)=>`r${index}:ref(qualifiedName:${JSON.stringify(ref)}){target{oid ... on Commit{message}}}`).join(' ')
    const matching=prefix?` matches:refs(refPrefix:${JSON.stringify(prefix)},first:100){pageInfo{hasNextPage} nodes{prefix name target{oid ... on Commit{message}}}}`:''
    const data=ghJson(['api','graphql','-f',`query=query{repository(owner:"u2giants",name:"shared-db"){${fields}${matching}}}`])
    if(data?.errors?.length||!data?.data?.repository)throw new LaneError('review record preflight returned GraphQL errors')
    if(prefix&&data.data.repository.matches?.pageInfo?.hasNextPage!==false)throw new LaneError('review replacement records are paginated')
    const result=new Map(refs.map((ref,index)=>{const target=data.data.repository[`r${index}`]?.target;return [ref,target?.oid?{sha:target.oid,commit:{message:target.message}}:null]}))
    Object.defineProperty(result,'matching',{value:(data.data.repository.matches?.nodes??[]).map((node)=>({ref:`${node.prefix}${node.name}`,sha:node.target?.oid,commit:{message:node.target?.message}})),enumerable:false})
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
  },
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
  getPr(number) { return ghJson(['api', `repos/${REPO}/pulls/${number}`]) },
  getPrFiles(number) { return ghPaginated(`repos/${REPO}/pulls/${number}/files?per_page=100`) },
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
    if(!/^db-coordination (?:author-acquisition|preview|merge|production|claim-release|claim-split-recovery|claim-object-expansion|claim-reversion|claim-version-supersession|claim-lease-renewal|reviewer-assignment-lock|reviewer-replacement-lock|reviewer-failure(?:-replacement)?)\b/.test(message))throw new LaneError('refusing recovery: mutex owner commit is not a recognized coordination lock')
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
  const match=/^db-coordination reviewer-cursor sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})$/i.exec(message)??/^db-coordination reviewer-(?:failure-)?replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40}) /i.exec(message)
  if (!match) throw new LaneError('reviewer cursor does not point to a recognized assignment')
  return {sequence:Number(match[1]),reviewer:match[2],issue:Number(match[3]),pr:Number(match[4]),headSha:match[5]}
}

export function reviewActiveRef(reviewer){
  if(!REVIEWERS.some((row)=>row.name===reviewer))throw new LaneError(`unknown reviewer ${reviewer}`)
  return `${REVIEW_ACTIVE_REF_PREFIX}/${reviewer}`
}

export function parseReviewLease(commit){
  if(!commit)return null
  const message=commit.message??commit.commit?.message??''
  const match=/^db-coordination reviewer-lease generation=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40}) sequence=(\d+)$/i.exec(message)??/^db-coordination reviewer-cursor sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})$/i.exec(message)??/^db-coordination reviewer-(?:failure-)?replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40}) /i.exec(message)
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
function requireReviewWireCapacity(required){if(reviewWireBudget&&reviewWireBudget.count+required>REVIEW_OPERATION_REQUEST_LIMIT)throw new LaneError(`reviewer operation cannot fit ${required} remaining requests inside the ${REVIEW_OPERATION_REQUEST_LIMIT}-request budget; refused before mutex acquisition`)}
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

// A verdict exists for an exact head when an issue comment, a PR comment, or a
// PR review is tied to that head AND carries a decision. Extracted so the
// replacement guard and the busy-reviewer probe cannot drift apart: "this review
// is finished" has to mean the same thing in both places.
export function hasVerdictForHead(issue,pr,headSha,io){
  const evidence=[...(io.getIssueComments?.(Number(issue))??[]),...(io.getIssueComments?.(Number(pr))??[]),...(io.getPrReviews?.(Number(pr))??[])]
  return evidence.some((row)=>{
    const body=String(row.body??''), tied=row.commit_id===headSha||body.includes(headSha)
    return tied&&(/\b(?:APPROVE|REVISE|REQUEST_CHANGES)\b/i.test(body)||['APPROVED','CHANGES_REQUESTED'].includes(String(row.state??'').toUpperCase()))
  })
}

function assertReviewLeaseStillStale(row,states){
  if(!row)return
  const state=states?.get(`${row.assignment.issue}:${row.assignment.pr}`),evidence=state?.evidence??[]
  const verdict=evidence.some((entry)=>{const body=String(entry.body??''),tied=entry.commit_id===row.assignment.headSha||body.includes(row.assignment.headSha);return tied&&(/\b(?:APPROVE|REVISE|REQUEST_CHANGES)\b/i.test(body)||['APPROVED','CHANGES_REQUESTED'].includes(String(entry.state??'').toUpperCase()))})
  if(state?.pr?.state==='open'&&state?.pr?.head?.sha===row.assignment.headSha&&!verdict)throw new LaneError(`reviewer ${row.assignment.reviewer} lease became live after mutex acquisition`)
}

function isReviewAssignmentLive(assignment,states,io){
  const state=states?.get(`${assignment.issue}:${assignment.pr}`),pr=state?.pr??io.getPr(assignment.pr),evidence=state?.evidence
  const verdict=evidence?evidence.some((entry)=>{const body=String(entry.body??''),tied=entry.commit_id===assignment.headSha||body.includes(assignment.headSha);return tied&&(/\b(?:APPROVE|REVISE|REQUEST_CHANGES)\b/i.test(body)||['APPROVED','CHANGES_REQUESTED'].includes(String(entry.state??'').toUpperCase()))}):hasVerdictForHead(assignment.issue,assignment.pr,assignment.headSha,io)
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
// must never silently divert every review to the overflow provider, which is
// the one that costs real money per run.
export function findBusyReviewers(io){
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
  try{states=typeof io.readReviewStates==='function'?io.readReviewStates(records.map((row)=>row.assignment)):null}catch{return null}
  for(const {reviewer,ref,sha,assignment} of records){
    let prRow,evidence
    try{
      const state=states?.get(`${assignment.issue}:${assignment.pr}`)
      prRow=state?.pr??io.getPr(assignment.pr);evidence=state?.evidence
    }catch{return null}
    if(prRow?.state!=='open'||prRow?.head?.sha!==assignment.headSha){stale.push({ref,sha,assignment});continue}
    let verdict
    try{verdict=evidence?evidence.some((row)=>{const body=String(row.body??''),tied=row.commit_id===assignment.headSha||body.includes(assignment.headSha);return tied&&(/\b(?:APPROVE|REVISE|REQUEST_CHANGES)\b/i.test(body)||['APPROVED','CHANGES_REQUESTED'].includes(String(row.state??'').toUpperCase()))}):hasVerdictForHead(assignment.issue,assignment.pr,assignment.headSha,io)}catch{return null}
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
  const start=(sequence-1)%ACTIVE_REVIEWERS.length
  const ordered=Array.from({length:ACTIVE_REVIEWERS.length},(_,offset)=>ACTIVE_REVIEWERS[(start+offset)%ACTIVE_REVIEWERS.length])
  if(!busy)return ordered[0]
  return ordered.find((row)=>!busy.has(row.name))??OVERFLOW_REVIEWERS.find((row)=>!busy.has(row.name))??ordered[0]
}

function assignNextReviewerOperation({issue,pr,headSha},io){
  const headPattern=io?.requiresExactReviewHeadSha?/^[0-9a-f]{40}$/i:/^[0-9a-f]{7,40}$/i
  if(!Number.isInteger(Number(issue))||!Number.isInteger(Number(pr))||!headPattern.test(String(headSha??'')))throw new LaneError('review assignment requires issue, PR, and exact 40-character head SHA')
  io=reviewOperationIo(io)
  const request={issue:Number(issue),pr:Number(pr),headSha:String(headSha)}
  const preflightBusy=findBusyReviewers(io)
  if(!preflightBusy)throw new LaneError('active reviewer leases are unreadable; reviewer assignment refused before mutex acquisition')
  const ownerSha=io.makeOwnerCommit(`db-coordination reviewer-assignment-lock issue=${request.issue} pr=${request.pr} head=${request.headSha}`)
  requireReviewWireCapacity(13)
  acquireReviewMutex(ownerSha,io)
  try{
    const assignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}`
    const replacementBase=`${REVIEW_REPLACEMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}`
    const replacementRows=io.listRefs?.(replacementBase)??[]
    if(replacementRows.length){
      const replacements=replacementRows.map((row)=>{const parsed=parseReviewReplacement(row.commit??io.getCommit(row.sha));return {...parsed,failureSha:parsed.failureSha==='self'?row.sha:parsed.failureSha,replacementSha:row.sha}})
      for(const replacement of replacements){
        if(replacement.issue!==request.issue||replacement.pr!==request.pr||replacement.headSha!==request.headSha||!REVIEWERS.some((r)=>r.name===replacement.reviewer))throw new LaneError('durable reviewer replacement does not match the assignment request')
        requireReplacementEvidence(replacement,io)
      }
      const replacement=replacements.sort((a,b)=>b.sequence-a.sequence)[0], reviewer=REVIEWERS.find((r)=>r.name===replacement.reviewer)
      if(![...ACTIVE_REVIEWERS,...OVERFLOW_REVIEWERS].some((row)=>row.name===replacement.reviewer))throw new LaneError(`durable replacement sequence ${replacement.sequence} belongs to retired reviewer ${replacement.reviewer}; its active lease was not recreated. Record a new governed replacement for this exact head`)
      const replacementLeaseRef=reviewActiveRef(reviewer.name),liveReplacement=preflightBusy.leases.get(reviewer.name),staleReplacement=preflightBusy.stale.find((row)=>row.ref===replacementLeaseRef)
      if(liveReplacement&&liveReplacement.sha!==replacement.replacementSha&&!staleReplacement)throw new LaneError(`reviewer ${reviewer.name} has an unrelated live lease; assignment retry repair refused`)
      const failed=[...preflightBusy.leases.values()].find((row)=>row.lease.issue===request.issue&&row.lease.pr===request.pr&&row.lease.headSha===request.headSha&&row.lease.sequence===replacement.failedSequence)
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      const freshStates=io.readReviewStates?.([replacement,...(staleReplacement?[staleReplacement.assignment]:[])])
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
      return {...replacement,wrapper:reviewer.wrapper}
    }
    const priorSha=io.readRef(assignmentRef)
    if(priorSha){
      const prior=parseReviewCursor(io.getCommit(priorSha)),leaseRef=reviewActiveRef(prior.reviewer),preflightLease=preflightBusy.leases.get(prior.reviewer),stalePrior=preflightBusy.stale.find((row)=>row.ref===leaseRef&&row.sha===priorSha)
      if(preflightLease?.sha===priorSha&&preflightLease.lease.issue===prior.issue&&preflightLease.lease.pr===prior.pr&&preflightLease.lease.headSha===prior.headSha&&preflightLease.lease.sequence===prior.sequence&&!stalePrior)return {...prior,wrapper:REVIEWERS.find((r)=>r.name===prior.reviewer)?.wrapper}
      if(stalePrior){
        if(io.atomicReviewRefs){assertReviewLeaseStillStale(stalePrior,io.readReviewStates([stalePrior.assignment]));io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},{ref:leaseRef,expected:priorSha,sha:null}]);const after=io.readReviewRefs([MUTEX_REF,leaseRef]);if(after.get(MUTEX_REF)!==ownerSha||after.get(leaseRef)!==null)throw new LaneError('stale assignment lease release readback mismatch')}
        else if(io.readRef(leaseRef)===priorSha)releaseOwnedRef(leaseRef,priorSha,io)
      }
      const live=io.getPr(prior.pr)
      if(live?.state==='open'&&live?.head?.sha===prior.headSha&&!hasVerdictForHead(prior.issue,prior.pr,prior.headSha,io)){
        if(![...ACTIVE_REVIEWERS,...OVERFLOW_REVIEWERS].some((row)=>row.name===prior.reviewer))throw new LaneError(`durable assignment sequence ${prior.sequence} belongs to retired reviewer ${prior.reviewer}; its active lease was not recreated. Record a governed replacement for this exact head`)
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        if(!io.createRef(leaseRef,priorSha)&&readRefAfterWrite(leaseRef,priorSha,io)!==priorSha)throw new LaneError(`reviewer ${prior.reviewer} has a conflicting active lease`)
      }
      return {...prior,wrapper:REVIEWERS.find((r)=>r.name===prior.reviewer)?.wrapper}
    }
    const cursorSha=io.readRef(REVIEW_CURSOR_REF), current=parseReviewCursor(cursorSha?io.getCommit(cursorSha):null)
    if(current&&current.issue===request.issue&&current.pr===request.pr&&current.headSha===request.headSha){
      if(!io.createRef(assignmentRef,cursorSha)&&readRefAfterWrite(assignmentRef,cursorSha,io)!==cursorSha)throw new LaneError('review assignment record could not be proved; retry the same assignment')
      const live=io.getPr(current.pr)
      if(live?.state==='open'&&live?.head?.sha===current.headSha&&!hasVerdictForHead(current.issue,current.pr,current.headSha,io)){
        if([...ACTIVE_REVIEWERS,...OVERFLOW_REVIEWERS].some((row)=>row.name===current.reviewer)){
          const leaseRef=reviewActiveRef(current.reviewer),existing=io.readRef(leaseRef)
          if(existing!==cursorSha&&(!io.createRef(leaseRef,cursorSha)||readRefAfterWrite(leaseRef,cursorSha,io)!==cursorSha))throw new LaneError(`reviewer ${current.reviewer} has a conflicting active lease`)
        }
      }
      return {...current,wrapper:REVIEWERS.find((r)=>r.name===current.reviewer)?.wrapper}
    }
    const sequence=(current?.sequence??0)+1
    // Ordinary path: round-robin over the active roster. The overflow provider
    // is reached only when EVERY active reviewer is already holding live review
    // work here and the overflow provider itself is free. The rotation position
    // is derived from `sequence`, not from who was last assigned, so spending a
    // sequence on the overflow provider does not move anyone's turn.
    const busy=preflightBusy
    const start=(sequence-1)%ACTIVE_REVIEWERS.length
    const reviewer=Array.from({length:ACTIVE_REVIEWERS.length},(_,offset)=>ACTIVE_REVIEWERS[(start+offset)%ACTIVE_REVIEWERS.length]).find((row)=>!busy.has(row.name))??OVERFLOW_REVIEWERS.find((row)=>!busy.has(row.name))
    if(!reviewer)throw new LaneError('no reviewer is available')
    const assignmentSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=${sequence} reviewer=${reviewer.name} issue=${request.issue} pr=${request.pr} head=${request.headSha}`)
    const leaseRef=reviewActiveRef(reviewer.name)
    const leaseSha=assignmentSha
    const selectedStale=busy.stale.find((row)=>row.ref===leaseRef)
    let staleReleased=false,leaseCreated=false,cursorChanged=false,assignmentCreated=false
    try{
      if(io.atomicReviewRefs){
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        const freshStates=io.readReviewStates([{issue:request.issue,pr:request.pr,headSha:request.headSha},...(selectedStale?[selectedStale.assignment]:[])])
        const fresh=freshStates?.get(`${request.issue}:${request.pr}`)
        const freshVerdict=fresh?.evidence?.some((row)=>{const body=String(row.body??''),tied=row.commit_id===request.headSha||body.includes(request.headSha);return tied&&(/\b(?:APPROVE|REVISE|REQUEST_CHANGES)\b/i.test(body)||['APPROVED','CHANGES_REQUESTED'].includes(String(row.state??'').toUpperCase()))})
        if(fresh?.issue?.state!=='open'||fresh?.pr?.state!=='open'||fresh?.pr?.head?.sha!==request.headSha||freshVerdict)throw new LaneError('review assignment issue, PR head, or verdict changed after mutex acquisition')
        if(selectedStale){
          const revived=freshStates?.get(`${selectedStale.assignment.issue}:${selectedStale.assignment.pr}`), evidence=revived?.evidence??[]
          const verdict=evidence.some((row)=>{const body=String(row.body??''),tied=row.commit_id===selectedStale.assignment.headSha||body.includes(selectedStale.assignment.headSha);return tied&&(/\b(?:APPROVE|REVISE|REQUEST_CHANGES)\b/i.test(body)||['APPROVED','CHANGES_REQUESTED'].includes(String(row.state??'').toUpperCase()))})
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
  const approved=ACTIVE_REVIEWERS.find((row)=>row.name===reviewer)
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

function replaceFailedReviewerOperation({issue,pr,headSha,failedSequence,failureCode,failingCheck,confirmLocalDependencyUnfixable,confirmNoVerdict,confirmNoArtifact},io){
  io=reviewOperationIo(io)
  const request={issue:Number(issue),pr:Number(pr),headSha:String(headSha??''),failedSequence:Number(failedSequence)}
  if(!Number.isInteger(request.issue)||!Number.isInteger(request.pr)||!/^[0-9a-f]{40}$/i.test(request.headSha)||!Number.isInteger(request.failedSequence))throw new LaneError('reviewer replacement requires exact issue, PR, 40-character head SHA, and failed sequence')
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
  const preflightBusy=findBusyReviewers(io)
  if(!preflightBusy)throw new LaneError('active reviewer leases are unreadable; reviewer replacement refused before mutex acquisition')
  const assignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}`
  const failureRef=`${REVIEW_FAILURE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}-${request.failedSequence}`
  const replacementBase=`${REVIEW_REPLACEMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}`
  const replacementRef=`${replacementBase}-${request.failedSequence}`
  const fixedRecords=io.readReviewRecords?.([replacementRef,assignmentRef,REVIEW_CURSOR_REF],replacementBase)??null
  let ownerSha=null,mutexAcquired=false
  try{
    let priorReplacement=fixedRecords?(fixedRecords.get(replacementRef)?.sha??null):io.readRef(replacementRef)
    // The first implementation used one unsuffixed immutable ref. Preserve it
    // as the first link while allowing later links to be appended safely.
    if(!priorReplacement){
      const legacyRow=(fixedRecords?.matching??io.listRefs?.(replacementBase)??[]).find((row)=>row.ref===replacementBase)
      if(legacyRow){const parsed=parseReviewReplacement(io.getCommit(legacyRow.sha));if(parsed.failedSequence===request.failedSequence)priorReplacement=legacyRow.sha}
    }
    if(priorReplacement){
      const rawParsed=parseReviewReplacement(fixedRecords?.get(replacementRef)?.sha===priorReplacement?fixedRecords.get(replacementRef).commit:io.getCommit(priorReplacement)),parsed={...rawParsed,failureSha:rawParsed.failureSha==='self'?priorReplacement:rawParsed.failureSha}, reviewer=REVIEWERS.find((r)=>r.name===parsed.reviewer)
      if(parsed.issue!==request.issue||parsed.pr!==request.pr||parsed.headSha!==request.headSha||parsed.failedSequence!==request.failedSequence||!reviewer)throw new LaneError('durable reviewer replacement does not match this retry')
      requireReplacementEvidence(parsed,io)
      if(![...ACTIVE_REVIEWERS,...OVERFLOW_REVIEWERS].some((row)=>row.name===parsed.reviewer))throw new LaneError(`durable replacement sequence ${parsed.sequence} belongs to retired reviewer ${parsed.reviewer}; its active lease was not recreated. Record a new governed replacement for this exact head`)
      const failed=[...preflightBusy.leases.values()].find((row)=>row.lease.issue===request.issue&&row.lease.pr===request.pr&&row.lease.headSha===request.headSha&&row.lease.sequence===request.failedSequence)
      const replacementLeaseRef=reviewActiveRef(parsed.reviewer)
      const staleReplacement=preflightBusy.stale.find((row)=>row.ref===replacementLeaseRef)
      const liveReplacement=preflightBusy.leases.get(parsed.reviewer)
      if(liveReplacement&&liveReplacement.sha!==priorReplacement&&!staleReplacement)throw new LaneError(`reviewer ${parsed.reviewer} has an unrelated live lease; idempotent replacement repair refused`)
      ownerSha=io.makeOwnerCommit(`db-coordination reviewer-replacement-lock issue=${request.issue} pr=${request.pr} head=${request.headSha}`)
      requireReviewWireCapacity(10);acquireReviewMutex(ownerSha,io);mutexAcquired=true
      const freshStates=io.readReviewStates?.([parsed,...(staleReplacement?[staleReplacement.assignment]:[])])
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
      return {...parsed,wrapper:reviewer.wrapper,failureCode:String(failureCode),replacementSha:priorReplacement}
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
    const replacementRows=fixedRecords?.matching??io.listRefs?.(replacementBase)??[]
    const parsedReplacements=replacementRows.map((row)=>{const parsed=parseReviewReplacement(row.commit??io.getCommit(row.sha));return {...parsed,failureSha:parsed.failureSha==='self'?row.sha:parsed.failureSha}})
    for(const replacement of parsedReplacements)requireReplacementEvidence(replacement,io)
    const predecessors=parsedReplacements.filter((row)=>row.sequence===request.failedSequence)
    const original=request.failedSequence===initial.sequence?initial:predecessors.length===1?predecessors[0]:null
    if(!original||original.issue!==request.issue||original.pr!==request.pr||original.headSha!==request.headSha)throw new LaneError('durable reviewer assignment or replacement does not match the replacement request')
    const cursorSha=fixedRecords?.get(REVIEW_CURSOR_REF)?.sha??io.readRef(REVIEW_CURSOR_REF), cursor=parseReviewCursor(cursorSha?(fixedRecords?.get(REVIEW_CURSOR_REF)?.sha===cursorSha?fixedRecords.get(REVIEW_CURSOR_REF).commit:io.getCommit(cursorSha)):null)
    if(!cursor||cursor.sequence<request.failedSequence)throw new LaneError('reviewer cursor is behind the failed durable assignment')
    const preflightState=preflightBusy.states?.get(`${request.issue}:${request.pr}`)
    const issueRow=preflightState?.issue??io.getIssue(request.issue), prRow=preflightState?.pr??io.getPr(request.pr)
    if(issueRow?.state!=='open')throw new LaneError('review replacement requires the exact issue to remain open')
    if(prRow?.state!=='open')throw new LaneError('review replacement requires the exact open PR head')
    // The mirror of the lookup above: here the assignment WAS found under the
    // head that was named, but the pull request has since moved past it. Same
    // truth, said plainly, instead of a technicality.
    if(prRow?.head?.sha!==request.headSha)throw new LaneError(`review replacement requires the exact open PR head: sequence=${initial.sequence} reviewer=${initial.reviewer} IS recorded for issue #${request.issue} PR #${request.pr} under head ${request.headSha}, but the pull request has since moved to head ${String(prRow?.head?.sha??'unknown')}. Nothing is missing. A push replaced the code under review, so a replacement reviewer would be bound to a commit the failed reviewer never saw. Assign a reviewer to the new code instead: --assign-reviewer --issue ${request.issue} --pr ${request.pr} --head-sha ${String(prRow?.head?.sha??'<current head>')}`)
    const hasVerdict=preflightState?.evidence?preflightState.evidence.some((row)=>{const body=String(row.body??''),tied=row.commit_id===request.headSha||body.includes(request.headSha);return tied&&(/\b(?:APPROVE|REVISE|REQUEST_CHANGES)\b/i.test(body)||['APPROVED','CHANGES_REQUESTED'].includes(String(row.state??'').toUpperCase()))}):hasVerdictForHead(request.issue,request.pr,request.headSha,io)
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
      if(failedNames.has(candidate.name)||preflightBusy.has(candidate.name))continue
      sequence=candidateSequence;reviewer=candidate;break
    }
    // LAST RESORT, same overflow provider as the busy path. When every active
    // provider has already failed on this exact head the replacement used to
    // refuse outright, stranding the PR. Codex is offered one attempt before
    // that refusal -- but only if it has not itself already failed here, and it
    // still advances the cursor monotonically like any other replacement.
    if(!reviewer){
      const overflow=OVERFLOW_REVIEWERS.find((row)=>!failedNames.has(row.name)&&!preflightBusy.has(row.name))
      if(overflow){sequence=cursor.sequence+1+ACTIVE_REVIEWERS.length;reviewer=overflow}
    }
    if(!reviewer)throw new LaneError('no other reviewer is available; every active provider and the overflow provider have already failed on this exact head')
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
        const freshVerdict=fresh?.evidence?.some((row)=>{const body=String(row.body??''),tied=row.commit_id===request.headSha||body.includes(request.headSha);return tied&&(/\b(?:APPROVE|REVISE|REQUEST_CHANGES)\b/i.test(body)||['APPROVED','CHANGES_REQUESTED'].includes(String(row.state??'').toUpperCase()))})
        if(fresh?.issue?.state!=='open'||fresh?.pr?.state!=='open'||fresh?.pr?.head?.sha!==request.headSha||freshVerdict)throw new LaneError('review replacement issue, PR head, or verdict changed after mutex acquisition')
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
    if(claims.filter((claim)=>String(claim.number)===String(options.claim)).length!==1||claims.length>MAX_AUTHOR_LANES)throw new LaneError('active claim set or lane capacity is ambiguous')
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
    if(claims.filter((claim)=>String(claim.number)===String(options.claim)).length!==1||claims.length>MAX_AUTHOR_LANES)throw new LaneError('active claim set or lane capacity is ambiguous')
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
    if(thirdParty.length+2>MAX_AUTHOR_LANES)throw new LaneError('split recovery would exceed migration-author capacity')
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
    else if (a === '--reissue-merged-stranded-claim') out.reissueMergedClaim = true
    else if (a === '--reversion-active-claim' || a === '--supersede-active-claim-version') out.reversionClaim = true
    else if (a === '--confirm-stale') out.confirmStale = true
    else if (/^--acquire-(preview|preview-recovery|preview-rehearsal|merge|production)$/.test(a)) out.acquireExclusive = a.slice(10)
    else if (/^--release-(preview|preview-recovery|preview-rehearsal|merge|production)$/.test(a)) out.releaseExclusive = a.slice(10)
    else if (['--task','--owner','--branch','--worktree','--issue','--pr','--head-sha','--owner-sha','--expected-sha','--released-claim','--active-claim','--source-pr','--target-pr','--target-branch','--target-worktree','--claim-number','--failed-sequence','--failure-code','--failing-check','--old-version','--reviewer','--wrapper','--version-pr-map'].includes(a)) { out[a.slice(2).replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = next(i); i++ }
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
    if(o.recoverSplit){console.log(JSON.stringify(recoverSameOwnerSplit(o,now,io),null,2));return 0}
    if(o.expandClaim){console.log(JSON.stringify(expandActiveClaimFromPr({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.expandClaimFromIssue){console.log(JSON.stringify(expandActiveClaimFromIssue({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.renewClaim){console.log(JSON.stringify(renewExpiredClaim({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.reissueMergedClaim){console.log(JSON.stringify(reissueMergedStrandedClaim({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.reversionClaim){console.log(JSON.stringify(reversionActiveClaim({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.replaceFailedReviewer){console.log(JSON.stringify(replaceFailedReviewer(o,io),null,2));return 0}
    if(o.reviewerPreflight){console.log(JSON.stringify(reviewerExecutionPreflight(o,io),null,2));return 0}
    if(o.assignReviewer){console.log(JSON.stringify(assignNextReviewer({issue:o.issue,pr:o.pr,headSha:o.headSha},io),null,2));return 0}
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
      const result = buildDynamicQueues(issues, claims, now, io.openIssueNumbers(), dependencyStates)
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
      if (result.dispatchable.length) { console.error(`REFILL REQUIRED NOW: dispatch issue(s) ${result.dispatchable.map((n)=>`#${n}`).join(', ')}`); return 2 }
      if (result.unlabelled.length) console.error(`UNLABELLED ISSUES: add the \`${WORK_LABEL}\` label to ${result.unlabelled.map((n)=>`#${n}`).join(', ')} — an unlabelled issue is invisible to every label-filtered query`)
      if (result.emptyLanes && !result.fullyAudited) { console.error('EMPTY LANE NOT PROVEN: classify and label every open issue before claiming no eligible work exists'); return 2 }
      return result.malformed.length || result.unlabelled.length || result.dependencyCycles.length || result.notOrchestratorWork.some((item)=>item.needsReturnAddress) ? 2 : 0
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
      const malformed=[];let occupied=0,expired=0
      for(const claim of claims){try{const lease=parseAuthorLease(claim.body,now);occupied++;if(!lease.legacy&&!lease.active)expired++}catch(e){malformed.push(`#${claim.number}: ${e.message}`)}}
      console.log(`${occupied}/${MAX_AUTHOR_LANES} lanes occupied; ${expired} expired claim(s) remain locked.`)
      for(const problem of malformed)console.error(`MALFORMED ${problem}`)
      return malformed.length || occupied>MAX_AUTHOR_LANES ? 2 : 0
    }
    if (!o.claim) throw new LaneError('choose --claim, --audit, --queue-audit, --return-issue, --cleanup-stale, or an exclusive-lane command')
    for (const k of ['task','owner','branch','worktree']) if (!o[k]) throw new LaneError(`--${k} is required`)
    if (!o.objects.length) throw new LaneError('--objects must name every database object exactly')
    o.leaseHours ??= DEFAULT_LEASE_HOURS
    if (!Number.isFinite(o.leaseHours) || o.leaseHours <= 0 || o.leaseHours > 24) throw new LaneError('--lease-hours must be greater than 0 and no more than 24')
    console.log(JSON.stringify(acquireAuthorLane(o, now, io), null, 2)); return 0
  } catch (error) { console.error(`REFUSED: ${error.message}`); return 2 }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main(process.argv.slice(2))
