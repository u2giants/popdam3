import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PAIR_DECISIONS,
  TargetQueueError,
  buildTargetCatalog,
  canReusePromotionManifest,
  evaluatePairCompatibility,
  evaluateProductionFreshness,
  isDocumentationOnlyPath,
  mutationConcurrencyGroup,
  promotionManifestBinding,
  dispatchConcurrencyGroup,
  pullRequestValidationConcurrencyGroup,
  resolveTargetIdentity,
} from './target-queue-identity.mjs'

const CATALOG = buildTargetCatalog([
  { role: 'preview', targetId: 'preview-a', projectRef: 'prevprojectref01', aliases: ['preview'] },
  { role: 'production', targetId: 'production-main', projectRef: 'prodprojectref01', aliases: ['production', 'prod'] },
])

const PLAN = {
  sharedEvidenceRefs: ['refs/db-evidence/promotion', 'refs/db-evidence/preview-ledger'],
  lockOrder: ['merge', 'production', 'preview'],
}

// ---------------------------------------------------------------------------
// Target identity
// ---------------------------------------------------------------------------

test('trusted catalog refuses duplicate project refs for different targets', () => {
  assert.throws(
    () => buildTargetCatalog([
      { role: 'preview', targetId: 'a-target', projectRef: 'samerefvalue01' },
      { role: 'production', targetId: 'b-target', projectRef: 'samerefvalue01' },
    ]),
    /duplicate projectRef/,
  )
})

test('untrusted input cannot manufacture a database name', () => {
  assert.throws(() => resolveTargetIdentity(CATALOG, 'production-main-evil', 'production'), TargetQueueError)
  assert.throws(() => resolveTargetIdentity(CATALOG, '../../prod', 'production'), /not in the trusted catalog/)
  assert.throws(() => resolveTargetIdentity(CATALOG, '', 'preview'), /empty/)
})

test('alias, targetId and projectRef resolve to the same trusted entry', () => {
  const viaAlias = resolveTargetIdentity(CATALOG, 'prod', 'production')
  const viaId = resolveTargetIdentity(CATALOG, 'production-main', 'production')
  const viaRef = resolveTargetIdentity(CATALOG, 'prodprojectref01', 'production')
  assert.equal(viaAlias.targetId, viaId.targetId)
  assert.equal(viaAlias.projectRef, viaRef.projectRef)
  assert.equal(viaAlias.targetId, 'production-main')
})

test('role mismatch refuses preview against a production resource', () => {
  assert.throws(() => resolveTargetIdentity(CATALOG, 'production-main', 'preview'), /refusing preview mutation/)
})

// ---------------------------------------------------------------------------
// Concurrency groups
// ---------------------------------------------------------------------------

test('mutation groups are target-qualified and role-bound', () => {
  const preview = resolveTargetIdentity(CATALOG, 'preview-a', 'preview')
  const production = resolveTargetIdentity(CATALOG, 'production-main', 'production')
  assert.equal(mutationConcurrencyGroup('preview', preview), 'shared-supabase-migrations-preview-preview-a')
  assert.equal(mutationConcurrencyGroup('production', production), 'shared-supabase-migrations-production-production-main')
  assert.notEqual(
    mutationConcurrencyGroup('preview', preview),
    mutationConcurrencyGroup('production', production),
  )
})

test('untrusted input cannot choose a mutation group', () => {
  assert.throws(() => mutationConcurrencyGroup('production', { targetId: 'preview-a', role: 'preview' }), /role mismatch/)
  assert.throws(() => mutationConcurrencyGroup('production', { targetId: 'invented-name' }), /role mismatch|trusted catalog/)
  assert.throws(() => pullRequestValidationConcurrencyGroup('refs/heads/x y'), /single token/)
})

// ---------------------------------------------------------------------------
// Compatibility matrix
// ---------------------------------------------------------------------------

test('preview/preview same role is forbidden', () => {
  const target = resolveTargetIdentity(CATALOG, 'preview-a', 'preview')
  const result = evaluatePairCompatibility(
    { kind: 'preview', target, locks: ['preview'], evidenceRefs: [] },
    { kind: 'preview', target, locks: ['preview'], evidenceRefs: [] },
    PLAN,
  )
  assert.equal(result.decision, PAIR_DECISIONS.FORBID_SAME_ROLE)
})

test('production/production is forbidden', () => {
  const target = resolveTargetIdentity(CATALOG, 'production-main', 'production')
  const result = evaluatePairCompatibility(
    { kind: 'production', target, locks: ['production'], evidenceRefs: [] },
    { kind: 'production', target, locks: ['production'], evidenceRefs: [] },
    PLAN,
  )
  assert.equal(result.decision, PAIR_DECISIONS.FORBID_SAME_ROLE)
})

test('merge/production is forbidden during protected freeze', () => {
  const production = resolveTargetIdentity(CATALOG, 'production-main', 'production')
  const result = evaluatePairCompatibility(
    { kind: 'merge', locks: ['merge'], evidenceRefs: [], freeze: true },
    { kind: 'production', target: production, locks: ['production'], evidenceRefs: [] },
    PLAN,
  )
  assert.equal(result.decision, PAIR_DECISIONS.FORBID_FREEZE)
})

test('merge/production without freeze still refuses shared exclusive lock collision', () => {
  const production = resolveTargetIdentity(CATALOG, 'production-main', 'production')
  const result = evaluatePairCompatibility(
    { kind: 'merge', locks: ['merge', 'production'], evidenceRefs: [] },
    { kind: 'production', target: production, locks: ['production'], evidenceRefs: [] },
    PLAN,
  )
  assert.equal(result.decision, PAIR_DECISIONS.FORBID_LOCK_ORDER)
})

test('same physical database under different roles is forbidden', () => {
  const fake = { role: 'production', targetId: 'shared-db', projectRef: 'onerefvalue0001' }
  const result = evaluatePairCompatibility(
    { kind: 'preview', target: fake, locks: ['preview'], evidenceRefs: [] },
    { kind: 'production', target: fake, locks: ['production'], evidenceRefs: [] },
    PLAN,
  )
  assert.equal(result.decision, PAIR_DECISIONS.FORBID_SAME_TARGET)
})

test('shared evidence ref writers cannot overlap', () => {
  const preview = resolveTargetIdentity(CATALOG, 'preview-a', 'preview')
  const production = resolveTargetIdentity(CATALOG, 'production-main', 'production')
  const result = evaluatePairCompatibility(
    { kind: 'preview', target: preview, locks: ['preview'], evidenceRefs: ['refs/db-evidence/promotion'] },
    { kind: 'production', target: production, locks: ['production'], evidenceRefs: ['refs/db-evidence/promotion'] },
    PLAN,
  )
  assert.equal(result.decision, PAIR_DECISIONS.FORBID_SHARED_EVIDENCE)
})

test('preview/production distinct targets with disjoint evidence and ordered locks is allowed', () => {
  const preview = resolveTargetIdentity(CATALOG, 'preview-a', 'preview')
  const production = resolveTargetIdentity(CATALOG, 'production-main', 'production')
  const result = evaluatePairCompatibility(
    { kind: 'preview', target: preview, locks: ['preview'], evidenceRefs: ['refs/db-evidence/preview-ledger'] },
    { kind: 'production', target: production, locks: ['production'], evidenceRefs: ['refs/db-evidence/promotion'] },
    PLAN,
  )
  assert.equal(result.decision, PAIR_DECISIONS.ALLOW)
})

test('sandbox/fake-lock: conflicting target pairs refuse while independent ones proceed', () => {
  const preview = resolveTargetIdentity(CATALOG, 'preview-a', 'preview')
  const production = resolveTargetIdentity(CATALOG, 'production-main', 'production')
  const independent = evaluatePairCompatibility(
    { kind: 'preview', target: preview, locks: ['preview'], evidenceRefs: [] },
    { kind: 'production', target: production, locks: ['production'], evidenceRefs: [] },
    { sharedEvidenceRefs: [], lockOrder: ['production', 'preview'] },
  )
  assert.equal(independent.decision, PAIR_DECISIONS.ALLOW)
  const conflict = evaluatePairCompatibility(
    { kind: 'preview', target: preview, locks: ['preview'], evidenceRefs: [] },
    { kind: 'preview', target: preview, locks: ['preview'], evidenceRefs: [] },
    { sharedEvidenceRefs: [], lockOrder: ['preview'] },
  )
  assert.equal(conflict.decision, PAIR_DECISIONS.FORBID_SAME_ROLE)
})

// ---------------------------------------------------------------------------
// Production freshness (unified)
// ---------------------------------------------------------------------------

test('documentation-only path detection is extension-based and refuses .github', () => {
  assert.equal(isDocumentationOnlyPath('docs/plan.md'), true)
  assert.equal(isDocumentationOnlyPath('docs/nested/notes.markdown'), true)
  assert.equal(isDocumentationOnlyPath('.github/workflows/x.md'), false)
  assert.equal(isDocumentationOnlyPath('scripts/foo.mjs'), false)
  assert.equal(isDocumentationOnlyPath('supabase/migrations/a.sql'), false)
  assert.equal(isDocumentationOnlyPath(''), false)
})

test('exact main tip unifies freshness and allows manifest reuse', () => {
  const result = evaluateProductionFreshness({
    dispatchMainSha: 'a'.repeat(40),
    currentMainSha: 'a'.repeat(40),
    changedPaths: [],
    exactMatch: true,
  })
  assert.equal(result.fresh, true)
  assert.equal(result.reuseManifest, true)
})

test('documentation-only main drift still allows reuse; substantive drift does not', () => {
  const docsOnly = evaluateProductionFreshness({
    dispatchMainSha: 'a'.repeat(40),
    currentMainSha: 'b'.repeat(40),
    changedPaths: ['docs/plan.md', 'README.md'],
  })
  assert.equal(docsOnly.fresh, true)
  assert.equal(docsOnly.reuseManifest, true)

  const substantive = evaluateProductionFreshness({
    dispatchMainSha: 'a'.repeat(40),
    currentMainSha: 'b'.repeat(40),
    changedPaths: ['docs/plan.md', 'scripts/check-main-tip-freshness.mjs'],
  })
  assert.equal(substantive.fresh, false)
  assert.equal(substantive.reuseManifest, false)
  assert.match(substantive.reason, /substantive paths/)
})

test('empty changed-path list after main moved refuses rather than guesses', () => {
  assert.throws(
    () => evaluateProductionFreshness({
      dispatchMainSha: 'a'.repeat(40),
      currentMainSha: 'b'.repeat(40),
      changedPaths: [],
    }),
    /refusing rather than guessing/,
  )
})

test('production-inert drift (test-only and .agent evidence) still allows reuse', () => {
  const inertDrift = evaluateProductionFreshness({
    dispatchMainSha: 'a'.repeat(40),
    currentMainSha: 'b'.repeat(40),
    changedPaths: [
      'scripts/lib/lanes/exclusive-policy.test.mjs',
      'scripts/test_production_business_risk_gate_source_identity_mutations.py',
      '.agent/work/3781/5/contract.json',
      'docs/plan.md',
    ],
  })
  assert.equal(inertDrift.fresh, true)
  assert.equal(inertDrift.reuseManifest, true)
  assert.match(inertDrift.reason, /production-inert/)
})

test('substantive production drift (non-test scripts, SQL, workflows) never allows reuse', () => {
  for (const path of [
    'scripts/check-main-tip-freshness.mjs',
    'scripts/production_business_risk_gate.py',
    'supabase/migrations/20260929000001_x.sql',
    '.github/workflows/shared-supabase-migrations.yml',
    'supabase/config.toml',
    'config/db-data-admin-property-source-coverage.json',
  ]) {
    const result = evaluateProductionFreshness({
      dispatchMainSha: 'a'.repeat(40),
      currentMainSha: 'b'.repeat(40),
      changedPaths: [path],
    })
    assert.equal(result.fresh, false, path)
    assert.equal(result.reuseManifest, false, path)
    assert.ok(result.reason.includes(path), result.reason)
  }
})

// ---------------------------------------------------------------------------
// Promotion manifest binding
// ---------------------------------------------------------------------------

const MIGRATIONS = [
  { version: '20260928000001', bytesSha256: '1'.repeat(64) },
  { version: '20260928000002', bytesSha256: '2'.repeat(64) },
]
const PRODUCER = { id: 'shared-supabase-migrations', sha256: 'p'.repeat(64) }
const POLICY = { id: 'production-risk-gate', sha256: 'q'.repeat(64) }

test('promotion manifest binds bytes, producer, policy and dependencies', () => {
  const bound = promotionManifestBinding({
    migrations: MIGRATIONS,
    producer: PRODUCER,
    policy: POLICY,
    dependencies: ['ext:pgcrypto', 'role:postgres'],
  })
  assert.match(bound.binding, /m:20260928000001:1{64}/)
  assert.match(bound.binding, /producer:shared-supabase-migrations/)
  assert.match(bound.binding, /policy:production-risk-gate/)
  assert.deepEqual(bound.migrationVersions, ['20260928000001', '20260928000002'])
  assert.equal(bound.reusableOnlyIfInert, true)
})

test('same filenames with different bytes requalify the manifest', () => {
  const inputs = {
    migrations: MIGRATIONS,
    producer: PRODUCER,
    policy: POLICY,
    dependencies: ['ext:pgcrypto'],
  }
  const manifest = { ...promotionManifestBinding(inputs), inputs }
  const drifted = {
    ...manifest,
    inputs: {
      ...inputs,
      migrations: [
        { version: '20260928000001', bytesSha256: '9'.repeat(64) },
        { version: '20260928000002', bytesSha256: '2'.repeat(64) },
      ],
    },
  }
  const state = {
    dispatchMainSha: 'a'.repeat(40),
    currentMainSha: 'a'.repeat(40),
    changedPaths: [],
    exactMatch: true,
  }
  assert.equal(canReusePromotionManifest(manifest, state).reusable, true)
  const reuse = canReusePromotionManifest(drifted, state)
  assert.equal(reuse.reusable, false)
  assert.match(reuse.reason, /not "same migration filenames"/)
})

test('substantive main drift never reuses a promotion manifest', () => {
  const inputs = {
    migrations: MIGRATIONS,
    producer: PRODUCER,
    policy: POLICY,
    dependencies: [],
  }
  const manifest = { ...promotionManifestBinding(inputs), inputs }
  const reuse = canReusePromotionManifest(manifest, {
    dispatchMainSha: 'a'.repeat(40),
    currentMainSha: 'c'.repeat(40),
    changedPaths: ['supabase/migrations/20260929000001_x.sql'],
  })
  assert.equal(reuse.reusable, false)
  assert.match(reuse.reason, /substantive paths/)
})

// ---------------------------------------------------------------------------
// Dispatch concurrency (workflow wiring, Step 10)
// ---------------------------------------------------------------------------

test('preview and production dispatch queues are distinct and enum-bound', () => {
  assert.equal(dispatchConcurrencyGroup('preview'), 'shared-supabase-migrations-preview')
  assert.equal(dispatchConcurrencyGroup('production'), 'shared-supabase-migrations-production')
  assert.notEqual(dispatchConcurrencyGroup('preview'), dispatchConcurrencyGroup('production'))
  assert.throws(() => dispatchConcurrencyGroup('preview-evil'), /closed enum/)
  assert.throws(() => dispatchConcurrencyGroup(''), /closed enum/)
})

test('shared-supabase-migrations.yml wires closed target-qualified dispatch groups', () => {
  const yaml = readFileSync(new URL('../.github/workflows/shared-supabase-migrations.yml', import.meta.url), 'utf8')
  // Closed two-branch map: unknown/empty target collapses to the preview queue
  // and can never mint a third queue name via API/CLI dispatch.
  assert.match(yaml, /inputs\.target == 'production' && 'shared-supabase-migrations-production' \|\| 'shared-supabase-migrations-preview'/)
  assert.doesNotMatch(yaml, /format\('shared-supabase-migrations-\{0\}', inputs\.target\)/)
  assert.doesNotMatch(yaml, /\|\| 'shared-supabase-migrations' \}/)
  assert.match(yaml, /github\.event_name == 'pull_request'/)
  assert.match(yaml, /github\.event_name == 'merge_group'/)
  assert.match(yaml, /target:\n[\s\S]*?type: choice\n[\s\S]*?options: \[preview, production\]/)
})
