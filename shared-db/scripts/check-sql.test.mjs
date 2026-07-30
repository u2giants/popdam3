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
