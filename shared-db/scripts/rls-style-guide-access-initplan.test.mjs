import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inspectPrStructuralChange, structuralWritesMatch } from './db-flow/admission.mjs'
import { validateClaimObjects } from './lib/lanes/claims.mjs'

const migration = 'supabase/migrations/20261023141625_style_guide_access_initplans.sql'
const sql = readFileSync(new URL('../' + migration, import.meta.url), 'utf8')
const contract = JSON.parse(readFileSync(new URL('../.agent/work/4429/2/contract.json', import.meta.url)))

test('canonical DDL inspector recognizes exactly the admitted style-guide writes', () => {
  const inspected = inspectPrStructuralChange([{ filename: migration, status: 'added', content: sql }])
  assert.equal(structuralWritesMatch(inspected, validateClaimObjects(contract.db_writes)), true)
})

test('exactly 4 ALTER POLICY statements wrap has_app_access', () => {
  const alters = [...sql.matchAll(/^ALTER POLICY [\s\S]*?;$/gm)]
  assert.equal(alters.length, 4)
  for (const m of alters) {
    assert.match(m[0], /has_app_access\(/)
    assert.match(m[0], /\( SELECT has_app_access\(/)
    assert.doesNotMatch(m[0], /ON "archive"\./)
  }
})

test('before and after guards are present and fail closed', () => {
  assert.match(sql, /\$rls4429_before\$/)
  assert.match(sql, /\$rls4429_after\$/)
  assert.match(sql, /must be STABLE/)
  assert.match(sql, /expected 4 target style-guide policies/)
})

test('offline CI runs this suite (#4429)', () => {
  const wf = readFileSync(new URL('../.github/workflows/tools-offline-tests.yml', import.meta.url), 'utf8')
  assert.match(wf, /node --test scripts\/rls-style-guide-access-initplan\.test\.mjs/)
})
