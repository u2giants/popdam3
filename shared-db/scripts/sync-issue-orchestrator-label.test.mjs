import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyIssue, scopeWorkType, syncIssue, MISSING_SCOPE_MARKER } from './sync-issue-orchestrator-label.mjs'

const F = '```'
const block = (wt) => `intro\n\n${F}db-work-scope\nstatus: queued\nwork_type: ${wt}\nroute: orchestrator\n${F}\n`

test('structural and curated-master-data are orchestrator', () => {
  for (const wt of ['structural', 'curated-master-data']) {
    const p = classifyIssue({ body: block(wt), labels: [{ name: 'non-orchestrator' }] })
    assert.deepEqual([p.want, p.add, p.remove, p.needsScope], ['orchestrator', ['orchestrator'], ['non-orchestrator'], false])
  }
})

test('any other work_type is non-orchestrator', () => {
  const p = classifyIssue({ body: block('proof'), labels: [{ name: 'orchestrator' }, { name: 'bug' }] })
  assert.deepEqual([p.want, p.add, p.remove, p.needsScope], ['non-orchestrator', ['non-orchestrator'], ['orchestrator'], false])
})

test('coordination labels win over a structural block', () => {
  for (const l of ['orchestrator-marker', 'orchestrator-alarm', 'db-claim']) {
    assert.equal(classifyIssue({ body: block('structural'), labels: [l] }).want, 'non-orchestrator')
  }
})

test('missing block or missing work_type is non-orchestrator and asks for scope', () => {
  for (const body of [null, 'no block', `${F}db-work-scope\nstatus: queued\n${F}`]) {
    const p = classifyIssue({ body, labels: [] })
    assert.deepEqual([p.want, p.needsScope], ['non-orchestrator', true])
  }
})

test('already-correct issue needs no change', () => {
  const p = classifyIssue({ body: block('structural'), labels: [{ name: 'orchestrator' }] })
  assert.deepEqual([p.add, p.remove], [[], []])
})

test('CRLF bodies parse', () => assert.equal(scopeWorkType(block('structural').replace(/\n/g, '\r\n')), 'structural'))

test('comments once on an open unscoped issue, never twice, never on closed', () => {
  const calls = []
  const run = (existing) => (args) => { calls.push(args); return args.includes('--slurp') ? JSON.stringify([existing]) : '{}' }
  syncIssue({ number: 7, state: 'open', body: '', labels: [] }, { run: run([]) })
  assert.ok(calls.some((a) => a.at(-2) === '--input'))
  calls.length = 0
  syncIssue({ number: 7, state: 'open', body: '', labels: ['non-orchestrator'] }, { authoritative: true, run: run([{ body: MISSING_SCOPE_MARKER }]) })
  assert.ok(!calls.some((a) => a.at(-2) === '--input'))
  calls.length = 0
  syncIssue({ number: 8, state: 'closed', body: '', labels: [] }, { run: run([]) })
  assert.deepEqual(calls.map((a) => a[2]), ['POST'])
})

test('pull requests are skipped', () => {
  assert.equal(syncIssue({ pull_request: {}, labels: [] }, { run: () => { throw new Error('must not call gh') } }), null)
})

test('fill mode keeps an existing single label but fixes blank and both-labels', () => {
  const structural = block('structural')
  assert.deepEqual(classifyIssue({ body: structural, labels: ['non-orchestrator'] }, { authoritative: false }).add, [])
  assert.deepEqual(classifyIssue({ body: structural, labels: [] }, { authoritative: false }).add, ['orchestrator'])
  const both = classifyIssue({ body: structural, labels: ['orchestrator', 'non-orchestrator'] }, { authoritative: false })
  assert.deepEqual([both.add, both.remove], [[], ['non-orchestrator']])
})

test('authoritative mode reclassifies after a body edit', () => {
  const p = classifyIssue({ body: block('structural'), labels: ['non-orchestrator'] }, { authoritative: true })
  assert.deepEqual([p.add, p.remove], [['orchestrator'], ['non-orchestrator']])
})
