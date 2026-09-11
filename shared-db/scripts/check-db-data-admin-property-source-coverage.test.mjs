// Negative-path tests for the DB Data Admin Property-source coverage guard (issue #2579).
//
// Backlog B7 standard: a test that only proves the guard EXISTS is worthless. Every
// assertion below feeds the guard a known-dirty case and proves it REFUSES it. The
// last two prove the shipped manifest passes, so a green run is not green-by-vacuum.
//
//   node --test scripts/check-db-data-admin-property-source-coverage.test.mjs
//
// Only family names, dispositions and selectors appear here. No licensed label, row,
// URL, contract or raw evidence.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadManifest, resolveFamily, checkManifestShape, checkCatalog,
  checkInventory, checkMigrationEvidence, catalogFromMigrations,
} from './check-db-data-admin-property-source-coverage.mjs'

const ok = (over = {}) => ({
  schema_version: 1,
  migration_version: '20260910155753',
  families: [
    {
      family: 'alpha', disposition: 'exposed', source_table: 'plm.alpha_property',
      table_prefixes: ['alpha_'], business_purpose: 'p', reason: 'r',
    },
    {
      family: 'beta', disposition: 'not_applicable_no_source_property_vocabulary',
      table_prefixes: ['beta_'], business_purpose: 'p', reason: 'r',
    },
  ],
  ...over,
})

test('a clean manifest is accepted, so the failures below are real', () => {
  assert.deepEqual(checkManifestShape(ok()), [])
  assert.deepEqual(checkCatalog(ok(), ['alpha_property', 'beta_asset']), [])
})

test('an unclassified plm table is refused', () => {
  const f = checkCatalog(ok(), ['alpha_property', 'gamma_property'])
  assert.equal(f.length, 1)
  assert.match(f[0], /plm\.gamma_property is claimed by no family/)
})

test('two families claiming one table is refused as a tie', () => {
  const m = ok()
  m.families[1].table_prefixes = ['alpha_']
  const f = checkCatalog(m, ['alpha_property'])
  assert.equal(f.length, 1)
  assert.match(f[0], /claimed by both alpha and beta/)
})

test('an exact name beats a prefix instead of tying', () => {
  const m = ok()
  m.families[1].table_names = ['alpha_property']
  const hit = resolveFamily(m, 'alpha_property')
  assert.equal(hit.tie, undefined)
  assert.equal(hit.family.family, 'beta')
})

test('a duplicate family name is refused', () => {
  const m = ok()
  m.families[1].family = 'alpha'
  assert.ok(checkManifestShape(m).some((x) => /duplicate family alpha/.test(x)))
})

test('an unknown disposition is refused', () => {
  const m = ok()
  m.families[1].disposition = 'probably_fine'
  assert.ok(checkManifestShape(m).some((x) => /unknown disposition probably_fine/.test(x)))
})

test('an exposed family with no source table is refused', () => {
  const m = ok()
  delete m.families[0].source_table
  assert.ok(checkManifestShape(m).some((x) => /alpha: exposed but names no source table/.test(x)))
})

test('a non-exposed family that still names a source table is refused', () => {
  const m = ok()
  m.families[1].source_table = 'plm.beta_property'
  assert.ok(checkManifestShape(m).some((x) => /beta: is not_applicable/.test(x)))
})

test('a family with no selector at all is refused', () => {
  const m = ok()
  delete m.families[1].table_prefixes
  assert.ok(checkManifestShape(m).some((x) => /beta: no table selector/.test(x)))
})

test('two exposed families sharing one source table is refused', () => {
  const m = ok()
  m.families[1].disposition = 'exposed'
  m.families[1].source_table = 'plm.alpha_property'
  assert.ok(checkManifestShape(m).some((x) => /claimed by both alpha and beta/.test(x)))
})

test('an exposed family the live inventory still calls other is refused', () => {
  const rows = [{ table_name: 'alpha_property', source_system: 'other' }]
  const f = checkInventory(ok(), rows)
  assert.equal(f.length, 1)
  assert.match(f[0], /still reports source_system 'other'/)
  assert.deepEqual(
    checkInventory(ok(), [{ table_name: 'alpha_property', source_system: 'alpha' }]), [])
})

test('a missing latest-complete clock in the migration is refused', () => {
  const m = ok()
  m.families[0].latest_complete_clock = 'alpha_latest'
  const f = checkMigrationEvidence(m, 'select 1 from plm.alpha_property')
  assert.ok(f.some((x) => /alpha_latest is absent from the reserved migration/.test(x)))
})

test('reading refused evidence is refused, and never naming it is refused too', () => {
  const m = ok()
  m.families[0].must_not_expose = ['plm.alpha_inferred']
  const reads = checkMigrationEvidence(m, 'select x from plm.alpha_inferred')
  assert.ok(reads.some((x) => /reads from it/.test(x)))
  const silent = checkMigrationEvidence(m, 'select 1')
  assert.ok(silent.some((x) => /never proves it stays out/.test(x)))
  // Naming it inside a fail-closed assertion is the proof, not a violation.
  assert.deepEqual(
    checkMigrationEvidence(m, "position('plm.alpha_inferred' in v_def) <> 0"), [])
})

test('an exposed source table absent from the migration is refused', () => {
  const m = ok()
  m.families[0].latest_complete_clock = 'alpha_latest'
  const f = checkMigrationEvidence(m, 'alpha_latest')
  assert.ok(f.some((x) => /plm\.alpha_property is exposed but absent/.test(x)))
})

test('the shipped manifest passes its own shape and covers the migration catalog', () => {
  const manifest = loadManifest()
  assert.deepEqual(checkManifestShape(manifest), [])
  const dir = new URL('../supabase/migrations/', import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/, '$1')
  const tables = catalogFromMigrations(dir)
  assert.ok(tables.length > 200, `expected a real catalog, got ${tables.length}`)
  assert.deepEqual(checkCatalog(manifest, tables), [])
  // Exactly the invocation CI runs: the non-empty-family rule is enforced on the
  // derived path too, so a manifest family matching no table is refused there.
  assert.deepEqual(
    checkCatalog(manifest, tables, { requireNonEmptyFamilies: true, derived: true }), [])
})

test('on the derived path an undeclared empty family is refused', () => {
  const m = ok()
  const f = checkCatalog(m, ['alpha_property'],
    { requireNonEmptyFamilies: true, derived: true })
  assert.equal(f.length, 1)
  assert.match(f[0], /^beta matches no table in the catalog derived from/)
})

test('on the live path an empty family is refused even when it declares the exemption', () => {
  const m = ok()
  m.families[1].absent_from_repo_migrations = 'predates this repository'
  const f = checkCatalog(m, ['alpha_property'], { requireNonEmptyFamilies: true })
  assert.equal(f.length, 1)
  assert.match(f[0], /^beta matches no table in the live catalog/)
})

test('the derived-path exemption must record a reason, and goes stale loudly', () => {
  const blank = ok()
  blank.families[1].absent_from_repo_migrations = '   '
  const f = checkCatalog(blank, ['alpha_property'],
    { requireNonEmptyFamilies: true, derived: true })
  assert.equal(f.length, 1)
  assert.match(f[0], /absent_from_repo_migrations must record why/)

  const stale = ok()
  stale.families[1].absent_from_repo_migrations = 'predates this repository'
  const g = checkCatalog(stale, ['alpha_property', 'beta_asset'],
    { requireNonEmptyFamilies: true, derived: true })
  assert.equal(g.length, 1)
  assert.match(g[0], /drop the declaration/)
})
