import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(new URL('../supabase/migrations/20260825130924_drop_contract_rights_preserve_portal_sources.sql', import.meta.url), 'utf8')
const nbcuContracts = readFileSync(new URL('../supabase/tests/nbcu_landing_contracts.sql', import.meta.url), 'utf8')
const licensingContracts = readFileSync(new URL('../supabase/tests/wildbrain_nbcu_licensing_read_access_contracts.sql', import.meta.url), 'utf8')
const privilegeContracts = readFileSync(new URL('../supabase/tests/plm_maintain_revokes_and_default_privileges.sql', import.meta.url), 'utf8')

test('drops only the empty contract-derived NBCU rights table', () => {
  assert.match(sql, /exists \(select 1 from plm\.nbcu_right\)/i)
  assert.match(sql, /raise exception 'Issue #1242 refused:/)
  assert.match(sql, /drop table if exists plm\.nbcu_right;/i)
})

test('keeps the NBCU portal publication gate and removes its rights dependency', () => {
  assert.match(sql, /create or replace function plm\.finalize_nbcu_capture\(p_capture_id uuid\)/i)
  assert.doesNotMatch(sql, /from plm\.nbcu_right where capture_id/i)
  for (const portalObject of ['nbcu_asset', 'nbcu_property', 'nbcu_character', 'nbcu_style_guide', 'nbcu_scope', 'nbcu_asset_ip_family']) {
    assert.match(sql, new RegExp(portalObject))
  }
})

test('does not alter retired or normalized Warner portal relationships', () => {
  assert.doesNotMatch(sql, /(comment on|drop|alter) (table|view).*wb_property_character/i)
  assert.doesNotMatch(sql, /wb_property_character_normalized/i)
})

test('removes the retired table from the shipped NBCU catalogue contracts', () => {
  for (const contract of [nbcuContracts, licensingContracts, privilegeContracts]) {
    assert.doesNotMatch(contract, /['"](?:plm\.)?nbcu_right['"]/i)
  }
  assert.match(nbcuContracts, /v_pass \+ v_fail <> 15/)
  assert.match(nbcuContracts, /expected 15/)
  assert.match(nbcuContracts, /if v_n <> 16 then/)
  assert.doesNotMatch(nbcuContracts, /expected 17/)
  assert.match(licensingContracts, /expected the 27 objects/i)
})
