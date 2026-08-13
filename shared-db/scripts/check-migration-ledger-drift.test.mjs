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
} from './check-migration-ledger-drift.mjs'

const MERGED = ['20260810180000', '20260810190000', '20260811030000']

function io({ files, applied }) {
  return {
    mainMigrationFiles: async () => files,
    fetchAppliedVersions: async () => {
      if (applied instanceof Error) throw applied
      return applied
    },
  }
}

const files = (versions) => versions.map((v) => `supabase/migrations/${v}_thing.sql`)

// --- direction A: merged but NOT applied (the issue #892 defect) -------------

test('reports merged-but-NOT-applied and exits 1', async () => {
  const drift = computeDrift(MERGED, ['20260810180000'])
  assert.deepEqual(drift.mergedNotApplied, ['20260810190000', '20260811030000'])
  assert.deepEqual(drift.appliedNotMerged, [])
  assert.equal(drift.driftFound, true)

  const report = formatReport({ target: 'production', projectRef: 'x', baseRef: 'origin/main', drift })
  assert.match(report, /MERGED BUT NOT APPLIED/)
  // The whole point of the guard: it must say out loud that a missing object in the
  // live catalog is NOT evidence the work was never done.
  assert.match(report, /never done/i)
})

// --- direction B: applied but NOT on main (orphan ledger row) ----------------

test('reports an orphan ledger row and exits 1', async () => {
  const drift = computeDrift(MERGED, [...MERGED, '20260701000000'])
  assert.deepEqual(drift.appliedNotMerged, ['20260701000000'])
  assert.equal(drift.driftFound, true)
  const report = formatReport({ target: 'preview', projectRef: 'x', baseRef: 'origin/main', drift })
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
