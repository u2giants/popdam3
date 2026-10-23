import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inspectPrStructuralChange, structuralWritesMatch } from './db-flow/admission.mjs'
import { validateClaimObjects } from './lib/lanes/claims.mjs'

const migration = 'supabase/migrations/20261023122936_owner_uid_initplans.sql'
const sql = readFileSync(new URL('../' + migration, import.meta.url), 'utf8')
const contract = JSON.parse(readFileSync(new URL('../.agent/work/4428/9/contract.json', import.meta.url)))

test('canonical DDL inspector recognizes exactly the admitted ownership writes', () => {
  const inspected = inspectPrStructuralChange([{ filename: migration, status: 'added', content: sql }])
  assert.equal(structuralWritesMatch(inspected, validateClaimObjects(contract.db_writes)), true)
})

test('exactly 17 ALTER POLICY statements wrap only auth.uid()', () => {
  const alters = [...sql.matchAll(/^ALTER POLICY [\s\S]*?;$/gm)]
  assert.equal(alters.length, 17)
  for (const m of alters) {
    assert.match(m[0], /auth\.uid\(\)/)
    assert.doesNotMatch(m[0], /has_role\(/)
    assert.doesNotMatch(m[0], /ON "archive"\./)
    assert.match(m[0], /\( SELECT auth\.uid\(\) AS uid\)/)
  }
})

test('offline CI runs this suite (#4428)', () => {
  const wf = readFileSync(new URL('../.github/workflows/tools-offline-tests.yml', import.meta.url), 'utf8')
  assert.match(wf, /node --test scripts\/rls-owner-uid-initplan\.test\.mjs/)
})

test('before and after guards are present and fail closed', () => {
  assert.match(sql, /\$rls4428_before\$/)
  assert.match(sql, /\$rls4428_after\$/)
  assert.match(sql, /must be STABLE/)
  assert.match(sql, /expected 17 target ownership policies/)
})
