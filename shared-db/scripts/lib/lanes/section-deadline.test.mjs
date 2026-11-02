// Issue #4414 plan step 4: bounded owned-section I/O, ambiguous-commit
// reconciliation, and no quota wait under ownership. Fake clock and fake io;
// no wall-clock performance assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { withReviewRequestBudget, reviewChildTimeoutMs, reconcileAtomicReviewBatch, setReviewMonotonicClock, runGitHubCommand, gitRemoteRefs, MUTEX_REF, REVIEW_MUTEX_SECTION_DEADLINE_MS, REVIEW_MUTEX_CLEANUP_ALLOWANCE_MS } from '../../manage-migration-author-lanes.mjs'
import { REPO } from './constants.mjs'
import { atomicIo, HEAD } from '../../test-fixtures/review-assignment-io.mjs'

function withClock(fn) {
  let now = 1000
  const previous = setReviewMonotonicClock(() => now)
  try { return fn({ advance: (ms) => { now += ms }, get now() { return now } }) } finally { setReviewMonotonicClock(previous) }
}

test('outside ownership the per-call default bound is unchanged', () => {
  assert.equal(reviewChildTimeoutMs(120000), 120000)
  withReviewRequestBudget(() => assert.equal(reviewChildTimeoutMs(60000), 60000))
})




test('partial_or_unreadable_transaction_is_recovery_required — and provably uncommitted is a retryable no-write refusal', () => {
  const refs = new Map([['refs/a', 'x'], ['refs/b', null]])
  const io = { readReviewRefs: (list) => new Map(list.map((r) => [r, refs.get(r) ?? null])) }
  const batch = [{ ref: 'refs/a', expected: 'x', sha: 'y' }, { ref: 'refs/b', expected: null, sha: 'z' }]
  assert.throws(() => reconcileAtomicReviewBatch(batch, io, new Error('boom')), (e) => e.retryableNoWrite === true && /did NOT commit/.test(e.message))
  refs.set('refs/a', 'y')
  assert.throws(() => reconcileAtomicReviewBatch(batch, io, new Error('boom')), /PARTIAL[\s\S]*RECOVERY REQUIRED/)
  refs.set('refs/b', 'z')
  assert.equal(reconcileAtomicReviewBatch(batch, io, new Error('boom')), 'committed')
  assert.throws(() => reconcileAtomicReviewBatch(batch, { readReviewRefs: () => { throw new Error('offline') } }, new Error('boom')), /UNKNOWN[\s\S]*RECOVERY REQUIRED/)
})


// Production read path: readReviewRefs goes through the real gitRemoteRefs with a
// stubbed git runner, so deadline behaviour is the shipped wiring, not the fixture (L2).
function wireRefs(io, launched) {
  const run = (bin, args, options) => {
    if (args[0] === 'remote') return `https://github.com/${REPO}.git\n`
    launched.push({ args, timeout: options.timeout })
    return [...io.refs.entries()].filter(([ref, sha]) => /^[0-9a-f]{40}$/.test(sha) && args.slice(2).includes(ref)).map(([ref, sha]) => `${sha}\t${ref}`).join('\n')
  }
  io.readReviewRefs = (list) => { const found = gitRemoteRefs(list, { run }); return new Map(list.map((ref) => [ref, found.get(ref) ?? null])) }
}



