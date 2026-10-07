// Step 10 (#3781) — pure exclusive-lock compatibility policy.
//
// This module is intentionally pure: no GitHub I/O, no ref mutation, no
// workflow wiring. It owns the compatibility-matrix assertions and the
// production-freshness assertion the lock manager must satisfy, so they can be
// proven here without taking the contested `manage-migration-author-lanes.mjs`
// surface (open PRs #3622 #3666 #3627 #3636 #3626 own it). Wiring into
// `acquireExclusive` call sites is a later change on accepted current main.
//
// FAIL-CLOSED IS THE WHOLE POINT. Every unknown kind, every non-ALLOW pair
// decision, every non-fresh production tip, every live promotion freeze, every
// missing freshness input and every missing heldKinds list refuses with a
// LaneError. A policy that guesses in the permissive direction is worse than no
// policy at all.

import {
  PAIR_DECISIONS,
  evaluatePairCompatibility,
  evaluateProductionFreshness,
} from '../../target-queue-identity.mjs'
import { LaneError } from './claims.mjs'

// ---------------------------------------------------------------------------
// Exclusive lock order
// ---------------------------------------------------------------------------
//
// Real refs live in `queue-routing.mjs` (`EXCLUSIVE_REFS`). preview,
// preview-recovery and preview-rehearsal share ONE ref
// (`refs/db-coordination/preview`) and are therefore one exclusive lane: they
// map to the same pair kind below so a recovery cannot run beside an ordinary
// preview. merge and production are distinct refs, but they are additionally
// cross-checked against each other by the acquisition interlocks further down —
// the compatibility matrix alone would ALLOW them without freeze when their
// locks are disjoint, and the live lock manager is stricter than that.

export const EXCLUSIVE_LOCK_ORDER = Object.freeze(['merge', 'production', 'preview'])

const PAIR_KIND_BY_EXCLUSIVE_KIND = Object.freeze({
  preview: 'preview',
  'preview-recovery': 'preview',
  'preview-rehearsal': 'preview',
  merge: 'merge',
  production: 'production',
})

/** Map an exclusive lane kind to the compatibility-matrix pair kind. */
export function pairKindForExclusiveKind(kind) {
  const pairKind = PAIR_KIND_BY_EXCLUSIVE_KIND[kind]
  if (!pairKind) throw new LaneError(`unknown exclusive lane kind: ${JSON.stringify(kind)}`)
  return pairKind
}

/** The safe default plan: no shared evidence refs, one total lock order. */
export function defaultCompatibilityPlan() {
  return { sharedEvidenceRefs: [], lockOrder: [...EXCLUSIVE_LOCK_ORDER] }
}

// ---------------------------------------------------------------------------
// Pair compatibility
// ---------------------------------------------------------------------------

/**
 * Assert that two mutations may overlap. Throws LaneError unless the matrix
 * decision is ALLOW; returns the ALLOW result otherwise.
 */
export function assertExclusivePairCompatibility(left, right, plan = defaultCompatibilityPlan()) {
  let result
  try {
    result = evaluatePairCompatibility(left, right, plan)
  } catch (error) {
    throw new LaneError(`exclusive pair refused: ${error.message}`)
  }
  if (result.decision !== PAIR_DECISIONS.ALLOW) {
    throw new LaneError(`exclusive pair refused: ${result.decision}: ${result.reason}`)
  }
  return result
}

// ---------------------------------------------------------------------------
// Production freshness
// ---------------------------------------------------------------------------

/**
 * Assert that a production promotion is still against a fresh main tip.
 * Throws LaneError unless the unified production-inert policy says fresh;
 * returns the freshness object otherwise.
 */
export function assertProductionFreshnessForExclusive(state) {
  let freshness
  try {
    freshness = evaluateProductionFreshness(state)
  } catch (error) {
    throw new LaneError(`production freshness refused: ${error.message}`)
  }
  if (!freshness.fresh) {
    throw new LaneError(`production freshness refused: ${freshness.reason}`)
  }
  return freshness
}

// ---------------------------------------------------------------------------
// Acquisition policy
// ---------------------------------------------------------------------------
//
// Cross-ref interlocks retained from `acquireExclusive`. The compatibility
// matrix ALLOWs merge+production without freeze when locks are disjoint; the
// live lock manager additionally refuses production while the merge ref is held
// and merge while the production ref is held. Encoding them here keeps the
// policy layer at least as strict as the lock manager it will be wired into.
// A missing, null or unreadable promotion freeze is LIVE and blocks merge.

const CROSS_REF_INTERLOCKS = Object.freeze([
  {
    requester: 'production',
    held: 'merge',
    reason: 'a guarded merge is active; production promotion must wait',
  },
  {
    requester: 'merge',
    held: 'production',
    reason: 'production promotion is active; merges are frozen',
  },
])

function promotionFreezeIsLive(freeze) {
  // Fail closed: a missing, null or otherwise unreadable freeze state is
  // unknown, and unknown is LIVE — it blocks merge. Only an explicit
  // expired:true freeze (documented shape, optionally with active:false)
  // releases merges.
  if (freeze === null || freeze === undefined) return true
  if (freeze === true) return true
  return freeze.expired !== true
}

function sideFor(pairKind, details = {}) {
  return {
    kind: pairKind,
    target: details.target ?? null,
    freeze: details.freeze ?? false,
    evidenceRefs: details.evidenceRefs ?? [],
    locks: details.locks ?? [pairKind],
  }
}

/**
 * Assert that acquiring an exclusive lane is allowed right now.
 *
 * - kind 'production': liveState must carry dispatchMainSha, currentMainSha
 *   and changedPaths together (all three). Missing or partial freshness inputs
 *   refuse (fail closed — production acquisition never defers freshness).
 *   When all three are present, the unified production-inert freshness policy
 *   must pass.
 * - kind 'merge': a live promotion freeze refuses. A missing, null or
 *   unreadable freeze is live and blocks; only an explicit expired:true
 *   freeze releases the lane.
 * - any kind: liveState.heldKinds is REQUIRED (use [] when none are held).
 *   The requested kind must be pair-compatible with every held kind, and the
 *   merge/production cross-ref interlocks must not fire. A missing heldKinds
 *   refuses — the pair matrix must always run.
 *
 * Returns `{ kind, pairKind }`. Throws LaneError on every refusal.
 */
export function assertExclusiveAcquisitionPolicy(kind, metadata = {}, liveState = {}) {
  const pairKind = pairKindForExclusiveKind(kind)

  if (liveState.heldKinds === undefined) {
    throw new LaneError(
      'heldKinds is required; provide the held kind list (use [] when none are held) so the pair matrix can run',
    )
  }
  if (!Array.isArray(liveState.heldKinds)) {
    throw new LaneError('heldKinds must be an array')
  }

  if (kind === 'production') {
    const provided = [
      liveState.dispatchMainSha !== undefined,
      liveState.currentMainSha !== undefined,
      liveState.changedPaths !== undefined,
    ]
    if (!provided.some(Boolean)) {
      throw new LaneError(
        'production freshness inputs are required; provide dispatchMainSha, currentMainSha and changedPaths together (production acquisition never defers freshness)',
      )
    }
    if (!provided.every(Boolean)) {
      throw new LaneError(
        'production freshness inputs are partial; provide dispatchMainSha, currentMainSha and changedPaths together',
      )
    }
    assertProductionFreshnessForExclusive(liveState)
  }

  if (kind === 'merge' && promotionFreezeIsLive(liveState.promotionFreeze)) {
    const freeze = liveState.promotionFreeze
    const detail = freeze === true
      ? 'promotion freeze is set'
      : freeze === null || freeze === undefined
        ? 'promotion freeze state is unknown (treated as live)'
        : freeze.unreadable
          ? `promotion freeze ${freeze.sha ?? 'unknown'} is unreadable`
          : `promotion merge freeze held by ${JSON.stringify(freeze.owner ?? 'unknown')}`
    throw new LaneError(`merges are paused for a production run; ${detail}`)
  }

  const requested = sideFor(pairKind, metadata)
  for (const held of liveState.heldKinds) {
    const heldPairKind = pairKindForExclusiveKind(held?.kind)
    for (const interlock of CROSS_REF_INTERLOCKS) {
      if (pairKind === interlock.requester && heldPairKind === interlock.held) {
        throw new LaneError(`${interlock.reason}; ${JSON.stringify(held.kind)} is held`)
      }
    }
    const heldSide = sideFor(heldPairKind, held)
    if (held.freeze !== undefined) heldSide.freeze = held.freeze
    assertExclusivePairCompatibility(requested, heldSide, liveState.plan)
  }

  return { kind, pairKind }
}

// ---------------------------------------------------------------------------
// Acceptance matrix fixtures
// ---------------------------------------------------------------------------

/**
 * Assertion fixtures covering the acceptance matrix. Each case names the pair
 * sides, the plan and the expected PAIR_DECISIONS value. A non-ALLOW expected
 * decision means `assertExclusivePairCompatibility` must throw carrying that
 * decision; ALLOW means it must return a result with that decision.
 */
export function compatibilityMatrixCases() {
  const previewTarget = { role: 'preview', targetId: 'preview-a', projectRef: 'prevprojectref01' }
  const productionTarget = { role: 'production', targetId: 'production-main', projectRef: 'prodprojectref01' }
  const sharedTarget = { role: 'production', targetId: 'shared-db', projectRef: 'onerefvalue0001' }
  const plan = defaultCompatibilityPlan()
  return [
    {
      name: 'preview/preview same role FORBID',
      left: { kind: 'preview', target: previewTarget, locks: ['preview'], evidenceRefs: [] },
      right: { kind: 'preview', target: previewTarget, locks: ['preview'], evidenceRefs: [] },
      plan,
      expected: PAIR_DECISIONS.FORBID_SAME_ROLE,
    },
    {
      name: 'production/production FORBID',
      left: { kind: 'production', target: productionTarget, locks: ['production'], evidenceRefs: [] },
      right: { kind: 'production', target: productionTarget, locks: ['production'], evidenceRefs: [] },
      plan,
      expected: PAIR_DECISIONS.FORBID_SAME_ROLE,
    },
    {
      name: 'merge+production with freeze FORBID',
      left: { kind: 'merge', locks: ['merge'], evidenceRefs: [], freeze: true },
      right: { kind: 'production', target: productionTarget, locks: ['production'], evidenceRefs: [] },
      plan,
      expected: PAIR_DECISIONS.FORBID_FREEZE,
    },
    {
      name: 'merge+production without freeze ALLOW only if plan safe',
      left: { kind: 'merge', locks: ['merge'], evidenceRefs: [] },
      right: { kind: 'production', target: productionTarget, locks: ['production'], evidenceRefs: [] },
      plan,
      expected: PAIR_DECISIONS.ALLOW,
    },
    {
      name: 'preview+production distinct targets ALLOW with safe plan',
      left: {
        kind: 'preview',
        target: previewTarget,
        locks: ['preview'],
        evidenceRefs: ['refs/db-evidence/preview-ledger'],
      },
      right: {
        kind: 'production',
        target: productionTarget,
        locks: ['production'],
        evidenceRefs: ['refs/db-evidence/promotion'],
      },
      plan: {
        sharedEvidenceRefs: ['refs/db-evidence/promotion', 'refs/db-evidence/preview-ledger'],
        lockOrder: [...EXCLUSIVE_LOCK_ORDER],
      },
      expected: PAIR_DECISIONS.ALLOW,
    },
    {
      name: 'same physical target FORBID_SAME_TARGET',
      left: { kind: 'preview', target: sharedTarget, locks: ['preview'], evidenceRefs: [] },
      right: { kind: 'production', target: sharedTarget, locks: ['production'], evidenceRefs: [] },
      plan,
      expected: PAIR_DECISIONS.FORBID_SAME_TARGET,
    },
    {
      name: 'shared evidence ref overlap FORBID',
      left: {
        kind: 'preview',
        target: previewTarget,
        locks: ['preview'],
        evidenceRefs: ['refs/db-evidence/promotion'],
      },
      right: {
        kind: 'production',
        target: productionTarget,
        locks: ['production'],
        evidenceRefs: ['refs/db-evidence/promotion'],
      },
      plan: {
        sharedEvidenceRefs: ['refs/db-evidence/promotion'],
        lockOrder: [...EXCLUSIVE_LOCK_ORDER],
      },
      expected: PAIR_DECISIONS.FORBID_SHARED_EVIDENCE,
    },
    {
      name: 'lock order violation FORBID',
      left: { kind: 'merge', locks: ['production', 'merge'], evidenceRefs: [] },
      right: { kind: 'preview', target: previewTarget, locks: ['preview'], evidenceRefs: [] },
      plan,
      expected: PAIR_DECISIONS.FORBID_LOCK_ORDER,
    },
    {
      name: 'preview-recovery vs preview (same ref) FORBID_SAME_ROLE',
      left: {
        kind: pairKindForExclusiveKind('preview-recovery'),
        target: previewTarget,
        locks: ['preview'],
        evidenceRefs: [],
      },
      right: {
        kind: pairKindForExclusiveKind('preview'),
        target: previewTarget,
        locks: ['preview'],
        evidenceRefs: [],
      },
      plan,
      expected: PAIR_DECISIONS.FORBID_SAME_ROLE,
    },
    {
      name: 'both sides take the same exclusive lock kind FORBID_LOCK_ORDER',
      left: { kind: 'merge', locks: ['merge', 'preview'], evidenceRefs: [] },
      right: { kind: 'preview', target: previewTarget, locks: ['preview'], evidenceRefs: [] },
      plan,
      expected: PAIR_DECISIONS.FORBID_LOCK_ORDER,
    },
  ]
}
