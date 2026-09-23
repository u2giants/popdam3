import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ConfigureQueueError,
  LANE_REFS,
  QUEUE_GATE_CONTEXT,
  MERGE_QUEUE_WORKFLOW,
  assertContextsAndWorkflow,
  assertMainTipPreview,
  assertNoMutationLane,
  assertRepositoryIdentity,
  desiredRuleset,
  main,
  planActivation,
  planRollback,
  readBaselineId,
  readHeldLanes,
  readMainTip,
  verifyReadback,
} from './configure-merge-queue.mjs'
import { QUEUE_RULE, RULESET_NAME, PREVIEW_REHEARSAL_CONTEXT } from './merge-queue-contract.mjs'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

test('queue is exactly one all-green PR built and merged at a time', () => {
  assert.deepEqual(QUEUE_RULE.parameters, {
    check_response_timeout_minutes: 30,
    grouping_strategy: 'ALLGREEN',
    max_entries_to_build: 1,
    max_entries_to_merge: 1,
    merge_method: 'MERGE',
    min_entries_to_merge: 1,
    min_entries_to_merge_wait_minutes: 0,
  })
  assert.deepEqual(desiredRuleset().conditions.ref_name.include, ['refs/heads/main'])
  assert.equal(desiredRuleset().target, 'branch')
  assert.equal(desiredRuleset().enforcement, 'active')
  assert.equal(desiredRuleset().rules.length, 1)
})

test('repository identity gate: organization, public, and the transferred object ID', () => {
  const live = { id: 1275568548, owner: { type: 'Organization' }, visibility: 'public' }
  assert.equal(assertRepositoryIdentity({ live, baselineId: 1275568548 }), true)
  assert.throws(() => assertRepositoryIdentity({ live: { ...live, owner: { type: 'User' } }, baselineId: 1275568548 }), /organization-owned/i)
  assert.throws(() => assertRepositoryIdentity({ live: { ...live, visibility: 'private' }, baselineId: 1275568548 }), /public/)
  assert.throws(() => assertRepositoryIdentity({ live: { ...live, id: 42 }, baselineId: 1275568548 }), /does not match the transfer baseline/)
  assert.throws(() => assertRepositoryIdentity({ live, baselineId: undefined }), /baseline repository ID is unreadable/)
})

test('baseline ID is read from the Step 3 artifact shape', () => {
  assert.equal(readBaselineId(JSON.stringify({ inventory: { repository: { id: 1275568548 } } })), 1275568548)
  assert.throws(() => readBaselineId('not json'), /not readable JSON/)
  assert.throws(() => readBaselineId('{}'), /no inventory\.repository\.id/)
})

test('contexts and workflow gate: the additive context and the on-main workflow', () => {
  const ok = { contexts: ['Tools offline tests', QUEUE_GATE_CONTEXT], workflows: [MERGE_QUEUE_WORKFLOW] }
  assert.equal(assertContextsAndWorkflow(ok), true)
  assert.throws(() => assertContextsAndWorkflow({ ...ok, contexts: ['Tools offline tests'] }), /update-required-checks/)
  assert.throws(() => assertContextsAndWorkflow({ ...ok, workflows: [] }), /not on main/)
  assert.throws(() => assertContextsAndWorkflow({ contexts: [], workflows: ok.workflows }), /unreadable/)
})

test('mutation-lane gate: any held exclusive lane refuses activation', () => {
  assert.equal(assertNoMutationLane([]), true)
  assert.throws(() => assertNoMutationLane(['refs/db-coordination/merge']), /mutation lane\(s\) held/)
  assert.throws(() => assertNoMutationLane(null), /unreadable/)
})

test('lane reads: a 404 is a free lane, anything else is a refusal', () => {
  const free = () => { throw new Error('HTTP 404: Not Found') }
  assert.deepEqual(readHeldLanes('acme/widgets', { read: free }), [])
  const held = (args) => (args.at(-1).endsWith('db-coordination/preview') ? { ref: 'refs/db-coordination/preview' } : (() => { throw new Error('HTTP 404: Not Found') })())
  assert.deepEqual(readHeldLanes('acme/widgets', { read: held }), ['refs/db-coordination/preview'])
  const broken = () => { throw new Error('HTTP 403: forbidden') }
  assert.throws(() => readHeldLanes('acme/widgets', { read: broken }), /could not be read/)
  assert.equal(LANE_REFS.length, 4)
})

test('main tip preview gate: migration tips need the exact-SHA success first', () => {
  const docsTip = { tipSha: SHA_A, tipPaths: ['docs/x.md'], statuses: [] }
  assert.deepEqual(assertMainTipPreview(docsTip), { held: false })
  const migrationTip = { tipSha: SHA_A, tipPaths: ['supabase/migrations/20260918120000_x.sql'], statuses: [] }
  assert.throws(() => assertMainTipPreview(migrationTip), /Dispatch the bounded post-merge rehearsal/)
  const rehearsed = { ...migrationTip, statuses: [{ context: PREVIEW_REHEARSAL_CONTEXT, state: 'success', created_at: '2026-09-18T01:00:00Z', id: 1 }] }
  assert.equal(assertMainTipPreview(rehearsed).held, true)
  assert.throws(() => assertMainTipPreview({ tipSha: 'bad', tipPaths: [], statuses: [] }), /unreadable/)
})

test('readMainTip refuses a truncated commit file list', () => {
  const read = (args) => {
    const target = args.at(-1)
    if (target.endsWith('/branches/main')) return { commit: { sha: SHA_A } }
    if (target.endsWith(`/commits/${SHA_A}`)) return { files: Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}` })) }
    if (target.includes('/statuses')) return [[]]
    throw new Error(`unexpected ${target}`)
  }
  assert.throws(() => readMainTip('acme/widgets', { read }), /truncated/)
})

test('activation plan: all gates pass, same-name ruleset is reused, duplicates refuse', () => {
  const base = {
    repo: 'acme/widgets',
    live: { id: 1, owner: { type: 'Organization' }, visibility: 'public' },
    baselineId: 1,
    contexts: [QUEUE_GATE_CONTEXT],
    workflows: [MERGE_QUEUE_WORKFLOW],
    heldLanes: [],
    mainTip: { tipSha: SHA_A, tipPaths: ['docs/x.md'], statuses: [] },
  }
  assert.equal(planActivation({ ...base, rulesets: [] }).existing, null)
  assert.equal(planActivation({ ...base, rulesets: [{ id: 9, name: RULESET_NAME }] }).existing.id, 9)
  assert.throws(() => planActivation({ ...base, rulesets: [{ id: 9, name: RULESET_NAME }, { id: 10, name: RULESET_NAME }] }), /multiple rulesets/)
})

test('read-back: every field must equal the desired document', () => {
  const desired = desiredRuleset()
  const written = { id: 7, ...desired, _links: { html: { href: 'https://example.test' } } }
  assert.equal(verifyReadback(written).id, 7)
  assert.throws(() => verifyReadback({ ...written, enforcement: 'evaluate' }), /read-back mismatch: enforcement/)
  assert.throws(() => verifyReadback({ ...written, conditions: { ref_name: { include: ['~ALL'], exclude: [] } } }), /read-back mismatch: conditions/)
  assert.throws(() => verifyReadback({ ...written, rules: [{ type: 'merge_queue', parameters: { ...QUEUE_RULE.parameters, max_entries_to_merge: 2 } }] }), /read-back mismatch: queue parameters/)
  assert.throws(() => verifyReadback({ ...written, rules: [] }), /exactly one merge_queue rule/)
  assert.throws(() => verifyReadback({ name: RULESET_NAME }), /did not read back with an ID/)
})

test('rollback names only the recorded main merge queue ruleset', () => {
  const rulesets = [{ id: 5, name: 'other' }, { id: 9, name: RULESET_NAME }]
  assert.equal(planRollback({ rulesets }).id, 9)
  assert.equal(planRollback({ rulesets, expectId: 9 }).id, 9)
  assert.throws(() => planRollback({ rulesets, expectId: 12 }), /does not match/)
  assert.throws(() => planRollback({ rulesets: [] }), /nothing to roll back/)
  assert.throws(() => planRollback({ rulesets: [{ id: 8, name: RULESET_NAME }, { id: 9, name: RULESET_NAME }] }), /multiple rulesets/)
  assert.throws(() => planRollback({ rulesets: null }), /unreadable/)
})

// End-to-end CLI shape with injected reads: dry run writes nothing, apply POSTs
// once and verifies, and a gate failure exits 1 without any write.
function fakeLive({ withRuleset = false } = {}) {
  const calls = []
  const bodies = []
  const read = (args, options = {}) => {
    calls.push({ args, hasInput: options.input !== undefined })
    if (options.input !== undefined) bodies.push(options.input)
    if (args.includes('POST') && args.some((a) => String(a).endsWith('/rulesets'))) return { id: 9, ...desiredRuleset() }
    if (args.includes('PUT') && args.some((a) => String(a).endsWith('rulesets/9'))) return { id: 9, ...desiredRuleset() }
    const target = args.at(-1)
    if (target.endsWith('includes_parents=false')) return withRuleset ? [{ id: 9, name: RULESET_NAME, enforcement: 'active' }] : []
    if (target === 'repos/acme/widgets') return { id: 1, owner: { type: 'Organization' }, visibility: 'public' }
    if (target.endsWith('required_status_checks')) return { contexts: [QUEUE_GATE_CONTEXT] }
    if (target.includes('/git/ref/')) throw new Error('HTTP 404: Not Found')
    if (target.endsWith('/branches/main')) return { commit: { sha: SHA_B } }
    if (/commits\/[0-9a-f]{40}$/.test(target)) return { files: [{ filename: 'docs/x.md' }] }
    if (target.includes('/statuses')) return [[]]
    throw new Error(`unexpected read ${args.join(' ')}`)
  }
  const treeReader = { pathsAtRef: () => [`.github/workflows/${MERGE_QUEUE_WORKFLOW}`, '.github/workflows/sync.yml', 'AGENTS.md'] }
  return { read, treeReader, calls, bodies }
}

test('CLI dry run writes nothing; apply posts the exact payload once', () => {
  const { read, treeReader, calls } = fakeLive()
  const logs = []
  const code = main([], { GITHUB_REPOSITORY: 'acme/widgets' }, { read, treeReader, baselineId: 1, log: (line) => logs.push(line), readOrigin: () => null })
  assert.equal(code, 0)
  assert.ok(logs.join('\n').includes('DRY RUN'))
  assert.equal(calls.filter((c) => c.hasInput).length, 0)

  const applied = fakeLive()
  const code2 = main(['--apply'], { GITHUB_REPOSITORY: 'acme/widgets' }, { read: applied.read, treeReader: applied.treeReader, baselineId: 1, log: () => {}, readOrigin: () => null })
  assert.equal(code2, 0)
  assert.equal(applied.bodies.length, 1)
  assert.deepEqual(JSON.parse(applied.bodies[0]), JSON.parse(JSON.stringify(desiredRuleset())))
  const write = applied.calls.find((c) => c.hasInput)
  assert.ok(write.args.includes('POST'))
  assert.ok(write.args.at(-2) === '--input' || write.args.includes('--input'))
})

test('CLI refuses before any write when a gate fails', () => {
  const { read, treeReader, calls } = fakeLive()
  const gatedRead = (args, options) => {
    const target = args.at(-1)
    if (target.includes('/git/ref/db-coordination/merge')) return { ref: 'refs/db-coordination/merge' }
    return read(args, options)
  }
  assert.throws(() => main(['--apply'], { GITHUB_REPOSITORY: 'acme/widgets' }, { read: gatedRead, treeReader, baselineId: 1, log: () => {}, readOrigin: () => null }), /mutation lane\(s\) held/)
  assert.equal(calls.filter((c) => c.hasInput).length, 0)
})
