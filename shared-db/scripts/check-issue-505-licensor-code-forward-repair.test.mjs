import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../supabase/migrations/20260830204711_licensors_external_id_canonical_codes.sql', import.meta.url),
  'utf8',
)
const productionGuard = readFileSync(new URL('./production_migration_guard.py', import.meta.url), 'utf8')
const producerGate = readFileSync(new URL('./production_business_risk_gate.py', import.meta.url), 'utf8')

test('DS SKU artifacts are refused only on licensed or Disney identity evidence', () => {
  const assetGuard = migration.split('from public.assets a')[1].split('from public.style_groups')[0]
  assert.match(assetGuard, /a\.licensor_name is not null/)
  assert.match(assetGuard, /a\.property_id is not null/)
  assert.match(assetGuard, /a\.is_licensed is distinct from false/)
  assert.match(assetGuard, /a\.licensor_id = c_disney_core/)
  assert.match(assetGuard, /c\.id = a\.licensor_id[\s\S]*c\.status = 'active'[\s\S]*lower\(c\.code\) not in \('ds', 'dy'\)/)
  assert.doesNotMatch(assetGuard, /licensor_id is not null or is_licensed/)

  const styleGuard = migration.split('from public.style_groups sg')[1].split('if v_n <> 0 then')[0]
  assert.match(styleGuard, /sg\.licensor_name is not null/)
  assert.match(styleGuard, /sg\.property_id is not null/)
  assert.match(styleGuard, /sg\.is_licensed is distinct from false/)
  assert.match(styleGuard, /sg\.licensor_id = c_disney_core/)
  assert.match(styleGuard, /c\.id = sg\.licensor_id[\s\S]*c\.status = 'active'[\s\S]*lower\(c\.code\) not in \('ds', 'dy'\)/)
  assert.doesNotMatch(styleGuard, /licensor_id is not null or is_licensed/)
})

test('forward repair preserves every asset and style-group row', () => {
  assert.doesNotMatch(migration, /update\s+public\.(?:assets|style_groups)\b/i)
  assert.match(migration, /v_ds_after <> v_ds_before/)
  assert.match(migration, /v_sg_ds_after <> v_sg_ds_before/)
})

test('stranded original is blocked and the producer gate pins the successor sidecar', () => {
  assert.match(productionGuard, /"20260830195655"/)
  assert.match(producerGate, /20260830204711\.json/)
})
