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

const TABULAR = /\.(?:csv|tsv|xlsx|xls)$/i
const DATA_ARTIFACT = /\.(?:csv|tsv|xlsx|xls|json|txt|png)$/i
const SENSITIVE_PATH = /^docs\/verification\/(?:character-identity-rules|coldlion-licensor-property|master-data-designflow-reference-cutover|opa-preview-load|popsg-property-reconciliation|style-guide-property-mapping)|^docs\/verification\/db-data-admin.*\.png$/i

export function publicVenueViolations(paths) {
  return paths.filter((path) =>
    (TABULAR.test(path) && !SAFE_TABULAR.has(path)) ||
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

test('the narrow public configuration and synthetic fixtures remain permitted', () => {
  assert.deepEqual(publicVenueViolations([...SAFE_TABULAR, ...SAFE_SENSITIVE_PATH_DATA]), [])
})
