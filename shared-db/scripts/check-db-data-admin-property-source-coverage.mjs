#!/usr/bin/env node
// Fail-closed validator for config/db-data-admin-property-source-coverage.json (issue #2579).
//
// The manifest is the machine-readable authority for all-licensor Property-source
// coverage in DB Data Admin. This script refuses:
//   * an unknown disposition, a duplicate family name, a family with no selector,
//     an `exposed` family with no source_table, and a non-`exposed` family that
//     claims one;
//   * two families that both claim the same plm table (a tie), and any plm table
//     that no family claims;
//   * an `exposed` source table, latest-complete clock or refused-evidence table
//     that the reserved migration contradicts.
//
// Offline (the default) the catalog is derived from this repository's own
// migrations, which is the path a new landing schema actually arrives on. With
// --catalog <file> (one plm base-table name per line) or --inventory <file>
// (JSON rows of {source_system, table_name} from api.source_capture_inventory)
// it compares against the live catalog as well.
//
// It prints selectors, family names and dispositions only. No licensed label,
// row, URL, contract or raw evidence may ever enter this file or its output.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(ROOT, 'config/db-data-admin-property-source-coverage.json')
const DISPOSITIONS = new Set([
  'exposed',
  'not_applicable_no_source_property_vocabulary',
  'blocked_missing_landing_shape',
])

export function loadManifest(file = MANIFEST) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

// Resolution: exact name, then longest prefix, then regex. Returns
// { family, strength } or null. Strength orders the tie check.
export function resolveFamily(manifest, table) {
  const hits = []
  for (const f of manifest.families) {
    if ((f.table_names || []).includes(table)) hits.push({ family: f, strength: 1e6 })
    else {
      let best = -1
      for (const p of f.table_prefixes || []) if (table.startsWith(p) && p.length > best) best = p.length
      if (best >= 0) hits.push({ family: f, strength: best })
      else if (f.table_regex && new RegExp(f.table_regex).test(table)) hits.push({ family: f, strength: 0 })
    }
  }
  if (hits.length === 0) return null
  hits.sort((a, b) => b.strength - a.strength)
  if (hits.length > 1 && hits[0].strength === hits[1].strength) {
    return { tie: [hits[0].family.family, hits[1].family.family] }
  }
  return hits[0]
}

export function checkManifestShape(manifest) {
  const failures = []
  if (manifest.schema_version !== 1) failures.push(`unknown schema_version ${manifest.schema_version}`)
  if (!Array.isArray(manifest.families) || manifest.families.length === 0) {
    failures.push('the manifest declares no families')
    return failures
  }
  const seen = new Set()
  for (const f of manifest.families) {
    const id = f.family
    if (!id) { failures.push('a family entry has no family name'); continue }
    if (seen.has(id)) failures.push(`duplicate family ${id}`)
    seen.add(id)
    if (!DISPOSITIONS.has(f.disposition)) failures.push(`${id}: unknown disposition ${f.disposition}`)
    if (!f.business_purpose) failures.push(`${id}: no business purpose`)
    if (!f.reason) failures.push(`${id}: no recorded reason`)
    const selectors =
      (f.table_names || []).length + (f.table_prefixes || []).length + (f.table_regex ? 1 : 0)
    if (selectors === 0) failures.push(`${id}: no table selector`)
    if (f.disposition === 'exposed') {
      if (!f.source_table) failures.push(`${id}: exposed but names no source table`)
      else if (!f.source_table.startsWith('plm.')) failures.push(`${id}: source table ${f.source_table} is not in plm`)
    } else if (f.source_table) {
      failures.push(`${id}: is ${f.disposition} but still names a source table`)
    }
  }
  // Exactly one exposed arm per source table.
  const bySource = new Map()
  for (const f of manifest.families.filter((x) => x.disposition === 'exposed')) {
    if (bySource.has(f.source_table)) {
      failures.push(`${f.source_table} is claimed by both ${bySource.get(f.source_table)} and ${f.family}`)
    }
    bySource.set(f.source_table, f.family)
  }
  return failures
}

// `derived` says the catalog came from this repository's own migrations rather
// than from the live database. The derived catalog cannot see a table that was
// created before this repository's migration history began, so a family may
// declare `absent_from_repo_migrations: "<reason>"` to be exempt on THAT path
// only. The declaration is not a way out of the rule: the family must still
// match a table on the live path, the reason must be recorded, and a
// declaration that turns out to be stale (the family does match a derived
// table) is itself a failure.
export function checkCatalog(manifest, tables, { requireNonEmptyFamilies = false, derived = false } = {}) {
  const failures = []
  const used = new Set()
  for (const t of tables) {
    const hit = resolveFamily(manifest, t)
    if (!hit) {
      failures.push(`plm.${t} is claimed by no family: add one manifest entry, do not widen an existing selector blindly`)
    } else if (hit.tie) {
      failures.push(`plm.${t} is claimed by both ${hit.tie[0]} and ${hit.tie[1]}`)
    } else {
      used.add(hit.family.family)
    }
  }
  if (requireNonEmptyFamilies) {
    const where = derived ? 'the catalog derived from this repository’s migrations' : 'the live catalog'
    for (const f of manifest.families) {
      const declared = f.absent_from_repo_migrations
      if (declared && used.has(f.family)) {
        failures.push(
          `${f.family} declares absent_from_repo_migrations but this repository's migrations do create a table it claims: drop the declaration`)
        continue
      }
      if (used.has(f.family)) continue
      if (derived && declared) {
        if (typeof declared !== 'string' || !declared.trim()) {
          failures.push(`${f.family}: absent_from_repo_migrations must record why, as a non-empty string`)
        }
        continue
      }
      failures.push(`${f.family} matches no table in ${where}`)
    }
  }
  return failures
}

export function checkInventory(manifest, rows) {
  // Nothing a family claims may still be reported as source_system 'other'.
  const failures = []
  for (const row of rows) {
    const hit = resolveFamily(manifest, row.table_name)
    if (!hit || hit.tie) continue
    const f = hit.family
    if (f.disposition === 'exposed' && row.source_system === 'other') {
      failures.push(`plm.${row.table_name} is exposed under ${f.family} but the inventory still reports source_system 'other'`)
    }
  }
  return failures
}

export function checkMigrationEvidence(manifest, migrationText) {
  const failures = []
  for (const f of manifest.families) {
    if (f.latest_complete_clock && !migrationText.includes(f.latest_complete_clock)) {
      failures.push(`${f.family}: latest-complete clock ${f.latest_complete_clock} is absent from the reserved migration`)
    }
    for (const forbidden of f.must_not_expose || []) {
      // Named in a fail-closed assertion is exactly how the migration PROVES the
      // refusal. Only a `from`/`join` on it would actually read the evidence.
      const read = new RegExp(`\\b(from|join)\\s+${forbidden.replace('.', '\\.')}\\b`, 'i')
      if (read.test(migrationText)) {
        failures.push(`${f.family}: ${forbidden} is refused evidence but the reserved migration reads from it`)
      }
      if (!migrationText.includes(forbidden)) {
        failures.push(`${f.family}: ${forbidden} is refused evidence but the reserved migration never proves it stays out`)
      }
    }
  }
  const newlyExposed = manifest.families.filter((f) => f.latest_complete_clock && f.source_table)
  for (const f of newlyExposed) {
    if (!migrationText.includes(f.source_table)) {
      failures.push(`${f.family}: ${f.source_table} is exposed but absent from the reserved migration`)
    }
  }
  return failures
}

export function catalogFromMigrations(dir) {
  const created = new Set()
  const dropped = new Set()
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8')
    for (const m of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?plm\.("?)([A-Za-z_][A-Za-z0-9_]*)\1/gi)) {
      created.add(m[2])
    }
    for (const m of text.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?plm\.("?)([A-Za-z_][A-Za-z0-9_]*)\1/gi)) {
      dropped.add(m[2])
    }
  }
  for (const d of dropped) created.delete(d)
  return [...created].sort()
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i === -1 ? null : process.argv[i + 1]
}

export function run() {
  const manifest = loadManifest()
  let failures = checkManifestShape(manifest)

  const migrationFile = path.join(
    ROOT, 'supabase/migrations',
    `${manifest.migration_version}_all_licensor_property_source_coverage.sql`)
  if (!fs.existsSync(migrationFile)) {
    failures.push(`the reserved migration ${manifest.migration_version} is missing`)
  } else {
    failures = failures.concat(
      checkMigrationEvidence(manifest, fs.readFileSync(migrationFile, 'utf8')))
  }

  const catalogFile = arg('--catalog')
  const inventoryFile = arg('--inventory')
  let tables
  let live = false
  if (catalogFile) {
    tables = fs.readFileSync(catalogFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    live = true
  } else if (inventoryFile) {
    tables = JSON.parse(fs.readFileSync(inventoryFile, 'utf8')).map((r) => r.table_name)
    live = true
  } else {
    tables = catalogFromMigrations(path.join(ROOT, 'supabase/migrations'))
  }
  // The non-empty-family requirement is not a live-catalog luxury: CI runs this
  // script with the derived catalog, so gating the rule on --catalog/--inventory
  // meant the "refuse an unclassified family" rule never ran where the gate
  // actually runs. It is enforced on every path now; the derived path's one
  // blind spot -- a table older than this repository's migration history -- is
  // handled by an explicit, recorded per-family declaration, not by skipping.
  failures = failures.concat(
    checkCatalog(manifest, tables, { requireNonEmptyFamilies: true, derived: !live }))

  if (inventoryFile) {
    failures = failures.concat(
      checkInventory(manifest, JSON.parse(fs.readFileSync(inventoryFile, 'utf8'))))
  }

  if (failures.length) {
    console.error('ERROR: DB Data Admin Property-source coverage manifest failed:')
    for (const f of failures) console.error(`  ${f}`)
    return 1
  }
  const exposed = manifest.families.filter((f) => f.disposition === 'exposed').length
  console.log(
    `DB Data Admin Property-source coverage passed: ${manifest.families.length} families, ` +
    `${exposed} exposed, ${tables.length} plm tables classified ` +
    `(${live ? 'live catalog' : 'catalog derived from migrations'}).`)
  return 0
}

if (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(run())
}
