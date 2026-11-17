// Tests for scripts/lint-plpgsql-migrations.mjs. Fixtures are byte copies of
// the three migrations retired on 2026-11-17 (bad/) and their reissues (clean/).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { lintFiles, lintSql } from './lint-plpgsql-migrations.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(here, 'fixtures', 'plpgsql-lint')
const list = dir => fs.readdirSync(path.join(fixtures, dir)).sort().map(f => path.join(fixtures, dir, f))

test('the three retired originals are flagged', () => {
  const bad = list('bad')
  assert.equal(bad.length, 3)
  const byFile = name => lintFiles(bad.filter(f => f.includes(name)))
  const plain = byFile('20261117020001')
  assert.ok(plain.some(f => /alias "v\."/.test(f.message)))
  assert.ok(plain.some(f => /name\[\]/.test(f.message)))
  const unique = byFile('20261117120000')
  assert.ok(unique.some(f => /alias "k\."/.test(f.message)))
  assert.ok(unique.some(f => /name\[\]/.test(f.message)))
  const pair = byFile('20261118020001')
  assert.ok(pair.some(f => /name\[\]/.test(f.message)))
})

test('the 20261204000000/000100/000200 reissues are clean', () => {
  const clean = list('clean')
  assert.equal(clean.length, 3)
  assert.deepEqual(lintFiles(clean), [])
})

test('loop record use, body-local aliases and casts are not flagged', () => {
  assert.deepEqual(lintSql(`
    for t in select * from (values ('a', array['x'])) as v(sch, cols) loop
      perform 1 from unnest(array[1]) with ordinality as v(n, o) where v.n = 1;
      if (select array_agg(a.attname) from pg_attribute a) = t.cols::name[] then null; end if;
      if (select array_agg(a.attname::text) from pg_attribute a) = t.cols then null; end if;
    end loop;`), [])
})

test('comments and integer loops are ignored', () => {
  assert.deepEqual(lintSql(`
    -- for t in select 1 as v(x) loop v.x end loop
    for i in 1..3 loop perform 1; end loop;`), [])
})

test('CLI exits 1 with file:line findings and 0 when clean', () => {
  const cli = path.join(here, 'lint-plpgsql-migrations.mjs')
  const bad = spawnSync(process.execPath, [cli, ...list('bad')], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /20261117120000_[^:]+:\d+: loop body references/)
  const ok = spawnSync(process.execPath, [cli, ...list('clean')], { encoding: 'utf8' })
  assert.equal(ok.status, 0, ok.stdout)
})

test('check-sql.sh reports added bad migrations as an advisory warning without failing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plpgsql-lint-'))
  try {
    const base = '20261101000000_base.sql'
    fs.writeFileSync(path.join(dir, base), 'select 1;\n')
    const added = path.basename(list('bad')[1]).replace(/\.fixture$/, '')
    fs.copyFileSync(list('bad')[1], path.join(dir, added))
    const env = { ...process.env, CHECK_SQL_MIGRATION_DIR: dir, CHECK_SQL_MAIN_NEWEST: '20261101000000', CHECK_SQL_MIGRATIONS_ONLY: '1', CHECK_SQL_PLPGSQL_LINT_FILES: path.join(dir, added) }
    const run = spawnSync('bash', [path.join(here, 'check-sql.sh')], { encoding: 'utf8', env })
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout + run.stderr, /::warning file=[^,]*20261117120000[^,]*,line=\d+,title=PL\/pgSQL lint \(advisory\)::/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
