import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { coordinationEvent, formatEventComment } from './db-coordination-events.mjs'
import { buildOrchestratorSnapshot, verifyOrchestratorSnapshot } from './orchestrator-flow/orchestrator-snapshot.mjs'
import { claimTitleIssues, fileEventStore, gatherLiveInput, gh, main, outcomeEventsFromComments, runSnapshotCycle, stalledOutcomes } from './orchestrator-snapshot.mjs'

const NOW = '2026-09-15T12:00:00.000Z'
const minutesAgo = (m) => new Date(Date.parse(NOW) - m * 60000).toISOString()
const ownerComment = (event) => ({ author_association: 'OWNER', body: formatEventComment(event) })
const event = (issue, state, minutes) => coordinationEvent({ eventType: state, workIssue: issue, actor: 'test', timestamp: minutesAgo(minutes) })

function fakeIo({ comments = {}, claims = [[900, 'CLAIM: #800 thing'], [901, 'CLAIM: issue-802-columns']], leases = [], locks = [] } = {}) {
  return {
    resolveMarker: () => ({ state: 'declared', marker: 2927, routing: { routeId: 'local_test', started: minutesAgo(600) } }),
    openIssues: () => [
      ...claims.map(([number, title]) => ({ number, title, labels: [{ name: 'db-claim' }] })),
      { number: 700, title: 'queued', labels: [{ name: 'db-work' }, { name: 'now' }] },
      { number: 701, title: 'pr', pull_request: {}, labels: [{ name: 'now' }] },
    ],
    openPullRequests: () => [{ number: 5, headRefOid: 'a'.repeat(40), statusCheckRollup: [{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }] }],
    matchingRefs: (_repo, prefix) => (prefix === 'db-coordination' ? locks : leases),
    issueComments: (_repo, issue) => comments[issue] ?? [],
  }
}

test('121-minute idle outcome appears in stalled_outcomes; 120 does not', () => {
  const events = [event(800, 'dispatched', 121), event(801, 'dispatched', 120)].map((e) => ({ ...e }))
  const result = stalledOutcomes(events, { now: NOW })
  assert.deepEqual(result.stalled_outcomes.map((row) => [row.work_issue, row.minutes_since_transition]), [[800, 121]])
  assert.equal(result.active_outcomes, 2)
})

test('zero closures in 4h flags only when outcomes are active; a closure clears it and closes the outcome', () => {
  assert.equal(stalledOutcomes([event(800, 'dispatched', 10)], { now: NOW }).zero_closures_4h, true)
  assert.equal(stalledOutcomes([], { now: NOW }).zero_closures_4h, false)
  const closed = stalledOutcomes([event(800, 'dispatched', 10), event(801, 'review_ready', 300), event(801, 'live_verified', 30)], { now: NOW, sessionStarted: minutesAgo(60) })
  assert.equal(closed.zero_closures_4h, false)
  assert.equal(closed.closures_in_window, 1)
  assert.equal(closed.closures_in_session, 1)
  assert.deepEqual(closed.stalled_outcomes, [])
})

test('only trusted, well-formed outcome events are read', () => {
  const events = outcomeEventsFromComments([
    ownerComment(event(800, 'dispatched', 5)),
    { author_association: 'NONE', body: formatEventComment(event(800, 'merged', 1)) },
    { author_association: 'OWNER', body: '```db-coordination-event\nnot json\n```' },
  ])
  assert.deepEqual(events.map((e) => e.event_type), ['dispatched'])
})

test('successor reconstructs the exact active map from the live snapshot and verifies it fresh', () => {
  const io = fakeIo({ comments: { 800: [ownerComment(event(800, 'dispatched', 30))] }, leases: [{ ref: 'refs/db-review-active-v2/x', object: { sha: 'b'.repeat(40) } }], locks: [{ ref: 'refs/db-coordination/merge', object: { sha: 'c'.repeat(40) } }, { ref: 'refs/db-coordination/reviewer-round-robin', object: { sha: 'd'.repeat(40) } }] })
  const { input } = gatherLiveInput('o/r', io)
  const { output } = runSnapshotCycle(input, { now: NOW })
  const successor = JSON.parse(JSON.stringify(output.snapshot))
  assert.deepEqual(successor.state.claims, [{ issue: 900, title: 'CLAIM: #800 thing', work_issues: [800] }, { issue: 901, title: 'CLAIM: issue-802-columns', work_issues: [802] }])
  assert.deepEqual(successor.state.stage_locks.filter((row) => row.held).map((row) => row.stage), ['merge'])
  assert.equal(successor.state.reviewer_leases.length, 1)
  assert.deepEqual(successor.state.eligible_queue, [{ issue: 700, labels: ['now'] }])
  assert.equal(successor.state.outcome_events.length, 1)
  assert.deepEqual(verifyOrchestratorSnapshot(successor, { readCurrent: () => gatherLiveInput('o/r', io).input, now: NOW }).status, 'CURRENT')
  assert.equal(buildOrchestratorSnapshot(gatherLiveInput('o/r', io).input).snapshot_id, successor.snapshot_id)
})

test('unchanged state produces zero output and no report; each transition wakes exactly once', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orch-snap-'))
  try {
    const comments = { 800: [ownerComment(event(800, 'dispatched', 100))] }
    const lines = []
    const run = (now) => main(['--orchestrator-snapshot', '--state-dir', dir, '--now', now], { io: fakeIo({ comments }), stdout: (line) => lines.push(JSON.parse(line)), stderr: (line) => lines.push(line) })
    assert.equal(run(NOW), 0)
    assert.equal(lines.length, 1)
    assert.deepEqual(lines[0].wakes.map((w) => w.wake), ['state_changed', 'zero_closures_4h'])
    assert.equal(lines[0].notification.event_type, 'orchestrator_snapshot_created')
    assert.equal(run(new Date(Date.parse(NOW) + 5 * 60000).toISOString()), 0)
    assert.equal(lines.length, 1, 'unchanged state must print nothing')
    const later = new Date(Date.parse(NOW) + 21 * 60000).toISOString()
    run(later)
    assert.equal(lines.length, 2)
    assert.deepEqual(lines[1].wakes, [{ wake: 'outcome_stalled', work_issue: 800 }])
    assert.equal(lines[1].stalled_outcomes[0].minutes_since_transition, 121)
    run(new Date(Date.parse(later) + 60000).toISOString())
    assert.equal(lines.length, 2, 'a still-stalled outcome does not wake again')
    comments[800].push(ownerComment(event(800, 'implementation_complete', -30)))
    run(new Date(Date.parse(later) + 2 * 60000).toISOString())
    assert.equal(lines.length, 3)
    assert.deepEqual(lines[2].wakes.map((w) => w.wake), ['state_changed'])
    assert.equal(lines[2].notification.event_type, 'orchestrator_state_changed')
    assert.equal(lines[2].notification.previous_snapshot_id, lines[0].snapshot.snapshot_id)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('file event store is create-only and converges on retries', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orch-store-'))
  try {
    const store = fileEventStore(dir)
    const record = { snapshot: { snapshot_id: 'x' }, notification: { event_id: 'e1' } }
    assert.equal(store.publish({ key: 'snapshot:e1', record }).status, 'created')
    assert.equal(store.publish({ key: 'snapshot:e1', record: { ...record, snapshot: { snapshot_id: 'y' } } }).status, 'existing')
    assert.equal(store.readPublished('snapshot:e1').snapshot.snapshot_id, 'x')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('GitHub reads go through the shared transport and refuse by name', () => {
  const failing = () => { const error = new Error('boom'); error.stderr = 'HTTP 404: Not Found'; throw error }
  assert.throws(() => gh(['api', 'repos/o/r'], { executor: failing, attempts: 1, reportStderr: () => {} }), (error) => error.name === 'Error' && /gh api repos\/o\/r failed: HTTP 404/.test(error.message))
  assert.equal(gh(['api', 'x'], { executor: () => '[]' }), '[]')
})

test('a closure exactly 240 minutes old is still in the window; 241 is not', () => {
  const at240 = stalledOutcomes([event(800, 'dispatched', 10), event(801, 'live_verified', 240)], { now: NOW })
  assert.equal(at240.closures_in_window, 1)
  assert.equal(at240.zero_closures_4h, false)
  const at241 = stalledOutcomes([event(800, 'dispatched', 10), event(801, 'live_verified', 241)], { now: NOW })
  assert.equal(at241.closures_in_window, 0)
  assert.equal(at241.zero_closures_4h, true)
})

test('duplicate terminal events with the same event_id count once', () => {
  const closure = event(801, 'live_verified', 30)
  const result = stalledOutcomes([event(800, 'dispatched', 10), closure, { ...closure }, event(802, 'live_verified', 20)], { now: NOW, sessionStarted: minutesAgo(60) })
  assert.equal(result.closures_in_window, 2)
  assert.equal(result.closures_in_session, 2)
})

test('claim title parsing ignores years, counts, dates and embedded hashes', () => {
  assert.deepEqual(claimTitleIssues('CLAIM: #800 fix 2026 rows (3 items) C#9 #12abc ref#77 #2026-09-15 tissue-5 issue-802-columns issue-3.1 &#39;'), [800, 802])
  assert.deepEqual(claimTitleIssues('no issues in 2026 or 4h'), [])
})

test('owned-issue comments are read in one bulk call, skipping issues listed with zero comments', () => {
  const comments = { 800: [ownerComment(event(800, 'dispatched', 30))] }
  const base = fakeIo({ comments })
  let single = 0
  const bulkCalls = []
  const io = {
    ...base,
    openIssues: () => base.openIssues().map((issue) => (issue.number === 901 ? { ...issue, comments: 0 } : issue)),
    issueComments: () => { single += 1; return [] },
    issueCommentsMany: (_repo, issues) => { bulkCalls.push(issues); return new Map(issues.map((n) => [n, comments[n] ?? []])) },
  }
  const { input } = gatherLiveInput('o/r', io)
  assert.equal(single, 0)
  assert.deepEqual(bulkCalls, [[800, 802, 900]])
  assert.deepEqual(input.outcome_events, gatherLiveInput('o/r', base).input.outcome_events)
})

test('events on a claim thread about an unowned issue are dropped', () => {
  const comments = { 900: [ownerComment(event(800, 'dispatched', 30)), ownerComment(event(555, 'dispatched', 30))] }
  const { input } = gatherLiveInput('o/r', fakeIo({ comments }))
  assert.deepEqual(input.outcome_events.map((e) => e.work_issue), [800])
})

test('store keys that sanitise alike never collide', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orch-store-'))
  try {
    const store = fileEventStore(dir)
    assert.equal(store.publish({ key: 'snapshot:a', record: { notification: { event_id: 'a' } } }).status, 'created')
    assert.equal(store.publish({ key: 'snapshot_a', record: { notification: { event_id: 'b' } } }).status, 'created')
    assert.equal(store.readPublished('snapshot_a').notification.event_id, 'b')
    assert.equal(readdirSync(path.join(dir, 'events')).length, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a corrupt last-report.json re-emits exactly once and is replaced atomically', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orch-corrupt-'))
  try {
    const lines = []
    const run = () => main(['--orchestrator-snapshot', '--state-dir', dir, '--now', NOW], { io: fakeIo(), stdout: (line) => lines.push(line), stderr: (line) => lines.push(line) })
    writeFileSync(path.join(dir, 'last-report.json'), '{not json')
    assert.equal(run(), 0)
    assert.equal(lines.length, 1)
    assert.doesNotThrow(() => JSON.parse(readFileSync(path.join(dir, 'last-report.json'), 'utf8')))
    assert.equal(readdirSync(dir).filter((name) => name.endsWith('.tmp')).length, 0)
    assert.equal(run(), 0)
    assert.equal(lines.length, 1, 'recovered state must not emit again')
    assert.ok(existsSync(path.join(dir, 'events')))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('refuses without the flag or a routable marker', () => {
  const errors = []
  assert.equal(main([], { io: fakeIo(), stdout: () => {}, stderr: (l) => errors.push(l) }), 2)
  assert.equal(main(['--orchestrator-snapshot'], { io: { ...fakeIo(), resolveMarker: () => ({ state: 'none', marker: null }) }, stdout: () => {}, stderr: (l) => errors.push(l) }), 2)
  assert.match(errors[1], /REFUSED: no open routable orchestrator marker/)
})
