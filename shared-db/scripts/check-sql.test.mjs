// Tests for the two migration guards in scripts/check-sql.sh.
//
// Guard A (added by PR #322): no two migrations may share the leading 14-digit
// version, because Supabase's ledger keys on the version alone and silently
// skips the loser. This file tests it but does not change it.
// Guard B (added here): a branch may not add a migration whose version sorts
// before the newest version already on the base branch -- that is how the
// 2026-07-28 collision on version 20260728160000 was created.
//
// The script is driven as a subprocess against throwaway fixture directories
// through its CHECK_SQL_* test seams, so these tests never touch
// supabase/migrations. One test runs the guards over the real repository to
// prove they pass as-is.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Git Bash on Windows wants forward slashes. */
const toBashPath = (p) => p.replace(/\\/g, '/')

function makeFixture(filenames) {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-sql-'))
  for (const name of filenames) {
    writeFileSync(path.join(dir, name), '-- fixture migration\nselect 1;\n')
  }
  return dir
}

/**
 * Run the migration guards in scripts/check-sql.sh.
 * `mainNewest` injects "newest version already on the base branch"; pass null
 * to let the script resolve it from git. `env` adds/overrides environment
 * variables (used to exercise the base-ref-unavailable path).
 */
function runGuards(migrationsDir, { mainNewest = null, env = {} } = {}) {
  const childEnv = {
    ...process.env,
    CHECK_SQL_MIGRATIONS_ONLY: '1',
    ...env,
  }
  if (migrationsDir) childEnv.CHECK_SQL_MIGRATION_DIR = toBashPath(migrationsDir)
  if (mainNewest) childEnv.CHECK_SQL_MAIN_NEWEST = mainNewest

  const result = spawnSync('bash', ['scripts/check-sql.sh'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: childEnv,
  })

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function withFixture(filenames, fn) {
  const dir = makeFixture(filenames)
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('passes when every migration version is unique', () => {
  withFixture(
    [
      '20260801120000_first.sql',
      '20260801130000_second.sql',
      '20260801140000_third.sql',
    ],
    (dir) => {
      const { status, stderr } = runGuards(dir, { mainNewest: '20260801100000' })
      assert.equal(status, 0, `expected a pass. stderr:\n${stderr}`)
    },
  )
})

test('Guard A fails and names BOTH colliding files', () => {
  withFixture(
    [
      '20260801120000_clickup_incremental_task_import.sql',
      '20260801120000_popdam_user_tables_foreign_keys.sql',
      '20260801130000_unrelated.sql',
    ],
    (dir) => {
      const { status, stderr } = runGuards(dir, { mainNewest: '20260801100000' })
      assert.notEqual(status, 0)
      assert.match(stderr, /duplicate migration version\(s\) detected/)
      assert.match(stderr, /version 20260801120000 is claimed by/)
      assert.match(stderr, /20260801120000_clickup_incremental_task_import\.sql/)
      assert.match(stderr, /20260801120000_popdam_user_tables_foreign_keys\.sql/)
    },
  )
})

test('Guard A reports every version when more than one collides', () => {
  withFixture(
    [
      '20260801120000_a.sql',
      '20260801120000_b.sql',
      '20260801130000_c.sql',
      '20260801130000_d.sql',
    ],
    (dir) => {
      const { status, stderr } = runGuards(dir, { mainNewest: '20260801100000' })
      assert.notEqual(status, 0)
      assert.match(stderr, /version 20260801120000 is claimed by/)
      assert.match(stderr, /version 20260801130000 is claimed by/)
    },
  )
})

// There is deliberately no allowlist of "known historical duplicates". Both past
// collisions (20260722220000 and 20260728160000) are resolved on disk -- the
// superseded file was deleted after its DDL was re-issued as
// 20260728174500_clickup_incremental_task_import_reissue.sql -- so nothing needs
// grandfathering. If either version ever collides again that is a regression,
// and this test pins that it fails exactly like any other duplicate.
test('a historically-collided version is NOT grandfathered if it collides again', () => {
  withFixture(
    [
      '20260728160000_clickup_incremental_task_import.sql',
      '20260728160000_popdam_user_tables_foreign_keys.sql',
    ],
    (dir) => {
      const { status, stderr } = runGuards(dir, { mainNewest: '20260728150000' })
      assert.notEqual(status, 0)
      assert.match(stderr, /version 20260728160000 is claimed by/)
      assert.match(stderr, /20260728160000_clickup_incremental_task_import\.sql/)
      assert.match(stderr, /20260728160000_popdam_user_tables_foreign_keys\.sql/)
    },
  )
})

test('Guard B fails a backdated migration and explains the rename fix', () => {
  withFixture(['20260728120000_backdated_migration.sql'], (dir) => {
    const { status, stderr } = runGuards(dir, { mainNewest: '20260729210000' })
    assert.notEqual(status, 0)
    assert.match(stderr, /backdated migration\(s\) detected/)
    assert.match(stderr, /newest migration version already on the base branch is 20260729210000/)
    assert.match(stderr, /20260728120000_backdated_migration\.sql/)
    assert.match(stderr, /HOW TO FIX: rename each file above to a NEW 14-digit timestamp/)
    assert.match(stderr, /pure rename/)
  })
})

test('Guard B allows a migration timestamped after the base branch newest', () => {
  withFixture(['20260801120000_forward_dated_migration.sql'], (dir) => {
    const { status, stdout } = runGuards(dir, { mainNewest: '20260729210000' })
    assert.equal(status, 0)
    assert.match(stdout, /Guard B: no migration sorts before/)
  })
})

test('Guard B skips with a loud warning when the base ref is unavailable', () => {
  withFixture(['20260801120000_forward_dated_migration.sql'], (dir) => {
    const { status, stderr } = runGuards(dir, {
      env: { GITHUB_BASE_REF: 'check-sql-test-branch-that-does-not-exist' },
    })
    assert.equal(status, 0, `expected a skip, not a failure. stderr:\n${stderr}`)
    assert.match(stderr, /Guard B \(backdated migration\) SKIPPED/)
    assert.match(stderr, /fetch-depth: 0/)
  })
})

test('Guard A still enforces duplicates when Guard B has to skip', () => {
  withFixture(['20260801120000_a.sql', '20260801120000_b.sql'], (dir) => {
    const { status, stderr } = runGuards(dir, {
      env: { GITHUB_BASE_REF: 'check-sql-test-branch-that-does-not-exist' },
    })
    assert.notEqual(status, 0)
    assert.match(stderr, /duplicate migration version\(s\) detected/)
  })
})

test('the real supabase/migrations directory passes both guards', () => {
  const { status, stderr } = runGuards(null)
  assert.equal(status, 0, `check-sql.sh failed on the real repo:\n${stderr}`)
})

// --- Guard B2: backdated against a LIVE LEDGER (#651) ----------------------
//
// Guard B compares a branch only against the BASE BRANCH, and `main` is not
// what the databases have actually run. Measured live on 2026-08-12:
//   preview    (rjyboqwcdzcocqgmsyel): 430 applied, newest 20260812211000
//   production (qsllyeztdwjgirsysgai): 426 applied, newest 20260812020000
//   repository:                        437 migration files
//
// PREVIEW IS NOT A SUPERSET OF PRODUCTION -- 20260810140000 and 20260810180000
// are applied on production but not on preview -- so these tests deliberately
// drive the two ledgers to DIFFERENT verdicts for the SAME added version. A
// guard that took a merged or assumed-ahead view would pass them both and
// would be wrong.

/** A ledger file: one 14-digit version per line, as `select version ...` emits. */
function makeLedger(versions) {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-sql-ledger-'))
  const file = path.join(dir, 'ledger.txt')
  writeFileSync(file, versions.join('\n') + '\n')
  return file
}

/** Guard B2 needs the base VERSION SET, not just the base maximum. */
function makeBaseVersions(versions) {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-sql-base-'))
  const file = path.join(dir, 'base.txt')
  writeFileSync(file, versions.join('\n') + '\n')
  return file
}

function makeDiff(file, addedLine) {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-sql-diff-'))
  const diff = path.join(dir, 'change.diff')
  writeFileSync(diff, `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -0,0 +1 @@\n+${addedLine}\n`)
  return diff
}

function makeReplacementDiff(file, removedLine, addedLine) {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-sql-diff-'))
  const diff = path.join(dir, 'change.diff')
  writeFileSync(diff, `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-${removedLine}\n+${addedLine}\n`)
  return diff
}

function makeAddedFileDiff(file, lines) {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-sql-diff-'))
  const diff = path.join(dir, 'change.diff')
  writeFileSync(diff, `diff --git a/${file} b/${file}\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}\n`)
  return diff
}

test('issue 1684 EOL guard rejects a new combined-table dependency', () => {
  withFixture(['20260801120000_fixture.sql'], (dir) => {
    const result = runGuards(dir, {
      mainNewest: '20260801100000',
      env: { CHECK_SQL_EOL_DIFF_FILE: toBashPath(makeDiff('apps/example/query.ts', 'select * from core.properties_and_characters')) },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /net-new runtime or migration references/)
  })
})

test('issue 1684 EOL guard permits maintenance with no net-new dependency', () => {
  withFixture(['20260801120000_fixture.sql'], (dir) => {
    const result = runGuards(dir, {
      mainNewest: '20260801100000',
      env: { CHECK_SQL_EOL_DIFF_FILE: toBashPath(makeReplacementDiff('apps/example/query.ts', 'select * from core.properties_and_characters', 'select id from "core"."properties_and_characters"')) },
    })
    assert.equal(result.status, 0, result.stderr)
  })
})

test('issue 1684 EOL guard catches quoted and search-path-relative references', () => {
  for (const addedLine of ['select * from "core"."properties_and_characters"', 'set search_path = core; select * from properties_and_characters']) {
    withFixture(['20260801120000_fixture.sql'], (dir) => {
      const result = runGuards(dir, {
        mainNewest: '20260801100000',
        env: { CHECK_SQL_EOL_DIFF_FILE: toBashPath(makeDiff('apps/example/query.sql', addedLine)) },
      })
      assert.notEqual(result.status, 0)
    })
  }
})

test('issue 1684 EOL guard does not confuse the separate dflow tables with core', () => {
  withFixture(['20260801120000_fixture.sql'], (dir) => {
    const result = runGuards(dir, {
      mainNewest: '20260801100000',
      env: { CHECK_SQL_EOL_DIFF_FILE: toBashPath(makeDiff('apps/example/query.sql', 'select * from dflow.properties_and_characters union all select * from "dflow_prod"."properties_and_characters"')) },
    })
    assert.equal(result.status, 0, result.stderr)
  })
})

test('issue 1684 EOL guard permits a declared replacement body for an existing RPC dependency', () => {
  withFixture(['20260801120000_fixture.sql'], (dir) => {
    const diff = makeAddedFileDiff('supabase/migrations/20260828000000_maintain_tree.sql', [
      '-- maintains-eol-dependency: function api.db_data_admin_licensor_property_tree',
      'create or replace function api.db_data_admin_licensor_property_tree() returns bigint language sql as $body$',
      '  select count(*) from "core"."properties_and_characters";',
      '$body$;',
    ])
    const result = runGuards(dir, { mainNewest: '20260801100000', env: { CHECK_SQL_EOL_DIFF_FILE: toBashPath(diff) } })
    assert.equal(result.status, 0, result.stderr)
  })
})

test('issue 1684 EOL guard rejects undeclared or out-of-body references in a maintenance migration', () => {
  for (const lines of [
    ['create or replace function api.db_data_admin_licensor_property_tree() returns bigint language sql as $body$', 'select count(*) from core.properties_and_characters;', '$body$;'],
    ['-- maintains-eol-dependency: function api.db_data_admin_licensor_property_tree', 'create or replace function api.db_data_admin_licensor_property_tree() returns bigint language sql as $body$', 'select 1;', '$body$;', 'select * from properties_and_characters;'],
  ]) {
    withFixture(['20260801120000_fixture.sql'], (dir) => {
      const diff = makeAddedFileDiff('supabase/migrations/20260828000000_bad_maintenance.sql', lines)
      const result = runGuards(dir, { mainNewest: '20260801100000', env: { CHECK_SQL_EOL_DIFF_FILE: toBashPath(diff) } })
      assert.notEqual(result.status, 0)
    })
  }
})

test('issue 1684 EOL guard allows only its exact staging migration', () => {
  withFixture(['20260801120000_fixture.sql'], (dir) => {
    const result = runGuards(dir, {
      mainNewest: '20260801100000',
      env: { CHECK_SQL_EOL_DIFF_FILE: toBashPath(makeDiff('supabase/migrations/20260827222039_eol_core_properties_and_characters.sql', 'comment on table core.properties_and_characters is \'EOL\';')) },
    })
    assert.equal(result.status, 0, result.stderr)
  })
})

const baseEnv = () => ({ CHECK_SQL_BASE_VERSIONS: toBashPath(makeBaseVersions(['20260101000000'])) })

test('Guard B2 passes a migration timestamped after everything the ledger holds', () => {
  const dir = makeFixture(['20260101000000_base.sql', '20260899000000_new.sql'])
  const result = runGuards(dir, {
    env: {
      ...baseEnv(),
      CHECK_SQL_PREVIEW_LEDGER: toBashPath(makeLedger(['20260812200000', '20260812211000'])),
    },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Guard B2: no added migration is behind or duplicated in preview/)
  assert.match(result.stdout, /2 applied, newest 20260812211000/)
  rmSync(dir, { recursive: true, force: true })
})

test('Guard B2 CATCHES THE #651 BLIND SPOT: passes Guard B, behind the live ledger', () => {
  // The whole point of the issue. 20260812100000 sorts AFTER the base branch's
  // newest (20260101000000), so Guard B clears it -- and it is behind what
  // preview has already applied, so it would apply out of order or be skipped.
  const dir = makeFixture(['20260101000000_base.sql', '20260812100000_new.sql'])
  const result = runGuards(dir, {
    env: {
      ...baseEnv(),
      CHECK_SQL_PREVIEW_LEDGER: toBashPath(makeLedger(['20260812200000', '20260812211000'])),
    },
  })
  assert.match(result.stdout, /Guard B: no migration sorts before/, 'Guard B must CLEAR it')
  assert.equal(result.status, 1, 'Guard B2 must fail it')
  assert.match(result.stderr, /sort BEFORE what preview has already applied/)
  assert.match(result.stderr, /20260812100000/)
  rmSync(dir, { recursive: true, force: true })
})

test('Guard B2 evaluates EACH ledger independently -- preview is not a superset of production', () => {
  // Same added version, two live environments, two different correct answers.
  // 20260812100000 is behind preview's newest (20260812211000) but ahead of
  // production's (20260812020000). Merging the ledgers, or trusting whichever
  // looks ahead, would lose one of these verdicts.
  const dir = makeFixture(['20260101000000_base.sql', '20260812100000_new.sql'])
  const result = runGuards(dir, {
    env: {
      ...baseEnv(),
      CHECK_SQL_PREVIEW_LEDGER: toBashPath(makeLedger(['20260812200000', '20260812211000'])),
      // The two versions production has and preview does not are REAL.
      CHECK_SQL_PRODUCTION_LEDGER: toBashPath(
        makeLedger(['20260810140000', '20260810180000', '20260812020000']),
      ),
    },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /sort BEFORE what preview has already applied/)
  assert.match(result.stdout, /no added migration is behind or duplicated in production/)
  rmSync(dir, { recursive: true, force: true })
})

test('Guard B2 fails a version that is ALREADY IN the ledger', () => {
  // The silent-skip class: the version is in supabase_migrations already, so
  // the file never runs and the push still reports success.
  const dir = makeFixture(['20260101000000_base.sql', '20260812211000_dup.sql'])
  const result = runGuards(dir, {
    env: {
      ...baseEnv(),
      CHECK_SQL_PREVIEW_LEDGER: toBashPath(makeLedger(['20260812200000', '20260812211000'])),
    },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ALREADY APPLIED in preview/)
  assert.match(result.stderr, /SILENTLY SKIPPED/)
  rmSync(dir, { recursive: true, force: true })
})

test('Guard B2 ignores versions the branch did not add', () => {
  // Seven files already on main (20260810140000 ... 20260811070000) are pending
  // in preview and ALL sort below preview's newest. Checking every local file
  // rather than only the added ones would fail this guard on main itself, and
  // a guard that is red on an untouched branch gets switched off.
  const dir = makeFixture(['20260101000000_base.sql', '20260810140000_already_on_main.sql'])
  const result = runGuards(dir, {
    env: {
      CHECK_SQL_BASE_VERSIONS: toBashPath(makeBaseVersions(['20260101000000', '20260810140000'])),
      CHECK_SQL_PREVIEW_LEDGER: toBashPath(makeLedger(['20260812211000'])),
    },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Guard B2: no added migration is behind or duplicated in preview/)
  rmSync(dir, { recursive: true, force: true })
})

test('Guard B2 REFUSES to read an unparseable ledger as an empty one', () => {
  // NO SILENT FAILURES. An empty read would make every added version look new
  // and clear the guard -- the false-clear shape this repository keeps hitting.
  const dir = makeFixture(['20260101000000_base.sql', '20260899000000_new.sql'])
  const ledgerDir = mkdtempSync(path.join(tmpdir(), 'check-sql-ledger-'))
  const ledger = path.join(ledgerDir, 'garbage.txt')
  writeFileSync(ledger, 'ERROR: connection refused\n')
  const result = runGuards(dir, {
    env: { ...baseEnv(), CHECK_SQL_PREVIEW_LEDGER: toBashPath(ledger) },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /contains no 14-digit versions/)
  assert.match(result.stderr, /Refusing to treat an unreadable ledger as an empty one/)
  rmSync(dir, { recursive: true, force: true })
})

test('Guard B2 fails when a ledger file is NAMED but absent', () => {
  // Naming a file that is not there is a wiring fault, not an absence, and
  // must not degrade to the "not configured" warning path.
  const dir = makeFixture(['20260101000000_base.sql', '20260899000000_new.sql'])
  const result = runGuards(dir, {
    env: { ...baseEnv(), CHECK_SQL_PREVIEW_LEDGER: '/nonexistent/ledger.txt' },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ledger file \/nonexistent\/ledger\.txt does not exist/)
  rmSync(dir, { recursive: true, force: true })
})

test('Guard B2 WARNS LOUDLY when unconfigured, and fails under CHECK_SQL_REQUIRE_LEDGER', () => {
  // Doing nothing quietly is precisely the #651 defect, so the unconfigured
  // path is never silent. CI, where the credentials exist, sets the strict
  // variable so the absence is fatal rather than advisory.
  const dir = makeFixture(['20260101000000_base.sql', '20260899000000_new.sql'])

  const lenient = runGuards(dir, { env: baseEnv() })
  assert.equal(lenient.status, 0, lenient.stderr)
  assert.match(lenient.stderr, /Guard B2 \(backdated against a LIVE LEDGER\) did not run/)
  assert.match(lenient.stderr, /CHECK_SQL_PREVIEW_DB_URL/)

  const strict = runGuards(dir, { env: { ...baseEnv(), CHECK_SQL_REQUIRE_LEDGER: '1' } })
  assert.equal(strict.status, 1)
  assert.match(strict.stderr, /is set, so this is an ERROR rather than a warning/)
  rmSync(dir, { recursive: true, force: true })
})

test('Guard B2 refuses to run when the ADDED set cannot be determined', () => {
  // Without the base ref there is no way to tell which versions this branch
  // adds, and checking every local file would fail on main. Configuring a
  // ledger and then silently checking nothing is the failure being fixed.
  const dir = makeFixture(['20260101000000_base.sql', '20260899000000_new.sql'])
  const result = runGuards(dir, {
    mainNewest: '20260101000000',
    env: { CHECK_SQL_PREVIEW_LEDGER: toBashPath(makeLedger(['20260812211000'])) },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /could not be determined/)
  rmSync(dir, { recursive: true, force: true })
})
