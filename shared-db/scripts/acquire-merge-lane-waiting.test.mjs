import test from 'node:test'
import assert from 'node:assert/strict'
import { acquireMergeLaneWaiting } from './acquire-merge-lane-waiting.mjs'

const ARGS = ['--acquire-merge', '--owner', 'github-actions:1', '--pr', '1', '--head-sha', 'a'.repeat(40)]
const BUSY = { status: 1, stdout: '', stderr: 'REFUSED: refs/db-coordination/merge is occupied; hold_reason lease:merge held by PR #4912\n' }
const OK = { status: 0, stdout: '{"ownerSha":"abc"}\n', stderr: '' }

function harness(results) {
  let clock = 0
  const calls = [], logs = []
  return {
    calls, logs,
    opts: {
      run: (args) => { calls.push(args); return results.shift() },
      wait: (ms) => { clock += ms },
      now: () => clock,
      log: (line) => logs.push(line),
    },
  }
}

test('contended merge lane waits, re-runs the full acquisition, and succeeds', () => {
  const h = harness([BUSY, BUSY, OK])
  const r = acquireMergeLaneWaiting(ARGS, { waitSeconds: 900, pollSeconds: 15, ...h.opts })
  assert.equal(r.status, 0)
  assert.equal(r.attempts, 3)
  assert.equal(r.stdout, OK.stdout)
  assert.deepEqual(h.calls, [ARGS, ARGS, ARGS], 'every attempt is the unchanged --acquire-merge CLI')
  assert.match(h.logs[0], /merge lane busy \(attempt 1, waited 0s of 900s\).*PR #4912/)
  assert.match(h.logs.at(-1), /acquired on attempt 3 after waiting 30s/)
})

test('contention past the budget fails closed with the last holder named', () => {
  const h = harness(Array(10).fill(BUSY))
  const r = acquireMergeLaneWaiting(ARGS, { waitSeconds: 30, pollSeconds: 15, ...h.opts })
  assert.equal(r.status, 1)
  assert.equal(r.attempts, 3)
  assert.match(h.logs.at(-1), /REFUSED: merge lane still occupied after waiting 30s \(budget 30s, 3 attempts\)/)
})

test('any other refusal is not retried', () => {
  for (const stderr of ['REFUSED: production promotion is active; merges are frozen', 'REFUSED: refs/db-coordination/author-acquisition remained occupied at abc', 'REFUSED: exclusive lane head SHA does not match the live pull request']) {
    const h = harness([{ status: 1, stdout: '', stderr }, OK])
    const r = acquireMergeLaneWaiting(ARGS, h.opts)
    assert.equal(r.status, 1, stderr)
    assert.equal(h.calls.length, 1, stderr)
  }
})

test('only --acquire-merge may be wrapped', () => {
  assert.throws(() => acquireMergeLaneWaiting(['--acquire-production'], harness([]).opts), /only wraps --acquire-merge/)
})
