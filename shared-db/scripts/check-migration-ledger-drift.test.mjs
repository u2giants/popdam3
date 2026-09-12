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
  assessDrift,
  computeDrift,
  formatReport,
  main,
  runDriftCheck,
  resolveFreshBaseRef,
  versionsFromFilenames,
  APPLIED_VERSIONS_SQL,
  fetchAppliedVersions,
  guardClassifications,
  validatePendingClassifications,
} from './check-migration-ledger-drift.mjs'

test('origin/main is refreshed before any migration-tree verification read', () => {
  const calls = []
  const run = (_command, args) => { calls.push(args) }
  assert.equal(resolveFreshBaseRef('origin/main', run), 'refs/remotes/origin/main')
  assert.deepEqual(calls[0], ['-C', calls[0][1], 'fetch', '--quiet', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'])
  assert.deepEqual(calls[1].slice(2), ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'])
})

test('origin/main verification refuses when the live refresh cannot complete', () => {
  assert.throws(
    () => resolveFreshBaseRef('origin/main', () => { throw new Error('offline') }),
    /branch evidence that may be stale/,
  )
})

test('an explicit immutable base ref is verified without rewriting it', () => {
  const calls = []
  assert.equal(resolveFreshBaseRef('abc123', (_command, args) => { calls.push(args) }), 'abc123')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].slice(2), ['rev-parse', '--verify', '--quiet', 'abc123'])
})

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

test('green when only retired and deliberately-held versions remain, while listing them', async () => {
  const applied = ['20260810180000']
  const pending = ['20260729120000', '20260817150944']
  const testIo = io({ files: files([...applied, ...pending]), applied })
  testIo.guardClassifications = async () => ({
    '20260729120000': { kind: 'retired', reason: 'never apply this retired version' },
    '20260817150944': { kind: 'deliberately-held', reason: 'production allowlist excludes this version' },
  })
  const result = await runDriftCheck({ target: 'production', io: testIo })
  assert.equal(result.drift.driftFound, false)
  assert.deepEqual(result.drift.intentionallyExcluded, pending)
  const report = formatReport(result)
  assert.match(report, /NO ACTIONABLE DRIFT/)
  assert.match(report, /20260729120000\s+\[RETIRED\]/)
  assert.match(report, /20260817150944\s+\[DELIBERATELY-HELD\]/)
  assert.match(report, /listed for visibility but do not make this check fail/)
})

test('red when a genuinely-pending version is added to retired and held versions', () => {
  const raw = computeDrift(
    ['20260810180000', '20260729120000', '20260817150944', '20260823000000'],
    ['20260810180000'],
  )
  const drift = assessDrift(raw, {
    '20260729120000': { kind: 'retired', reason: 'retired' },
    '20260817150944': { kind: 'deliberately-held', reason: 'held' },
    '20260823000000': { kind: 'genuinely-pending', reason: 'normal promotion required' },
  })
  assert.equal(drift.driftFound, true)
  assert.deepEqual(drift.actionableMergedNotApplied, ['20260823000000'])
})

test('an orphan ledger row stays red when all merged-but-unapplied versions are excluded', () => {
  const raw = computeDrift(
    ['20260810180000', '20260729120000'],
    ['20260810180000', '20260701000000'],
  )
  const drift = assessDrift(raw, {
    '20260729120000': { kind: 'retired', reason: 'retired' },
  })
  assert.equal(drift.driftFound, true)
  assert.deepEqual(drift.appliedNotMerged, ['20260701000000'])
})

test('classifies retired and deliberately-held versions from every existing Python registry', () => {
  const result = guardClassifications(['20260729120000', '20260802170000', '20260802171000', '20260814170749', '20260816045130', '20260824181600'], [])
  assert.equal(result['20260729120000'].kind, 'retired')
  assert.match(result['20260729120000'].reason, /RETIRED_VERSIONS/)
  assert.equal(result['20260802170000'].kind, 'deliberately-held')
  assert.match(result['20260802170000'].reason, /owner ruling/i)
  // Held AND hard-blocked. The held historical FR ruling was superseded by the
  // guarded forward 20260818174350, so this original must never be applied at
  // all; the drift report must print the hard block, not 'waiting its turn'.
  assert.equal(result['20260802171000'].kind, 'retired')
  assert.match(result['20260802171000'].reason, /refuses this version outright/)
  assert.equal(result['20260816045130'].kind, 'retired')
  assert.match(result['20260816045130'].reason, /explicit COMMIT separates DDL from the Supabase migration ledger/)
  assert.match(result['20260816045130'].reason, /never apply production/)
  assert.equal(result['20260814170749'].kind, 'retired')
  assert.match(result['20260814170749'].reason, /20260825201330/)
  assert.match(result['20260814170749'].reason, /run 32901820150/)
  assert.equal(result['20260824181600'].kind, 'retired')
  assert.match(result['20260824181600'].reason, /20260825192610, applied to production 2026-08-25/)
})

test('classifies the stranded coldlion.division original as retired, not pending', () => {
  const result = guardClassifications(['20260903200951'], [])
  assert.equal(result['20260903200951'].kind, 'retired')
  assert.match(result['20260903200951'].reason, /replaced byte-for-byte by 20260905024139/)
  assert.match(result['20260903200951'].reason, /issue 2349/)
})

test('classifies the stranded bulk-operation history original as retired, not pending', () => {
  const result = guardClassifications(['20260908195056'], [])
  assert.equal(result['20260908195056'].kind, 'retired')
  assert.match(result['20260908195056'].reason, /reissued with identical migration content as 20260909202801/)
  assert.match(result['20260908195056'].reason, /issue 2439 and claim 2443/)
})

test('classifies preview-only historical restoration as deliberately held',()=>{
  const result=guardClassifications(['20260817150944'],[])
  assert.equal(result['20260817150944'].kind,'deliberately-held')
  assert.match(result['20260817150944'].reason,/never include.*production allowlist/i)
})

test('classifies the FR compatibility prerequisite as deliberately held',()=>{
  const result=guardClassifications(['20260817225127'],[])
  assert.equal(result['20260817225127'].kind,'deliberately-held')
  assert.match(result['20260817225127'].reason,/compatibility prerequisite.*one bounded apply/i)
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

// Issue #1608 ask 3: a version whose declared base is unapplied in the target is
// not the same risk as an ordinary pending version, and today they are
// indistinguishable in this report.
test('the real 2026-08-24 migration is reported as base-absent from the guard rules', () => {
  // End-to-end through the Python emission, so a broken import or a dropped
  // `derivedFrom` key fails here rather than silently degrading to "pending".
  const result = guardClassifications(['20260824135515'], ['20260811030000'])
  assert.equal(result['20260824135515'].kind, 'base-absent')
  assert.match(result['20260824135515'].reason, /20260814223552/)
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

// ---------------------------------------------------------------------------
// Issue #2820 — migrations authored for a DIFFERENT database.
//
// The hazard being guarded is double-sided. Reporting an out-of-scope migration
// as promotable invites applying schema to a database it was never reviewed
// against; excluding it INVISIBLY hides real work from the promotion queue,
// which is worse. So every test that proves an exclusion is paired with a probe
// proving an in-scope migration is STILL reported as promotable.
// ---------------------------------------------------------------------------

const FOREIGN = '20260909121403'
const IN_SCOPE = '20260911210844'

function scopedClassifications() {
  return {
    [FOREIGN]: {
      kind: 'foreign-target',
      reason: 'NOT IN SCOPE FOR PRODUCTION. This migration targets the DesignFlow non-production Supabase project. Recorded under issue #2403.',
    },
    [IN_SCOPE]: {
      kind: 'genuinely-pending',
      reason: 'No rule names this version; the normal bounded promotion workflow remains required.',
    },
  }
}

test('a migration targeting another database is not counted as actionable drift', () => {
  const drift = assessDrift(computeDrift([FOREIGN, '20260810180000'], ['20260810180000']), {
    [FOREIGN]: scopedClassifications()[FOREIGN],
  })
  assert.deepEqual(drift.foreignTarget, [FOREIGN])
  assert.deepEqual(drift.actionableMergedNotApplied, [])
  assert.equal(drift.driftFound, false)
})

test('POSITIVE CONTROL: an in-scope migration is STILL reported as promotable', () => {
  const drift = assessDrift(computeDrift([FOREIGN, IN_SCOPE, '20260810180000'], ['20260810180000']), scopedClassifications())
  assert.deepEqual(drift.foreignTarget, [FOREIGN])
  assert.deepEqual(drift.actionableMergedNotApplied, [IN_SCOPE],
    'the exclusion mechanism must not swallow ordinary pending work')
  assert.equal(drift.driftFound, true)
})

test('out-of-scope migrations are reported in their own section, never silently omitted', () => {
  const drift = assessDrift(computeDrift([FOREIGN, IN_SCOPE, '20260810180000'], ['20260810180000']), scopedClassifications())
  const report = formatReport({
    target: 'production',
    projectRef: 'qsllyeztdwjgirsysgai',
    baseRef: 'origin/main',
    drift,
    fileByVersion: {},
    pendingClassifications: scopedClassifications(),
  })

  assert.match(report, /NOT IN SCOPE FOR THIS DATABASE — 1 version\(s\)/)
  assert.match(report, /DesignFlow/)
  assert.match(report, /#2403/)

  // It must NOT appear in the promotable list, and the in-scope one must.
  const promotable = report.slice(report.indexOf('MERGED BUT NOT APPLIED'), report.indexOf('NOT IN SCOPE FOR THIS DATABASE'))
  assert.ok(!promotable.includes(FOREIGN), 'an out-of-scope migration must not be listed as promotable')
  assert.ok(promotable.includes(IN_SCOPE), 'in-scope work must remain in the promotable list')
  assert.match(report, /MERGED BUT NOT APPLIED — 1 version\(s\)/)
})

test('the drift checker passes the target through, so scope is decided per database', async () => {
  const seen = []
  const result = await runDriftCheck({
    target: 'preview',
    baseRef: 'abc123',
    io: {
      mainMigrationFiles: async () => [`supabase/migrations/${IN_SCOPE}_x.sql`],
      fetchAppliedVersions: async () => ['20260810180000'],
      guardClassifications: async (versions, _applied, target) => {
        seen.push(target)
        return Object.fromEntries(versions.map((v) => [v, scopedClassifications()[IN_SCOPE]]))
      },
    },
  })
  assert.deepEqual(seen, ['preview'], 'the target being checked must reach the one policy engine')
  assert.deepEqual(result.drift.actionableMergedNotApplied, [IN_SCOPE])
})

test('a foreign-target classification with no reason is still REFUSED', () => {
  assert.throws(
    () => validatePendingClassifications([FOREIGN], { [FOREIGN]: { kind: 'foreign-target', reason: '   ' } }),
    /unknown or reasonless classification/,
  )
})
