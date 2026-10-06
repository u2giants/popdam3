// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { reviewTargetIsRecordable } from './admission.mjs'
import { SERVICE_CLASSES, CHANGE_TYPES, evaluateAdmission, parseImpactBlock } from '../../orchestrator-flow/admission.mjs'
import { OUTCOME_STATES } from '../../orchestrator-flow/outcome-lifecycle.mjs'
import { conflicts } from '../../lib/hold-reason.mjs'
import { validateDependencyDeclaration, classifyDependencies, findDependencyCycles } from '../../lib/work-dependencies.mjs'
import { LaneError, parseAuthorLease, validateClaimObjects } from './claims.mjs'
import { REPO } from './constants.mjs'
import { githubIo } from '../../manage-migration-author-lanes.mjs'
import { parseDependencyDeclarations } from '../work-dependencies.mjs'
import { dependencyIssue } from '../work-dependencies.mjs'
import { createStageEvidenceVerifier } from '../work-stage-evidence.mjs'

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
// `reviewer_cannot_read_repository` (#2079) is the code for a reviewer that is
// structurally incapable of reading the code under review. It is terminal in the
// strongest sense -- no retry, no wrapper version and no better prompt gives an
// HTTP client a checkout -- and it exists so the recovery route this tool NAMES
// is one an operator can actually run, instead of forcing a misdescription as
// `wrapper_terminal_failure`.
// `reviewer_cannot_emit_governed_verdict` (#2831) is its sibling: the reviewer is
// healthy but its wrapper cannot end a review with the governed verdict line, so the
// slot can never be satisfied. Like the code above it asserts no fault; it exists so a
// slot already spent on such a reviewer can be redirected honestly.
// `review_target_superseded` is the one code that blames NOBODY: the PR head
// moved (or the PR closed) while a healthy reviewer was mid-review, and the
// runner refused with "review target is no longer the exact open PR head".
// It is release-only and inverts the release head guard -- it must PROVE the
// recorded head is no longer the open PR head -- and replacement refuses it,
// because redrawing at a dead head is pointless and would list the healthy
// provider as failed on that head. Never use a provider code for this case.
export const REVIEW_TARGET_SUPERSEDED = 'review_target_superseded'
export const SLOT_INDEPENDENCE_CONFLICT = 'slot_independence_conflict'
// `silent_worker_observed` (#3492) is terminal for release purposes: the worker
// went silent, the silence was proved and reclaimed with immutable evidence, and
// the slot must be freed so a replacement can be drawn. It stays out of the
// provider-fault family on purpose -- silence is not a provider outage -- but
// `--release-failed-reviewer` must accept it, or the recovery path dead-ends
// (release refuses the code, replace tells the operator to release first).
export const TERMINAL_FAILURE_CODES = Object.freeze(['insufficient_quota','provider_unavailable','local_dependency_unavailable','wrapper_terminal_failure','turn_limit_cancelled','reviewer_cannot_read_repository','reviewer_cannot_emit_governed_verdict',REVIEW_TARGET_SUPERSEDED,'silent_worker_observed'])
export function reviewTargetSuperseded(prRow,headSha,request={},io={}){if(reviewTargetIsRecordable(prRow,{pr:request.pr,issue:request.issue,headSha},io))return false;return Boolean(prRow?.state)&&(String(prRow.state).toLowerCase()!=='open'||(/^[0-9a-f]{40}$/i.test(String(prRow?.head?.sha??''))&&String(prRow.head.sha).toLowerCase()!==String(headSha).toLowerCase()))}

export const QUEUE_STATUSES = new Set(['ready','blocked','owner-decision'])
export const QUEUE_WORK_TYPES = new Set(['structural','curated-master-data','application-data','source-data','repo-maintenance','documentation','security-settings'])
// claim-first: canonical structural route (#3874); shared-db-orchestrator: legacy alias.
export const CLAIM_FIRST_ROUTES = new Set(['claim-first','shared-db-orchestrator'])
export const QUEUE_ROUTES = new Set(['claim-first','shared-db-orchestrator','self-service-additive','curated-master-data-governance','application-session','source-data-session','owner-only','repo-maintenance'])
export const ROUTES_BY_WORK_TYPE = Object.freeze({
  // self-service-additive (#3199 Phase B2): structural work confined by the
  // merge-time boundary classifier to additive changes in {crm,pim,dam}. It is
  // a ROUTE, never a work type: NON_STRUCTURAL_EXITS is untouched and shape
  // work stays structural.
  structural: new Set(['claim-first','shared-db-orchestrator','self-service-additive']),
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
  // REPO-SESSION. A security-settings change needs access the orchestrator does
  // not have. Owner ruling 2026-09-28 (#3675, "never ask a human to approve"):
  // it goes to a separately started AI session that obtains that access itself,
  // never back to Albert.
  'security-settings': 'repo-session',
})

// Exits that mean "this is not the orchestrator's work AND the orchestrator has
// nothing to do about it" - visible to an audit, never a worklist.
export const OUTSIDE_ORCHESTRATOR_EXITS = Object.freeze(['repo-session'])

// A REJECT exit must MOVE the task, never merely decline it. `return_to` is the
// forwarding address: the repository whose session owns the work. Rejecting
// without one closes the issue into silence, because the session that filed it
// has usually already ended and nobody reads the notification.
export const RETURN_ADDRESS_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
export const RETURNED_MARKER = 'RETURNED TO'

// A returned COPY carries its provenance in its BODY, never in its comments: it
// is a brand new issue, so it has no comments at all. The already-returned guard
// read comments only, so when `return_to` named THIS repository the copy landed
// back in this queue looking like a fresh reject, and returning it minted the
// next generation forever (issue #2836; #2619/#2620/#2621 -> #2692/#2691/#2690).
// The same loop is reachable across repositories whenever two repos address each
// other, so the guard is written against the COPY, not against the address.
// `LEGACY_RETURNED_COPY_PATTERN` recognises the copies already filed, which
// carry the provenance line but not the explicit marker.
export const RETURNED_COPY_MARKER = 'RETURNED COPY OF'
export const LEGACY_RETURNED_COPY_PATTERN = /^Returned from [A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+ by the shared-db orchestrator\./m

// Provenance is written at the HEAD of the copy and is only read there. A
// body-wide search would refuse a genuine first return whose own description
// quotes the sentence — inside a fenced example, say — and that error falls on
// the wrong side: it strands work nobody can forward (grok-4.6, low finding 1).
// The marker is line 1 (legacy) or line 2 (current) of every copy this function
// mints, so the window is deliberately tight.
export const RETURNED_COPY_HEADER_LINES = 3

// Returns the provenance line when `body` is a returned copy, else null.
export function returnedCopyProvenance(body = '') {
  const header = String(body ?? '').split(/\r?\n/).slice(0, RETURNED_COPY_HEADER_LINES)
  const marked = header.map((line)=>line.trim()).find((line)=>line.startsWith(RETURNED_COPY_MARKER))
  if (marked) return marked
  const legacy = LEGACY_RETURNED_COPY_PATTERN.exec(header.join('\n'))
  return legacy ? legacy[0] : null
}

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
  const dependencies = parseDependencyDeclarations(fields.get('depends_on') ?? '')
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
  if (returnTo !== null && workType === 'structural') throw new LaneError('structural db-work-scope must not carry a return_to address; use application_return_to')
  const serviceClass = fields.get('service_class') ?? (workType === 'structural' ? 'standard-application' : 'maintenance')
  if (!SERVICE_CLASSES.includes(serviceClass)) throw new LaneError(`db-work-scope service_class must be one of ${SERVICE_CLASSES.join(', ')}`)
  if (workType !== 'structural' && serviceClass !== 'maintenance') throw new LaneError(`${workType} work cannot self-promote to application service class`)
  const changeType = fields.get('change_type') ?? null
  if (changeType !== null && !CHANGE_TYPES.includes(changeType)) throw new LaneError(`db-work-scope change_type must be one of ${CHANGE_TYPES.join(', ')}`)
  const applicationReturnTo = fields.get('application_return_to') ?? null
  if (applicationReturnTo !== null && !RETURN_ADDRESS_PATTERN.test(applicationReturnTo)) throw new LaneError('db-work-scope application_return_to must be an owner/repo slug')
  if (applicationReturnTo !== null && workType !== 'structural') throw new LaneError('application_return_to is only valid for structural outcomes')
  const liveAssertion = fields.get('live_assertion') ?? null
  const generatedTypes = fields.get('generated_types') ?? null
  const outcomeStage = fields.get('outcome_stage') ?? 'entered'
  if (!OUTCOME_STATES.includes(outcomeStage)) throw new LaneError(`db-work-scope outcome_stage must be one of ${OUTCOME_STATES.join(', ')}`)
  // `objects` stays as an alias for `writes` so every existing caller keeps working
  // during the compatibility window. Step 8A removes it once the queue audit finds
  // zero open legacy claims.
  return { status, workType, route, priority, dependencies, returnTo, writes, reads, legacyObjects, objects: writes, serviceClass, changeType, applicationReturnTo, liveAssertion, generatedTypes, outcomeStage }
}

// orchestrator-alarm marks the no-progress alarm fallback issue (scripts/orchestrator-flow/no-progress-alarm.mjs); the queue audit excludes it too.
export const COORDINATION_LABELS = new Set(['db-claim','orchestrator-marker','orchestrator-alarm'])
export const WORK_LABEL = 'db-work'

// Two flat lists, compared as writes. Conservative on purpose: a caller that has
// lost the read/write distinction must not be handed a weaker answer.
export function overlaps(a, b) { return conflicts({ writes: a, reads: [] }, { writes: b, reads: [] }) }

export function downstreamBlockerCounts(dependencyEdges) {
  const dependents = new Map()
  for (const [issue, dependencies] of Object.entries(dependencyEdges)) {
    for (const declaration of dependencies) {
      const dependency = dependencyIssue(declaration)
      if (!dependents.has(dependency)) dependents.set(dependency, new Set())
      dependents.get(dependency).add(Number(issue))
    }
  }
  const count = (issue) => {
    const seen = new Set(), pending = [...(dependents.get(issue) ?? [])]
    while (pending.length) {
      const dependent = pending.pop()
      if (seen.has(dependent)) continue
      seen.add(dependent)
      pending.push(...(dependents.get(dependent) ?? []))
    }
    return seen.size
  }
  return new Map(Object.keys(dependencyEdges).map(Number).map((issue)=>[issue,count(issue)]))
}

export function queueOrder(a,b) {
  const serviceRank = { 'urgent-application': 0, 'standard-application': 1, maintenance: 2 }
  const stageRank = Object.fromEntries(OUTCOME_STATES.map((state,index)=>[state,index]))
  return serviceRank[a.serviceClass]-serviceRank[b.serviceClass]
    || (stageRank[b.outcomeStage]??0)-(stageRank[a.outcomeStage]??0)
    || b.blockedIssueCount-a.blockedIssueCount
    || a.createdAt-b.createdAt
    || a.issue-b.issue
}


/** Fetch current dependency facts without changing issues or dispatching work. */
export function readDependencyStates(declarations, io = githubIo) {
  const parsed = parseDependencyDeclarations(declarations ?? [])
  const explicit = new Set(parsed.filter(value => typeof value === 'object').map(dependencyIssue))
  const states = {}
  for (const number of new Set(parsed.map(dependencyIssue))) {
    let issue
    try { issue = io.getIssue(number) } catch (error) {
      const detail = String(error?.stderr ?? error?.message ?? error)
      states[number] = /HTTP 404|Not Found/i.test(detail) ? { exists: false } : { exists: true, unreadable: detail }
      continue
    }
    if (!issue || issue.pull_request || !['open', 'closed'].includes(issue.state)) {
      states[number] = { exists: true, unreadable: `#${number} is not a readable work issue` }; continue
    }
    const state = { exists: true, open: issue.state === 'open', closedAt: issue.closed_at ?? null, comments: [], repository: REPO }
    if (!state.open || explicit.has(number)) {
      try {
        state.comments = io.getIssueComments(number).map(comment => ({ ...comment, author: comment.user?.login ?? comment.author }))
      } catch (error) {
        states[number] = { exists: true, unreadable: `comments unreadable: ${String(error?.message ?? error)}` }; continue
      }
    }
    if (explicit.has(number)) state.verifyStageEvidence = createStageEvidenceVerifier({ ...io, parseScope: parseQueueScope }, REPO)
    states[number] = state
  }
  return states
}

export function buildDynamicQueues(issues, claims, now = new Date(), allOpenIssueNumbers = issues.map((issue)=>issue.number), dependencyStates = null, claimPullStates = new Map(), authoredOnMain = new Set(), outcomeStates = new Map()) {
  const openNumbers = new Set(allOpenIssueNumbers.map(Number))
  const skipped = [], unclassified = [], malformed = [], unlabelled = [], candidates = [], notOrchestratorWork = [], selfServiceLane = []
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
        // #3675: security-settings is AI-session work; a legacy owner-only
        // scope on it is re-scoped, not a debt owed by a human.
        blockedOnOwner: scope.route === 'owner-only' && scope.workType !== 'security-settings',
        returnTo: scope.returnTo,
        // A copy that was already returned here must never be asked for a
        // forwarding address or returned again (issue #2836).
        returnedCopyOf: returnedCopyProvenance(issue.body),
        needsReturnAddress: requiresReturnAddress(scope.workType) && !scope.returnTo && !returnedCopyProvenance(issue.body),
      })
    }
    if (scope.status !== 'ready') { skipped.push({ issue:issue.number, reason:`status:${scope.status}`, workType:scope.workType, route:scope.route }); continue }
    if (scope.workType === 'structural' && scope.route === 'self-service-additive') {
      // #3199 Phase B2: self-service lane work NEVER refills the orchestrator.
      // It is collected in its own bucket (printed as its own audit section)
      // because its authors claim, review and merge through the same guarded
      // machinery WITHOUT an orchestrator turn — refilling from here would
      // re-create exactly the traffic this route exists to remove.
      //
      // Round-2 review (Medium): the early `continue` used to skip dependency
      // registration and admission, so the audit went BLIND to exactly this
      // route's blockers -- an invalid depends_on never surfaced, a cycle
      // through a self-service issue was invisible, and an admission failure
      // (including the {crm,pim,dam} confinement) never reported as malformed.
      // The checks below are the same ones the orchestrator-routed path runs;
      // the only thing withheld is the refill itself (no candidates.push).
      dependencyEdges[issue.number] = scope.dependencies
      try {
        validateDependencyDeclaration(issue.number, scope.dependencies)
      } catch (error) {
        malformed.push({ issue: issue.number, reason: error.message })
        continue
      }
      if (dependencyStates) {
        const verdict = classifyDependencies(issue.number, scope.dependencies, dependencyStates)
        if (!verdict.satisfied) {
          for (const blocked of verdict.blocked) {
            skipped.push({ issue: issue.number, reason: `${blocked.status}:${blocked.number}`, detail: blocked.reason })
          }
          continue
        }
      } else {
        const waiting = scope.dependencies.filter((declaration)=>typeof declaration === 'object' || openNumbers.has(dependencyIssue(declaration))).map(dependencyIssue)
        if (waiting.length) { skipped.push({ issue:issue.number, reason:`depends-on-open:${waiting.join(',')}` }); continue }
      }
      try { evaluateAdmission(issue, scope, parseImpactBlock(issue.body)) }
      catch (error) { malformed.push({ issue: issue.number, reason: error.message }); continue }
      selfServiceLane.push({ issue:issue.number, title:issue.title, workType:scope.workType, route:scope.route })
      continue
    }
    if (scope.workType !== 'structural' || !CLAIM_FIRST_ROUTES.has(scope.route)) {
      skipped.push({ issue:issue.number, reason:'not-migration-author-work', workType:scope.workType, route:scope.route }); continue
    }
    // A closed author claim is the normal result of a merge. If its permanently
    // reserved version is on main, the issue may remain open for promotion, but
    // it must never be offered as fresh authoring again.
    if (authoredOnMain.has(issue.number)) {
      skipped.push({ issue:issue.number, reason:'authored-on-main', detail:"the closed claim's own reserved migration version was added by its merged pull request and remains on current main" })
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
      const waiting = scope.dependencies.filter((declaration)=>typeof declaration === 'object' || openNumbers.has(dependencyIssue(declaration))).map(dependencyIssue)
      if (waiting.length) { skipped.push({ issue:issue.number, reason:`depends-on-open:${waiting.join(',')}` }); continue }
    }
    const createdAt = Date.parse(issue.createdAt ?? issue.created_at ?? '')
    if(scope.changeType===null){skipped.push({issue:issue.number,reason:'missing-required-admission-fields'});continue}
    try { evaluateAdmission(issue, scope, parseImpactBlock(issue.body)) }
    catch (error) { malformed.push({ issue: issue.number, reason: error.message }); continue }
    const authoritativeOutcome=outcomeStates.get(Number(issue.number)) ?? 'entered'
    candidates.push({ issue:issue.number, title:issue.title, createdAt:Number.isFinite(createdAt)?createdAt:Number(issue.number), ...scope, outcomeStage:authoritativeOutcome })
  }
  const blockerCounts = downstreamBlockerCounts(dependencyEdges)
  for (const candidate of candidates) candidate.blockedIssueCount = blockerCounts.get(candidate.issue) ?? 0
  const protectedClaims = claims.map((claim)=>{
    const lease = parseAuthorLease(claim.body,now)
    return { claim:claim.number, issue:null, priority:Number.MAX_SAFE_INTEGER, writes:lease.writes, reads:lease.reads ?? [], objects:lease.writes, capacityActive:lease.capacityActive, leaseState:lease.capacityState, expiresAt:lease.expiresAt?.toISOString?.() ?? null, prState:claimPullStates.get(claim.number) ?? 'unknown' }
  })
  const components = [...protectedClaims, ...candidates].map((item)=>[item])
  for (let i=0;i<components.length;i++) for (let j=i+1;j<components.length;) {
    if (components[i].some((a)=>components[j].some((b)=>conflicts(a,b)))) components[i].push(...components.splice(j,1)[0]); else j++
  }
  // Uncapped: every collision component gets its own lane, numbered in order.
  const queues = []
  const componentRank = (component) => component.filter((item)=>item.issue).sort(queueOrder)[0]
  const ordered = components.sort((a,b)=>Number(Boolean(b.some(x=>x.claim)))-Number(Boolean(a.some(x=>x.claim))) || (componentRank(a)&&componentRank(b)?queueOrder(componentRank(a),componentRank(b)):0))
  for (const component of ordered) {
    const protectedItems = component.filter((x)=>x.claim)
    const activeItem = protectedItems.find((x)=>x.capacityActive)
    const lane = { lane:queues.length+1, active:null, activeLeaseState:null, activeExpiresAt:null, activePrState:null, protected:[], queued:[], objects:[], reads:[] }
    queues.push(lane)
    if (activeItem) {
      lane.active = activeItem.claim
      lane.activeLeaseState = activeItem.leaseState
      lane.activeExpiresAt = activeItem.expiresAt
      lane.activePrState = activeItem.prState
    }
    lane.protected.push(...protectedItems.map((item)=>item.claim))
    lane.queued.push(...component.filter((x)=>x.issue).sort(queueOrder).map((x)=>x.issue))
    lane.objects.push(...new Set(component.flatMap((x)=>x.writes ?? x.objects ?? [])))
    lane.reads.push(...new Set(component.flatMap((x)=>x.reads ?? [])))
  }
  const authorQueues = queues
  const emptyLanes = authorQueues.filter((q)=>!q.active).length
  const dispatchable = authorQueues.filter((q)=>!q.active && !q.protected.length && q.queued.length).map((q)=>q.queued[0])
  const urgentWaitingCapacity = candidates.filter((candidate)=>candidate.serviceClass==='urgent-application'&&!dispatchable.includes(candidate.issue)).filter((candidate)=>{
    const queue=authorQueues.find((row)=>row.queued.includes(candidate.issue));return Boolean(queue?.active)||Boolean(queue?.protected?.length)
  }).map((candidate)=>candidate.issue)
  const expiredClaims = authorQueues.filter((q)=>q.active && q.activeLeaseState === 'expired-unconfirmed').map((q)=>({ claim:q.active, lane:q.lane, expires_at:q.activeExpiresAt, pr_state:q.activePrState, queued:[...q.queued] }))
  // A CYCLE IS NEVER STARTABLE and is invisible to an open/closed test, so it is
  // reported as its own finding rather than as N tasks that merely look blocked.
  const dependencyCycles = findDependencyCycles(dependencyEdges)
  return { queues, expiredClaims, skipped, unclassified, malformed, unlabelled, notOrchestratorWork, selfServiceLane, dependencyCycles, grandfatheredDependencies, blockerCounts:Object.fromEntries(blockerCounts), dispatchable, urgentWaitingCapacity, emptyLanes, fullyAudited:!unclassified.length&&!malformed.length&&!unlabelled.length&&!dependencyCycles.length }
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
  // The copy's own provenance, read from the BODY. Without this a same-repo
  // return_to loops forever (issue #2836).
  const copyOf = returnedCopyProvenance(issue.body)
  if (copyOf) throw new LaneError(`issue #${number} is itself a returned copy (${copyOf}); returning it again would mint another generation`)

  const body = [
    `Returned from ${REPO}#${number} by the shared-db orchestrator.`,
    `${RETURNED_COPY_MARKER} https://github.com/${REPO}/issues/${number}`,
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
