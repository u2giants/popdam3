import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { HISTORICAL_RESTORATIONS, validateHistoricalRestorationFile } from './historical-migration-restorations.mjs'

test('pins the one authenticated preview historical restoration',()=>{
  const row=HISTORICAL_RESTORATIONS['20260817150944']
  assert.equal(row.name,'sync_dflow_columns_onto_plm_designflow_copies')
  assert.equal(row.creatorSha256,'ede9ab5ebdcbbb7af5760ff9ce653aa402b0c53a41e2ee9bdf18121204e58b9a')
  assert.equal(row.previewProject,'mvpkijzfmfcxhnzqogzs')
  assert.deepEqual(row.objects,['table plm.rfqitem','table plm.gridviewstate','table plm.itemdetail'])
})

test('pins the Sample Tracking preview ledger restoration byte for byte',()=>{
  const row=HISTORICAL_RESTORATIONS['20260824150630']
  assert.equal(row.name,'sample_tracking_piece_split_and_transit_return')
  assert.equal(row.previewProject,'mvpkijzfmfcxhnzqogzs')
  assert.equal(row.fileSha256,'5e9829b2cab7f0462804acce18bccf0d65b9c88363e9e54290581513047f4a52')
  assert.equal(row.statementBytes,15811)
  assert.equal(validateHistoricalRestorationFile(row.filename,readFileSync(row.filename,'utf8')),row)
})

test('refuses wrong paths and bytes',()=>{
  assert.throws(()=>validateHistoricalRestorationFile('supabase/migrations/20260817150944_wrong.sql','select 1;\n'),/not an approved/)
  assert.throws(()=>validateHistoricalRestorationFile(HISTORICAL_RESTORATIONS['20260817150944'].filename,'select 1;\n'),/hash mismatch/)
})
