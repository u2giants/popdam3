import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inspectPrStructuralChange, structuralWritesMatch } from './db-flow/admission.mjs'
import { validateClaimObjects } from './lib/lanes/claims.mjs'

const migration = 'supabase/migrations/20261023151801_packaging_access_initplans.sql'
const sql = readFileSync(new URL('../' + migration, import.meta.url), 'utf8')
const contract = JSON.parse(readFileSync(new URL('../.agent/work/4430/1/contract.json', import.meta.url)))

test('canonical DDL inspector recognizes exactly the admitted packaging writes', () => {
  const inspected = inspectPrStructuralChange([{ filename: migration, status: 'added', content: sql }])
  assert.equal(structuralWritesMatch(inspected, validateClaimObjects(contract.db_writes)), true)
})

test('exactly 2 ALTER POLICY statements wrap only helper subexpressions', () => {
  const alters = [...sql.matchAll(/^ALTER POLICY [\s\S]*?;$/gm)]
  assert.equal(alters.length, 2)
  for (const m of alters) {
    assert.match(m[0], /\( SELECT (app\.)?has_role\(/)
    assert.match(m[0], /apinilla@popcre\.com/)
  }
  assert.match(sql, /\( SELECT (app\.)?has_any_role\(/)
})

test('before and after guards are present and fail closed', () => {
  assert.match(sql, /\$rls4430_before\$/)
  assert.match(sql, /\$rls4430_after\$/)
  assert.match(sql, /must be STABLE/)
  assert.match(sql, /expected 2 target packaging policies/)
})

test('offline CI runs this suite (#4430)', () => {
  const wf = readFileSync(new URL('../.github/workflows/tools-offline-tests.yml', import.meta.url), 'utf8')
  assert.match(wf, /node --test scripts\/rls-packaging-access-initplan\.test\.mjs/)
})
