import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const SAFE_TABULAR = new Set([
  'docs/coldlion-field-decisions-20260819.csv',
  'docs/verification/popsg-property-reconciliation-20260726/normalization-fixtures-v1.csv',
])

const SAFE_SENSITIVE_PATH_DATA = new Set([
  'docs/verification/coldlion-licensor-property-phase2b-20260724/source-hashes.json',
  'docs/verification/popsg-property-reconciliation-20260726/normalization-fixtures-v1.csv',
  'docs/verification/popsg-property-reconciliation-20260727-psg3/approval.json',
  'docs/verification/popsg-property-reconciliation-20260728-psg4/approval-language.txt',
  'docs/verification/popsg-property-reconciliation-20260728-psg4/manifest.json',
  'docs/verification/popsg-property-reconciliation-20260728-psg4/owner-approval.json',
])

// Issue #2391: PostgreSQL structural statistics captured by the database-efficiency runbook are
// catalog metadata (object names, sizes, counters, placeholder-normalized statement text), not
// licensed or business rows; object names already appear in public migrations. Only these four
// capture file names, directly inside a timestamped run directory, are permitted.
const SAFE_STRUCTURAL_STATS =
  /^docs\/verification\/database-efficiency\/\d{8}T\d{6}Z\/run\d+\/(?:foreign-keys|indexes|pg-stat-statements-top\d+|relation-stats)\.csv$/
const TABULAR = /\.(?:csv|tsv|xlsx|xls)$/i
const DATA_ARTIFACT = /\.(?:csv|tsv|xlsx|xls|json|txt|png)$/i
const SENSITIVE_PATH = /^docs\/verification\/(?:character-identity-rules|coldlion-licensor-property|master-data-designflow-reference-cutover|opa-preview-load|popsg-property-reconciliation|style-guide-property-mapping)|^docs\/verification\/db-data-admin.*\.png$/i

export function publicVenueViolations(paths) {
  return paths.filter((path) =>
    (TABULAR.test(path) && !SAFE_TABULAR.has(path) && !SAFE_STRUCTURAL_STATS.test(path)) ||
    (SENSITIVE_PATH.test(path) && DATA_ARTIFACT.test(path) && !SAFE_SENSITIVE_PATH_DATA.has(path)))
}

test('licensed and internal data artifacts stay in the private source-data repository', () => {
  const paths = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
  assert.deepEqual(publicVenueViolations(paths), [],
    'move data artifacts to private u2giants/licensor-source-data and link them from docs/private-data-artifacts.md')
})

test('the venue guard catches new spreadsheets and source-derived evidence', () => {
  assert.deepEqual(publicVenueViolations([
    'docs/new-export.csv',
    'docs/verification/popsg-property-reconciliation-new/raw.json',
    'docs/verification/db-data-admin-live.png',
  ]), [
    'docs/new-export.csv',
    'docs/verification/popsg-property-reconciliation-new/raw.json',
    'docs/verification/db-data-admin-live.png',
  ])
})

test('the structural-statistics exception stays narrow (#2391)', () => {
  const base = 'docs/verification/database-efficiency/20260904T212459Z/run1/'
  assert.deepEqual(publicVenueViolations([
    `${base}indexes.csv`,
    `${base}pg-stat-statements-top300.csv`,
    `${base}licensor-rows.csv`,
    `${base}nested/indexes.csv`,
    'docs/verification/database-efficiency/indexes.csv',
    'docs/verification/other/20260904T212459Z/run1/indexes.csv',
    `${base}indexes.xlsx`,
  ]), [
    `${base}licensor-rows.csv`,
    `${base}nested/indexes.csv`,
    'docs/verification/database-efficiency/indexes.csv',
    'docs/verification/other/20260904T212459Z/run1/indexes.csv',
    `${base}indexes.xlsx`,
  ])
})

test('the narrow public configuration and synthetic fixtures remain permitted', () => {
  assert.deepEqual(publicVenueViolations([...SAFE_TABULAR, ...SAFE_SENSITIVE_PATH_DATA]), [])
})
