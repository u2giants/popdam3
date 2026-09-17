#!/usr/bin/env node
// Issue #2611: guard the prepack exclusion so it cannot silently regress.
//
// Owner ruling (docs/business-rules/product-items-and-identifiers.md, 2026-09-06):
// prepacks "must be excluded from any population being assessed for missing
// Licensor or Property, not chased for attribution." That rule lived only in
// prose for months and was never implemented; this script exists so that if the
// implementation is weakened or reverted, a check goes red instead of a known
// assortment head quietly reappearing in a missing-attribution population.
//
// This repository's check scripts validate repository artifacts offline -- none
// of them opens a database connection, and this one does not either. It
// therefore guards the DEFINITIONS, each on its own: the newest migration that
// defines the view for the
// missing-attribution population must route its assortment test through
// plm.prepack_role, and the newest migration that defines plm.prepack_role, even
// one that never names the view, must keep testing both roles against ColdLion. A live-data assertion belongs to the promotion run, not to CI.
//
// Named fixture, re-derived against production on 2026-09-11 and recorded with
// its query in docs/verification/prepack-exclusion-20260911.md: seven prepack
// heads sit in a LICENSED division and are missing attribution today. A head in
// EH001/EP001 would prove nothing, because the non-licensed-division rule
// removes it whether or not the prepack filter works.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = path.join(ROOT, 'supabase/migrations')
const VERIFICATION = 'docs/verification/prepack-exclusion-20260911.md'

export const POPULATION_VIEW = 'plm.item_missing_attribution'
export const ROLE_FUNCTION = 'plm.prepack_role'

// Prepack heads in a licensed division, missing attribution on 2026-09-11.
export const KNOWN_LICENSED_DIVISION_HEADS = [
  'AA814DYCR01',
  'AAH62NBEX01',
  'AAH62WBLB01',
  'VF122FKFK01',
  'VF122FKFK02',
  'VF122FKFK03',
  'VFS22FKFK01',
]

// The exclusions that must survive, in the order they bite. Non-licensed
// divisions first: see unmapped-licensor-population.md.
const NON_LICENSED_DIVISIONS = ['EH001', 'EP001']

const strip = (sql) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')

/**
 * Pure inspection of one migration's SQL text. Exported so the test can feed it
 * a known-dirty variant: a guard that has never been shown to fail is not
 * evidence that anything passed.
 */
const viewDefinition = (sql) =>
  sql.match(new RegExp(`create\\s+(or\\s+replace\\s+)?view\\s+${POPULATION_VIEW}\\b[\\s\\S]*?;`))
const functionDefinition = (sql) =>
  sql.match(new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+${ROLE_FUNCTION}\\b[\\s\\S]*?\\$\\$;`))

export function inspect(sqlText) {
  const sql = strip(sqlText).toLowerCase()
  const failures = inspectView(sql)
  if (functionDefinition(sql)) failures.push(...inspectFunction(sql))
  return failures
}

export function inspectView(sqlText) {
  const failures = []
  const sql = strip(sqlText).toLowerCase()

  const viewMatch = viewDefinition(sql)
  if (!viewMatch) {
    failures.push(`no definition of view ${POPULATION_VIEW} found`)
    return failures
  }
  const body = viewMatch[0]

  if (!body.includes(ROLE_FUNCTION)) {
    failures.push(
      `${POPULATION_VIEW} does not call ${ROLE_FUNCTION}: a known assortment head ` +
        `(e.g. ${KNOWN_LICENSED_DIVISION_HEADS[0]}) would reappear as a missing-attribution row`,
    )
  } else if (!/plm\.prepack_role\s*\([\s\S]*?\)\s*is\s+null/.test(body)) {
    failures.push(
      `${POPULATION_VIEW} calls ${ROLE_FUNCTION} but does not require it to be null; ` +
        'both heads and members must be excluded',
    )
  }

  for (const division of NON_LICENSED_DIVISIONS) {
    if (!body.includes(division.toLowerCase())) {
      failures.push(
        `${POPULATION_VIEW} does not exclude non-licensed division ${division} ` +
          '(owner ruling 2026-09-06)',
      )
    }
  }

  if (body.includes('erp_items_current')) {
    failures.push(
      `${POPULATION_VIEW} references public.erp_items_current, which is a frozen ` +
        'DesignFlow snapshot whose prepack rows are members, not heads (#2611), and ' +
        'is being retired by #2482',
    )
  }

  return failures
}

export function inspectFunction(sqlText) {
  const failures = []
  const sql = strip(sqlText).toLowerCase()
  const fnMatch = functionDefinition(sql)
  if (!fnMatch) {
    failures.push(`no definition of function ${ROLE_FUNCTION} found`)
  } else {
    const fn = fnMatch[0]
    if (fn.includes('erp_items_current')) {
      failures.push(
        `${ROLE_FUNCTION} references public.erp_items_current, the retired DesignFlow snapshot (#2611, #2482)`,
      )
    }
    if (!fn.includes('coldlion.prod_history_component')) {
      failures.push(
        `${ROLE_FUNCTION} no longer tests heads against ` +
          'coldlion.prod_history_component, the transaction-attested head source',
      )
    }
    if (!fn.includes('coldlion.item_detail')) {
      failures.push(
        `${ROLE_FUNCTION} no longer tests members against coldlion.item_detail`,
      )
    }
    for (const role of ['head', 'member']) {
      if (!fn.includes(`'${role}'`)) {
        failures.push(`${ROLE_FUNCTION} no longer returns '${role}'`)
      }
    }
  }

  return failures
}

/**
 * Judge the view and the role function separately, each from the newest
 * migration that DEFINES it (the definition the database ends up with), so a
 * later migration that replaces only plm.prepack_role is inspected even when it
 * never names the view. Exported for the test.
 */
export function inspectMigrations(migrations) {
  const failures = []
  const ordered = [...migrations].sort((a, b) => a.name.localeCompare(b.name))
  const newest = (definition) =>
    ordered.filter((m) => definition(strip(m.sql).toLowerCase())).at(-1)

  const view = newest(viewDefinition)
  if (!view) {
    failures.push(`no migration defines ${POPULATION_VIEW}; the prepack exclusion is prose again (#2611)`)
  } else {
    for (const failure of inspectView(view.sql)) failures.push(`${view.name}: ${failure}`)
  }

  const fn = newest(functionDefinition)
  if (!fn) {
    failures.push(`no migration defines ${ROLE_FUNCTION}; the prepack exclusion is prose again (#2611)`)
  } else {
    for (const failure of inspectFunction(fn.sql)) failures.push(`${fn.name}: ${failure}`)
  }

  return { failures, view: view?.name, fn: fn?.name }
}

function main() {
  const migrations = fs
    .readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS, name), 'utf8') }))
  const inspected = inspectMigrations(migrations)
  const failures = [...inspected.failures]

  const note = path.join(ROOT, VERIFICATION)
  if (!fs.existsSync(note)) {
    failures.push(`${VERIFICATION} is missing; the fixture heads lose their provenance`)
  } else {
    const text = fs.readFileSync(note, 'utf8')
    const missing = KNOWN_LICENSED_DIVISION_HEADS.filter((item) => !text.includes(item))
    if (missing.length > 0) {
      failures.push(
        `${VERIFICATION} no longer records fixture head(s) ${missing.join(', ')}`,
      )
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`)
    process.exit(1)
  }

  console.log(
    `Prepack exclusion check passed: ${inspected.view} and ${inspected.fn} exclude both prepack ` +
      `roles and the non-licensed divisions, and ${KNOWN_LICENSED_DIVISION_HEADS.length} ` +
      'fixture heads keep their recorded provenance.',
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
