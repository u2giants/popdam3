// Step 10 (#3781) — lock-manager compatibility matrix and unified production
// freshness, proven without taking the contested manage-migration-author-lanes
// surface. Fake-lock cases use a tiny in-memory io that mimics EXCLUSIVE_REFS.

import assert from 'node:assert/strict'
import test from 'node:test'
import { formatLeaseMessage } from '../exclusive-lease.mjs'
import { EXCLUSIVE_REFS } from './queue-routing.mjs'
import { LaneError } from './claims.mjs'
import {
  EXCLUSIVE_LOCK_ORDER,
  assertExclusiveAcquisitionPolicy,
  assertExclusivePairCompatibility,
  assertProductionFreshnessForExclusive,
  compatibilityMatrixCases,
  defaultCompatibilityPlan,
  pairKindForExclusiveKind,
} from './exclusive-policy.mjs'
import {
  PAIR_DECISIONS,
  evaluateProductionFreshness,
} from '../../target-queue-identity.mjs'

// ---------------------------------------------------------------------------
// Lock order and plan
// ---------------------------------------------------------------------------

test('EXCLUSIVE_LOCK_ORDER is a total order of the three exclusive lanes', () => {
  assert.deepEqual([...EXCLUSIVE_LOCK_ORDER], ['merge', 'production', 'preview'])
  assert.ok(Object.isFrozen(EXCLUSIVE_LOCK_ORDER))
})

test('preview, preview-recovery and preview-rehearsal share one pair kind (one exclusive ref)', () => {
  assert.equal(EXCLUSIVE_REFS.preview, EXCLUSIVE_REFS['preview-recovery'])
  assert.equal(EXCLUSIVE_REFS.preview, EXCLUSIVE_REFS['preview-rehearsal'])
  assert.equal(pairKindForExclusiveKind('preview'), 'preview')
  assert.equal(pairKindForExclusiveKind('preview-recovery'), 'preview')
  assert.equal(pairKindForExclusiveKind('preview-rehearsal'), 'preview')
  assert.equal(pairKindForExclusiveKind('merge'), 'merge')
  assert.equal(pairKindForExclusiveKind('production'), 'production')
  assert.throws(() => pairKindForExclusiveKind('preview-evil'), LaneError)
})

test('defaultCompatibilityPlan lists no shared evidence and one total lock order', () => {
  const plan = defaultCompatibilityPlan()
  assert.deepEqual(plan.sharedEvidenceRefs, [])
  assert.deepEqual(plan.lockOrder, [...EXCLUSIVE_LOCK_ORDER])
  // Mutating the returned plan must not corrupt the constant.
  plan.lockOrder.push('bogus')
  assert.deepEqual([...EXCLUSIVE_LOCK_ORDER], ['merge', 'production', 'preview'])
})

// ---------------------------------------------------------------------------
// Compatibility matrix
// ---------------------------------------------------------------------------

test('compatibility matrix cases cover the acceptance matrix', () => {
  const cases = compatibilityMatrixCases()
  const names = cases.map((c) => c.name)
  assert.ok(names.some((n) => /preview\/preview/.test(n)))
  assert.ok(names.some((n) => /production\/production/.test(n)))
  assert.ok(names.some((n) => /with freeze/.test(n)))
  assert.ok(names.some((n) => /without freeze/.test(n)))
  assert.ok(names.some((n) => /distinct targets/.test(n)))
  assert.ok(names.some((n) => /same physical target/.test(n)))
  assert.ok(names.some((n) => /shared evidence/.test(n)))
  assert.ok(names.some((n) => /lock order/.test(n)))
  assert.ok(names.some((n) => /preview-recovery vs preview/.test(n)))
})

for (const matrixCase of compatibilityMatrixCases()) {
  test(`matrix: ${matrixCase.name}`, () => {
    if (matrixCase.expected === PAIR_DECISIONS.ALLOW) {
      const result = assertExclusivePairCompatibility(
        matrixCase.left,
        matrixCase.right,
        matrixCase.plan,
      )
      assert.equal(result.decision, PAIR_DECISIONS.ALLOW)
    } else {
      assert.throws(
        () => assertExclusivePairCompatibility(matrixCase.left, matrixCase.right, matrixCase.plan),
        (error) => {
          assert.ok(error instanceof LaneError, `expected LaneError, got ${error?.name}`)
          assert.ok(
            error.message.includes(matrixCase.expected),
            `expected ${matrixCase.expected} in: ${error.message}`,
          )
          return true
        },
      )
    }
  })
}

test('assertExclusivePairCompatibility wraps evaluator refusals as LaneError', () => {
  assert.throws(
    () => assertExclusivePairCompatibility(
      { kind: 'bogus-kind', locks: [], evidenceRefs: [] },
      { kind: 'production', locks: ['production'], evidenceRefs: [] },
      defaultCompatibilityPlan(),
    ),
    LaneError,
  )
  assert.throws(
    () => assertExclusivePairCompatibility(
      { kind: 'merge', locks: ['merge'], evidenceRefs: [] },
      { kind: 'production', locks: ['production'], evidenceRefs: [] },
      { sharedEvidenceRefs: [] }, // lockOrder missing → fail closed
    ),
    LaneError,
  )
})

// ---------------------------------------------------------------------------
// Freshness unification (one production-inert policy)
// ---------------------------------------------------------------------------

const FRESH_BASE = {
  dispatchMainSha: 'a'.repeat(40),
  currentMainSha: 'a'.repeat(40),
  changedPaths: [],
  exactMatch: true,
}

test('freshness unification: exact tip is fresh and reuses the manifest', () => {
  const result = assertProductionFreshnessForExclusive(FRESH_BASE)
  assert.equal(result.fresh, true)
  assert.equal(result.reuseManifest, true)
})

test('freshness unification: docs-only drift is fresh under production-inert', () => {
  const result = assertProductionFreshnessForExclusive({
    dispatchMainSha: 'a'.repeat(40),
    currentMainSha: 'b'.repeat(40),
    changedPaths: ['docs/plan.md', 'README.md'],
  })
  assert.equal(result.fresh, true)
  assert.equal(result.reuseManifest, true)
})

test('freshness unification: test-only drift is fresh under production-inert', () => {
  const result = assertProductionFreshnessForExclusive({
    dispatchMainSha: 'a'.repeat(40),
    currentMainSha: 'b'.repeat(40),
    changedPaths: [
      'scripts/lib/lanes/exclusive-policy.test.mjs',
      'scripts/test_production_business_risk_gate_source_identity_mutations.py',
    ],
  })
  assert.equal(result.fresh, true)
  assert.match(result.reason, /production-inert/)
})

test('freshness unification: .agent evidence drift is fresh under production-inert', () => {
  const result = assertProductionFreshnessForExclusive({
    dispatchMainSha: 'a'.repeat(40),
    currentMainSha: 'b'.repeat(40),
    changedPaths: ['.agent/work/3781/5/contract.json', '.agent/completion.json'],
  })
  assert.equal(result.fresh, true)
  assert.equal(result.reuseManifest, true)
})

test('freshness unification: substantive drift (.mjs/.sql/.yml) is not fresh', () => {
  for (const path of [
    'scripts/check-main-tip-freshness.mjs',
    'supabase/migrations/20260929000001_x.sql',
    '.github/workflows/shared-supabase-migrations.yml',
    'supabase/config.toml',
  ]) {
    assert.throws(
      () => assertProductionFreshnessForExclusive({
        dispatchMainSha: 'a'.repeat(40),
        currentMainSha: 'b'.repeat(40),
        changedPaths: [path],
      }),
      (error) => {
        assert.ok(error instanceof LaneError)
        assert.ok(error.message.includes(path), error.message)
        return true
      },
      path,
    )
  }
})

test('freshness unification: empty changedPaths with a moved tip refuses', () => {
  assert.throws(
    () => assertProductionFreshnessForExclusive({
      dispatchMainSha: 'a'.repeat(40),
      currentMainSha: 'b'.repeat(40),
      changedPaths: [],
    }),
    (error) => {
      assert.ok(error instanceof LaneError)
      assert.match(error.message, /refusing rather than guessing/)
      return true
    },
  )
})

test('evaluateProductionFreshness and assertProductionFreshnessForExclusive agree on one policy', () => {
  const state = {
    dispatchMainSha: 'a'.repeat(40),
    currentMainSha: 'b'.repeat(40),
    changedPaths: ['scripts/lib/lanes/exclusive-policy.test.mjs', 'docs/x.md'],
  }
  const raw = evaluateProductionFreshness(state)
  assert.equal(raw.fresh, true)
  assert.equal(assertProductionFreshnessForExclusive(state).fresh, true)

  const substantive = {
    ...state,
    changedPaths: ['scripts/target-queue-identity.mjs'],
  }
  assert.equal(evaluateProductionFreshness(substantive).fresh, false)
  assert.throws(() => assertProductionFreshnessForExclusive(substantive), LaneError)
})

// ---------------------------------------------------------------------------
// Acquisition policy
// ---------------------------------------------------------------------------

test('acquisition policy: production with no freshness inputs refuses (never defers)', () => {
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('production', {}, { heldKinds: [] }),
    (error) => {
      assert.ok(error instanceof LaneError)
      assert.match(error.message, /production freshness inputs are required/)
      return true
    },
  )
})

test('acquisition policy: partial freshness inputs refuse fail-closed', () => {
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('production', {}, {
      dispatchMainSha: 'a'.repeat(40),
      // currentMainSha and changedPaths missing
      heldKinds: [],
    }),
    /partial/,
  )
})

test('acquisition policy: production with full fresh inputs returns the freshness result', () => {
  const result = assertExclusiveAcquisitionPolicy('production', {}, { ...FRESH_BASE, heldKinds: [] })
  assert.equal(result.kind, 'production')
  assert.equal(result.pairKind, 'production')
})

test('acquisition policy: unknown kind refuses', () => {
  assert.throws(() => assertExclusiveAcquisitionPolicy('preview-evil', {}, {}), LaneError)
})

test('acquisition policy: heldKinds is required (missing refuses)', () => {
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('preview', {}, {
      promotionFreeze: { expired: true },
    }),
    /heldKinds is required/,
  )
})

test('acquisition policy: heldKinds must be an array', () => {
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('preview', {}, { heldKinds: 'merge' }),
    /heldKinds must be an array/,
  )
})

test('acquisition policy: preview-recovery held does not postpone approved production', () => {
  // The 'preview recovery must not postpone approved production' property at
  // policy level: preview-recovery holds the preview exclusive ref, production
  // takes a different ref and a different pair kind, so the pair is ALLOW.
  const result = assertExclusiveAcquisitionPolicy('production', {}, {
    ...FRESH_BASE,
    heldKinds: [{ kind: 'preview-recovery' }],
  })
  assert.equal(result.pairKind, 'production')
})

test('acquisition policy: preview-rehearsal held does not postpone approved production', () => {
  const result = assertExclusiveAcquisitionPolicy('production', {}, {
    ...FRESH_BASE,
    heldKinds: [{ kind: 'preview-rehearsal' }],
  })
  assert.equal(result.pairKind, 'production')
})

test('acquisition policy: second production while one is held refuses (same role)', () => {
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('production', {}, {
      ...FRESH_BASE,
      heldKinds: [{ kind: 'production' }],
    }),
    (error) => {
      assert.ok(error instanceof LaneError)
      assert.match(error.message, /FORBID_SAME_ROLE/)
      return true
    },
  )
})

test('acquisition policy: preview-recovery while preview is held refuses (same ref)', () => {
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('preview-recovery', {}, {
      heldKinds: [{ kind: 'preview' }],
    }),
    /FORBID_SAME_ROLE/,
  )
})

test('acquisition policy: preview while preview-recovery is held refuses (same ref)', () => {
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('preview', {}, {
      heldKinds: [{ kind: 'preview-recovery' }],
    }),
    /FORBID_SAME_ROLE/,
  )
})

test('acquisition policy: production refuses while merge ref is held (cross-ref interlock)', () => {
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('production', {}, {
      ...FRESH_BASE,
      heldKinds: [{ kind: 'merge' }],
    }),
    (error) => {
      assert.ok(error instanceof LaneError)
      assert.match(error.message, /guarded merge is active/)
      return true
    },
  )
})

test('acquisition policy: merge refuses while production ref is held (cross-ref interlock)', () => {
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('merge', {}, {
      promotionFreeze: { expired: true },
      heldKinds: [{ kind: 'production' }],
    }),
    /production promotion is active; merges are frozen/,
  )
})

test('acquisition policy: merge refuses under a live promotion freeze', () => {
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('merge', {}, {
      promotionFreeze: { sha: 'freeze-sha-1', owner: 'prod-run', pr: 7, issue: 50, expired: false },
      heldKinds: [],
    }),
    /merges are paused for a production run/,
  )
})

test('acquisition policy: merge refuses under an unreadable promotion freeze (fail closed)', () => {
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('merge', {}, {
      promotionFreeze: { sha: 'freeze-sha-2', unreadable: true, expired: false },
      heldKinds: [],
    }),
    /unreadable/,
  )
})

test('acquisition policy: merge refuses when the promotion freeze state is unknown (fail closed)', () => {
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('merge', {}, { heldKinds: [] }),
    /merges are paused for a production run/,
  )
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('merge', {}, {
      promotionFreeze: null,
      heldKinds: [],
    }),
    /merges are paused for a production run/,
  )
})

test('acquisition policy: an expired promotion freeze does not block merge', () => {
  const result = assertExclusiveAcquisitionPolicy('merge', {}, {
    promotionFreeze: { sha: 'freeze-sha-3', owner: 'prod-run', expired: true },
    heldKinds: [],
  })
  assert.equal(result.kind, 'merge')
})

test('acquisition policy: promotion freeze does not block production or preview', () => {
  assert.equal(
    assertExclusiveAcquisitionPolicy('production', {}, {
      ...FRESH_BASE,
      promotionFreeze: { sha: 'f', expired: false },
      heldKinds: [],
    }).kind,
    'production',
  )
  assert.equal(
    assertExclusiveAcquisitionPolicy('preview', {}, {
      promotionFreeze: { sha: 'f', expired: false },
      heldKinds: [],
    }).kind,
    'preview',
  )
})

test('acquisition policy: same physical target under different roles refuses', () => {
  const shared = { role: 'production', targetId: 'shared-db', projectRef: 'onerefvalue0001' }
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('production', { target: shared }, {
      ...FRESH_BASE,
      heldKinds: [{ kind: 'preview', target: shared }],
    }),
    /FORBID_SAME_TARGET/,
  )
})

test('acquisition policy: shared evidence ref overlap refuses', () => {
  const plan = {
    sharedEvidenceRefs: ['refs/db-evidence/promotion'],
    lockOrder: [...EXCLUSIVE_LOCK_ORDER],
  }
  assert.throws(
    () => assertExclusiveAcquisitionPolicy(
      'production',
      { evidenceRefs: ['refs/db-evidence/promotion'] },
      {
        ...FRESH_BASE,
        plan,
        heldKinds: [{ kind: 'preview', evidenceRefs: ['refs/db-evidence/promotion'] }],
      },
    ),
    /FORBID_SHARED_EVIDENCE/,
  )
})

// ---------------------------------------------------------------------------
// Fake-lock live proof (in-memory io mimicking EXCLUSIVE_REFS)
// ---------------------------------------------------------------------------

function fakeExclusiveIo() {
  const refs = new Map()
  const messages = new Map()
  let seq = 0
  return {
    refs,
    readRef: (ref) => refs.get(ref) ?? null,
    readCommitMessage: (sha) => messages.get(sha) ?? null,
    makeOwnerCommit: (message) => {
      const sha = `owner-${++seq}`
      messages.set(sha, message)
      return sha
    },
    createRef: (ref, sha) => {
      if (refs.has(ref)) return false
      refs.set(ref, sha)
      return true
    },
    deleteRef: (ref) => {
      refs.delete(ref)
    },
  }
}

function occupy(io, kind, holderId = 'holder-1') {
  const ownerSha = io.makeOwnerCommit(formatLeaseMessage(kind, {
    requestId: 'req-1',
    holderId,
    headSha: 'b'.repeat(40),
    generation: 1,
    acquiredAt: '2026-10-06T00:00:00.000Z',
  }))
  assert.equal(io.createRef(EXCLUSIVE_REFS[kind], ownerSha), true)
  return ownerSha
}

test('fake-lock: holding preview-recovery does NOT block acquiring production (different exclusive refs)', () => {
  const io = fakeExclusiveIo()
  occupy(io, 'preview-recovery')
  // preview-recovery occupies the preview ref...
  assert.notEqual(io.readRef(EXCLUSIVE_REFS.preview), null)
  assert.equal(io.readRef(EXCLUSIVE_REFS['preview-recovery']), io.readRef(EXCLUSIVE_REFS.preview))
  // ...while the production ref stays free.
  assert.equal(io.readRef(EXCLUSIVE_REFS.production), null)
  // And the acquisition policy allows production while preview-recovery is held.
  const result = assertExclusiveAcquisitionPolicy('production', {}, {
    ...FRESH_BASE,
    heldKinds: [{ kind: 'preview-recovery' }],
  })
  assert.equal(result.kind, 'production')
})

test('fake-lock: second acquire of the same kind / same ref refuses (occupied)', () => {
  const io = fakeExclusiveIo()
  occupy(io, 'production', 'first-holder')
  // The ref is occupied: a second create refuses.
  assert.equal(io.createRef(EXCLUSIVE_REFS.production, 'second-owner'), false)
  // The policy refuses a second production while one is held.
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('production', {}, {
      ...FRESH_BASE,
      heldKinds: [{ kind: 'production' }],
    }),
    /FORBID_SAME_ROLE/,
  )
  // preview-recovery and preview share one ref: whichever is held, the other
  // cannot take the lane.
  occupy(io, 'preview-recovery', 'recovery-holder')
  assert.equal(io.createRef(EXCLUSIVE_REFS.preview, 'other-owner'), false)
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('preview', {}, {
      heldKinds: [{ kind: 'preview-recovery' }],
    }),
    /FORBID_SAME_ROLE/,
  )
})

test('fake-lock: production refuses while the merge ref is held (existing interlock semantics)', () => {
  const io = fakeExclusiveIo()
  occupy(io, 'merge')
  // The production ref is free at the ref level, but the merge/production
  // cross-ref interlock must still refuse — reproduced at policy level because
  // acquireExclusive lives in the contested manage-migration-author-lanes.mjs.
  assert.equal(io.readRef(EXCLUSIVE_REFS.production), null)
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('production', {}, {
      ...FRESH_BASE,
      heldKinds: [{ kind: 'merge' }],
    }),
    /guarded merge is active; production promotion must wait/,
  )
})

test('fake-lock: merge refuses under promotion freeze (existing interlock semantics)', () => {
  const io = fakeExclusiveIo()
  // No merge ref held yet, but a live promotion freeze blocks merge acquisition.
  assert.equal(io.readRef(EXCLUSIVE_REFS.merge), null)
  assert.throws(
    () => assertExclusiveAcquisitionPolicy('merge', {}, {
      promotionFreeze: { sha: 'freeze-1', owner: 'prod-run', pr: 7, issue: 50, acquiredAt: '2026-10-06T00:00:00.000Z', expiresAt: '2026-10-06T03:00:00.000Z', expired: false },
      heldKinds: [],
    }),
    /merges are paused for a production run/,
  )
  // Once the freeze expires, merge is allowed again.
  const result = assertExclusiveAcquisitionPolicy('merge', {}, {
    promotionFreeze: { sha: 'freeze-1', owner: 'prod-run', expired: true },
    heldKinds: [],
  })
  assert.equal(result.kind, 'merge')
})

test('fake-lock: distinct exclusive refs are the preview-recovery / production separation', () => {
  assert.notEqual(EXCLUSIVE_REFS.preview, EXCLUSIVE_REFS.production)
  assert.notEqual(EXCLUSIVE_REFS.merge, EXCLUSIVE_REFS.production)
  assert.notEqual(EXCLUSIVE_REFS.preview, EXCLUSIVE_REFS.merge)
})
