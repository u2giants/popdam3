// Negative-path first: HANDOFF.md backlog item B7 -- "every guard ships with a
// test that COMMITS THE VIOLATION and asserts the observable consequence". So
// the first tests here construct real colliding pull requests and assert the
// guard FAILS on them; only then do we assert it passes on the innocent cases.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  baseCompareSpec,
  extractObjects,
  findCollisions,
  formatReport,
  normalizeSql,
} from './check-pr-object-collisions.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readMigration = (name) =>
  readFileSync(path.join(repoRoot, 'supabase', 'migrations', name), 'utf8')

// ---------------------------------------------------------------------------
// THE HISTORICAL CASE (2026-07-31): four independent sessions each authored a
// forward migration doing `create or replace function
// plm.promote_coldlion_source_owned`. Each passed CI alone. These are the real
// migration files that came out of that incident, replayed as four separate
// pull requests -- exactly the shape the guard must reject.
// ---------------------------------------------------------------------------
const HISTORICAL = [
  '20260731163000_coldlion_recurring_promotion_drop_dead_failure_recording.sql',
  '20260731180000_coldlion_recurring_promotion_serialization_lock.sql',
  '20260731190000_coldlion_promotion_crosscheck_provenance_coverage.sql',
  '20260731200000_coldlion_recurring_promotion_fanin_name_tiebreak.sql',
]

test('FIRES: the real 2026-07-31 four-way collision is detected', () => {
  const sources = HISTORICAL.map((name, i) => ({
    label: `PR #${100 + i}`,
    files: [
      { path: `supabase/migrations/${name}`, sql: readMigration(name) },
    ],
  }))

  const result = findCollisions(sources)
  const hit = result.collisions.find(
    (c) => c.object === 'function plm.promote_coldlion_source_owned',
  )
  assert.ok(hit, 'expected plm.promote_coldlion_source_owned to be flagged')
  assert.equal(hit.sources.length, 4, 'all four pull requests must be named')

  const report = formatReport(result)
  assert.match(report, /^ERROR: cross-PR database object collision detected\./)
  assert.match(report, /plm\.promote_coldlion_source_owned/)
  for (const name of HISTORICAL) assert.match(report, new RegExp(name))
})

test('FIRES: a pair is enough -- two PRs replacing one function', () => {
  const sql = (body) =>
    `create or replace function plm.f(a int) returns void language sql as $$ ${body} $$;`
  const result = findCollisions([
    { label: 'PR #1', files: [{ path: 'supabase/migrations/1_a.sql', sql: sql('select 1') }] },
    { label: 'PR #2', files: [{ path: 'supabase/migrations/2_b.sql', sql: sql('select 2') }] },
  ])
  assert.deepEqual(
    result.collisions.map((c) => c.object),
    ['function plm.f'],
  )
})

test('FIRES: the base branch counts as a source (the B6 stale-base rule)', () => {
  // The precise form of "a stale base is a failure": it matters when the base
  // moved in a way that touched an object this PR also replaces.
  const result = findCollisions([
    {
      label: 'PR #7 (this PR)',
      files: [{ path: 'supabase/migrations/a.sql', sql: 'create or replace view api.x as select 1;' }],
    },
    {
      label: 'main (merged since this PR branched)',
      files: [{ path: 'supabase/migrations/b.sql', sql: 'CREATE OR REPLACE VIEW api.x AS SELECT 2;' }],
    },
  ])
  assert.deepEqual(result.collisions.map((c) => c.object), ['view api.x'])
})

test('FIRES: triggers and policies collide per (name, table)', () => {
  const trigger = (when) =>
    `create trigger touch ${when} update on public.assets for each row execute function public.f();`
  const t = findCollisions([
    { label: 'A', files: [{ path: 'a.sql', sql: trigger('before') }] },
    { label: 'B', files: [{ path: 'b.sql', sql: trigger('after') }] },
  ])
  assert.deepEqual(t.collisions.map((c) => c.object), ['table public.assets', 'trigger touch on public.assets'])

  const p = findCollisions([
    { label: 'A', files: [{ path: 'a.sql', sql: 'create policy p on core.customer for select using (true);' }] },
    { label: 'B', files: [{ path: 'b.sql', sql: 'create policy p on core.customer for all using (false);' }] },
  ])
  assert.deepEqual(p.collisions.map((c) => c.object), ['policy p on core.customer', 'table core.customer'])
})

test('FIRES: `drop` + `create` collides with `create or replace` (Kimi K3 finding)', () => {
  // The repo's other house idiom. Only the create-or-replace side was modelled
  // in the first version of this guard, so this pair -- just as much a lost
  // overwrite -- passed silently.
  const result = findCollisions([
    {
      label: 'PR #1',
      files: [{ path: 'a.sql', sql: 'create or replace function plm.promote_coldlion_source_owned(m text) returns void;' }],
    },
    {
      label: 'PR #2',
      files: [{
        path: 'b.sql',
        sql: 'drop function if exists plm.promote_coldlion_source_owned(text);\n'
          + 'create function plm.promote_coldlion_source_owned(m text) returns void;',
      }],
    },
  ])
  assert.deepEqual(
    result.collisions.map((c) => c.object),
    ['function plm.promote_coldlion_source_owned'],
  )
})

test('FIRES: two PRs dropping the same view collide', () => {
  const result = findCollisions([
    { label: 'A', files: [{ path: 'a.sql', sql: 'drop view api.v;' }] },
    { label: 'B', files: [{ path: 'b.sql', sql: 'drop view if exists api.v; create view api.v as select 2;' }] },
  ])
  assert.deepEqual(result.collisions.map((c) => c.object), ['view api.v'])
})

test('the base-branch compare uses the MERGE BASE, not pull_request.base.sha', () => {
  // Kimi K3's sharpest finding, confirmed against the live GitHub API: three-dot
  // compare `<headSha>...<baseRef>` starts at merge-base(head, base) -- the real
  // branch point -- while `base.sha` is the base branch's tip at event time, so
  // `base.sha...baseRef` compares the base branch to itself and returns nothing.
  // That made the entire stale-base leg dead code in the first version.
  assert.equal(
    baseCompareSpec('u2giants/shared-db', 'HEADSHA', 'main'),
    'repos/u2giants/shared-db/compare/HEADSHA...main',
  )
})

// ---------------------------------------------------------------------------
// DOES NOT FIRE -- the false-positive side. A guard that blocks every pull
// request is worse than the bug it prevents.
// ---------------------------------------------------------------------------

test('does NOT fire on a single pull request replacing one object four times', () => {
  const sources = [
    {
      label: 'PR #1 (this PR)',
      files: HISTORICAL.map((name) => ({
        path: `supabase/migrations/${name}`,
        sql: readMigration(name),
      })),
    },
  ]
  assert.deepEqual(findCollisions(sources).collisions, [])
})

test('does NOT fire on an INNOCENT PR when two OTHER PRs collide', () => {
  // Found by the live drill, not by reasoning: three real pull requests were
  // opened, two colliding on plm.promote_coldlion_source_owned and one touching
  // an unrelated view, and the first version of this guard FAILED the innocent
  // one. Blocking an unrelated author over someone else's collision is the
  // false positive the design posture forbids.
  const collide = 'create or replace function plm.promote_coldlion_source_owned(m text) returns void;'
  const sources = [
    { label: 'PR #401 (this PR)', files: [{ path: 'c.sql', sql: 'create or replace view api.unrelated as select 1;' }] },
    { label: 'PR #398', files: [{ path: 'a.sql', sql: collide }] },
    { label: 'PR #399', files: [{ path: 'b.sql', sql: collide }] },
  ]
  const result = findCollisions(sources, 'PR #401 (this PR)')
  assert.deepEqual(result.collisions, [], 'the innocent PR must not be failed')
  assert.deepEqual(
    result.bystanderCollisions.map((c) => c.object),
    ['function plm.promote_coldlion_source_owned'],
    'the other two must still be reported as a note',
  )
  const report = formatReport(result)
  assert.match(report, /^No cross-PR object collisions detected involving this pull request\./)
  assert.match(report, /NOTE \(not a failure for this pull request\)/)

  // ...and the guilty parties are still failed when THEY are the primary.
  assert.equal(findCollisions(sources, 'PR #398').collisions.length, 1)
  assert.equal(findCollisions(sources, 'PR #399').collisions.length, 1)
})

test('does NOT fire on unrelated PRs touching different objects', () => {
  const result = findCollisions([
    { label: 'PR #1', files: [{ path: 'a.sql', sql: 'create or replace function crm.a() returns void language sql as $$ select $$;' }] },
    { label: 'PR #2', files: [{ path: 'b.sql', sql: 'create or replace function crm.b() returns void language sql as $$ select $$;' }] },
    { label: 'PR #3', files: [{ path: 'c.sql', sql: 'create or replace view api.c as select 1;' }] },
  ])
  assert.deepEqual(result.collisions, [])
  assert.match(formatReport(result), /^No cross-PR object collisions detected involving this pull request.$/)
})

test('does NOT fire on a same-named trigger attached to different tables', () => {
  const result = findCollisions([
    { label: 'A', files: [{ path: 'a.sql', sql: 'create trigger touch before update on public.assets for each row execute function f();' }] },
    { label: 'B', files: [{ path: 'b.sql', sql: 'create trigger touch before update on public.style_groups for each row execute function f();' }] },
  ])
  assert.deepEqual(result.collisions, [])
})

test('does NOT fire on a same-named function in different schemas', () => {
  const result = findCollisions([
    { label: 'A', files: [{ path: 'a.sql', sql: 'create or replace function crm.f() returns void language sql as $$ select $$;' }] },
    { label: 'B', files: [{ path: 'b.sql', sql: 'create or replace function pim.f() returns void language sql as $$ select $$;' }] },
  ])
  assert.deepEqual(result.collisions, [])
})

test('does NOT fire on a commented-out create or replace', () => {
  const result = findCollisions([
    { label: 'A', files: [{ path: 'a.sql', sql: 'create or replace function plm.real() returns void language sql as $$ select $$;' }] },
    { label: 'B', files: [{ path: 'b.sql', sql: '-- create or replace function plm.real() -- historical note\nselect 1;' }] },
  ])
  assert.deepEqual(result.collisions, [])
})

test('FAIL-CLOSED POSTURE: no pull-request context exits 2', () => {
  // The guard's core promise (a false positive blocking every PR is worse than
  // the bug it prevents) had no test until Kimi K3's review said so.
  const script = path.join(repoRoot, 'scripts', 'check-pr-object-collisions.mjs')
  const run = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }, // no GITHUB_* at all
  })
  assert.equal(run.status, 2, run.stderr)
  assert.match(run.stderr, /could not gather complete inputs/)
  assert.match(run.stderr, /No collision checking was performed/)
})

// ---------------------------------------------------------------------------
// Extraction details.
// ---------------------------------------------------------------------------

test('extraction is case-insensitive, whitespace- and newline-tolerant', () => {
  assert.deepEqual(
    extractObjects('CREATE   OR\n  REPLACE\tFUNCTION  Plm . Promote_X ( a int )'),
    ['function plm.promote_x'],
  )
})

test('CRLF comments are still stripped (backlog item B1 trap)', () => {
  const crlf = '-- create or replace function plm.ghost()\r\ncreate or replace view api.v as select 1;\r\n'
  assert.deepEqual(extractObjects(crlf), ['view api.v'])
  assert.ok(!normalizeSql(crlf).includes('ghost'))
})

test('quoted identifiers are unquoted, unquoted ones lower-cased', () => {
  assert.deepEqual(
    extractObjects('create or replace function "Plm"."Weird Name"() returns void;'),
    ['function Plm.Weird Name'],
  )
  assert.deepEqual(
    extractObjects('create or replace function PLM.Mixed() returns void;'),
    ['function plm.mixed'],
  )
})

test('overloads collapse to one key -- deliberately coarse', () => {
  const result = findCollisions([
    { label: 'A', files: [{ path: 'a.sql', sql: 'create or replace function plm.f(a int) returns void;' }] },
    { label: 'B', files: [{ path: 'b.sql', sql: 'create or replace function plm.f(a text, b int) returns void;' }] },
  ])
  assert.deepEqual(result.collisions.map((c) => c.object), ['function plm.f'])
})

test('materialized views and procedures are recognised', () => {
  assert.deepEqual(extractObjects('create materialized view if not exists rep.m as select 1;'), [
    'materialized view rep.m',
  ])
  assert.deepEqual(extractObjects('create or replace procedure app.p() language sql as $$ select $$;'), [
    'procedure app.p',
  ])
})

test('DOCUMENTED BLIND SPOT: an UNQUALIFIED name does not collide with a qualified one', () => {
  // Pinned as intended behaviour, not left to be rediscovered. There is no safe
  // static resolution of `set search_path`; migrations here schema-qualify by
  // convention and this guard depends on that convention holding.
  const result = findCollisions([
    { label: 'A', files: [{ path: 'a.sql', sql: 'create or replace function plm.promote_x() returns void;' }] },
    { label: 'B', files: [{ path: 'b.sql', sql: 'set search_path to plm; create or replace function promote_x() returns void;' }] },
  ])
  assert.deepEqual(result.collisions, [], 'documented miss -- change this test if it is ever fixed')
})

test('DOCUMENTED BLIND SPOT: plain `create table`/`alter` is not modelled', () => {
  // Asserted so the limitation stays honest and visible rather than drifting
  // into an assumption that the guard covers it. See the header comment.
  assert.deepEqual(extractObjects('alter table core.customer add column x int;'), [])
  assert.deepEqual(extractObjects('create table core.thing (id int);'), [])
  assert.deepEqual(extractObjects("execute 'create or replace function plm.hidden()';"), [
    'function plm.hidden', // string-built DDL happens to match here; it is not guaranteed
  ])
})

test('merge collisions use broad claim identities for create/alter table', () => {
  const result = findCollisions([
    { label: 'A', files: [{ path: 'a.sql', sql: 'create table core.thing (id int);' }] },
    { label: 'B', files: [{ path: 'b.sql', sql: 'alter table core.thing add column x int;' }] },
  ])
  assert.deepEqual(result.collisions.map((x) => x.object), ['table core.thing'])
})
