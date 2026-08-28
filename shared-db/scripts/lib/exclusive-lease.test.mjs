import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LeaseError, RECOGNIZED_PREFIX, RECOVERY_GRACE_MS, LEASE_BLOCK_VERSION,
  formatLeaseMessage, parseLeaseMessage, assertLease, evaluateRecovery, recoveredLeaseMetadata,
} from './exclusive-lease.mjs'

const NOW = new Date('2026-08-23T12:00:00Z')
const meta = (over = {}) => ({
  requestId: 'req-1', holderId: 'github-actions:555', githubRunId: '555', githubRunAttempt: '1',
  owner: 'github-actions:555', pr: 42, headSha: 'abc1234', migrationVersions: ['20260823120000'],
  acquiredAt: '2026-08-23T11:00:00Z', generation: 1, ...over,
})
const finished = (over = {}) => ({ status: 'completed', conclusion: 'failure', completedAt: '2026-08-23T11:30:00Z', ...over })

// --- FORMAT AND PARSE ------------------------------------------------------

// THE COMPATIBILITY THAT MATTERS MOST. recoverStaleAuthorMutex refuses to free any
// mutex whose owner commit it does not recognise. A new format that broke this
// would make a crash DURING acquisition permanently unrecoverable.
test('the first line keeps the exact prefix recoverStaleAuthorMutex recognises', () => {
  const message = formatLeaseMessage('merge', meta())
  assert.match(message.split('\n')[0], new RegExp(`^${RECOGNIZED_PREFIX} merge `))
  const recoveryRegex = /^db-coordination (?:author-acquisition|author-capacity-relinquish|author-capacity-resume|preview|merge|production|claim-release|claim-split-recovery|claim-object-expansion|claim-reversion|claim-version-supersession|claim-lease-renewal|reviewer-assignment-lock|reviewer-replacement-lock)\b/
  for (const kind of ['preview', 'merge', 'production']) {
    assert.match(formatLeaseMessage(kind, meta()), recoveryRegex, `${kind} must stay recoverable by recover-author-mutex.yml`)
  }
})

test('a lease round-trips through format and parse', () => {
  const parsed = parseLeaseMessage(formatLeaseMessage('preview', meta()))
  assert.equal(parsed.legacy, false)
  assert.equal(parsed.leaseVersion, LEASE_BLOCK_VERSION)
  assert.equal(parsed.kind, 'preview')
  assert.equal(parsed.holderId, 'github-actions:555')
  assert.equal(parsed.githubRunId, '555')
  assert.equal(parsed.generation, 1)
  assert.deepEqual(parsed.migrationVersions, ['20260823120000'])
})

// preview, preview-recovery and preview-rehearsal share ONE ref. A recovery that
// cannot tell them apart does not know what it is fencing.
test('the exact kind is recorded, not just the ref it lives on', () => {
  for (const kind of ['preview', 'preview-recovery', 'preview-rehearsal']) {
    assert.equal(parseLeaseMessage(formatLeaseMessage(kind, meta())).kind, kind)
  }
})

test('a lease without its required metadata is refused at format time', () => {
  for (const field of ['requestId', 'holderId', 'headSha', 'generation', 'acquiredAt']) {
    assert.throws(() => formatLeaseMessage('merge', meta({ [field]: undefined })), new RegExp(`missing ${field}`))
  }
  assert.throws(() => formatLeaseMessage('merge', meta({ generation: 0 })), /positive integer/)
})

// A LEGACY LEASE MUST ANNOUNCE ITSELF, not masquerade as a modern one with empty
// fields, because empty fields would compare equal to an absent expectation.
test('a pre-Step-6 lease is reported as legacy rather than as generation-less', () => {
  const legacy = parseLeaseMessage('db-coordination merge req-9 pr=42 head=abc1234')
  assert.equal(legacy.legacy, true)
  assert.equal(legacy.generation, null)
  assert.equal(legacy.kind, 'merge')
})

test('an unrecognised message shape is refused', () => {
  assert.throws(() => parseLeaseMessage(''), /is empty/)
  assert.throws(() => parseLeaseMessage('something else entirely'), /must start with/)
})

// --- ASSERT: fencing immediately before a side effect ----------------------

test('a matching lease passes the pre-write assertion', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('merge', meta()))
  assert.doesNotThrow(() => assertLease(lease, { holderId: 'github-actions:555', generation: 1, kind: 'merge', headSha: 'abc1234', pr: 42, migrationVersions: ['20260823120000'] }))
})

// THIS IS THE WHOLE POINT OF THE GENERATION. An old holder that wakes up after a
// takeover must refuse to write.
test('a stale generation refuses, so a superseded holder cannot write', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('merge', meta({ generation: 2 })))
  assert.throws(() => assertLease(lease, { holderId: 'github-actions:555', generation: 1 }), /has been recovered by another holder and must not write/)
})

test('a different holder refuses', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('merge', meta()))
  assert.throws(() => assertLease(lease, { holderId: 'github-actions:999', generation: 1 }), /a takeover has happened and this job must stop/)
})

test('a mismatched kind, head, PR or version set refuses', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('preview', meta()))
  assert.throws(() => assertLease(lease, { kind: 'merge' }), /currently holds a preview lease/)
  assert.throws(() => assertLease(lease, { headSha: 'dead999' }), /this job is working on dead999/)
  assert.throws(() => assertLease(lease, { pr: 43 }), /this job is PR 43/)
  assert.throws(() => assertLease(lease, { migrationVersions: ['20260101000000'] }), /this job is applying/)
})

test('no lease at all, or a legacy lease, refuses a side effect', () => {
  assert.throws(() => assertLease(null, {}), /no lease is held/)
  assert.throws(() => assertLease(parseLeaseMessage('db-coordination merge r pr=1 head=a'), {}), /predates generation fencing/)
})

// --- RECOVERY: every uncertainty refuses -----------------------------------

test('a finished run whose grace has elapsed is recoverable', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('merge', meta()))
  const verdict = evaluateRecovery(lease, finished(), NOW)
  assert.equal(verdict.recoverable, true, verdict.reason)
})

// NEVER TAKE A LANE FROM A LIVE JOB, however long it has been running. This is
// what makes the absence of a lease clock safe.
test('a running job keeps its lane no matter how long it has held it', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('production', meta({ acquiredAt: '2026-08-20T00:00:00Z' })))
  const verdict = evaluateRecovery(lease, { status: 'in_progress' }, NOW)
  assert.equal(verdict.recoverable, false)
  assert.match(verdict.reason, /never taken from a live job, however long/)
})

test('an unreadable run refuses, because unreadable is not finished', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('merge', meta()))
  assert.equal(evaluateRecovery(lease, null, NOW).recoverable, false)
  assert.match(evaluateRecovery(lease, { unreadable: 'HTTP 500' }, NOW).reason, /unreadable is not finished/)
})

test('a non-terminal conclusion refuses', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('merge', meta()))
  assert.match(evaluateRecovery(lease, finished({ conclusion: null }), NOW).reason, /not conclusively terminal/)
})

// A RE-RUN REUSES GITHUB_RUN_ID, so the stored attempt is worthless as evidence.
test('a later attempt still running refuses, even though the recorded run completed', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('merge', meta()))
  const verdict = evaluateRecovery(lease, finished({ latestAttemptActive: true }), NOW)
  assert.equal(verdict.recoverable, false)
  assert.match(verdict.reason, /the recorded attempt finishing proves nothing/)
})

test('another active run for the same PR and head refuses', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('merge', meta()))
  assert.match(evaluateRecovery(lease, finished({ newerRunActive: true }), NOW).reason, /two live holders/)
})

// GRACE COVERS THE DATABASE SESSION GITHUB CANNOT SEE.
test('recovery refuses inside the grace period and says how long remains', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('merge', meta()))
  const verdict = evaluateRecovery(lease, finished({ completedAt: '2026-08-23T11:55:00Z' }), NOW)
  assert.equal(verdict.recoverable, false)
  assert.match(verdict.reason, /300s of grace remain/)
  assert.match(verdict.reason, /database session closing behind it/)
  assert.equal(RECOVERY_GRACE_MS, 600000)
})

test('a missing or unreadable completion time refuses rather than assuming', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('merge', meta()))
  assert.match(evaluateRecovery(lease, finished({ completedAt: null }), NOW).reason, /grace period cannot be measured/)
  assert.match(evaluateRecovery(lease, finished({ completedAt: 'soon' }), NOW).reason, /unreadable completion time/)
})

// A LAPTOP CAN HOLD A LANE. Inventing a sentinel run id to make it recoverable
// would be inventing evidence.
test('a lease acquired outside Actions is never auto-recoverable', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('preview', meta({ githubRunId: undefined })))
  const verdict = evaluateRecovery(lease, finished(), NOW)
  assert.equal(verdict.recoverable, false)
  assert.match(verdict.reason, /only its recorded owner may release it/)
})

test('a legacy lease is never auto-recoverable', () => {
  const verdict = evaluateRecovery(parseLeaseMessage('db-coordination merge r pr=1 head=a'), finished(), NOW)
  assert.equal(verdict.recoverable, false)
  assert.match(verdict.reason, /never taken over automatically/)
})

test('there is no lease to recover when the ref is free', () => {
  assert.equal(evaluateRecovery(null, finished(), NOW).recoverable, false)
})

// --- RECOVERY METADATA -----------------------------------------------------

test('a recovery increments the generation and records who it replaced', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('merge', meta({ generation: 3 })))
  const next = recoveredLeaseMetadata(lease, { holderId: 'github-actions:777', githubRunId: '777', githubRunAttempt: '1', acquiredAt: NOW.toISOString(), previousOwnerSha: 'old1234', requestId: 'req-2' })
  assert.equal(next.generation, 4)
  assert.equal(next.previousOwnerSha, 'old1234')
  assert.equal(next.headSha, lease.headSha, 'a recovery fences the SAME work, it does not repurpose the lane')
  assert.deepEqual(next.migrationVersions, lease.migrationVersions)
  assert.match(formatLeaseMessage('merge', next), /recovered_from: old1234/)
})

// AN UNAUDITABLE TAKEOVER IS WORSE THAN A STUCK LANE, because nobody can later
// establish who was holding what.
test('a recovery that names no previous owner or no new holder is refused', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('merge', meta()))
  assert.throws(() => recoveredLeaseMetadata(lease, { holderId: 'x', acquiredAt: 'now' }), /must record the owner sha it replaced/)
  assert.throws(() => recoveredLeaseMetadata(lease, { previousOwnerSha: 'old' }), /must name its new holder/)
})

test('the recovered lease then fences the old holder out', () => {
  const lease = parseLeaseMessage(formatLeaseMessage('merge', meta({ generation: 1 })))
  const next = recoveredLeaseMetadata(lease, { holderId: 'new', githubRunId: '777', acquiredAt: 'now', previousOwnerSha: 'old', requestId: 'r2' })
  const recovered = parseLeaseMessage(formatLeaseMessage('merge', next))
  assert.throws(() => assertLease(recovered, { holderId: 'github-actions:555', generation: 1 }), /must stop/)
  assert.doesNotThrow(() => assertLease(recovered, { holderId: 'new', generation: 2 }))
})

test('LeaseError is the single error type callers catch', () => {
  assert.throws(() => parseLeaseMessage(''), LeaseError)
  assert.throws(() => assertLease(null, {}), LeaseError)
})
