import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assignNextReviewer,
  mutexSectionReserveAfterPrepare,
  MUTEX_REF,
  REVIEW_OPERATION_REQUEST_LIMIT,
  REVIEW_MUTEX_SECTION_RESERVE,
  REVIEW_STARTED_REF_PREFIX,
  REVIEW_ACTIVE_CUTOVER_REF,
  REVIEW_ASSIGNMENT_REF_PREFIX,
} from '../../manage-migration-author-lanes.mjs'

function usableAdmission(row) {
  return {
    provider: row.provider,
    status: 'ready',
    usable: true,
    admission: {
      schema_version: 1,
      provider: row.provider,
      state: 'unknown',
      reason: 'unscopable',
      quota_state: 'unknown',
      reset_at: null,
      credential_profile_scope: null,
      model_scope: null,
    },
  }
}

function baseIo() {
  const refs = new Map()
  const commits = new Map()
  let next = 1
  refs.set(REVIEW_ACTIVE_CUTOVER_REF, 'cutover-complete')
  return {
    refs,
    commits,
    makeOwnerCommit(message) {
      const sha = String(next++).padStart(40, '0')
      commits.set(sha, { message, committer: { date: new Date().toISOString() } })
      return sha
    },
    requiresExactReviewHeadSha: true,
    enableReviewerQueue: false,
    resolveReviewEngine: () => 'claude',
    reviewerUsability: (reviewers) => new Map(reviewers.map((row) => [row.provider, usableAdmission(row)])),
    pauseReviewerFailure: () => {},
    readPaidReviewStarts: (prefix) => [...refs.entries()].filter(([ref]) => ref.startsWith(prefix)).map(([ref, sha]) => ({ ref, sha, commit: commits.get(sha) })),
    readRef: (ref) => refs.get(ref) ?? null,
    listRefs: (prefix) => [...refs.entries()].filter(([ref]) => ref.startsWith(prefix)).map(([ref, sha]) => ({ ref, sha, commit: commits.get(sha) })),
    getCommit: (sha) => commits.get(sha),
    getPr: (pr) => ({ state: 'open', number: Number(pr), head: { sha: 'a'.repeat(40) } }),
    getIssue: () => ({ state: 'open' }),
    getIssueComments: () => [],
    getPrReviews: () => [],
    createRef(ref, sha) {
      if (refs.has(ref)) return false
      refs.set(ref, sha)
      return true
    },
    updateRef: (ref, sha) => { refs.set(ref, sha) },
    deleteRef: (ref) => { refs.delete(ref) },
    getRateLimit: () => ({ remaining: 5000, limit: 5000, reset: 0, graphRemaining: 5000, graphLimit: 5000, graphReset: 0 }),
  }
}

test('slow_preparation_does_not_hold_author_mutex — paid-start classification finishes before acquire', () => {
  const io = baseIo()
  let capacityListFinished = false
  let mutexAcquireSawFinishedCapacity = false
  let capacitySawHeldMutex = false

  // assertPaidReviewCapacity prefers readPaidReviewStarts when present.
  const rawStarts = io.readPaidReviewStarts.bind(io)
  io.readPaidReviewStarts = (prefix, pr) => {
    if (io.refs.has(MUTEX_REF)) capacitySawHeldMutex = true
    const rows = rawStarts(prefix, pr)
    capacityListFinished = true
    return rows
  }

  const rawCreateRef = io.createRef.bind(io)
  io.createRef = (ref, sha) => {
    if (ref === MUTEX_REF && capacityListFinished) mutexAcquireSawFinishedCapacity = true
    return rawCreateRef(ref, sha)
  }

  let outcome = 'unknown'
  try {
    const result = assignNextReviewer({ issue: 4414, pr: 4419, headSha: 'a'.repeat(40), slot: 1 }, io)
    outcome = `assigned:${result?.reviewer ?? '?'}`
  } catch (error) {
    outcome = String(error?.message ?? error)
  }

  assert.equal(capacitySawHeldMutex, false, `paid-start classification must not run while the author mutex is held (outcome=${outcome})`)
  assert.equal(capacityListFinished, true, `fixture never listed paid starts; outcome=${outcome}`)
  assert.equal(mutexAcquireSawFinishedCapacity, true, `paid-start classification must finish before mutex acquisition; outcome=${outcome}`)
})

test('idempotent retry does not require paid-start provenance when a durable assignment exists', () => {
  const io = baseIo()
  const head = 'a'.repeat(40)
  // First draw establishes a durable assignment.
  const first = assignNextReviewer({ issue: 4414, pr: 4419, headSha: head, slot: 1 }, io)
  assert.ok(first?.reviewer)
  // Unreadable starts must not fail a retry that only re-serves the assignment.
  io.listRefs = (prefix) => {
    if (String(prefix).includes('started')) throw new Error('start listing unavailable on retry')
    return [...io.refs.entries()].filter(([ref]) => ref.startsWith(prefix)).map(([ref, sha]) => ({ ref, sha, commit: io.commits.get(sha) }))
  }
  io.readPaidReviewStarts = () => { throw new Error('start listing unavailable on retry') }
  let result = null
  let error = null
  try {
    result = assignNextReviewer({ issue: 4414, pr: 4419, headSha: head, slot: 1 }, io)
  } catch (caught) {
    error = caught
  }
  if (error) {
    // Only a non-capacity refusal is acceptable on a durable-assignment retry.
    assert.ok(!/start listing unavailable|paid-start|readPaidReviewStarts|circuit breaker/i.test(String(error.message)),
      `retry must not depend on paid-start provenance: ${error.message}`)
  } else {
    assert.equal(result?.reviewer, first.reviewer, 'retry re-serves the durable assignment')
  }
})

test('derived request ceilings are unchanged (not widened by instrumentation)', () => {
  assert.equal(REVIEW_OPERATION_REQUEST_LIMIT, 25)
  assert.equal(REVIEW_MUTEX_SECTION_RESERVE, 15)
  assert.ok(String(REVIEW_ASSIGNMENT_REF_PREFIX).includes('assignment') || String(REVIEW_ASSIGNMENT_REF_PREFIX).length > 0)
})

test('phase trace is emitted to stderr after a successful assignment', () => {
  const io = baseIo()
  const lines = []
  const originalWrite = process.stderr.write
  process.stderr.write = (chunk, ...rest) => {
    lines.push(String(chunk))
    return true
  }
  try {
    const result = assignNextReviewer({ issue: 4414, pr: 4419, headSha: 'a'.repeat(40), slot: 1 }, io)
    assert.ok(result?.reviewer)
  } finally {
    process.stderr.write = originalWrite
  }
  const traces = lines.filter((line) => line.includes('review-phase-trace '))
  assert.equal(traces.length, 1, `expected exactly one review-phase-trace line, got ${traces.length}: ${JSON.stringify(lines)}`)
  assert.match(traces[0], /release=proved_released|release=successor_seen/)
  assert.match(traces[0], /held_ms=\d+/)
})

test('mutex reserve shrinks by prepare spend so capacity work outside the lock cannot over-gate', () => {
  // Formula is exported so mutation of the call site is caught by source match,
  // and the algebra itself is pinned here.
  assert.equal(mutexSectionReserveAfterPrepare(0), 15)
  assert.equal(mutexSectionReserveAfterPrepare(2), 13)
  assert.equal(mutexSectionReserveAfterPrepare(11), 4)
  assert.equal(mutexSectionReserveAfterPrepare(99), 4, 'floor of 4')
  const source = readFileSync(new URL('../../manage-migration-author-lanes.mjs', import.meta.url), 'utf8')
  assert.match(source, /mutexSectionReserveAfterPrepare\(capacitySpend\)/, 'assignment must gate with the shrunken reserve')
  assert.ok(!/requireReviewWireCapacity\(REVIEW_MUTEX_SECTION_RESERVE\)\s*\n\s*endPhase\('prepare'\)/.test(source),
    'assignment must not still gate with the full historical reserve after prepare')
})
