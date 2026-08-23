// End-to-end coordination scenarios (Step 5, issue #1366).
//
// WHY A TABLE AND NOT MORE UNIT TESTS
// -----------------------------------
// Every layer of this system is unit-tested in isolation, and every one of them
// passed while the system as a whole still had the holes this plan exists to
// close. What was missing is a place where a WHOLE SITUATION is written down —
// "two agents want the same table, one reads and one writes" — with an expected
// accept-or-refuse decision and the reason.
//
// These are regression tests for judgement, not for functions. When a future
// change makes one of these scenarios flip, that is the alarm.
//
// Each row states: the situation, what must happen, and WHY. A row whose `why` is
// missing is not a scenario, it is a snapshot.

import test from 'node:test'
import assert from 'node:assert/strict'
import { conflicts, parseQueueScope, buildDynamicQueues } from './manage-migration-author-lanes.mjs'
import { classifyDependency } from './lib/work-dependencies.mjs'
import { contractHash, reconcileReportWithContract, validateContract } from './agent-work-contract.mjs'
import { auditTimeline } from './db-coordination-events.mjs'

const NOW = new Date('2026-08-23T12:00:00Z')
const scope = (body) => ['```db-work-scope', 'status: ready', 'work_type: structural', 'route: shared-db-orchestrator', 'priority: 5', 'depends_on:', body, '```'].join('\n')

// --- CONFLICT SCENARIOS ----------------------------------------------------

const CONFLICT_SCENARIOS = [
  {
    name: 'two agents READ the same table',
    a: { writes: ['table core.a'], reads: ['table core.shared'] },
    b: { writes: ['table core.b'], reads: ['table core.shared'] },
    expect: false,
    why: 'Reading is not mutating. Serialising readers was the cost the flat objects list imposed for no safety gain.',
  },
  {
    name: 'one agent WRITES what another READS',
    a: { writes: ['table core.shared'], reads: [] },
    b: { writes: [], reads: ['table core.shared'] },
    expect: true,
    why: 'The reader would see the table change underneath it. This is the silent corruption the lanes exist to prevent.',
  },
  {
    name: 'the same pair, compared the other way round',
    a: { writes: [], reads: ['table core.shared'] },
    b: { writes: ['table core.shared'], reads: [] },
    expect: true,
    why: 'A one-sided check would let a writer start whenever the reader happened to be evaluated first.',
  },
  {
    name: 'two agents WRITE the same table',
    a: { writes: ['table core.shared'], reads: [] },
    b: { writes: ['table core.shared'], reads: [] },
    expect: true,
    why: 'Competing writers is the original failure: both pass every check, both merge, one silently erases the other.',
  },
  {
    name: 'entirely unrelated work',
    a: { writes: ['table core.a'], reads: ['table core.c'] },
    b: { writes: ['table core.b'], reads: ['table core.d'] },
    expect: false,
    why: 'Independent work must stay parallel, or the whole queue degenerates into a single lane.',
  },
  {
    name: 'a legacy objects-only claim against a reader',
    a: { writes: ['table core.shared'], reads: [] },
    b: { writes: [], reads: ['table core.shared'] },
    expect: true,
    why: 'A legacy claim is interpreted as a write. Treating it as a read would let a writer start against work already in flight.',
  },
]

for (const row of CONFLICT_SCENARIOS) {
  test(`conflict: ${row.name}`, () => {
    assert.equal(conflicts(row.a, row.b), row.expect, row.why)
  })
}

// --- DEPENDENCY SCENARIOS --------------------------------------------------

const DEPENDENCY_SCENARIOS = [
  {
    name: 'prerequisite still open',
    state: { exists: true, open: true },
    satisfied: false,
    why: 'The ordinary waiting case, and the only one the old rule handled correctly.',
  },
  {
    name: 'prerequisite closed with no completion record, after the cutoff',
    state: { exists: true, open: false, closedAt: '2026-09-01T00:00:00Z', comments: [] },
    satisfied: false,
    why: 'Closure is not success. This exact case used to release downstream work.',
  },
  {
    name: 'prerequisite closed before completion records existed',
    state: { exists: true, open: false, closedAt: '2026-08-01T00:00:00Z', comments: [] },
    satisfied: true,
    why: 'It could not have carried a record. Blocking it would stall live work to enforce a rule it could not follow; it is reported as grandfathered so it stays countable.',
  },
  {
    name: 'prerequisite cancelled',
    state: { exists: true, open: false, comments: [completion({ outcome: 'cancelled', reason: 'approach abandoned' })] },
    satisfied: false,
    why: 'A cancelled prerequisite means the thing downstream work depends on was never built.',
  },
  {
    name: 'prerequisite returned to another repository',
    state: { exists: true, open: false, comments: [completion({ outcome: 'returned', reason: 'belongs to popdam3' })] },
    satisfied: false,
    why: 'Returned work left this queue unfinished. Somebody else may do it later, or never.',
  },
  {
    name: 'prerequisite merged, and the commit is in main',
    state: { exists: true, open: false, comments: [completion({ outcome: 'merged', pr: 1, merge_sha: 'abc1234', migration_versions: [] })], mergeInMain: true },
    satisfied: true,
    why: 'The one unambiguous success: a typed record whose evidence re-derives against main.',
  },
  {
    name: 'prerequisite claims a merge that is not in main',
    state: { exists: true, open: false, comments: [completion({ outcome: 'merged', pr: 1, merge_sha: 'abc1234', migration_versions: [] })], mergeInMain: false },
    satisfied: false,
    why: 'A record is a claim. When main disagrees with it, main wins.',
  },
  {
    name: 'prerequisite number never existed',
    state: { exists: false },
    satisfied: false,
    why: 'A typo used to release work instantly, because a nonexistent issue is certainly not open.',
  },
  {
    name: 'prerequisite unreadable',
    state: { exists: true, unreadable: 'HTTP 500' },
    satisfied: false,
    why: 'Could-not-check is not the same as nothing-to-check, and must never be treated as clean.',
  },
]

function completion(over) {
  const record = { schema_version: 1, work_issue: 10, ...over }
  return { body: '```db-work-completion\n' + JSON.stringify(record) + '\n```' }
}

for (const row of DEPENDENCY_SCENARIOS) {
  test(`dependency: ${row.name}`, () => {
    assert.equal(classifyDependency(10, row.state).satisfied, row.satisfied, row.why)
  })
}

test('dependency: a cycle can never start', () => {
  const cyclic = buildDynamicQueues([
    { number: 20, title: 'a', body: ['```db-work-scope', 'status: ready', 'work_type: structural', 'route: shared-db-orchestrator', 'priority: 5', 'depends_on: #21', 'writes:', '  - table core.a', '```'].join('\n') },
    { number: 21, title: 'b', body: ['```db-work-scope', 'status: ready', 'work_type: structural', 'route: shared-db-orchestrator', 'priority: 5', 'depends_on: #20', 'writes:', '  - table core.b', '```'].join('\n') },
  ], [], NOW, [20, 21], {})
  assert.equal(cyclic.dependencyCycles.length, 1, 'neither task is startable, and no open/closed test can see that')
  assert.equal(cyclic.fullyAudited, false)
})

// --- CONTRACT SCENARIOS ----------------------------------------------------

const baseContract = validateContract({
  schema_version: 1, work_issue: 42, work_type: 'structural', route: 'shared-db-orchestrator',
  goal: 'add one table', base_sha: 'abc1234', dispatcher: 'orchestrator', worker: 'codex',
  branch: 'codex/42', worktree: '.claude/worktrees/42',
  allowed_paths: ['supabase/migrations/**'], file_writes: ['supabase/migrations/20260823120000_a.sql'],
  db_reads: [], db_writes: ['table plm.a'],
  prohibited_actions: ['no production'], required_checks: ['node --test scripts/*.test.mjs'],
  assumptions: [], stop_conditions: ['stop if a second table is needed'],
})

const baseReport = {
  schema_version: 1, work_issue: 42, outcome: 'merged', pr: 7, merge_sha: 'def5678',
  migration_versions: ['20260823120000'],
  contract_ref: 'refs/db-contracts/42/1', contract_sha256: contractHash(baseContract),
  head_sha: 'aaa1111', files_changed: ['supabase/migrations/20260823120000_a.sql'],
  db_reads: [], db_writes: ['table plm.a'],
  checks: [{ command: 'node --test scripts/*.test.mjs', exit_code: 0, evidence: 'all pass' }],
  assumptions_resolved: [], stop_conditions_hit: [],
}

const CONTRACT_SCENARIOS = [
  {
    name: 'the worker did exactly what it was authorised to do',
    report: baseReport,
    satisfied: true,
    why: 'The ordinary success case must stay cheap, or the guard gets disabled.',
  },
  {
    name: 'the worker edited a file outside its allowed paths',
    report: { ...baseReport, files_changed: [...baseReport.files_changed, 'scripts/unrelated.mjs'] },
    satisfied: false,
    why: 'Whatever the outcome says, that is not the job it was authorised to do.',
  },
  {
    name: 'the worker widened its database writes',
    report: { ...baseReport, db_writes: ['table plm.a', 'table core.licensor'] },
    satisfied: false,
    why: 'Writing an undeclared object defeats the claim system upstream of the contract.',
  },
  {
    name: 'the contract was edited after the fact to match what was built',
    contract: { ...baseContract, goal: 'add one table, and whatever else came up' },
    report: baseReport,
    satisfied: false,
    why: 'The hash is the whole defence against retrofitting authority.',
  },
  {
    name: 'a required check never ran',
    report: { ...baseReport, checks: [] },
    satisfied: false,
    why: 'An unproven claim of success is exactly what this layer replaces.',
  },
  {
    name: 'a required check ran and failed, but the work was reported merged',
    report: { ...baseReport, checks: [{ command: 'node --test scripts/*.test.mjs', exit_code: 1, evidence: '2 failing' }] },
    satisfied: false,
    why: 'Red tests plus a green report is the most dangerous combination available.',
  },
  {
    name: 'a stop condition fired but the work claims success anyway',
    report: { ...baseReport, stop_conditions_hit: ['a second table was needed'] },
    satisfied: false,
    why: 'Stop means stop. Reporting done anyway is the failure the contract exists to catch.',
  },
  {
    name: 'a stop condition fired and the report says so honestly',
    report: { ...baseReport, outcome: 'returned', reason: 'scope grew', pr: undefined, merge_sha: undefined, migration_versions: undefined, stop_conditions_hit: ['a second table was needed'] },
    satisfied: true,
    why: 'Stopping correctly must be a first-class, blameless outcome, or nobody will ever do it.',
  },
]

for (const row of CONTRACT_SCENARIOS) {
  test(`contract: ${row.name}`, () => {
    const verdict = reconcileReportWithContract(row.report, row.contract ?? baseContract)
    assert.equal(verdict.satisfied, row.satisfied, `${row.why}\nproblems: ${verdict.problems.join('; ')}`)
  })
}

// --- TIMELINE SCENARIOS ----------------------------------------------------

const at = (m) => new Date(Date.UTC(2026, 7, 23, 12, m)).toISOString()
const ev = (type, minute, over = {}) => ({
  schema_version: 1, event_id: `${type}-${minute}`, event_type: type, timestamp: at(minute),
  work_issue: 42, actor: 'orchestrator', result: 'succeeded', ...over,
})

const TIMELINE_SCENARIOS = [
  {
    name: 'a complete, tidy piece of work',
    events: [ev('dispatched', 0), ev('claim_acquired', 1), ev('merge_acquired', 2), ev('merge_released', 3), ev('claim_released', 4), ev('work_completed', 5)],
    valid: true,
    why: 'A reviewer must be able to read the normal case without wading through warnings.',
  },
  {
    name: 'a lane left held after the work finished',
    events: [ev('preview_acquired', 1), ev('work_completed', 2)],
    valid: false,
    why: 'A leaked stage blocks every other session until a human notices.',
  },
  {
    name: 'a refused acquisition followed by clean completion',
    events: [ev('merge_acquired', 1, { result: 'refused', detail: 'held by #99' }), ev('work_completed', 2)],
    valid: true,
    why: 'Recording refusals is only safe if a refusal can never be mistaken for ownership.',
  },
  {
    name: 'work continuing after it was cancelled',
    events: [ev('work_cancelled', 1), ev('production_acquired', 2)],
    valid: false,
    why: 'Cancelled work that keeps touching production is the worst thing this trace could fail to show.',
  },
]

for (const row of TIMELINE_SCENARIOS) {
  test(`timeline: ${row.name}`, () => {
    const audit = auditTimeline(row.events)
    assert.equal(audit.valid, row.valid, `${row.why}\nproblems: ${audit.problems.join('; ')}`)
  })
}

// --- THE TABLE ITSELF ------------------------------------------------------

test('every scenario states why it matters', () => {
  const rows = [...CONFLICT_SCENARIOS, ...DEPENDENCY_SCENARIOS, ...CONTRACT_SCENARIOS, ...TIMELINE_SCENARIOS]
  for (const row of rows) {
    assert.ok(row.why && row.why.length > 30, `scenario "${row.name}" needs a reason; a row without one is a snapshot, not a scenario`)
  }
  assert.ok(rows.length >= 25, 'the scenario table should cover the whole protocol, not a sample')
})

test('the queue honours the conflict matrix end to end', () => {
  const readers = buildDynamicQueues([
    { number: 1, title: 'r1', body: scope('writes:\n  - table core.own1\nreads:\n  - table core.shared') },
    { number: 2, title: 'r2', body: scope('writes:\n  - table core.own2\nreads:\n  - table core.shared') },
  ], [], NOW)
  assert.equal(readers.dispatchable.length, 2, 'two readers must run at once')

  const mixed = buildDynamicQueues([
    { number: 1, title: 'r1', body: scope('writes:\n  - table core.own1\nreads:\n  - table core.shared') },
    { number: 3, title: 'w', body: scope('writes:\n  - table core.shared') },
  ], [], NOW)
  assert.equal(mixed.dispatchable.length, 1, 'a writer must serialise against a reader')
})
