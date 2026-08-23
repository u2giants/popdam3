// Fenced, recoverable exclusive stage leases (Step 6, issue #1366).
//
// THE PROBLEM
// -----------
// Preview, guarded merge, and production promotion are exclusive: one holder at a
// time, enforced by a Git ref. If the job holding one CRASHES, the ref stays. No
// automated path frees it, so the lane is held until a human notices — and the
// people who would notice are the sessions now silently queued behind it.
//
// WHY THERE IS NO HEARTBEAT, AND NO LEASE CLOCK
// ---------------------------------------------
// The obvious design — a 30-minute lease renewed every 10 minutes — was specified
// and then removed, for three reasons that are all verifiable in this repository:
//
//   1. IT WOULD STRAND EVERY LANE. `releaseOwnedRef` compares the ref's CURRENT
//      sha against the sha captured at acquisition, and every calling workflow
//      stashes that acquisition sha at lock time. A heartbeat moves the ref sha,
//      so the first renewal would make release refuse and the stage stay locked
//      forever — precisely the failure the step exists to fix.
//
//   2. IT WOULD OPEN THE WINDOW IT CLAIMS TO CLOSE. `updateRef` PATCHes with
//      force=true and no expected-sha: there is NO Git-level compare-and-swap
//      here. A heartbeat writing the ref without holding MUTEX_REF could
//      overwrite a recovery that had already incremented the generation, which is
//      exactly the split ownership fencing is for.
//
//   3. IT BUYS NO SIGNAL GITHUB DOES NOT ALREADY GIVE. Recovery is forbidden
//      while the recorded run is alive, so a clock can never fire during healthy
//      work. The heartbeat's only job would be stopping a 30-minute clock looking
//      stale during a legitimate 90-minute apply. If assert treated expiry as
//      failure, a dead background renewer would fail a healthy production apply;
//      if it ignored expiry, the duration would be dead code.
//
// LIVENESS IS A LIVE QUERY. Recovery asks GitHub, at decision time, whether the
// recorded run is finished — and reads the CURRENT latest run_attempt, never the
// attempt stored in the lease. A re-run reuses GITHUB_RUN_ID, so a stored attempt
// can make a live run look completed.

export class LeaseError extends Error {}

export const LEASE_BLOCK_VERSION = 1

// The recognized-lock prefix `recoverStaleAuthorMutex` matches. It MUST remain the
// first line of the owner commit message: that function refuses to free any mutex
// whose message it does not recognise, so a new format would make a crash DURING
// acquisition — mutex held, exclusive ref possibly created — permanently
// unrecoverable by .github/workflows/recover-author-mutex.yml.
export const RECOGNIZED_PREFIX = 'db-coordination'

// Grace after a run is conclusively finished, before its lane may be taken over.
// A finished run can still have a database session closing behind it; GitHub
// fencing cannot see that, so time is the only cover available at this layer.
export const RECOVERY_GRACE_MS = 10 * 60 * 1000

const TERMINAL_CONCLUSIONS = Object.freeze(['success', 'failure', 'cancelled', 'timed_out', 'startup_failure', 'stale', 'neutral', 'skipped', 'action_required'])

/**
 * Format the owner commit message for an exclusive lease.
 *
 * Line 1 keeps the exact legacy shape so `recoverStaleAuthorMutex` still
 * recognises it. The metadata follows as `key: value` lines.
 */
export function formatLeaseMessage(kind, metadata) {
  if (!kind) throw new LeaseError('a lease needs its stage kind')
  const required = ['requestId', 'holderId', 'headSha', 'generation', 'acquiredAt']
  for (const field of required) {
    if (metadata?.[field] === undefined || metadata[field] === null || metadata[field] === '') throw new LeaseError(`lease metadata is missing ${field}`)
  }
  if (!Number.isInteger(metadata.generation) || metadata.generation <= 0) throw new LeaseError('lease generation must be a positive integer')

  const lines = [
    `${RECOGNIZED_PREFIX} ${kind} ${metadata.requestId} pr=${metadata.pr ?? 'none'} head=${metadata.headSha}`,
    '',
    `lease_version: ${LEASE_BLOCK_VERSION}`,
    // EXACT KIND, not just the ref. preview, preview-recovery and
    // preview-rehearsal share ONE ref, so a recovery that cannot tell them apart
    // does not know what it is fencing.
    `kind: ${kind}`,
    `holder_id: ${metadata.holderId}`,
    `github_run_id: ${metadata.githubRunId ?? 'none'}`,
    `github_run_attempt: ${metadata.githubRunAttempt ?? 'none'}`,
    `owner: ${metadata.owner ?? 'none'}`,
    `pr: ${metadata.pr ?? 'none'}`,
    `head_sha: ${metadata.headSha}`,
    `migration_versions: ${(metadata.migrationVersions ?? []).join(',') || 'none'}`,
    `acquired_at: ${metadata.acquiredAt}`,
    `generation: ${metadata.generation}`,
  ]
  if (metadata.previousOwnerSha) lines.push(`recovered_from: ${metadata.previousOwnerSha}`)
  return lines.join('\n')
}

export function parseLeaseMessage(message) {
  if (typeof message !== 'string' || !message.trim()) throw new LeaseError('lease message is empty')
  const [first, ...rest] = message.split('\n')
  if (!first.startsWith(`${RECOGNIZED_PREFIX} `)) {
    throw new LeaseError(`lease message must start with "${RECOGNIZED_PREFIX} <kind>" so recoverStaleAuthorMutex still recognises it`)
  }
  const fields = new Map()
  for (const raw of rest) {
    const line = raw.trim()
    if (!line) continue
    const match = /^([a-z_]+):\s*(.*)$/.exec(line)
    if (match) fields.set(match[1], match[2].trim())
  }
  // A LEGACY LEASE HAS NO METADATA BLOCK. Say so explicitly rather than
  // returning something that looks like a modern lease with empty fields.
  if (!fields.has('lease_version')) {
    return { legacy: true, kind: first.split(' ')[1] ?? null, generation: null, holderId: null, githubRunId: null }
  }
  const generation = Number(fields.get('generation'))
  if (!Number.isInteger(generation) || generation <= 0) throw new LeaseError('lease generation is missing or not a positive integer')
  const none = (value) => (value === 'none' || value === undefined ? null : value)
  return {
    legacy: false,
    leaseVersion: Number(fields.get('lease_version')),
    kind: fields.get('kind') ?? null,
    holderId: fields.get('holder_id') ?? null,
    githubRunId: none(fields.get('github_run_id')),
    githubRunAttempt: none(fields.get('github_run_attempt')),
    owner: none(fields.get('owner')),
    pr: none(fields.get('pr')),
    headSha: fields.get('head_sha') ?? null,
    migrationVersions: (none(fields.get('migration_versions')) ?? '').split(',').filter(Boolean),
    acquiredAt: fields.get('acquired_at') ?? null,
    generation,
    recoveredFrom: none(fields.get('recovered_from')),
  }
}

/**
 * Fence a side-effecting operation: does the lease on the ref right now still
 * belong to this holder, at this generation, for this exact work?
 *
 * Called immediately BEFORE every preview, merge, or production side effect. A
 * check at acquisition time proves nothing about the moment of the write.
 */
export function assertLease(lease, expected) {
  if (!lease) throw new LeaseError('no lease is held on this stage')
  if (lease.legacy) throw new LeaseError('the lease on this stage predates generation fencing; release and re-acquire it rather than writing against it')
  if (expected.holderId && lease.holderId !== expected.holderId) {
    throw new LeaseError(`this stage is held by ${lease.holderId}, not ${expected.holderId}; a takeover has happened and this job must stop`)
  }
  if (expected.generation !== undefined && lease.generation !== expected.generation) {
    throw new LeaseError(`lease generation is ${lease.generation}, this job holds ${expected.generation}; it has been recovered by another holder and must not write`)
  }
  if (expected.kind && lease.kind !== expected.kind) throw new LeaseError(`this ref currently holds a ${lease.kind} lease, not ${expected.kind}`)
  if (expected.headSha && lease.headSha !== expected.headSha) throw new LeaseError(`lease is for head ${lease.headSha}, this job is working on ${expected.headSha}`)
  if (expected.pr && String(lease.pr) !== String(expected.pr)) throw new LeaseError(`lease is for PR ${lease.pr}, this job is PR ${expected.pr}`)
  if (expected.migrationVersions) {
    const held = [...lease.migrationVersions].sort().join(',')
    const want = [...expected.migrationVersions].sort().join(',')
    if (held !== want) throw new LeaseError(`lease covers migration versions [${held}], this job is applying [${want}]`)
  }
  return lease
}

/**
 * May this lease be taken over? Pure: the caller supplies the live run state, so
 * every refusal below is exhaustively testable.
 *
 * Returns { recoverable, reason }. EVERY UNCERTAINTY REFUSES.
 */
export function evaluateRecovery(lease, runState, now = new Date()) {
  if (!lease) return { recoverable: false, reason: 'there is no lease on this ref to recover' }
  if (lease.legacy) {
    return { recoverable: false, reason: 'this lease predates generation fencing and carries no run identity; it must be released by its owner or by a human, never taken over automatically' }
  }
  // A LOCAL ACQUISITION HAS NO RUN TO BE TERMINAL. acquireExclusive is a public
  // CLI, so a laptop can hold a lane. Inventing a sentinel run id to make it
  // recoverable would be inventing evidence.
  if (!lease.githubRunId) {
    return { recoverable: false, reason: 'this lease was acquired outside GitHub Actions and has no run to prove terminal; only its recorded owner may release it' }
  }
  if (!runState) return { recoverable: false, reason: `run ${lease.githubRunId} could not be read; unreadable is not finished` }
  if (runState.unreadable) return { recoverable: false, reason: `run ${lease.githubRunId} could not be read (${runState.unreadable}); unreadable is not finished` }
  if (runState.status !== 'completed') {
    return { recoverable: false, reason: `run ${lease.githubRunId} is ${runState.status}; a lease is never taken from a live job, however long it has been running` }
  }
  if (!TERMINAL_CONCLUSIONS.includes(runState.conclusion)) {
    return { recoverable: false, reason: `run ${lease.githubRunId} reports conclusion ${runState.conclusion ?? 'none'}, which is not conclusively terminal` }
  }
  // A RE-RUN REUSES THE RUN ID. Trusting the attempt stored in the lease would
  // let a live re-attempt look finished.
  if (runState.latestAttemptActive) {
    return { recoverable: false, reason: `run ${lease.githubRunId} has a later attempt still running; the recorded attempt finishing proves nothing` }
  }
  if (runState.newerRunActive) {
    return { recoverable: false, reason: `another run for the same PR and head is still active; recovering now could produce two live holders` }
  }
  if (!runState.completedAt) return { recoverable: false, reason: `run ${lease.githubRunId} reports no completion time, so the grace period cannot be measured` }
  const elapsed = now.getTime() - Date.parse(runState.completedAt)
  if (Number.isNaN(elapsed)) return { recoverable: false, reason: `run ${lease.githubRunId} has an unreadable completion time` }
  if (elapsed < RECOVERY_GRACE_MS) {
    const remaining = Math.ceil((RECOVERY_GRACE_MS - elapsed) / 1000)
    return { recoverable: false, reason: `run ${lease.githubRunId} finished ${Math.floor(elapsed / 1000)}s ago; ${remaining}s of grace remain, because a finished job can still have a database session closing behind it` }
  }
  return { recoverable: true, reason: `run ${lease.githubRunId} is ${runState.conclusion}, its grace has elapsed, and no later attempt or run is active` }
}

/** The metadata a recovery writes: same stage, new holder, generation + 1. */
export function recoveredLeaseMetadata(lease, { holderId, githubRunId, githubRunAttempt, acquiredAt, previousOwnerSha, requestId }) {
  if (!holderId) throw new LeaseError('a recovery must name its new holder')
  if (!previousOwnerSha) throw new LeaseError('a recovery must record the owner sha it replaced, or the takeover is unauditable')
  return {
    requestId,
    holderId,
    githubRunId,
    githubRunAttempt,
    owner: lease.owner,
    pr: lease.pr,
    headSha: lease.headSha,
    migrationVersions: lease.migrationVersions,
    acquiredAt,
    generation: lease.generation + 1,
    previousOwnerSha,
  }
}
