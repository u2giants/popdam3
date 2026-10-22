// Issue #3779 step 8a: ownership and release safety for exclusive stage leases.
//
// Every scenario below drives the REAL lane manager functions against an
// in-memory adapter that behaves like GitHub refs: create-if-absent, force
// update, delete, and commit messages readable by sha. No network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  releaseExclusive, recoverExclusive, assertExclusive, readExclusiveLease, EXCLUSIVE_REFS, MUTEX_REF, MUTEX_RECOVERY_ACTIVE_REF, main,
} from './manage-migration-author-lanes.mjs'
import { RECOVERY_GRACE_MS, formatLeaseMessage } from './lib/exclusive-lease.mjs'

const NOW = new Date('2026-10-21T12:00:00Z')
const HEAD = 'a'.repeat(40)
const MAIN = 'b'.repeat(40)

function leaseIo() {
  const refs = new Map(), commits = new Map(), calls = []; let seq = 0
  const io = {
    refs, commits, calls,
    runStates: new Map(),
    makeOwnerCommit(message) { const sha = (++seq).toString(16).padStart(40, '0'); commits.set(sha, message); return sha },
    createRef(ref, sha) { calls.push(['create', ref, sha]); if (refs.has(ref)) return false; refs.set(ref, sha); return true },
    readRef(ref) { return refs.get(ref) ?? null },
    updateRef(ref, sha) { calls.push(['update', ref, sha]); refs.set(ref, sha) },
    deleteRef(ref) { calls.push(['delete', ref]); refs.delete(ref) },
    readCommitMessage(sha) { return commits.get(sha) ?? null },
    getCommit(sha) { return { message: commits.get(sha), committer: { date: NOW.toISOString() } } },
    runState(runId) { return io.runStates.get(String(runId)) ?? null },
    mainSha: () => MAIN,
    openClaims: () => [], prSources: () => [], openPulls: () => [],
    getPr: (number) => ({ number: Number(number), state: 'open', head: { sha: HEAD, ref: 'claude/x' }, base: { sha: MAIN } }),
    wait: () => {},
  }
  return io
}
const finished = (over = {}) => ({ status: 'completed', conclusion: 'cancelled', completedAt: new Date(NOW.getTime() - RECOVERY_GRACE_MS - 60_000).toISOString(), ...over })
const quiet = (fn) => { const log = console.log, error = console.error; console.log = () => {}; console.error = () => {}; try { return fn() } finally { console.log = log; console.error = error } }
// Seed a lease exactly as acquireExclusive writes it (same formatter, same ref),
// without the admission/claim preflight that acquisition runs first; those
// preflights are covered by the lane manager suite and are not what these
// scenarios test.
function seedLease(io, kind, over = {}) {
  const meta = { requestId: 'req-100', holderId: 'github-actions:100', githubRunId: '100', githubRunAttempt: '1', owner: 'github-actions:100', pr: 7, headSha: HEAD, migrationVersions: [], acquiredAt: NOW.toISOString(), generation: 1, ...over }
  const ownerSha = io.makeOwnerCommit(formatLeaseMessage(kind, meta))
  assert.equal(io.createRef(EXCLUSIVE_REFS[kind], ownerSha), true)
  return { kind, ref: EXCLUSIVE_REFS[kind], ownerSha, holderId: meta.holderId, generation: meta.generation }
}
const acquire = (io, over = {}) => seedLease(io, 'merge', over)
const mutexReleased = (io) => assert.equal(io.refs.has(MUTEX_REF), false, 'the coordination mutex must be released')

// --- stale_generation_cannot_write_or_release --------------------------------

test('stale_generation_cannot_write_or_release: after recovery the original holder can neither assert nor release', () => {
  const io = leaseIo()
  const original = acquire(io)
  assert.equal(original.generation, 1)
  io.runStates.set('100', finished())
  const takeover = recoverExclusive('merge', { holderId: 'github-actions:200', apply: true, now: NOW }, io)
  assert.equal(takeover.recovered, true)
  assert.equal(takeover.generation, 2)
  mutexReleased(io)
  // The old holder wakes up and tries to fence a write.
  assert.throws(() => assertExclusive('merge', { holderId: 'github-actions:100', generation: 1, kind: 'merge' }, io), /held by github-actions:200|generation is 2/)
  // ...and tries to release by identity, by stale sha, and by both.
  assert.throws(() => releaseExclusive('merge', { holderId: 'github-actions:100', generation: 1 }, io), /held by github-actions:200|generation is 2/)
  assert.throws(() => releaseExclusive('merge', { ownerSha: original.ownerSha }, io), /held by github-actions:200|generation is 2|ownership moved/)
  assert.throws(() => releaseExclusive('merge', { holderId: 'github-actions:100', generation: 1, ownerSha: original.ownerSha }, io), /held by github-actions:200|generation is 2/)
  // Nothing of the successor's was touched, and no delete was ever issued.
  const current = readExclusiveLease('merge', io)
  assert.equal(current.holderId, 'github-actions:200')
  assert.equal(current.generation, 2)
  assert.equal(io.calls.some(([op, ref]) => op === 'delete' && ref === EXCLUSIVE_REFS.merge), false)
  mutexReleased(io)
  // The successor releases cleanly by its own identity.
  const released = releaseExclusive('merge', { holderId: 'github-actions:200', generation: 2 }, io)
  assert.equal(released.released, true)
  assert.equal(io.refs.has(EXCLUSIVE_REFS.merge), false)
  mutexReleased(io)
})

// --- two_recoverers_only_one_wins --------------------------------------------

test('two_recoverers_only_one_wins: two candidates observing the same old generation produce exactly one successor', () => {
  const io = leaseIo()
  acquire(io)
  io.runStates.set('100', finished())
  // Both evaluate the same stale lease outside the mutex (dry runs agree).
  assert.equal(recoverExclusive('merge', { holderId: 'github-actions:201', now: NOW }, io).wouldRecover, true)
  assert.equal(recoverExclusive('merge', { holderId: 'github-actions:202', now: NOW }, io).wouldRecover, true)
  const first = recoverExclusive('merge', { holderId: 'github-actions:201', apply: true, now: NOW }, io)
  assert.equal(first.recovered, true)
  const second = recoverExclusive('merge', { holderId: 'github-actions:202', apply: true, now: NOW }, io)
  assert.equal(second.recovered, false)
  assert.match(second.reason, /acquired outside GitHub Actions|is running|changed while recovery|never taken from a live job|could not be read/)
  const lease = readExclusiveLease('merge', io)
  assert.equal(lease.holderId, 'github-actions:201')
  assert.equal(lease.generation, 2)
  assert.equal(io.calls.filter(([op, ref]) => op === 'update' && ref === EXCLUSIVE_REFS.merge).length, 1, 'exactly one takeover write')
  mutexReleased(io)
  // Interleaved form: the second contender's under-mutex re-read sees the moved
  // generation even when its pre-mutex observation was identical.
  const io2 = leaseIo()
  acquire(io2)
  io2.runStates.set('100', finished())
  const originalRead = io2.readRef.bind(io2)
  let armed = true
  io2.readRef = (ref) => {
    // The moment the second recoverer starts taking the mutex (its first read
    // is the recovery-active marker), the first one has already replaced the
    // lease: simulate by applying the first takeover right then.
    if (armed && ref === MUTEX_RECOVERY_ACTIVE_REF) { armed = false; io2.readRef = originalRead; assert.equal(recoverExclusive('merge', { holderId: 'github-actions:301', apply: true, now: NOW }, io2).recovered, true) }
    return originalRead(ref)
  }
  const loser = recoverExclusive('merge', { holderId: 'github-actions:302', apply: true, now: NOW }, io2)
  assert.equal(loser.recovered, false)
  assert.match(loser.reason, /changed while recovery was being evaluated|recovery is active|remained occupied/)
  assert.equal(readExclusiveLease('merge', io2).holderId, 'github-actions:301')
  mutexReleased(io2)
})

// --- release_recovery_interleaving_preserves_successor -----------------------

test('release_recovery_interleaving_preserves_successor: an old holder\'s release racing a takeover never deletes the successor', () => {
  const io = leaseIo()
  const original = acquire(io)
  io.runStates.set('100', finished())
  // The old holder reads its own lease, then stalls; recovery lands in between.
  const observed = readExclusiveLease('merge', io)
  assert.equal(observed.sha, original.ownerSha)
  const takeover = recoverExclusive('merge', { holderId: 'github-actions:400', apply: true, now: NOW }, io)
  assert.equal(takeover.recovered, true)
  // The stalled holder resumes its release with everything it stashed.
  assert.throws(() => releaseExclusive('merge', { ownerSha: observed.sha }, io), /held by github-actions:400|generation is 2|ownership moved/)
  assert.throws(() => releaseExclusive('merge', { holderId: observed.holderId, generation: observed.generation }, io), /held by github-actions:400|generation is 2/)
  const successor = readExclusiveLease('merge', io)
  assert.equal(successor.holderId, 'github-actions:400')
  assert.equal(successor.generation, 2)
  assert.equal(successor.recoveredFrom, original.ownerSha)
  assert.equal(io.calls.some(([op, ref]) => op === 'delete' && ref === EXCLUSIVE_REFS.merge), false)
  mutexReleased(io)
  // Reverse interleaving: the old holder releases first; recovery then finds
  // nothing to recover and does not manufacture a lease.
  const io2 = leaseIo()
  const lock = acquire(io2)
  io2.runStates.set('100', finished())
  assert.equal(releaseExclusive('merge', { ownerSha: lock.ownerSha }, io2).released, true)
  const nothing = recoverExclusive('merge', { holderId: 'github-actions:401', apply: true, now: NOW }, io2)
  assert.equal(nothing.recovered, false)
  assert.equal(io2.refs.has(EXCLUSIVE_REFS.merge), false)
  // And a second release by the same holder is idempotent, not a delete.
  const again = releaseExclusive('merge', { ownerSha: lock.ownerSha }, io2)
  assert.equal(again.released, false)
  assert.equal(again.idempotent, true)
  mutexReleased(io2)
})

// --- legacy_sha_release_is_serialized_and_owner_bound ------------------------

test('legacy_sha_release_is_serialized_and_owner_bound: the --owner-sha CLI path runs under the mutex and binds to holder + generation', () => {
  const io = leaseIo()
  const lock = acquire(io)
  const before = io.calls.length
  const code = quiet(() => main(['--release-merge', '--owner-sha', lock.ownerSha], NOW, io))
  assert.equal(code, 0)
  const during = io.calls.slice(before)
  const mutexIndex = during.findIndex(([op, ref]) => op === 'create' && ref === MUTEX_REF)
  const deleteIndex = during.findIndex(([op, ref]) => op === 'delete' && ref === EXCLUSIVE_REFS.merge)
  assert.ok(mutexIndex >= 0, 'the release took the coordination mutex')
  assert.ok(deleteIndex > mutexIndex, 'the lease delete happened under the mutex')
  assert.equal(io.refs.has(EXCLUSIVE_REFS.merge), false)
  mutexReleased(io)

  // A sha that is not a lease commit, an unreadable sha, or a malformed sha refuses.
  const io2 = leaseIo()
  acquire(io2)
  assert.throws(() => releaseExclusive('merge', { ownerSha: 'f'.repeat(40) }, io2), /unreadable/)
  const stray = io2.makeOwnerCommit('db-coordination author-acquisition request-1')
  assert.throws(() => releaseExclusive('merge', { ownerSha: stray }, io2), /not a lease commit|pre-Step-6 lease commit|another owner/)
  assert.throws(() => releaseExclusive('merge', { ownerSha: 'abc' }, io2), /40-hex/)
  assert.throws(() => releaseExclusive('merge', {}, io2), /needs --holder-id and --generation, or the acquisition --owner-sha/)
  assert.throws(() => releaseExclusive('merge', { holderId: 'x' }, io2), /BOTH/)
  assert.throws(() => releaseExclusive('merge', { holderId: 'x', generation: 0 }, io2), /positive integer/)
  assert.equal(io2.refs.has(EXCLUSIVE_REFS.merge), true, 'nothing was released')
  mutexReleased(io2)

  // A sha from ANOTHER lane's acquisition (same holder id, other kind) refuses.
  const io3 = leaseIo()
  const merge = acquire(io3)
  const preview = seedLease(io3, 'preview')
  assert.throws(() => releaseExclusive('merge', { ownerSha: preview.ownerSha }, io3), /ownership moved|holds a preview lease|not merge/)
  assert.equal(io3.refs.get(EXCLUSIVE_REFS.merge), merge.ownerSha)
  mutexReleased(io3)

  // Legacy (pre-fencing) lease: only its exact sha releases it, and it is never
  // upgraded or taken over.
  const io4 = leaseIo()
  const legacySha = io4.makeOwnerCommit('db-coordination merge req-9 pr=42 head=abc1234')
  io4.refs.set(EXCLUSIVE_REFS.merge, legacySha)
  assert.throws(() => releaseExclusive('merge', { holderId: 'anyone', generation: 1 }, io4), /pre-Step-6 lease; release it with its exact acquisition sha/)
  assert.throws(() => releaseExclusive('merge', { ownerSha: 'e'.repeat(40) }, io4), /another owner/)
  io4.runStates.set('100', finished())
  assert.equal(recoverExclusive('merge', { holderId: 'github-actions:500', apply: true, now: NOW }, io4).recovered, false)
  assert.equal(io4.refs.get(EXCLUSIVE_REFS.merge), legacySha)
  const legacyRelease = releaseExclusive('merge', { ownerSha: legacySha }, io4)
  assert.equal(legacyRelease.legacy, true)
  assert.equal(io4.refs.has(EXCLUSIVE_REFS.merge), false)
  mutexReleased(io4)

  // A modern --owner-sha release for a fenced lane also refuses a stale sha
  // whose holder+generation still match but whose ref sha moved outside
  // acquisition/recovery (a rewrite nobody serialized).
  const io5 = leaseIo()
  const lock5 = acquire(io5)
  const rewritten = io5.makeOwnerCommit(io5.readCommitMessage(lock5.ownerSha))
  io5.refs.set(EXCLUSIVE_REFS.merge, rewritten)
  assert.throws(() => releaseExclusive('merge', { ownerSha: lock5.ownerSha }, io5), /ownership moved/)
  assert.equal(io5.refs.get(EXCLUSIVE_REFS.merge), rewritten)
  mutexReleased(io5)

  // Modern identity release accepts --holder-id/--generation from the CLI.
  const io6 = leaseIo()
  const lock6 = acquire(io6)
  assert.equal(quiet(() => main(['--release-merge', '--holder-id', lock6.holderId, '--generation', String(lock6.generation)], NOW, io6)), 0)
  assert.equal(io6.refs.has(EXCLUSIVE_REFS.merge), false)
  mutexReleased(io6)
})

test('a different ref sha after our delete is never read as proof of our own release', () => {
  const io = leaseIo()
  const lock = acquire(io)
  // A writer that bypasses the mutex re-creates the ref right after our delete.
  const originalDelete = io.deleteRef.bind(io)
  io.deleteRef = (ref) => { originalDelete(ref); if (ref === EXCLUSIVE_REFS.merge) io.refs.set(ref, 'c'.repeat(40)) }
  assert.throws(() => releaseExclusive('merge', { ownerSha: lock.ownerSha }, io), /not proven|different sha is not proof/)
  assert.equal(io.refs.get(EXCLUSIVE_REFS.merge), 'c'.repeat(40), 'the foreign ref is untouched')
  mutexReleased(io)
})

test('the direct releaseOwnedRef CLI fast path is gone and every --release-<lane> flag reaches releaseExclusive', () => {
  const source = readFileSync(new URL('./manage-migration-author-lanes.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /releaseOwnedRef\(EXCLUSIVE_REFS\[o\.releaseExclusive\]/, 'the unserialized SHA fast path must not return')
  assert.match(source, /releaseExclusive\(o\.releaseExclusive, \{ holderId: o\.holderId, generation: o\.generation, ownerSha: o\.ownerSha \}, io\)/)
  for (const lane of ['preview', 'preview-recovery', 'preview-rehearsal', 'merge', 'production']) {
    const io = leaseIo()
    const lock = seedLease(io, lane)
    assert.equal(quiet(() => main([`--release-${lane}`, '--owner-sha', lock.ownerSha], NOW, io)), 0, `${lane} releases through the CLI`)
    assert.equal(io.refs.has(EXCLUSIVE_REFS[lane]), false)
    mutexReleased(io)
  }
})

test('issue 4604: a shared-ref release accepts any preview kind but still binds owner and generation', () => {
  for (const held of ['preview', 'preview-recovery', 'preview-rehearsal']) {
    for (const asked of ['preview', 'preview-recovery', 'preview-rehearsal']) {
      const io = leaseIo()
      const lock = seedLease(io, held)
      const result = releaseExclusive(asked, { ownerSha: lock.ownerSha }, io)
      assert.equal(result.released, true, `${asked} releases a ${held} lease on the shared ref`)
      assert.equal(io.refs.has(EXCLUSIVE_REFS.preview), false)
      mutexReleased(io)
    }
  }
  // The CLI path the workflows use, with the rehearsal lease that broke #4604.
  const io = leaseIo()
  const lock = seedLease(io, 'preview-rehearsal')
  assert.equal(quiet(() => main(['--release-preview', '--owner-sha', lock.ownerSha], NOW, io)), 0)
  assert.equal(io.refs.has(EXCLUSIVE_REFS.preview), false)
  // Identity still binds: a different holder or generation on the shared ref refuses.
  const io2 = leaseIo()
  seedLease(io2, 'preview-rehearsal')
  assert.throws(() => releaseExclusive('preview', { holderId: 'github-actions:999', generation: 1 }, io2), /held by github-actions:100/)
  assert.throws(() => releaseExclusive('preview', { holderId: 'github-actions:100', generation: 2 }, io2), /generation is 1/)
  assert.equal(io2.refs.has(EXCLUSIVE_REFS.preview), true)
  // A lease on a DIFFERENT ref is never released through this lane.
  const io3 = leaseIo()
  const merge = seedLease(io3, 'merge')
  assert.equal(releaseExclusive('production', { ownerSha: merge.ownerSha }, io3).released, false)
  io3.refs.set(EXCLUSIVE_REFS.production, merge.ownerSha)
  assert.throws(() => releaseExclusive('production', { ownerSha: merge.ownerSha }, io3), /does not live on this ref/)
  io3.refs.delete(EXCLUSIVE_REFS.production)
  assert.equal(io3.refs.get(EXCLUSIVE_REFS.merge), merge.ownerSha)
  mutexReleased(io3)
})
