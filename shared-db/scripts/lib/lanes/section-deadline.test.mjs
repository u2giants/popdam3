// Issue #4414 plan step 4: bounded owned-section I/O, ambiguous-commit
// reconciliation, and no quota wait under ownership. Fake clock and fake io;
// no wall-clock performance assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assignNextReviewer,
  withReviewRequestBudget,
  reviewChildTimeoutMs,
  reconcileAtomicReviewBatch,
  setReviewMonotonicClock,
  runGitHubCommand,
  gitRemoteRefs,
  MUTEX_REF,
  REVIEW_MUTEX_SECTION_DEADLINE_MS,
  REVIEW_MUTEX_CLEANUP_ALLOWANCE_MS,
  REVIEW_ACTIVE_CUTOVER_REF,
} from '../../manage-migration-author-lanes.mjs'
import { REPO } from './constants.mjs'

const HEAD = 'a'.repeat(40)
function usable(row) {
  return { provider: row.provider, status: 'ready', usable: true, admission: { schema_version: 1, provider: row.provider, state: 'unknown', reason: 'unscopable', quota_state: 'unknown', reset_at: null, credential_profile_scope: null, model_scope: null } }
}
function atomicIo() {
  const refs = new Map([[REVIEW_ACTIVE_CUTOVER_REF, 'cutover-complete']])
  const commits = new Map()
  let next = 1
  const rows = (prefix) => [...refs.entries()].filter(([ref]) => ref.startsWith(prefix)).map(([ref, sha]) => ({ ref, sha, commit: commits.get(sha) }))
  return {
    refs, commits,
    makeOwnerCommit(message) { const sha = String(next++).padStart(40, '0'); commits.set(sha, { message, committer: { date: new Date().toISOString() } }); return sha },
    requiresExactReviewHeadSha: true, enableReviewerQueue: false,
    resolveReviewEngine: () => 'claude',
    reviewerUsability: (reviewers) => new Map(reviewers.map((row) => [row.provider, usable(row)])),
    pauseReviewerFailure: () => {},
    readPaidReviewStarts: rows,
    readRef: (ref) => refs.get(ref) ?? null,
    listRefs: rows,
    getCommit: (sha) => commits.get(sha),
    getPr: (pr) => ({ state: 'open', number: Number(pr), head: { sha: HEAD } }),
    getIssue: () => ({ state: 'open' }),
    getIssueComments: () => [], getPrReviews: () => [],
    createRef(ref, sha) { if (refs.has(ref)) return false; refs.set(ref, sha); return true },
    updateRef: (ref, sha) => { refs.set(ref, sha) },
    deleteRef: (ref) => { refs.delete(ref) },
    readReviewStates: (list) => new Map(list.map((l) => [`${l.issue}:${l.pr}`, { issue: { state: 'open', number: Number(l.issue) }, pr: { state: 'open', number: Number(l.pr), head: { sha: HEAD } } }])),
    readReviewRefs: (list) => new Map(list.map((ref) => [ref, refs.get(ref) ?? null])),
    applyBatch(changes) { for (const c of changes) { if (c.sha) refs.set(c.ref, c.sha); else refs.delete(c.ref) } },
    atomicReviewRefs(changes) {
      for (const c of changes) if ((refs.get(c.ref) ?? null) !== (c.expected ?? null)) throw new Error(`stale ${c.ref}`)
      this.applyBatch(changes)
    },
    atomicReviewMutexRelease(owner) { if (refs.get(MUTEX_REF) === owner) refs.delete(MUTEX_REF) },
    wait: () => {},
    getRateLimit: () => ({ remaining: 5000, limit: 5000, reset: 0, graphRemaining: 5000, graphLimit: 5000, graphReset: 0 }),
  }
}
function withClock(fn) {
  let now = 1000
  const previous = setReviewMonotonicClock(() => now)
  try { return fn({ advance: (ms) => { now += ms }, get now() { return now } }) } finally { setReviewMonotonicClock(previous) }
}

test('outside ownership the per-call default bound is unchanged', () => {
  assert.equal(reviewChildTimeoutMs(120000), 120000)
  withReviewRequestBudget(() => assert.equal(reviewChildTimeoutMs(60000), 60000))
})

test('owned children are capped by the remaining section deadline on a monotonic clock', () => withClock((clock) => {
  const io = atomicIo()
  const seen = []
  const raw = io.readReviewRefs
  io.readReviewRefs = (list) => {
    if (io.refs.has(MUTEX_REF)) { seen.push(reviewChildTimeoutMs(10 * 60 * 1000)); clock.advance(60 * 1000) }
    return raw(list)
  }
  const result = assignNextReviewer({ issue: 4414, pr: 4419, headSha: HEAD, slot: 1 }, io)
  assert.ok(result?.reviewer)
  assert.ok(seen.length >= 2, 'reads happened under ownership')
  assert.equal(seen[0], REVIEW_MUTEX_SECTION_DEADLINE_MS, 'first owned call gets the full section budget, never more')
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] < seen[i - 1], 'remaining budget only shrinks')
  assert.equal(io.refs.has(MUTEX_REF), false, 'mutex released')
  assert.equal(reviewChildTimeoutMs(5), 5, 'deadline cleared after release')
}))

test('exhausted section refuses before launching a child, and release still runs on its own allowance', () => withClock((clock) => {
  const io = atomicIo()
  let batchLaunched = false
  const rawBatch = io.atomicReviewRefs.bind(io)
  io.atomicReviewRefs = (changes) => {
    const assignment = changes.length > 1
    if (assignment) { reviewChildTimeoutMs(60000); batchLaunched = true }
    return rawBatch(changes)
  }
  const rawStates = io.readReviewStates
  let releaseBudget = null
  io.readReviewStates = (list) => {
    if (io.refs.has(MUTEX_REF)) clock.advance(REVIEW_MUTEX_SECTION_DEADLINE_MS)
    return rawStates(list)
  }
  const rawRelease = io.atomicReviewMutexRelease
  io.atomicReviewMutexRelease = (owner) => { releaseBudget = reviewChildTimeoutMs(10 * 60 * 1000); return rawRelease(owner) }
  assert.throws(() => assignNextReviewer({ issue: 4414, pr: 4419, headSha: HEAD, slot: 1 }, io), /deadline; refused before launching/)
  assert.equal(batchLaunched, false, 'no write launched after the deadline')
  assert.equal(releaseBudget, REVIEW_MUTEX_CLEANUP_ALLOWANCE_MS, 'release got its reserved cleanup allowance')
  assert.equal(io.refs.has(MUTEX_REF), false, 'our mutex was released')
}))

test('ambiguous atomic commit that actually landed is preserved, never redrawn', () => {
  const io = atomicIo()
  const rawBatch = io.atomicReviewRefs.bind(io)
  let assignmentCalls = 0
  io.atomicReviewRefs = (changes) => {
    if (changes.length === 4) { assignmentCalls++; rawBatch(changes); const e = new Error('atomic reviewer ref transition failed (timed out; result unknown until readback)'); e.atomicOutcomeUnknown = true; throw e }
    return rawBatch(changes)
  }
  const result = assignNextReviewer({ issue: 4414, pr: 4419, headSha: HEAD, slot: 1 }, io)
  assert.ok(result?.reviewer)
  assert.match(result.reconciledAfter, /timed out/)
  assert.equal(assignmentCalls, 1, 'exactly one paid-draw write, no redraw')
  assert.equal(io.refs.has(MUTEX_REF), false)
})

test('reconcile: provably uncommitted is a retryable no-write refusal; partial is recovery-required', () => {
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

test('an inherited GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS never waits while the mutex is held', () => withClock(() => {
  const saved = process.env.GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS
  process.env.GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS = '900'
  try {
    const io = atomicIo()
    let waited = 0, calls = 0, timeouts = []
    const raw = io.readReviewRefs
    io.readReviewRefs = (list) => {
      if (io.refs.has(MUTEX_REF) && calls === 0) {
        calls++
        const executor = (bin, args, options) => { timeouts.push(options.timeout); const e = new Error('rate'); e.stderr = 'HTTP 403: API rate limit exceeded'; throw e }
        assert.throws(() => runGitHubCommand(['api', 'repos/x/y'], { executor, wait: () => { waited++ } }), /rate limit/)
      }
      return raw(list)
    }
    assignNextReviewer({ issue: 4414, pr: 4419, headSha: HEAD, slot: 1 }, io)
    assert.equal(calls, 1)
    assert.equal(waited, 0, 'no quota wait under ownership')
    assert.equal(timeouts.length, 1, 'one attempt, no probe/replay')
    assert.ok(timeouts[0] <= REVIEW_MUTEX_SECTION_DEADLINE_MS)
  } finally {
    if (saved === undefined) delete process.env.GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS; else process.env.GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS = saved
  }
}))

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

test('production gitRemoteRefs refuses before launch once the section is exhausted', () => withClock((clock) => {
  const io = atomicIo(); const launched = []; wireRefs(io, launched)
  const rawStates = io.readReviewStates
  let refusedLaunch = null
  io.readReviewStates = (list) => {
    if (io.refs.has(MUTEX_REF)) {
      clock.advance(REVIEW_MUTEX_SECTION_DEADLINE_MS)
      const before = launched.length
      assert.throws(() => io.readReviewRefs([MUTEX_REF]), /exhausted its mutex-held section deadline/)
      refusedLaunch = launched.length === before
    }
    return rawStates(list)
  }
  assert.throws(() => assignNextReviewer({ issue: 4414, pr: 4419, headSha: HEAD, slot: 1 }, io), /deadline/)
  assert.equal(refusedLaunch, true, 'ls-remote never launched after the deadline')
  assert.equal(io.refs.has(MUTEX_REF), false, 'release still ran on its reserved allowance')
}))

test('timed-out push with an exhausted section still reconciles on the cleanup allowance (no-write => retryable)', () => withClock((clock) => {
  const io = atomicIo(); const launched = []; wireRefs(io, launched)
  io.atomicReviewRefs = function (changes) {
    if (changes.length === 4) { clock.advance(REVIEW_MUTEX_SECTION_DEADLINE_MS); const e = new Error('atomic reviewer ref transition failed (timed out; result unknown until readback)'); throw e }
    for (const c of changes) { if (c.sha) this.refs.set(c.ref, c.sha); else this.refs.delete(c.ref) }
  }
  assert.throws(() => assignNextReviewer({ issue: 4414, pr: 4419, headSha: HEAD, slot: 1 }, io), (e) => e.retryableNoWrite === true && /did NOT commit/.test(e.message))
  assert.equal(io.refs.has(MUTEX_REF), false)
}))

test('the section deadline does not depend on a request budget (archiveOldReviewVerdicts holds the mutex without one)', () => {
  const source = readFileSync(new URL('../../manage-migration-author-lanes.mjs', import.meta.url), 'utf8')
  assert.match(source, /function startReviewSectionDeadline\(\)\{reviewSectionDeadline=/, 'deadline is module state, not gated on reviewWireBudget')
  const archive = source.slice(source.indexOf('export function archiveOldReviewVerdicts'))
  assert.match(archive.slice(0, 2000), /acquireReviewMutex\(ownerSha,io\)/, 'archive acquires through acquireReviewMutex, which starts the deadline')
  assert.equal(reviewChildTimeoutMs(undefined), undefined, 'no deadline outside ownership')
})
