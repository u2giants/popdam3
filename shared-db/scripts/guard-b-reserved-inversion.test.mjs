// Issue #6798: reservation order is not merge order. Guard B must let a reserved,
// object-disjoint migration land after a later-reserved one merged first, and
// must keep refusing every other backdated shape.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { decideInversion } from './guard-b-reserved-inversion.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const A = ['20261222090100_fix_a.sql', 'create or replace function popsg.folder_view() returns int language sql as $$ select 1 $$;\n']
const B = ['20261222090200_fix_b.sql', 'create or replace function plm.other_thing() returns int language sql as $$ select 2 $$;\n']
const BASE = ['20261201000000_base.sql', 'create table core.base_t (id int);\n']

// Simulate the queue: `main` holds `mainFiles`; the queued PR adds `added`.
function queueRun({ mainFiles, added, reserved }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'guardb-6798-'))
  try {
    for (const [name, sql] of [...mainFiles, ...added]) writeFileSync(path.join(dir, name), sql)
    const baseFile = path.join(dir, 'base-versions.txt')
    writeFileSync(baseFile, mainFiles.map(([n]) => n.slice(0, 14)).join('\n') + '\n')
    const resFile = path.join(dir, 'reserved.txt')
    writeFileSync(resFile, reserved.join('\n') + '\n')
    const r = spawnSync('bash', ['scripts/check-sql.sh'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, CHECK_SQL_MIGRATIONS_ONLY: '1', CHECK_SQL_MIGRATION_DIR: dir, CHECK_SQL_BASE_VERSIONS: baseFile, CHECK_SQL_RESERVED_VERSIONS: resFile },
    })
    return { status: r.status, out: r.stdout + r.stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('inversion: A reserves, B reserves, B merges first, A still lands (two queued PRs both land)', () => {
  const reserved = [A[0].slice(0, 14), B[0].slice(0, 14)]
  const bFirst = queueRun({ mainFiles: [BASE], added: [B], reserved })
  assert.equal(bFirst.status, 0, bFirst.out)
  const aSecond = queueRun({ mainFiles: [BASE, B], added: [A], reserved })
  assert.equal(aSecond.status, 0, aSecond.out)
  assert.match(aSecond.out, /reserved inversion \(#6798\): 20261222090100_fix_a\.sql accepted/)
})

test('an unreserved (hand-picked) backdated version is still refused', () => {
  const r = queueRun({ mainFiles: [BASE, B], added: [A], reserved: [B[0].slice(0, 14)] })
  assert.equal(r.status, 1, r.out)
  assert.match(r.out, /backdated migration\(s\) detected/)
  assert.match(r.out, /no live refs\/db-claims reservation/)
})

test('a reserved version is refused when a newer main migration writes the same object', () => {
  const B2 = ['20261222090200_fix_b.sql', 'create or replace function popsg.folder_view() returns int language sql as $$ select 3 $$;\n']
  const r = queueRun({ mainFiles: [BASE, B2], added: [A], reserved: [A[0].slice(0, 14), B2[0].slice(0, 14)] })
  assert.equal(r.status, 1, r.out)
  assert.match(r.out, /also writes function popsg\.folder_view/)
})

test('decideInversion fails closed on no detected objects and unreadable newer files', () => {
  assert.equal(decideInversion({ version: '1', sql: 'select 1;', reserved: true, newer: [] }).ok, false)
  assert.equal(decideInversion({ version: '1', sql: A[1], reserved: true, newer: [{ name: 'x', sql: undefined }] }).ok, false)
  assert.equal(decideInversion({ version: '1', sql: A[1], reserved: true, newer: [{ name: 'x', sql: B[1] }] }).ok, true)
})
