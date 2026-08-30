import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

test('contract runner starts without blanket licensing authorization', () => {
  const workflow = fs.readFileSync(
    path.join(root, '.github/workflows/database-contract-tests.yml'),
    'utf8',
  )
  const defaultArm = workflow.match(/\*\)\s+printf 'begin;\\n([^']*)'/)?.[1] ?? ''
  assert.ok(defaultArm.includes('\\ir %s'), 'wrapper must still execute each contract file')
  assert.ok(defaultArm.includes('rollback;'), 'wrapper must still roll every contract back')
  assert.doesNotMatch(
    defaultArm,
    /ci_authorize_licensing_contract_test/,
    'a default authorization makes guard-refusal contracts pass without exercising the guard',
  )
})

test('blanket helper is opt-in only in the known legacy contract', () => {
  const testsDir = path.join(root, 'supabase/tests')
  const callers = fs.readdirSync(testsDir)
    .filter(name => name.endsWith('.sql'))
    .filter(name => /select\s+public\.ci_authorize_licensing_contract_test\s*\(\s*\)/i.test(
      fs.readFileSync(path.join(testsDir, name), 'utf8'),
    ))
  assert.deepEqual(callers, ['clickup_task_import_contracts.sql'])
})

test('runner authorization is limited to the audited legacy fixture allowlist', () => {
  const workflow = fs.readFileSync(
    path.join(root, '.github/workflows/database-contract-tests.yml'),
    'utf8',
  )
  const optInArm = workflow.match(/case "\$base" in\s+([^)]*)\)\s+printf 'begin;\\nselect public\.ci_authorize_licensing_contract_test/)?.[1] ?? ''
  const actual = optInArm.split('|').map(name => name.trim()).filter(Boolean).sort()
  const expected = [
    'coldlion_licensor_property_phase1_contracts.sql',
    'coldlion_licensor_property_phase2_contracts.sql',
    'coldlion_licensor_property_phase4_contracts.sql',
    'contract_property_evidence_contracts.sql',
    'db_data_admin_licensor_property_tree.sql',
    'item_taxonomy_phase2_fixture.sql',
    'opa_normalized_sync_contracts.sql',
    'opa_property_character_importer_contracts.sql',
    'opa_property_character_landing_contracts.sql',
    'popdam_effective_asset_filter_contracts.sql',
    'popsg_property_resolution_contracts.sql',
    'source_resolution_durability_contracts.sql',
    'source_resolution_remaining_sources_contracts.sql',
    'wb_canonical_relationship_edges_contracts.sql',
  ].sort()
  assert.deepEqual(actual, expected)
  assert.ok(actual.every(name => !/(guard|refusal)/i.test(name)))
})
