// Issue #4414 plan step 5 (§10 hostile matrix). Proofs not already covered by an
// existing named test live here; docs/verification/reviewer-assignment-holds.md maps
// every §10 name to its test. Fake io with real CAS semantics; no wall-clock timing.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assignNextReviewer,
  MUTEX_REF,
  REVIEW_CURSOR_REF,
  REVIEW_ASSIGNMENT_REF_PREFIX,
} from '../../manage-migration-author-lanes.mjs'
import { atomicIo, HEAD } from '../../test-fixtures/review-assignment-io.mjs'

const REQUEST = { issue: 4414, pr: 4419, headSha: HEAD, slot: 1 }
const assignmentRefs = (io) => [...io.refs.keys()].filter((ref) => ref.startsWith(`${REVIEW_ASSIGNMENT_REF_PREFIX}/`))
function captureStderr(fn) {
  const lines = [], original = process.stderr.write
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true }
  try { return { result: fn(), lines } } catch (error) { return { error, lines } } finally { process.stderr.write = original }
}

test('fresh_head_change_refuses_draw', () => {
  const io = atomicIo()
  const rawStates = io.readReviewStates
  io.readReviewStates = (list) => { if (io.refs.has(MUTEX_REF)) io.head = 'b'.repeat(40); return rawStates(list) }
  assert.throws(() => assignNextReviewer(REQUEST, io), /changed after mutex acquisition/)
  assert.deepEqual(assignmentRefs(io), [], 'no assignment written')
  assert.equal(io.refs.has(REVIEW_CURSOR_REF), false, 'cursor untouched')
  assert.equal(io.refs.has(MUTEX_REF), false, 'mutex released')
})

test('peer_policy_change_under_lock_refuses — a peer slot taken by the same reviewer after prepare', () => {
  // Precompute what a concurrent slot-1 draw writes, on a disjoint SHA range.
  const peer = atomicIo({ start: 1000 })
  const first = assignNextReviewer(REQUEST, peer)
  const peerWrites = [...peer.refs.entries()].filter(([ref]) => ref !== MUTEX_REF)
  const io = atomicIo()
  const rawStates = io.readReviewStates
  let injected = false
  io.readReviewStates = (list) => {
    if (io.refs.has(MUTEX_REF) && !injected) {
      injected = true
      for (const [sha, commit] of peer.commits) io.commits.set(sha, commit)
      for (const [ref, sha] of peerWrites) io.refs.set(ref, sha)
    }
    return rawStates(list)
  }
  assert.throws(() => assignNextReviewer({ ...REQUEST, slot: 2 }, io), new RegExp(`${first.reviewer.replace(/[.]/g, '\\.')} already holds another review slot for this exact head`))
  assert.equal(injected, true, 'peer appeared only after prepare, under the lock')
  assert.deepEqual(assignmentRefs(io), assignmentRefs(peer), 'only the peer slot-1 record exists; no slot-2 assignment written')
  assert.equal(io.refs.has(MUTEX_REF), false)
})

test('concurrent_draws_preserve_one_tuple_and_cursor — a draw that meets a held mutex writes nothing, the retry re-serves', () => {
  const io = atomicIo()
  const foreign = io.makeOwnerCommit('db-coordination someone-else')
  io.refs.set(MUTEX_REF, foreign)
  assert.throws(() => assignNextReviewer(REQUEST, io), /is occupied/)
  assert.equal(io.refs.get(MUTEX_REF), foreign, 'foreign owner untouched')
  assert.deepEqual(assignmentRefs(io), [])
  io.refs.delete(MUTEX_REF)
  const first = assignNextReviewer(REQUEST, io)
  const cursor = io.refs.get(REVIEW_CURSOR_REF)
  const again = assignNextReviewer(REQUEST, io)
  assert.equal(again.reviewer, first.reviewer, 'same tuple re-served')
  assert.equal(io.refs.get(REVIEW_CURSOR_REF), cursor, 'cursor advanced exactly once')
  assert.equal(assignmentRefs(io).length, 1, 'one assignment record per tuple')
})

test('provider_execution_starts_after_mutex_release — assignment returns only after a proved release', () => {
  const io = atomicIo()
  const result = assignNextReviewer(REQUEST, io)
  assert.ok(result.wrapper, 'caller receives the wrapper to launch')
  assert.equal(io.refs.has(MUTEX_REF), false, 'nothing the caller runs next can hold the mutex')
})

test('slow_report_holds_no_mutex — work after return (provider run, reporting) observes no owned mutex', () => {
  const io = atomicIo()
  assignNextReviewer(REQUEST, io)
  // Simulate an arbitrarily slow provider/report phase: the mutex stays free and
  // an unrelated coordinator can take and release it meanwhile.
  const other = io.makeOwnerCommit('db-coordination unrelated-claim')
  assert.equal(io.createRef(MUTEX_REF, other), true, 'unrelated work can acquire while the review runs')
  io.refs.delete(MUTEX_REF)
})

test('completed_assignment_survives_cleanup_failure', () => {
  const io = atomicIo()
  io.atomicReviewMutexRelease = () => { throw new Error('release transport lost') }
  io.readRefOverApi = (ref) => io.refs.get(ref) ?? null
  io.releaseRefOverGit = () => { throw new Error('git fallback down') }
  let error
  try { assignNextReviewer(REQUEST, io) } catch (caught) { error = caught }
  assert.ok(error, 'unproved release is reported, never hidden')
  assert.ok(error.completedResult?.reviewer, 'completed draw is carried on the error')
  assert.match(error.message, /do not retry it|RECOVERY REQUIRED/)
  assert.equal(assignmentRefs(io).length, 1, 'the assignment stands; nothing was rolled back or redrawn')
})

test('wait_trace_preserves_observed_owner_and_unknown_attribution', () => {
  const io = atomicIo()
  const foreign = io.makeOwnerCommit('db-coordination claim-holder')
  io.refs.set(MUTEX_REF, foreign)
  const { error, lines } = captureStderr(() => assignNextReviewer(REQUEST, io))
  assert.match(String(error?.message), /occupied/)
  const trace = lines.find((line) => line.startsWith('review-phase-trace '))
  assert.ok(trace, 'a refused acquisition still emits its trace')
  assert.match(trace, new RegExp(`foreign_mutex=${foreign.slice(0, 12)}`))
  assert.match(trace, /release=not_acquired/)
  assert.doesNotMatch(trace, /cause=|caused_by=/, 'observed owner only; no invented attribution')
})

test('trace_failure_does_not_repeat_or_hide_completed_assignment', () => {
  const io = atomicIo()
  const original = process.stderr.write
  process.stderr.write = () => { throw new Error('EPIPE') }
  let result
  try { result = assignNextReviewer(REQUEST, io) } finally { process.stderr.write = original }
  assert.ok(result?.reviewer, 'assignment returned despite trace sink failure')
  assert.equal(assignmentRefs(io).length, 1, 'exactly one draw')
  assert.equal(io.refs.has(MUTEX_REF), false)
})

test('trace_is_monotonic_and_secret_safe — the emitted line carries no tokens or raw child output', () => {
  const io = atomicIo()
  process.env.GH_TOKEN_TEST_SENTINEL = 'ghp_' + 'secretsentinel' + '0'.repeat(21)
  try {
    const { lines } = captureStderr(() => assignNextReviewer(REQUEST, io))
    const trace = lines.find((line) => line.startsWith('review-phase-trace '))
    assert.ok(trace)
    assert.doesNotMatch(trace, /ghp_|secretsentinel|token/i)
    for (const [, ms] of trace.matchAll(/=(-?\d+)ms/g)) assert.ok(Number(ms) >= 0, 'no negative durations')
  } finally { delete process.env.GH_TOKEN_TEST_SENTINEL }
})
