// Issue #3779 (Step 9 of #3306, plan_shared_release_hold_reduction.md step 3):
// merge PREPARATION runs outside the serial mutation lane; only the short
// protected merge job shares the repository-wide group, and even that group is
// never the authority -- the owner-bound, generation-fenced merge lease is.
//
// Two families of proof live here:
//   1. workflow SHAPE: read from the real guarded-migration-merge.yml, never a
//      copy, so a later edit that re-merges the jobs or moves a long wait back
//      under the lease fails this file;
//   2. lease BEHAVIOUR: the real acquire/assert/release/recover functions on an
//      in-memory ref store, exercised the way two simultaneous runs would race.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { jobBlocks, stepBlock } from './lib/workflow-jobs.mjs'
import { formatLeaseMessage, evaluateRecovery, RECOVERY_GRACE_MS } from './lib/exclusive-lease.mjs'
import { acquireExclusive, assertExclusive, releaseExclusive, recoverExclusive, readExclusiveLease, EXCLUSIVE_REFS, MUTEX_REF } from './manage-migration-author-lanes.mjs'

const workflow = readFileSync(new URL('../.github/workflows/guarded-migration-merge.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const jobs = jobBlocks(workflow)
const prepare = jobs.get('prepare')
const merge = jobs.get('merge')

// GitHub concurrency-group semantics, modelled only as far as the proof needs:
// per group, at most one RUNNING job and at most one PENDING job; a newer
// pending job REPLACES (cancels) the older pending one. That replacement is the
// very property that makes a group unusable as a durable FIFO contract.
function concurrencyGroupOf(block) {
  const m = /^ {4}concurrency:\n(?: {6}#.*\n)* {6}group: (.+)$/m.exec(block)
  return m?.[1]?.trim() ?? null
}
function simulateGroups(events) {
  const groups = new Map()
  const log = []
  const state = (g) => groups.get(g) ?? groups.set(g, { running: null, pending: null }).get(g)
  for (const ev of events) {
    const s = state(ev.group)
    if (ev.type === 'enqueue') {
      if (!s.running) { s.running = ev.job; log.push(`${ev.job} runs in ${ev.group}`) }
      else {
        if (s.pending) log.push(`${s.pending} cancelled (replaced while pending in ${ev.group})`)
        s.pending = ev.job; log.push(`${ev.job} pending in ${ev.group}`)
      }
    } else if (ev.type === 'finish') {
      assert.equal(s.running, ev.job, `${ev.job} was not running`)
      s.running = null; log.push(`${ev.job} finished`)
      if (s.pending) { s.running = s.pending; s.pending = null; log.push(`${s.running} runs in ${ev.group}`) }
    }
  }
  return log
}

test('preparation_wait_does_not_block_independent_merge', () => {
  assert.ok(prepare && merge, 'the guarded merge workflow must have a prepare job and a merge job')
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('\njobs:\n')), /^concurrency:/m,
    'a workflow-level group serialises preparation behind every other request; it must not come back')
  const prepareGroup = concurrencyGroupOf(prepare)
  const mergeGroup = concurrencyGroupOf(merge)
  assert.match(prepareGroup, /\$\{\{ inputs\.pull_request \}\}/, 'preparation is scheduled per request, never repository-wide')
  assert.equal(mergeGroup, 'shared-db-guarded-merge', 'only the protected merge job shares the repository-wide group')
  assert.match(merge, /^ {4}needs: prepare$/m)
  for (const block of [prepare, merge]) assert.match(block, /cancel-in-progress: false/, 'a job that may hold or be about to hold the lease is never cancelled by a later dispatch')

  // Every long external wait is in the unlocked, per-request job.
  assert.ok(stepBlock(prepare, 'Pre-flight the required status checks before taking the merge lane'), 'the bounded preflight wait belongs to preparation')
  assert.ok(stepBlock(prepare, 'Check the GitHub API quota before taking the merge lane'), 'the quota wait belongs to preparation')
  assert.match(prepare, /GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS: '900'/)
  assert.doesNotMatch(merge, /GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS: '900'/, 'the merge job never waits 900 seconds on anything; the lease would be held or queued meanwhile')
  assert.doesNotMatch(merge, /PREFLIGHT_WAIT_SECONDS: '[1-9]/, 'under the lease every wait is zero')
  assert.match(stepBlock(merge, 'Re-read required-check authority under the merge lock from protected main'), /PREFLIGHT_WAIT_SECONDS: '0'[\s\S]*GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS: '0'/)
  assert.ok(stepBlock(merge, 'Acquire the exclusive merge lane'), 'the lease is acquired in the protected job only')
  assert.equal(stepBlock(prepare, 'Acquire the exclusive merge lane'), null, 'preparation never touches the lease')
  assert.doesNotMatch(prepare, /--acquire-merge|--release-merge|-f state=/, 'preparation holds nothing and writes nothing')
  assert.match(prepare, /^ {4}permissions:\n(?: {6}(?:#.*|[a-z-]+: read)\n)+/m, 'preparation is granted read permissions only')
  assert.doesNotMatch(prepare, /^ {6}[a-z-]+: write$/m)
  assert.match(prepare, /^ {6}issues: read$/m, 'the self-service classifier falls back to github.token and reads the linked issue')
  // Both jobs check out protected main with full history: the lock's "main moved
  // independently" re-check needs a merge base (#3669), and the prepare job's
  // copy must not be the only one the guard certifies.
  for (const [label, block] of [['prepare', prepare], ['merge', merge]]) {
    const checkout = stepBlock(block, 'Check out protected main policy separately from the pull request')
    assert.ok(checkout, `${label} checks out protected main separately`)
    assert.match(checkout, /path: trusted-policy[\s\S]*fetch-depth: 0/, `${label}: a shallow trusted-policy checkout has no merge base`)
    assert.doesNotMatch(checkout, /fetch-depth: 1/)
  }
  assert.match(prepare, /head_sha: \$\{\{ steps\.executable_source\.outputs\.head \}\}/, 'the prepared head is the one git checked out, not the input echoed back')

  // Scheduling proof on the REAL groups: request A is stuck in preparation (its
  // quota wait), request B is independent and ready. B's protected merge runs
  // while A has not even entered the protected group.
  const groupFor = (job, pr) => (job === 'prepare' ? prepareGroup.replace('${{ inputs.pull_request }}', pr) : mergeGroup)
  const log = simulateGroups([
    { type: 'enqueue', group: groupFor('prepare', '101'), job: 'A.prepare' },
    { type: 'enqueue', group: groupFor('prepare', '202'), job: 'B.prepare' },
    { type: 'finish', group: groupFor('prepare', '202'), job: 'B.prepare' },
    { type: 'enqueue', group: groupFor('merge', '202'), job: 'B.merge' },
    { type: 'finish', group: groupFor('merge', '202'), job: 'B.merge' },
    // only now does A's quota wait end
    { type: 'finish', group: groupFor('prepare', '101'), job: 'A.prepare' },
    { type: 'enqueue', group: groupFor('merge', '101'), job: 'A.merge' },
  ])
  assert.deepEqual(log, [
    'A.prepare runs in shared-db-guarded-merge-prepare-101',
    'B.prepare runs in shared-db-guarded-merge-prepare-202',
    'B.prepare finished',
    'B.merge runs in shared-db-guarded-merge',
    'B.merge finished',
    'A.prepare finished',
    'A.merge runs in shared-db-guarded-merge',
  ])
  // The same timeline under the OLD workflow-wide group: B could not start at all.
  const old = simulateGroups([
    { type: 'enqueue', group: 'shared-db-guarded-merge', job: 'A' },
    { type: 'enqueue', group: 'shared-db-guarded-merge', job: 'B' },
  ])
  assert.deepEqual(old, ['A runs in shared-db-guarded-merge', 'B pending in shared-db-guarded-merge'])
})

test('pending_group_job_is_not_a_durable_fifo_and_authorizes_nothing', () => {
  // Three dispatches reach the protected group while one merge runs: the second
  // pending job REPLACES the first. The replaced run never executed a step, so
  // it never acquired, never wrote a status and must never be treated as queued
  // authority. The lease release is gated on this run's own acquisition.
  const log = simulateGroups([
    { type: 'enqueue', group: 'shared-db-guarded-merge', job: 'M1' },
    { type: 'enqueue', group: 'shared-db-guarded-merge', job: 'M2' },
    { type: 'enqueue', group: 'shared-db-guarded-merge', job: 'M3' },
  ])
  assert.ok(log.includes('M2 cancelled (replaced while pending in shared-db-guarded-merge)'))
  const release = stepBlock(merge, 'Release the exclusive merge lane with ownership proof')
  assert.match(release, /if: always\(\) && steps\.merge_lock\.outputs\.owner_sha != ''/, 'a run that never acquired releases nothing')
  const revoke = stepBlock(merge, 'Revoke authorization if the guarded merge did not complete')
  assert.match(revoke, /if: failure\(\) && steps\.merge_lock\.outputs\.owner_sha != ''/)
  // What preparation hands over is identity only, re-proven under the lease.
  const handover = stepBlock(merge, 'Refuse to proceed on an unprepared request')
  assert.ok(handover, 'the merge job binds itself to the prepared identity')
  assert.match(handover, /needs\.prepare\.outputs\.trusted_sha/)
  assert.match(handover, /needs\.prepare\.outputs\.head_sha/)
  assert.doesNotMatch(merge, /needs\.prepare\.outputs\.(?:authorized|approved|green|result)/, 'no transferable green flag exists')
  const lockIdx = merge.indexOf('      - name: Acquire the exclusive merge lane')
  for (const name of ['Re-read required-check authority under the merge lock from protected main', 'Require current main and rerun every applicable coordination guard', 'Re-prove the head and merge while the lock is held']) {
    assert.ok(merge.indexOf(`      - name: ${name}`) > lockIdx, `${name} must run under the lease, after acquisition`)
  }
  const underLock = merge.slice(lockIdx)
  for (const proof of ['check-required-checks-preflight.mjs', 'check-main-tip-freshness.mjs" --contains', 'check-pr-object-collisions.mjs', 'check-migration-pr-lease.mjs', 'check-exact-head-approval.mjs', '--queue-mode', 'matching-refs/db-coordination/promotion-freeze']) {
    assert.ok(underLock.includes(proof), `${proof} is re-proven under the lease`)
  }
})

// --- lease behaviour -------------------------------------------------------

function laneIo() {
  let seq = 0
  const refs = new Map(), messages = new Map()
  const runs = new Map()
  return {
    refs, messages, runs,
    openClaims: () => [], prSources: () => [], openPulls: () => [],
    makeOwnerCommit: (message) => { const sha = (++seq).toString(16).padStart(40, '0'); messages.set(sha, message); return sha },
    readCommitMessage: (sha) => messages.get(sha) ?? null,
    createRef: (ref, sha) => { if (refs.has(ref)) return false; refs.set(ref, sha); return true },
    readRef: (ref) => refs.get(ref) ?? null,
    updateRef: (ref, sha) => { refs.set(ref, sha) },
    listRefs: (prefix) => [...refs.entries()].filter(([ref]) => ref.startsWith(prefix)).map(([ref, sha]) => ({ ref, sha })),
    deleteRef: (ref) => { refs.delete(ref) },
    getPr: (number) => ({ number: Number(number), state: 'open', head: { sha: (Number(number) === 202 ? 'b' : 'a').repeat(40), ref: `codex/${number}` }, base: { sha: 'm'.repeat(40), ref: 'main' } }),
    mainSha: () => 'm'.repeat(40),
    getPrFiles: () => [{ filename: 'docs/example.md', status: 'modified' }],
    runState: (runId) => runs.get(String(runId)) ?? null,
    getCommit: (sha) => ({ message: messages.get(sha) ?? '' }),
  }
}
const runA = { owner: 'github-actions:1001', pr: 101, headSha: 'a'.repeat(40), githubRunId: '1001', githubRunAttempt: '1' }
const runB = { owner: 'github-actions:2002', pr: 202, headSha: 'b'.repeat(40), githubRunId: '2002', githubRunAttempt: '1' }

test('simultaneous_merges_admit_one_writer', () => {
  const io = laneIo()
  const first = acquireExclusive('merge', runA, io)
  assert.equal(io.readRef(EXCLUSIVE_REFS.merge), first.ownerSha)
  // The second request reaches acquisition while the first holds: refused,
  // naming the holder, and the ref is untouched.
  assert.throws(() => acquireExclusive('merge', runB, io), /occupied/)
  assert.equal(io.readRef(EXCLUSIVE_REFS.merge), first.ownerSha)
  assert.equal(io.readRef(MUTEX_REF), null, 'the coordination mutex is released after a refused acquisition')
  // The holder fences every write against its own identity; the loser cannot.
  assertExclusive('merge', { holderId: runA.owner, kind: 'merge', headSha: runA.headSha, pr: runA.pr }, io)
  assert.throws(() => assertExclusive('merge', { holderId: runB.owner, kind: 'merge' }, io), /held by github-actions:1001/)
  // Ownership-aware release: the loser cannot release the winner's lease.
  assert.throws(() => releaseExclusive('merge', { holderId: runB.owner, generation: 1 }, io), /held by github-actions:1001/)
  assert.equal(io.readRef(EXCLUSIVE_REFS.merge), first.ownerSha)
  const released = releaseExclusive('merge', { holderId: runA.owner, generation: 1 }, io)
  assert.equal(released.released, true)
  assert.equal(io.readRef(EXCLUSIVE_REFS.merge), null)
  // Only now does the second request win -- by acquiring, not by waiting its turn.
  const second = acquireExclusive('merge', runB, io)
  assert.equal(readExclusiveLease('merge', io).holderId, runB.owner)
  assert.notEqual(second.ownerSha, first.ownerSha)
})

test('merge_versus_production_race_admits_only_the_authorized_writer', () => {
  const io = laneIo()
  const held = acquireExclusive('merge', runA, io)
  assert.throws(() => acquireExclusive('production', { owner: 'promotion:7', headSha: 'm'.repeat(40), githubRunId: '7' }, io), /guarded merge is active/)
  releaseExclusive('merge', { holderId: runA.owner, generation: 1 }, io)
  const production = acquireExclusive('production', { owner: 'promotion:7', headSha: 'm'.repeat(40), githubRunId: '7' }, io)
  assert.equal(io.readRef(EXCLUSIVE_REFS.production), production.ownerSha)
  assert.throws(() => acquireExclusive('merge', runB, io), /frozen/)
  assert.notEqual(held.ownerSha, production.ownerSha)
})

test('expired_timestamp_alone_does_not_authorize_stealing_a_live_lock', () => {
  const io = laneIo()
  const old = new Date(Date.now() - 6 * 60 * 60 * 1000) // six hours ago: far past any grace
  acquireExclusive('merge', { ...runA, now: old }, io)
  // The recorded run is still in progress: however old the lease, no takeover.
  io.runs.set('1001', { status: 'in_progress', conclusion: null, completedAt: null })
  const live = recoverExclusive('merge', { holderId: runB.owner, apply: true }, io)
  assert.equal(live.recovered, false)
  assert.match(live.reason, /never taken from a live job/)
  assert.equal(readExclusiveLease('merge', io).holderId, runA.owner)
  // The run cannot be read at all: unreadable is not finished.
  io.runs.delete('1001')
  const unknown = recoverExclusive('merge', { holderId: runB.owner, apply: true }, io)
  assert.equal(unknown.recovered, false)
  assert.match(unknown.reason, /could not be read/)
  // Conclusively finished, grace elapsed, no later attempt: recoverable, and the
  // recovery bumps the generation so the old holder can neither write nor release.
  io.runs.set('1001', { status: 'completed', conclusion: 'cancelled', completedAt: new Date(Date.now() - RECOVERY_GRACE_MS - 1000).toISOString() })
  const taken = recoverExclusive('merge', { holderId: runB.owner, apply: true }, io)
  assert.equal(taken.recovered, true)
  assert.equal(taken.generation, 2)
  assert.throws(() => assertExclusive('merge', { holderId: runA.owner, generation: 1 }, io), /held by github-actions:2002/)
  assert.throws(() => releaseExclusive('merge', { holderId: runA.owner, generation: 1 }, io), /held by github-actions:2002/)
  assert.equal(readExclusiveLease('merge', io).generation, 2)
})

test('recovery verdict is pure and refuses every uncertainty', () => {
  const lease = { legacy: false, githubRunId: '1', generation: 1 }
  assert.equal(evaluateRecovery(lease, null).recoverable, false)
  assert.equal(evaluateRecovery(lease, { status: 'completed', conclusion: 'success', latestAttemptActive: true, completedAt: new Date(0).toISOString() }).recoverable, false)
  assert.equal(evaluateRecovery(lease, { status: 'completed', conclusion: 'success', newerRunActive: true, completedAt: new Date(0).toISOString() }).recoverable, false)
  assert.equal(evaluateRecovery(lease, { status: 'completed', conclusion: 'success', completedAt: new Date().toISOString() }).recoverable, false)
  assert.equal(evaluateRecovery({ legacy: true }, { status: 'completed', conclusion: 'success', completedAt: new Date(0).toISOString() }).recoverable, false)
  assert.equal(evaluateRecovery(lease, { status: 'completed', conclusion: 'success', completedAt: new Date(0).toISOString() }).recoverable, true)
  assert.ok(formatLeaseMessage('merge', { requestId: 'r', holderId: 'h', owner: 'h', pr: 1, headSha: 'a'.repeat(40), migrationVersions: [], acquiredAt: new Date(0).toISOString(), generation: 1 }).startsWith('db-coordination merge'))
})
