// Self-service additive lane boundary tests (issue #3199 Phase B1).
//
// DIRTY-FIRST, ALWAYS: every refusal fixture is asserted BEFORE any passing
// fixture runs in its block, because a classifier that false-accepts one
// out-of-boundary change has removed the only gate that keeps the lane safe.
// The fixtures are the plan §10 list, including the holes the 2026-09-17 Grok
// review contributed: FK targets, SECURITY DEFINER, RLS-before-grant,
// CREATE OR REPLACE, dflow/app boundary escapes, riding-along workflows, and
// both sides of the ADD COLUMN boundary.
import assert from 'node:assert/strict'
import test from 'node:test'
import { classifySelfServiceLane, boundaryReferenceViolations, BOUNDARY_SCHEMAS, workIssueRouteOf, LaneBoundaryError } from './check-self-service-additive-lane.mjs'
import { readFileSync } from 'node:fs'

const MIGRATION = 'supabase/migrations/20260918000000_lane_fixture.sql'
const files = (names, status = 'added') => names.map((filename) => ({ filename, status }))
const classify = (sql, { extraFiles = [], mainVersions = [], content = sql } = {}) =>
  classifySelfServiceLane({ changedFiles: [...files([MIGRATION]), ...extraFiles], migrations: [{ filename: MIGRATION, content }], mainVersions })

test('a created table with a foreign key into a shared schema REFUSES (the §6.5 hole)', () => {
  const result = classify('create table crm.foo (id uuid, customer uuid references core.customer(id))')
  assert.equal(result.verdict, 'refuse')
  assert.match(result.reasons.join('; '), /references object\(s\) outside \{crm,pim,dam,plm\}: core\.customer/)
})

test('SECURITY DEFINER functions REFUSE, with or without boundary names', () => {
  for (const sql of [
    'create function crm.leak() returns void language plpgsql security definer as $$ begin null; end $$',
    'create function pim.leak() returns void language plpgsql security invoker set search_path = public as $$ begin null; end $$',
  ]) {
    const result = classify(sql)
    assert.equal(result.verdict, 'refuse', sql)
    assert.match(result.reasons.join('; '), /SECURITY DEFINER|statement is not a whitelisted/, sql)
  }
})

test('a function body referencing a shared schema REFUSES even when the created name is in-boundary', () => {
  const result = classify('create function crm.f() returns void language sql security invoker as $$ select 1 from core.item $$')
  assert.equal(result.verdict, 'refuse')
  assert.match(result.reasons.join('; '), /core\.item/)
  const viaApi = classify('create function dam.g() returns void language sql security invoker as $$ select api.plm_item_list() $$')
  assert.equal(viaApi.verdict, 'refuse')
  assert.match(viaApi.reasons.join('; '), /api\.plm_item_list/)
})

test('a view body referencing a shared schema REFUSES; an all-crm view PASSES', () => {
  const bad = classify('create view crm.v as select * from core.customer')
  assert.equal(bad.verdict, 'refuse')
  assert.match(bad.reasons.join('; '), /core\.customer/)
  const good = classify('create view crm.v as select t.id from crm.customer_ext t')
  assert.equal(good.verdict, 'pass')
})

test('GRANT to a browser role on a crm table with no RLS REFUSES; with RLS first it PASSES', () => {
  const naked = classify([
    'create table crm.open_table (id uuid)',
    'grant select on crm.open_table to authenticated',
  ].join(';\n'))
  assert.equal(naked.verdict, 'refuse')
  assert.match(naked.reasons.join('; '), /before row level security is enabled/)

  const guarded = classify([
    'create table crm.guarded (id uuid)',
    'alter table crm.guarded enable row level security',
    'create policy guarded_read on crm.guarded for select to authenticated using (true)',
    'grant select on crm.guarded to authenticated',
  ].join(';\n'))
  assert.equal(guarded.verdict, 'pass')
})

test('dam grants to browser roles are judged without the RLS precondition (dam is not browser-exposed)', () => {
  const result = classify([
    'create table dam.worker_state (id uuid)',
    'grant select on dam.worker_state to authenticated',
  ].join(';\n'))
  assert.equal(result.verdict, 'pass')
})

test('CREATE OR REPLACE of anything REFUSES', () => {
  for (const sql of [
    'create or replace function crm.f() returns void language sql security invoker as $$ select 1 $$',
    'create or replace view crm.v as select 1',
  ]) {
    const result = classify(sql)
    assert.equal(result.verdict, 'refuse', sql)
    assert.match(result.reasons.join('; '), /CREATE OR REPLACE|not a whitelisted/, sql)
  }
})

test('every out-of-boundary schema REFUSES on sight', () => {
  for (const schema of ['dflow', 'app', 'api', 'core', 'public', 'ingest', 'storage']) {
    const result = classify(`create table ${schema}.foo (id uuid)`)
    assert.equal(result.verdict, 'refuse', schema)
    assert.match(result.reasons.join('; '), /outside \{crm,pim,dam,plm\}|not a whitelisted/, schema)
  }
})

test('plm is in-boundary for additive shapes (owner ruling 2026-09-25)', () => {
  const result = classify('create table plm.foo (id uuid)')
  assert.equal(result.verdict, 'pass')
  const column = classify('alter table plm.foo add column note text')
  assert.equal(column.verdict, 'pass')
})

test('CREATE SCHEMA REFUSES — brand-new schemas are an owner decision', () => {
  const result = classify('create schema sales')
  assert.equal(result.verdict, 'refuse')
  assert.match(result.reasons.join('; '), /CREATE SCHEMA/)
})

test('a workflow, script or .github file riding along REFUSES; a prose document may ride', () => {
  for (const rider of ['.github/workflows/evil.yml', 'scripts/evil.mjs', 'supabase/config.toml']) {
    const result = classify('create table crm.ok (id uuid)', { extraFiles: files([rider]) })
    assert.equal(result.verdict, 'refuse', rider)
    assert.match(result.reasons.join('; '), /non-migration file rides along/, rider)
  }
  const docs = classify('create table crm.ok (id uuid)', { extraFiles: [{ filename: 'docs/notes.md', status: 'added' }] })
  assert.equal(docs.verdict, 'pass')
})

test('data statements, drops and truncates REFUSE', () => {
  for (const sql of [
    'insert into crm.foo values (1)',
    'update crm.foo set id = 1',
    'delete from crm.foo',
    'merge into crm.foo using crm.bar on true when matched then update set id = 1',
    'drop table crm.foo',
    'truncate crm.foo',
  ]) {
    const result = classify(sql)
    assert.equal(result.verdict, 'refuse', sql)
    assert.match(result.reasons.join('; '), /data and destructive|outside the lane/, sql)
  }
})

test('ADD COLUMN: nullable built-in PASSES; NOT NULL DEFAULT and REFERENCES both REFUSE', () => {
  const pass = classify('alter table crm.customer_ext add column notes text')
  assert.equal(pass.verdict, 'pass')
  const notNull = classify('alter table crm.customer_ext add column x int not null default 0')
  assert.equal(notNull.verdict, 'refuse')
  assert.match(notNull.reasons.join('; '), /not a whitelisted/)
  const references = classify('alter table crm.customer_ext add column y int references crm.other(id)')
  assert.equal(references.verdict, 'refuse')
})

test('an index on an EXISTING boundary table REFUSES; on a table this change creates it PASSES', () => {
  const existing = classify('create index ix on crm.customer_ext (id)')
  assert.equal(existing.verdict, 'refuse')
  assert.match(existing.reasons.join('; '), /which this change does not create/)
  const fresh = classify('create index ix on crm.new_table (id)')
  // created in a prior statement
  const withCreate = classify(['create table crm.new_table (id uuid)', 'create index ix on crm.new_table (id)'].join(';\n'))
  assert.equal(withCreate.verdict, 'pass')
  assert.equal(fresh.verdict, 'refuse')
})

test('a reused or modified migration version REFUSES', () => {
  const reused = classify('create table crm.ok (id uuid)', { mainVersions: ['20260918000000'] })
  assert.equal(reused.verdict, 'refuse')
  assert.match(reused.reasons.join('; '), /reuses version/)
  const modified = classifySelfServiceLane({
    changedFiles: [{ filename: MIGRATION, status: 'modified' }],
    migrations: [{ filename: MIGRATION, content: 'create table crm.ok (id uuid)' }],
    mainVersions: [],
  })
  assert.equal(modified.verdict, 'refuse')
  assert.match(modified.reasons.join('; '), /modifies an existing migration/)
})

test('untokenisable SQL REFUSES as parse doubt, never as a guess', () => {
  const result = classify("create table crm.foo (id uuid); select 'unterminated")
  assert.equal(result.verdict, 'refuse')
  assert.match(result.reasons.join('; '), /could not be tokenised/)
})

test('the §10 PASS fixture: new dam table + RLS + policy + grant + index', () => {
  const result = classify([
    'create table dam.sku_note (id uuid primary key, sku text not null, note text)',
    'alter table dam.sku_note enable row level security',
    'create policy sku_note_all on dam.sku_note for all to service_role using (true)',
    'grant select on dam.sku_note to service_role',
    'create index sku_note_sku on dam.sku_note (sku)',
  ].join(';\n'))
  assert.equal(result.verdict, 'pass')
  assert.deepEqual(result.objects.tables, ['dam.sku_note'])
})

test('a SECURITY INVOKER function over boundary objects PASSES; system schema references are allowed', () => {
  const result = classify([
    'create table crm.note (id uuid, body text)',
    'create function crm.note_count() returns integer language sql security invoker stable as $$ select count(*) from crm.note where pg_catalog.pg_typeof(id) is not null $$',
  ].join(';\n'))
  assert.equal(result.verdict, 'pass')
  assert.deepEqual(result.objects.functions, ['crm.note_count'])
})

test('no new migration REFUSES — the lane is for additive structural changes only', () => {
  const result = classifySelfServiceLane({ changedFiles: files(['docs/x.md']), migrations: [], mainVersions: [] })
  assert.equal(result.verdict, 'refuse')
  assert.match(result.reasons.join('; '), /no new migration/)
})

test('reference scanning distinguishes table aliases from schema names', () => {
  assert.deepEqual(boundaryReferenceViolations('select t.id from crm.foo t join crm.bar b on b.id = t.id'), [])
  const bad = boundaryReferenceViolations('select x.id from crm.foo t, sales.other x')
  assert.ok(bad.includes('sales.other'), JSON.stringify(bad))
})

test('the boundary stays exactly {crm, pim, dam, plm} (owner ruling 2026-09-25)', () => {
  assert.deepEqual([...BOUNDARY_SCHEMAS], ['crm', 'pim', 'dam', 'plm'])
})

// ---------------------------------------------------------------------------
// Round-2 review fixes (governed Grok REVISE at 5acb1b4e): each fixture pins a
// hole that review found, dirty-first.

test('a single-quoted routine body REFUSES instead of hiding from the reference scan (review High)', () => {
  const result = classify("create function crm.f() returns void language sql security invoker as 'select 1 from core.customer'")
  assert.equal(result.verdict, 'refuse')
  assert.match(result.reasons.join('; '), /single-quoted AS literal/)
  // An in-boundary single-quoted body refuses for the same reason: the scan
  // cannot prove what it cannot see.
  const benign = classify("create function crm.g() returns void language sql security invoker as 'select 1'")
  assert.equal(benign.verdict, 'refuse')
  assert.match(benign.reasons.join('; '), /single-quoted AS literal/)
})

test('GRANT ... WITH GRANT OPTION REFUSES by name, not by generic shape miss (review High)', () => {
  const result = classify([
    'create table crm.escalating (id uuid)',
    'alter table crm.escalating enable row level security',
    'grant select on crm.escalating to authenticated with grant option',
  ].join(';\n'))
  assert.equal(result.verdict, 'refuse')
  assert.match(result.reasons.join('; '), /WITH GRANT OPTION/)
})

test('an empty or unreadable migration file REFUSES instead of passing vacuously (review Medium)', () => {
  const empty = classify('', { content: '' })
  assert.equal(empty.verdict, 'refuse')
  assert.match(empty.reasons.join('; '), /contains no statements/)
  const whitespace = classify('-- only a comment\n', { content: '-- only a comment\n' })
  assert.equal(whitespace.verdict, 'refuse')
  assert.match(whitespace.reasons.join('; '), /contains no statements/)
})

test('workIssueRouteOf routes through the operation fork, never structural admission (review Critical)', () => {
  // A repository-maintenance pull request must resolve WITHOUT structural
  // admission: the structural resolver refuses every non-structural
  // change_type, and the guarded merge serves repo-maintenance pull requests
  // too. This is the exact defect the review marked Critical.
  const route = (operationRoute, scope) => workIssueRouteOf(42, {
    derive: () => ({ route: operationRoute, issue: 7 }),
    getIssue: () => ({ body: 'scope fence' }),
    parseScope: () => scope,
  })
  assert.equal(route('repo-maintenance', { route: 'repo-maintenance', workType: 'repo-maintenance', changeType: 'ci' }).operationRoute, 'repo-maintenance')
  assert.equal(route('structural', { route: 'self-service-additive' }).scope.route, 'self-service-additive')
  assert.equal(route('structural', { route: 'shared-db-orchestrator' }).scope.route, 'shared-db-orchestrator')
  // An unreadable derivation still throws, and the CLI maps a throw to exit 2.
  assert.throws(() => workIssueRouteOf(42, {
    derive: () => { throw new LaneBoundaryError('pull request could not be derived') },
    getIssue: () => ({ body: '' }),
    parseScope: () => null,
  }), /could not be derived/)
  // The routing fork is pinned in source: derivePrOperationRoute, the same
  // fork the merge machinery uses — never the structural admission resolver,
  // whose refusal of non-structural change_types is the defect fixed here.
  // (The import line is pinned, not the whole file: workIssueRouteOf's comment
  // names the rejected resolver to explain the fork.)
  const source = readFileSync(new URL('./check-self-service-additive-lane.mjs', import.meta.url), 'utf8')
  assert.match(source, /derive = derivePrOperationRoute/)
  assert.doesNotMatch(source.split('\n').find((line) => line.includes('from \'./manage-migration-author-lanes.mjs\'')), /resolveAdmittedIssueForPr/)
})

test('COMMENT ON a shared or unqualified target REFUSES (round-2 review Medium)', () => {
  for (const sql of [
    'comment on schema core is null',
    'comment on publication supabase_realtime is null',
    'comment on extension pg_net is null',
  ]) {
    const result = classify(sql)
    assert.equal(result.verdict, 'refuse', sql)
    assert.match(result.reasons.join('; '), /not a whitelisted lane shape/, sql)
  }
  // A dotted shared-schema target is caught by the reference scan instead.
  const dotted = classify('comment on column core.customer.note is null')
  assert.equal(dotted.verdict, 'refuse')
  assert.match(dotted.reasons.join('; '), /core\.customer/)
  // A boundary-qualified comment still passes.
  const own = classify([
    'create table crm.noted (id uuid)',
    'comment on table crm.noted is \'\'',
  ].join(';\n'))
  assert.equal(own.verdict, 'pass')
})
