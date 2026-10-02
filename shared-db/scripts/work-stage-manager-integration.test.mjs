import test from 'node:test'
import assert from 'node:assert/strict'
import { parseQueueScope, buildDynamicQueues, readDependencyStates, verifyCompletionAcceptance } from './manage-migration-author-lanes.mjs'

const scope = (number, depends = '') => ({ number, title: `work ${number}`, body: ['```db-work-scope', 'status: ready', 'work_type: structural', 'route: shared-db-orchestrator', 'service_class: standard-application', 'change_type: migration', 'application_return_to: popcre/example-app', 'live_assertion: authenticated create succeeds', 'generated_types: not-applicable', 'priority: 1', `depends_on: ${depends}`, 'writes:', `  - table core.task_${number}`, 'reads:', '```'].join('\n') })

test('manager keeps explicit required stages and conservative legacy numbers', () => {
  assert.deepEqual(parseQueueScope(scope(10, '#11@implementation-merged, 12').body).dependencies, [{ issue: 11, required_stage: 'implementation-merged' }, 12])
  for (const value of ['11@unknown', '0@database-applied']) assert.throws(() => parseQueueScope(scope(10, value).body))
})

test('explicit stages cannot bypass an open prerequisite when proof cannot be fetched', () => {
  const result = buildDynamicQueues([scope(10, '11@implementation-merged'), scope(11)], [], new Date('2026-09-20T20:00:00Z'))
  assert.ok(!result.dispatchable.includes(10))
})

test('stage-qualified dependency cycles remain cycles', () => {
  const result = buildDynamicQueues([scope(10, '11@implementation-merged'), scope(11, '10@database-applied')], [], new Date('2026-09-20T20:00:00Z'))
  assert.ok(!result.dispatchable.includes(10))
  assert.ok(!result.dispatchable.includes(11))
  assert.ok(result.dependencyCycles.length > 0)
})




import { expectedOperatorAssociation } from './lib/repository-identity.mjs'
const finalRecord = { schema_version: 1, work_issue: 10, outcome: 'merged', pr: 99, merge_sha: 'a'.repeat(40), migration_versions: [] }
function completionIo() {
  const body = ['```db-work-scope', 'status: ready', 'work_type: repo-maintenance', 'route: repo-maintenance', 'change_type: repo-maintenance', 'priority: 1', 'writes:', 'reads:', '```'].join('\n')
  return {
    getIssue: () => ({ state: 'open', body }),
    issueComments: () => [{ author: 'u2giants', author_association: expectedOperatorAssociation(), body: '```db-work-completion\n' + JSON.stringify(finalRecord) + '\n```' }],
    getPr: () => ({ merged_at: '2026-09-20T20:00:00Z', merge_commit_sha: finalRecord.merge_sha, base: { repo: { full_name: 'popcre/shared-db' }, ref: 'main' } }),
    getPrFiles: () => [{ filename: 'scripts/example.mjs' }], readRef: () => 'b'.repeat(40),
    compareCommits: () => ({ status: 'ahead', behind_by: 0 }), closingIssuesForPr: () => [{ number: 10 }],
    commentIssue: () => { throw new Error('read side wrote a comment') }, updateIssue: () => { throw new Error('read side closed issue') },
  }
}
test('maintenance delivery can be verified while closeout stays with its opener', () => {
  const result = verifyCompletionAcceptance({ issue: 10 }, completionIo())
  assert.equal(result.status, 'delivered-closeout-pending')
  assert.equal(result.ownerAction.issue, 10)
  for (const change of [io => { io.closingIssuesForPr = () => [{ number: 11 }] }, io => { io.compareCommits = () => ({ status: 'behind', behind_by: 1 }) }]) {
    const io = completionIo(); change(io)
    assert.throws(() => verifyCompletionAcceptance({ issue: 10 }, io))
  }
  const missing = completionIo(); missing.issueComments = () => []
  assert.equal(verifyCompletionAcceptance({ issue: 10 }, missing).status, 'incomplete')
})

test('dependency reader fetches open stage comments, retains numeric identity and treats unreadable as blocked', () => {
  const calls = []
  const io = { getIssue: number => { calls.push(number); return { state: 'open' } }, getIssueComments: number => [{ user: { login: 'u2giants' }, author_association: expectedOperatorAssociation(), body: 'stage evidence' }] }
  const states = readDependencyStates([{ issue: 11, required_stage: 'implementation-merged' }, 12], io)
  assert.deepEqual(calls, [11, 12])
  assert.equal(states[11].comments.length, 1)
  assert.equal(states[12].comments.length, 0)
  assert.equal(typeof states[11].verifyStageEvidence, 'function')
  io.getIssueComments = () => { throw new Error('HTTP 429') }
  assert.match(readDependencyStates([{ issue: 11, required_stage: 'implementation-merged' }], io)[11].unreadable, /429/)
})
