#!/usr/bin/env node
/**
 * Read-only production caller for the orchestrator snapshot library (issue #2728,
 * programme popcre/ai-devops#401 Step 4).
 *
 *   node scripts/orchestrator-snapshot.mjs --orchestrator-snapshot [--repo owner/name]
 *        [--state-dir <absolute dir>] [--now <ISO>]
 *
 * It reads the live orchestrator marker, open claims, open PR heads and check
 * rollups, reviewer lease refs, exclusive stage lock refs, outcome events on the
 * owned issues, and the now/next eligible queue. It never writes to GitHub.
 *
 * Output is transition-only. Without --state-dir every run prints the report.
 * With --state-dir, the last report key is kept in that local directory and
 * snapshot events are written create-only beside it through the library's
 * compare-and-create publisher: an unchanged state prints NOTHING, and each
 * meaningful transition (snapshot change, an outcome newly stalled past 120
 * minutes, the zero-closures-in-4h alarm turning on) prints exactly once.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson } from './orchestrator-flow/evidence-bundle.mjs'
import { buildOrchestratorSnapshot, publishSnapshotTransition } from './orchestrator-flow/orchestrator-snapshot.mjs'
import { OUTCOME_STATES, trustedOutcomeComments } from './orchestrator-flow/outcome-lifecycle.mjs'
import { formatHoldReason } from './lib/hold-reason.mjs'
import { parseEventComment } from './db-coordination-events.mjs'
import { runGitHubCommand } from './lib/github-transport.mjs'
import { currentRepository } from './lib/repository-identity.mjs'
import { buildDynamicQueues, githubIo as laneIo, parseQueueScope } from './manage-migration-author-lanes.mjs'
import { findCompletionRecord } from './lib/work-dependencies.mjs'

export class SnapshotCallerError extends Error {}

export const STALL_MINUTES = 120
// Standard work must dispatch within one hour (ai-devops#401 target 2, issue #3126). The alarm runs
// every 30 minutes, so undispatched work alarms after 30 minutes and is reported before the hour ends.
export const DISPATCH_STALL_MINUTES = 30
export const UNDISPATCHED_STATES = Object.freeze(['entered', 'classified'])
export const ZERO_CLOSURE_WINDOW_MINUTES = 240
export const TERMINAL_OUTCOME_STATE = 'live_verified'
export const STAGE_LOCK_REFS = Object.freeze(['refs/db-coordination/preview', 'refs/db-coordination/merge', 'refs/db-coordination/production'])
export const REVIEWER_LEASE_PREFIX = 'db-review-active-v2'
export const QUEUE_LABELS = Object.freeze(['now', 'next'])
const MINUTE = 60000

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
/** Work issue numbers named in a claim title: only bounded #N or issue-N tokens, never bare numbers, years, dates or counts. */
export function claimTitleIssues(title) {
  const text = String(title ?? '')
  const numbers = [
    ...[...text.matchAll(/(?<![\w#&])#(\d{1,7})(?![\w-])/g)].map((match) => Number(match[1])),
    ...[...text.matchAll(/(?<![\w-])issue-(\d{1,7})(?![\d.])/gi)].map((match) => Number(match[1])),
  ]
  return [...new Set(numbers)].filter((n) => n > 0).sort((a, b) => a - b)
}

/** Atomically replace a file: write a sibling temp file, then rename over the target. */
export function writeFileAtomic(file, text) {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try { writeFileSync(temp, text, { flag: 'wx' }); renameSync(temp, file) } catch (error) { rmSync(temp, { force: true }); throw error }
}

const labelNames = (issue) => (issue?.labels ?? []).map((label) => (typeof label === 'string' ? label : label?.name)).filter(Boolean)

/** Outcome events from trusted operator comments (login plus owner-implied association, #2530); a malformed block is skipped, never fatal. */
export function outcomeEventsFromComments(comments = []) {
  const events = []
  for (const comment of trustedOutcomeComments(comments)) {
    let parsed = []
    try { parsed = parseEventComment(comment?.body ?? '') } catch { continue }
    for (const event of parsed) {
      if (!OUTCOME_STATES.includes(event.event_type) || event.result === 'refused') continue
      events.push({ event_id: event.event_id, event_type: event.event_type, work_issue: event.work_issue, timestamp: event.timestamp, ...(event.hold_reason ? { hold_reason: event.hold_reason } : {}) })
    }
  }
  return events
}

/**
 * Minutes since each owned outcome's last stage transition. An outcome whose
 * last transition is the terminal state is closed and never stalls.
 */
export function stalledOutcomes(outcomeEvents, { now, ownedIssues = null, stallMinutes = STALL_MINUTES, dispatchStallMinutes = DISPATCH_STALL_MINUTES, windowMinutes = ZERO_CLOSURE_WINDOW_MINUTES, sessionStarted = null } = {}) {
  const nowMs = Date.parse(now)
  if (Number.isNaN(nowMs)) throw new SnapshotCallerError('now must be an ISO instant')
  const last = new Map()
  for (const event of outcomeEvents) {
    const at = Date.parse(event.timestamp)
    if (Number.isNaN(at)) continue
    const prior = last.get(event.work_issue)
    if (!prior || at > prior.at || (at === prior.at && event.event_id > prior.event_id)) last.set(event.work_issue, { at, state: event.event_type, event_id: event.event_id, hold_reason: event.hold_reason ?? null })
  }
  const owned = ownedIssues ? new Set(ownedIssues.map(Number)) : null
  const outcomes = [...last.entries()]
    .filter(([issue, row]) => row.state !== TERMINAL_OUTCOME_STATE && (!owned || owned.has(issue)))
    .map(([issue, row]) => ({ work_issue: issue, state: row.state, last_transition_at: new Date(row.at).toISOString(), minutes_since_transition: Math.max(0, Math.floor((nowMs - row.at) / MINUTE)), ...(row.hold_reason ? { hold_reason: row.hold_reason, hold: formatHoldReason(row.hold_reason) } : {}) }))
    .sort((a, b) => b.minutes_since_transition - a.minutes_since_transition || a.work_issue - b.work_issue)
  const closureIds = new Set()
  const closures = outcomeEvents.filter((event) => {
    if (event.event_type !== TERMINAL_OUTCOME_STATE || closureIds.has(event.event_id)) return false
    closureIds.add(event.event_id)
    return true
  })
  const inWindow = closures.filter((event) => { const at = Date.parse(event.timestamp); return at <= nowMs && nowMs - at <= windowMinutes * MINUTE })
  const sessionMs = sessionStarted ? Date.parse(sessionStarted) : NaN
  return {
    stalled_outcomes: outcomes.filter((row) => row.minutes_since_transition > (UNDISPATCHED_STATES.includes(row.state) ? dispatchStallMinutes : stallMinutes)),
    active_outcomes: outcomes.length,
    closures_in_window: inWindow.length,
    closures_in_session: Number.isNaN(sessionMs) ? null : closures.filter((event) => Date.parse(event.timestamp) >= sessionMs).length,
    zero_closures_4h: outcomes.length > 0 && inWindow.length === 0,
  }
}

/**
 * Ready structural requests the ledger has never seen (issue #3148). The event alarm above only
 * sees issues with outcome events, so a request waiting for admission was invisible: #3036 sat
 * 11.4 hours and #2860 23.5 hours between creation and `entered`. Candidacy is decided by the
 * queue audit's own `buildDynamicQueues` (one scope parser, the dependency proof, the admission
 * gate), so the alarm never names a request the queue itself withholds. Claims are not passed:
 * admission does not wait for a busy collision lane. Without `dependencyStates` the audit falls
 * back to its open-issue test.
 */
export function readyRequestCandidates(issues = [], { dependencyStates = null } = {}) {
  const workIssues = issues.filter((issue) => !issue.pull_request && !labelNames(issue).includes('db-claim'))
  const openNumbers = issues.filter((issue) => !issue.pull_request).map((issue) => Number(issue.number))
  const queued = new Set(buildDynamicQueues(workIssues.map((issue) => ({ ...issue, labels: labelNames(issue) })), [], new Date(), openNumbers, dependencyStates).queues.flatMap((lane) => lane.queued))
  return workIssues.filter((issue) => queued.has(Number(issue.number))).map((issue) => ({ work_issue: Number(issue.number), created_at: issue.created_at ?? issue.createdAt }))
}

/** Dependency numbers referenced by any parseable scope, for the audit's dependency proof. */
export function referencedDependencies(issues = []) {
  const referenced = new Set()
  for (const issue of issues) {
    try { for (const number of parseQueueScope(issue.body)?.dependencies ?? []) referenced.add(Number(number)) } catch { /* malformed scopes are withheld by the audit */ }
  }
  return [...referenced].sort((a, b) => a - b)
}

/** Candidates with no outcome event, older than the dispatch threshold, as stalled rows in state `requested`. */
export function stalledRequests(unentered = [], { now, dispatchStallMinutes = DISPATCH_STALL_MINUTES } = {}) {
  const nowMs = Date.parse(now)
  if (Number.isNaN(nowMs)) throw new SnapshotCallerError('now must be an ISO instant')
  return unentered.flatMap((row) => {
    const at = Date.parse(row.created_at)
    if (Number.isNaN(at)) return []
    const minutes = Math.max(0, Math.floor((nowMs - at) / MINUTE))
    return minutes > dispatchStallMinutes ? [{ work_issue: row.work_issue, state: 'requested', last_transition_at: new Date(at).toISOString(), minutes_since_transition: minutes }] : []
  }).sort((a, b) => b.minutes_since_transition - a.minutes_since_transition || a.work_issue - b.work_issue)
}

/** The key that decides whether anything is worth reporting. Minute counters are excluded. */
export function reportKey(snapshot, alarms) {
  return sha256(canonicalJson({
    snapshot_id: snapshot.snapshot_id,
    stalled: alarms.stalled_outcomes.map((row) => row.work_issue).sort((a, b) => a - b),
    zero_closures_4h: alarms.zero_closures_4h,
  }))
}

/** Wake events for the transition from previous to current. Empty when nothing meaningful changed. */
export function transitionWakes(previous, current) {
  const wakes = []
  if (!previous || previous.snapshot_id !== current.snapshot_id) wakes.push({ wake: 'state_changed', snapshot_id: current.snapshot_id })
  const before = new Set(previous?.stalled ?? [])
  for (const issue of current.stalled) if (!before.has(issue)) wakes.push({ wake: 'outcome_stalled', work_issue: issue })
  if (current.zero_closures_4h && !previous?.zero_closures_4h) wakes.push({ wake: 'zero_closures_4h' })
  return wakes
}

/** A local create-only event store matching the library's compare-and-create contract. */
export function fileEventStore(dir) {
  const file = (key) => path.join(dir, 'events', `${sha256(String(key))}.json`)
  return {
    publish({ key, record }) {
      mkdirSync(path.join(dir, 'events'), { recursive: true })
      try { writeFileSync(file(key), canonicalJson(record), { flag: 'wx' }); return { status: 'created', event_id: record.notification.event_id } } catch (error) {
        if (error.code !== 'EEXIST') throw error
        return { status: 'existing', event_id: JSON.parse(readFileSync(file(key), 'utf8')).notification.event_id }
      }
    },
    readPublished(key) { try { return JSON.parse(readFileSync(file(key), 'utf8')) } catch { return null } },
  }
}

/**
 * One snapshot cycle. Returns { output, state } where output is null when the
 * state is unchanged. `previous` is the prior persisted state (or null).
 */
export function runSnapshotCycle(input, { now, previous = null, store = null, sessionStarted = null } = {}) {
  const ownedIssues = [...new Set([...(input.claims ?? []).flatMap((claim) => [claim.issue, ...(claim.work_issues ?? [])])])]
  const alarms = stalledOutcomes(input.outcome_events, { now, ownedIssues, sessionStarted })
  const snapshot = buildOrchestratorSnapshot(input, { capturedAt: now })
  const key = reportKey(snapshot, alarms)
  const current = { report_key: key, snapshot_id: snapshot.snapshot_id, stalled: alarms.stalled_outcomes.map((row) => row.work_issue).sort((a, b) => a - b), zero_closures_4h: alarms.zero_closures_4h, snapshot }
  if (previous && previous.report_key === key) return { output: null, state: previous }
  let notification = null
  if (store && (!previous || previous.snapshot_id !== snapshot.snapshot_id)) {
    notification = publishSnapshotTransition(input, { previousSnapshot: previous?.snapshot ?? null, capturedAt: now, publish: store.publish, readPublished: store.readPublished }).notification
  }
  const output = { snapshot, notification, wakes: transitionWakes(previous, current), ...alarms }
  return { output, state: current }
}

// ---------------------------------------------------------------- live reads

export function gh(args, options = {}) {
  return runGitHubCommand(args, { ...options, wrapError: (detail) => new SnapshotCallerError(`gh ${args[0]} ${args[1] ?? ''} failed: ${String(detail).split('\n')[0]}`) })
}
const ghPages = (endpoint) => JSON.parse(gh(['api', endpoint, '--paginate', '--slurp'])).flat()

export const defaultIo = {
  resolveMarker(repo) {
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-orchestrator-marker.mjs')
    const result = spawnSync(process.execPath, [script, '--resolve', '--repo', repo, '--json'], { encoding: 'utf8' })
    if (result.status !== 0) throw new SnapshotCallerError(`orchestrator marker did not resolve (exit ${result.status})`)
    return JSON.parse(result.stdout)
  },
  // The queue audit's own dependency proof, including merge-in-main evidence for closed dependencies.
  dependencyStates(numbers) {
    const states = laneIo.dependencyStates(numbers)
    for (const state of Object.values(states)) {
      if (state.open || state.unreadable || state.exists === false) continue
      let record = null
      try { record = findCompletionRecord(state.comments) } catch { continue }
      if (['merged', 'live_verified'].includes(record?.outcome)) state.mergeInMain = laneIo.mergeCommitInMain(record.merge_sha)
    }
    return states
  },
  openIssues: (repo) => ghPages(`repos/${repo}/issues?state=open&per_page=100`),
  openPullRequests: (repo) => JSON.parse(gh(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', 'number,headRefOid,statusCheckRollup'])),
  matchingRefs: (repo, prefix) => JSON.parse(gh(['api', `repos/${repo}/git/matching-refs/${prefix}`])),
  issueComments: (repo, issue) => ghPages(`repos/${repo}/issues/${issue}/comments?per_page=100`).map((c) => ({ ...c, author: c.user?.login })),
  // One GraphQL read for every owned issue's comments instead of one paginated
  // REST read per issue. An issue whose comments do not fit one page, or that
  // GraphQL cannot resolve, falls back to the REST reader so nothing is dropped
  // and an unresolvable issue still refuses exactly as before.
  issueCommentsMany(repo, issues) {
    const [owner, name] = repo.split('/')
    const result = new Map()
    for (let start = 0; start < issues.length; start += 25) {
      const chunk = issues.slice(start, start + 25)
      const fields = 'comments(first:100){pageInfo{hasNextPage} nodes{authorAssociation author{login} body}}'
      const query = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${chunk.map((n) => `i${Number(n)}:issueOrPullRequest(number:${Number(n)}){...on Issue{${fields}} ...on PullRequest{${fields}}}`).join(' ')}}}`
      let data = null
      try { data = JSON.parse(gh(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`]))?.data?.repository ?? null } catch { data = null }
      for (const n of chunk) {
        const connection = data?.[`i${Number(n)}`]?.comments
        if (!connection || connection.pageInfo?.hasNextPage || !Array.isArray(connection.nodes)) { result.set(n, defaultIo.issueComments(repo, n)); continue }
        result.set(n, connection.nodes.map((node) => ({ author_association: node.authorAssociation, author: node.author?.login, body: node.body })))
      }
    }
    return result
  },
}

function checkSummary(rollup = []) {
  const counts = {}
  for (const check of rollup) {
    const state = String(check.conclusion || check.state || check.status || 'UNKNOWN').toUpperCase()
    counts[state] = (counts[state] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

// Exit 3 from the marker resolver, or a resolved marker with no route, means no orchestrator is running.
export const NO_ORCHESTRATOR = /marker did not resolve \(exit 3\)|no open routable orchestrator marker/

// allowNoMarker: the no-progress alarm must still evaluate stalls with no orchestrator, so it gets
// marker: null. Every other caller keeps refusing, and any other read failure still throws.
export function gatherLiveInput(repo, io = defaultIo, { allowNoMarker = false } = {}) {
  let resolved = null
  try {
    resolved = io.resolveMarker(repo)
    if (!Number.isInteger(resolved?.marker) || !resolved?.routing?.routeId) throw new SnapshotCallerError('no open routable orchestrator marker')
  } catch (error) {
    if (!allowNoMarker || !NO_ORCHESTRATOR.test(String(error?.message))) throw error
    resolved = null
  }
  const issues = io.openIssues(repo).filter((issue) => !issue.pull_request)
  const claims = issues.filter((issue) => labelNames(issue).includes('db-claim')).map((issue) => ({
    issue: issue.number,
    title: issue.title,
    work_issues: claimTitleIssues(issue.title),
  }))
  const ownedIssues = [...new Set(claims.flatMap((claim) => [claim.issue, ...claim.work_issues]))].sort((a, b) => a - b)
  const owned = new Set(ownedIssues)
  // An owned issue already listed with zero comments has no events to read.
  const listedCommentCount = new Map(issues.map((issue) => [issue.number, issue.comments]))
  const toRead = ownedIssues.filter((issue) => listedCommentCount.get(issue) !== 0)
  const commentsByIssue = io.issueCommentsMany ? io.issueCommentsMany(repo, toRead) : new Map(toRead.map((issue) => [issue, io.issueComments(repo, issue)]))
  const outcomeEvents = ownedIssues.flatMap((issue) => outcomeEventsFromComments(commentsByIssue.get(issue) ?? []).filter((event) => owned.has(event.work_issue) && (event.work_issue === issue || claims.some((claim) => claim.issue === issue))))
  const references = referencedDependencies(issues)
  const dependencyStates = references.length && io.dependencyStates ? io.dependencyStates(references) : null
  const candidates = readyRequestCandidates(issues, { dependencyStates }).filter((row) => !owned.has(row.work_issue))
  const candidateComments = candidates.length ? (io.issueCommentsMany ? io.issueCommentsMany(repo, candidates.map((row) => row.work_issue)) : new Map(candidates.map((row) => [row.work_issue, io.issueComments(repo, row.work_issue)]))) : new Map()
  const candidateEvents = new Map(candidates.map((row) => [row.work_issue, outcomeEventsFromComments(candidateComments.get(row.work_issue) ?? []).filter((event) => event.work_issue === row.work_issue)]))
  const unentered = candidates.filter((row) => candidateEvents.get(row.work_issue).length === 0)
  // Entered but no owning claim yet (#3158): neither the owned-event alarm nor the unentered alarm sees these.
  const unclaimedEvents = candidates.flatMap((row) => candidateEvents.get(row.work_issue))
  const leaseRefs = io.matchingRefs(repo, REVIEWER_LEASE_PREFIX)
  const stageRefs = io.matchingRefs(repo, 'db-coordination').filter((ref) => STAGE_LOCK_REFS.includes(ref.ref))
  return {
    input: {
      marker: resolved ? { issue: resolved.marker, status: 'active', route_id: resolved.routing.routeId } : null,
      claims,
      pull_requests: io.openPullRequests(repo).map((pr) => ({ number: pr.number, head: pr.headRefOid, checks: checkSummary(pr.statusCheckRollup) })),
      reviewer_leases: leaseRefs.map((ref) => ({ ref: ref.ref, sha: ref.object?.sha })),
      stage_locks: STAGE_LOCK_REFS.map((ref) => ({ stage: ref.split('/').pop(), held: stageRefs.some((row) => row.ref === ref), sha: stageRefs.find((row) => row.ref === ref)?.object?.sha ?? null })),
      outcome_events: outcomeEvents,
      eligible_queue: issues.filter((issue) => labelNames(issue).some((name) => QUEUE_LABELS.includes(name))).map((issue) => ({ issue: issue.number, labels: labelNames(issue).filter((name) => QUEUE_LABELS.includes(name)).sort() })),
    },
    sessionStarted: resolved?.routing?.started ?? null,
    // Kept out of `input` so the sealed snapshot digest is unchanged.
    unentered,
    unclaimedEvents,
  }
}

export function main(argv = process.argv.slice(2), { io = defaultIo, stdout = console.log, stderr = console.error } = {}) {
  try {
    const value = (name) => { const index = argv.indexOf(name); return index >= 0 && argv[index + 1] ? argv[index + 1] : null }
    if (!argv.includes('--orchestrator-snapshot')) throw new SnapshotCallerError('--orchestrator-snapshot is required')
    const repo = currentRepository(value('--repo'))
    const now = value('--now') ?? new Date().toISOString()
    const stateDir = value('--state-dir')
    if (stateDir && !path.isAbsolute(stateDir)) throw new SnapshotCallerError('--state-dir must be an absolute path')
    const { input, sessionStarted } = gatherLiveInput(repo, io)
    const stateFile = stateDir ? path.join(stateDir, 'last-report.json') : null
    let previous = null
    if (stateFile) { try { previous = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { previous = null } }
    const { output, state } = runSnapshotCycle(input, { now, previous, store: stateDir ? fileEventStore(stateDir) : null, sessionStarted })
    if (output) stdout(JSON.stringify(output, null, 2))
    if (stateFile && output) { mkdirSync(stateDir, { recursive: true }); writeFileAtomic(stateFile, canonicalJson(state)) }
    return 0
  } catch (error) { stderr(`REFUSED: ${error.message}`); return 2 }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main()
