// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { parseLeaseMessage, assertLease } from '../../lib/exclusive-lease.mjs'
import { EXCLUSIVE_REFS } from './queue-routing.mjs'
import { LaneError } from './claims.mjs'
import { githubIo } from '../../manage-migration-author-lanes.mjs'
import {
  EXCLUSIVE_LOCK_ORDER,
  assertExclusiveAcquisitionPolicy,
  assertExclusivePairCompatibility,
  assertProductionFreshnessForExclusive,
  compatibilityMatrixCases,
  defaultCompatibilityPlan,
  pairKindForExclusiveKind,
} from './exclusive-policy.mjs'

// Pure lock-manager policy (Step 10, issue #3781). Re-exported here so callers
// of the exclusive-lock surface get the compatibility-matrix assertions without
// importing the policy module directly. `assertExclusiveAcquisitionPolicy` is
// the entry point: production freshness under the unified production-inert
// rule, promotion-freeze blocking of merge, and pair compatibility against
// every held exclusive kind (including the merge/production cross-ref
// interlocks). The existing `readExclusiveLease` / `assertExclusive` fencing
// below is unchanged and still required immediately before every write.
export {
  EXCLUSIVE_LOCK_ORDER,
  assertExclusiveAcquisitionPolicy,
  assertExclusivePairCompatibility,
  assertProductionFreshnessForExclusive,
  compatibilityMatrixCases,
  defaultCompatibilityPlan,
  pairKindForExclusiveKind,
}

// --- FENCED STAGE OPERATIONS (Step 6, issue #1366) -------------------------
//
// EVERY ONE OF THESE TAKES THE GLOBAL MUTEX FIRST. `updateRef` PATCHes with
// force=true and no expected-sha, so there is NO Git-level compare-and-swap here:
// the mutex is the only thing making read-then-write atomic. An unserialised
// release could delete a ref a recovery had already replaced.

/** Read the lease currently on a stage's ref, or null when the lane is free. */
export function readExclusiveLease(kind, io = githubIo) {
  const ref = EXCLUSIVE_REFS[kind]
  if (!ref) throw new LaneError(`unknown exclusive lane: ${kind}`)
  const sha = io.readRef(ref)
  if (!sha) return null
  const message = io.readCommitMessage?.(sha)
  if (!message) throw new LaneError(`the lease on ${ref} is unreadable; refusing to guess who holds it`)
  return { ...parseLeaseMessage(message), ref, sha }
}

/**
 * Fence a side effect. Run IMMEDIATELY before every preview, merge or production
 * write: a check performed at acquisition time proves nothing about the moment
 * the write happens.
 */
export function assertExclusive(kind, expected, io = githubIo) {
  const lease = readExclusiveLease(kind, io)
  assertLease(lease, expected)
  return lease
}
