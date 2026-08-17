// Negative-path tests for the migration-ledger drift guard.
//
// Backlog B7 standard, standing policy in this repo: a test that only proves the guard
// EXISTS is worthless against the defect class it guards. Nearly every assertion here
// proves the guard REFUSES something, and the two most important ones prove it refuses
// to say "no drift" when it could not check.
//
//   node --test scripts/check-migration-ledger-drift.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  Unknown,
  computeDrift,
  formatReport,
  main,
  runDriftCheck,
  versionsFromFilenames,
  APPLIED_VERSIONS_SQL,
  fetchAppliedVersions,
  guardClassifications,
  classifyPendingWithRules,
  validatePendingClassifications,
} from './check-migration-ledger-drift.mjs'

const MERGED = ['20260810180000', '20260810190000', '20260811030000']

function io({ files, applied }) {
  return {
    mainMigrationFiles: async () => files,
    fetchAppliedVersions: async () => {
      if (applied instanceof Error) throw applied
      return applied
    },
    guardClassifications: async (versions) => Object.fromEntries(
      versions.map((version) => [version, { kind: 'genuinely-pending', reason: 'test fixture: normal bounded workflow remains required' }]),
    ),
  }
}

const classifications = (versions, kind = 'genuinely-pending') => Object.fromEntries(
  versions.map((version) => [version, { kind, reason: 'focused test reason' }]),
)

const ruleFixture = (overrides = {}) => ({
  retired: [], hardBlocked: [], bundle: [], frHeld: [], frRemoval: [], atomic: [], coPresence: [], ...overrides,
})

const files = (versions) => versions.map((v) => `supabase/migrations/${v}_thing.sql`)

// --- direction A: merged but NOT applied (the issue #892 defect) -------------

test('reports merged-but-NOT-applied and exits 1', async () => {
  const drift = computeDrift(MERGED, ['20260810180000'])
  assert.deepEqual(drift.mergedNotApplied, ['20260810190000', '20260811030000'])
  assert.deepEqual(drift.appliedNotMerged, [])
  assert.equal(drift.driftFound, true)

  const report = formatReport({ target: 'production', projectRef: 'x', baseRef: 'origin/main', drift, pendingClassifications: classifications(drift.mergedNotApplied) })
  assert.match(report, /MERGED BUT NOT APPLIED/)
  // The whole point of the guard: it must say out loud that a missing object in the
  // live catalog is NOT evidence the work was never done.
  assert.match(report, /never done/i)
  assert.match(report, /GENUINELY-PENDING/)
  assert.match(report, /why: focused test reason/)
})

// --- direction B: applied but NOT on main (orphan ledger row) ----------------

test('reports an orphan ledger row and exits 1', async () => {
  const drift = computeDrift(MERGED, [...MERGED, '20260701000000'])
  assert.deepEqual(drift.appliedNotMerged, ['20260701000000'])
  assert.equal(drift.driftFound, true)
  const report = formatReport({ target: 'preview', projectRef: 'x', baseRef: 'origin/main', drift, pendingClassifications: {} })
  assert.match(report, /APPLIED BUT NOT ON THE BASE BRANCH/)
  assert.match(report, /SILENTLY SKIPPED/)
})

test('reports drift in BOTH directions at once — neither hides the other', async () => {
  const drift = computeDrift(MERGED, ['20260810180000', '20260701000000'])
  assert.deepEqual(drift.mergedNotApplied, ['20260810190000', '20260811030000'])
  assert.deepEqual(drift.appliedNotMerged, ['20260701000000'])
})

// --- no drift ---------------------------------------------------------------

test('no drift when the two sets match exactly', async () => {
  const drift = computeDrift(MERGED, [...MERGED].reverse())
  assert.equal(drift.driftFound, false)
  assert.match(formatReport({ target: 'production', projectRef: 'x', baseRef: 'origin/main', drift }), /NO DRIFT/)
})

test('the clean path through runDriftCheck returns driftFound false', async () => {
  const result = await runDriftCheck({ target: 'production', io: io({ files: files(MERGED), applied: MERGED }) })
  assert.equal(result.drift.driftFound, false)
  assert.equal(result.projectRef, 'qsllyeztdwjgirsysgai')
})

test('classifies retired and deliberately-held versions from the existing Python rule sources', () => {
  const result = guardClassifications(['20260729120000', '20260802170000', '20260816045130'], [])
  assert.equal(result['20260729120000'].kind, 'retired')
  assert.match(result['20260729120000'].reason, /RETIRED_VERSIONS/)
  assert.equal(result['20260802170000'].kind, 'deliberately-held')
  assert.match(result['20260802170000'].reason, /owner ruling/i)
  assert.equal(result['20260816045130'].kind, 'retired')
  assert.match(result['20260816045130'].reason, /explicit COMMIT separates DDL from the Supabase migration ledger/)
  assert.match(result['20260816045130'].reason, /never apply production/)
})

test('classifies a normal version explicitly instead of leaving it unknown', () => {
  const result = guardClassifications(['29990101000000'], [])
  assert.equal(result['29990101000000'].kind, 'genuinely-pending')
  assert.match(result['29990101000000'].reason, /bounded promotion workflow/)
})

test('carries the production guard reason for an atomic or co-presence migration', () => {
  const result = guardClassifications(['20260810190000'], [])
  assert.equal(result['20260810190000'].kind, 'guarded-batch')
  assert.match(result['20260810190000'].reason, /Disney DCP Vault|B9/)
  assert.match(result['20260810190000'].reason, /20260810190100/)
})

test('ledger-aware co-presence classifies every outstanding fix in a full fix-only recovery', () => {
  const rules = ruleFixture({ coPresence: [{ create: '100', fixes: ['110', '120'], why: 'both fixes close the exposure' }] })
  const result = classifyPendingWithRules(['110', '120'], ['100'], rules)
  for (const version of ['110', '120']) {
    assert.equal(result[version].kind, 'guarded-batch')
    assert.match(result[version].reason, /Create 100 is already applied/)
    assert.match(result[version].reason, /110, 120/)
  }
})

test('ledger-aware co-presence permits the remaining fix recovery after its sibling applied', () => {
  const rules = ruleFixture({ coPresence: [{ create: '100', fixes: ['110', '120'], why: 'both fixes close the exposure' }] })
  const result = classifyPendingWithRules(['120'], ['100', '110'], rules)
  assert.equal(result['120'].kind, 'guarded-batch')
  assert.match(result['120'].reason, /Outstanding required fixes: 120/)
  assert.doesNotMatch(result['120'].reason, /Outstanding required fixes: 110/)
})

test('one-directional co-presence does not make a fix depend on an unapplied create', () => {
  const rules = ruleFixture({ coPresence: [{ create: '100', fixes: ['110', '120'], why: 'create requires fixes' }] })
  const result = classifyPendingWithRules(['110'], [], rules)
  assert.equal(result['110'].kind, 'genuinely-pending')
})

test('future FR removal versions inherit the deliberate owner-held bundle', () => {
  const rules = ruleFixture({ frHeld: ['200', '210'], frRemoval: ['220', '230'] })
  const result = classifyPendingWithRules(['200', '220', '230'], [], rules)
  for (const version of ['200', '220', '230']) {
    assert.equal(result[version].kind, 'deliberately-held')
    assert.match(result[version].reason, /200, 210, 220, 230/)
  }
})

test('REFUSES incomplete, unknown, or reasonless pending classification', () => {
  assert.throws(() => validatePendingClassifications(['1'], {}), /incomplete/)
  assert.throws(() => validatePendingClassifications(['1'], { 1: { kind: 'mystery', reason: 'x' } }), /unknown/)
  assert.throws(() => validatePendingClassifications(['1'], { 1: { kind: 'retired', reason: '' } }), /reasonless/)
})

test('REFUSES to format a pending version without its WHY', () => {
  const drift = computeDrift(MERGED, ['20260810180000'])
  assert.throws(
    () => formatReport({ target: 'production', projectRef: 'x', baseRef: 'origin/main', drift }),
    /has no classification/,
  )
})

test('REFUSES the whole check when the classifier omits one pending version', async () => {
  const broken = io({ files: files(MERGED), applied: ['20260810180000'] })
  broken.guardClassifications = async () => ({
    '20260810190000': { kind: 'genuinely-pending', reason: 'only one of two was classified' },
  })
  await assert.rejects(runDriftCheck({ target: 'production', io: broken }), /classification is incomplete/)
})

// --- the unreachable ledger MUST fail loudly --------------------------------

test('REFUSES to report "no drift" when the ledger cannot be reached', async () => {
  await assert.rejects(
    runDriftCheck({
      target: 'production',
      io: io({ files: files(MERGED), applied: new Unknown('Supabase Management API returned 401') }),
    }),
    /401/,
  )
})

test('REFUSES an EMPTY ledger — the check-sql.sh Guard B precedent', async () => {
  // The exact shape of a silent failure: the query "succeeds" and returns nothing, and a
  // naive comparison then reports every merged migration as pending, or (worse, if the
  // arrays were the other way round) reports a clean result.
  assert.throws(() => computeDrift(MERGED, []), (error) => {
    assert.ok(error instanceof Unknown)
    assert.match(error.message, /Refusing to continue as though the ledger were empty/)
    return true
  })
})

test('REFUSES an empty merged set rather than calling every applied row an orphan', () => {
  assert.throws(() => computeDrift([], MERGED), /Refusing to continue as though main carried no migrations/)
})

test('REFUSES a missing SUPABASE_ACCESS_TOKEN loudly instead of returning no rows', async () => {
  await assert.rejects(fetchAppliedVersions('qsllyeztdwjgirsysgai', ''), (error) => {
    assert.ok(error instanceof Unknown)
    assert.match(error.message, /NOT "no drift"/)
    return true
  })
})

test('the CLI exits 2, never 0, when the ledger is unreadable', async () => {
  const saved = process.env.SUPABASE_ACCESS_TOKEN
  delete process.env.SUPABASE_ACCESS_TOKEN
  try {
    const code = await main(['--target', 'production'])
    assert.equal(code, 2, 'a run that could not read the ledger must not exit 0')
  } finally {
    if (saved !== undefined) process.env.SUPABASE_ACCESS_TOKEN = saved
  }
})

test('an unknown --target is UNKNOWN, not a silent default to preview', async () => {
  await assert.rejects(runDriftCheck({ target: 'prod', io: io({ files: files(MERGED), applied: MERGED }) }), /unknown --target/)
  assert.equal(await main(['--target']), 2)
  assert.equal(await main([]), 2)
  assert.equal(await main(['--nonsense']), 2)
})

// --- input hygiene ----------------------------------------------------------

test('REFUSES a .sql migration with no 14-digit version', () => {
  assert.throws(
    () => versionsFromFilenames(['supabase/migrations/fix_the_thing.sql']),
    /no leading 14-digit version/,
  )
})

test('the ledger statement is a constant SELECT — no write path exists', () => {
  assert.match(APPLIED_VERSIONS_SQL, /^select version from supabase_migrations\.schema_migrations/)
  assert.doesNotMatch(APPLIED_VERSIONS_SQL, /insert|update|delete|alter|create|drop/i)
})
