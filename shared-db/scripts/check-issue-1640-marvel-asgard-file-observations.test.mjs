import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const migration = readFileSync(
  fileURLToPath(new URL(
    '../supabase/migrations/20260827101135_marvel_asgard_lossless_file_observations.sql',
    import.meta.url,
  )),
  'utf8',
)

test('keeps the source UUID asset group while moving filenames to observations', () => {
  assert.match(migration, /original_file_id is distinct from x\.original_file_id/)
  assert.match(migration, /alter column exact_filename drop not null/)
  assert.match(migration, /add column file_observation_key text/)
  assert.match(migration, /add column exact_filename text/)
  assert.match(migration, /primary key \(capture_key,guide_node_id,file_observation_key\)/)
})

test('requires lossless observation evidence and fails conflicting replay closed', () => {
  assert.match(migration, /x\.file_observation_key is null/)
  assert.match(migration, /x\.exact_filename is null/)
  assert.match(migration, /jsonb_typeof\(x\.raw_observation\)<>'object'/)
  assert.match(migration, /file-observation replay conflict/)
  assert.match(migration, /o\.asset_id is distinct from a\.id/)
  assert.match(migration, /o\.exact_filename is distinct from x\.exact_filename/)
  assert.match(migration, /o\.raw_observation is distinct from x\.raw_observation/)
})

test('retains file-card provenance without adding public access', () => {
  assert.match(migration, /page_number,asset_id,file_observation_key/)
  assert.match(migration, /file_size_bytes,source_display_order/)
  assert.match(migration, /raw_observation_sha256,raw_observation/)
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete).*authenticated/i)
})
